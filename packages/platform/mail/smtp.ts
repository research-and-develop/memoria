import type { Mailer } from '../ports';

import { domainOf } from './address';
import { MailError } from './error';
import { maskAddresses } from './mask';
import { base64, buildMessage, checkMessage } from './mime';

/**
 * Our SMTP client (plan p03, D3.6, D3.7): one connection per message, platform-neutral over a small
 * socket interface. The Cloudflare adapter wraps `cloudflare:sockets` (packages/platform-cloudflare/
 * smtp.ts); a Docker adapter would wrap `node:tls` with the same code.
 *
 * - `starttls` (587, 2525): EHLO, STARTTLS answered exactly `220` with no byte after it, TLS, the
 *   capabilities read again, then AUTH. A server without STARTTLS fails; never clear text.
 * - `tls` (465): TLS from the first byte.
 * - `none`: clear text, development only (Mailpit; `parseConfig` refuses it elsewhere).
 * - `AUTH PLAIN` only, only after TLS (or with `none`). MAIL FROM, RCPT TO, DATA with the message
 *   dot-stuffed. Resolves at the `250` to the message; `QUIT` follows through `background`, ≤ 1 s.
 * - Replies: lines ≤ 512 octets, ≤ 100 lines and ≤ 8 KB, ASCII, one code; else SMTP_PROTOCOL.
 * - Timeouts: 10 s to connect, 15 s per reply, 18 s for the whole send (before the runner's 20 s
 *   cap). A timeout or the signal closes the socket, so a send cannot complete afterwards.
 * - Any reply: 4xx transient, 5xx permanent, except 530/534/535 (authentication: configuration,
 *   retried). `detail` is the server's text, masked (D3.11). Nothing is logged here.
 */
export interface SmtpSocket {
  /** The next bytes, or null when the server closed the connection. */
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
  /** Upgrade to TLS (checking the certificate against the host); returns the new socket. Once. */
  startTls(): Promise<SmtpSocket>;
  close(): void;
}

export type SmtpSecurity = 'starttls' | 'tls' | 'none';
export type SmtpSettings = { host: string; port: number; security: SmtpSecurity; username: string | null; password: string | null };
export type SmtpConnect = (target: { host: string; port: number; security: SmtpSecurity }) => Promise<SmtpSocket>;

export const SMTP_TIMEOUTS = { connectMs: 10_000, replyMs: 15_000, sendMs: 18_000, quitMs: 1_000 };
const MAX_LINE = 512;
const MAX_LINES = 100;
const MAX_REPLY_BYTES = 8 * 1024;

type Reply = { code: number; lines: string[] };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function smtpMailer(settings: SmtpSettings, connect: SmtpConnect, opts: { background: (task: Promise<unknown>) => void; now?: () => Date }): Mailer {
  const now = opts.now ?? (() => new Date());
  return {
    async send(message, { signal }) {
      if (signal.aborted) throw new MailError('MAIL_ABORTED');
      const { from, to } = checkMessage(message);
      const mime = buildMessage(message, { date: now() });
      const session = new Session(settings, { mask: [to, settings.username] });
      const onAbort = () => session.stop(new MailError('MAIL_ABORTED'));
      signal.addEventListener('abort', onAbort, { once: true });
      const sendTimer = setTimeout(() => session.stop(new MailError('SMTP_TIMEOUT')), SMTP_TIMEOUTS.sendMs);
      try {
        const reply = await session.deliver(connect, { from, to, mime, ehloDomain: domainOf(from) });
        opts.background(session.quit());
        return { providerMessageId: queueId(reply) };
      } catch (error) {
        session.stop(error instanceof MailError ? error : new MailError('SMTP_CONNECTION'));
        throw session.failed;
      } finally {
        clearTimeout(sendTimer);
        signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

/** `250 2.0.0 Ok: queued as 4ABC12` → `4ABC12`, else null. */
function queueId(reply: Reply): string | null {
  const m = /queued as ([A-Za-z0-9._-]{1,100})/i.exec(reply.lines.join(' '));
  return m?.[1] ?? null;
}

class Session {
  failed: MailError | null = null;
  private socket: SmtpSocket | null = null;
  private buffer = new Uint8Array(0);
  private readonly failure: Promise<never>;
  private rejectFailure: (error: MailError) => void = () => {};

  constructor(
    private readonly settings: SmtpSettings,
    private readonly secrets: { mask: (string | null)[] },
  ) {
    this.failure = new Promise<never>((_, reject) => {
      this.rejectFailure = reject;
    });
    this.failure.catch(() => {}); // observed through race(); never an unhandled rejection
  }

  /** End the session with `error` (the first one wins) and close the socket. */
  stop(error: MailError): void {
    if (this.failed) return;
    this.failed = error;
    this.socket?.close();
    this.rejectFailure(error);
  }

  private race<T>(promise: Promise<T>): Promise<T> {
    if (this.failed) return Promise.reject(this.failed);
    promise.catch(() => {});
    return Promise.race([promise, this.failure]);
  }

  async deliver(connect: SmtpConnect, m: { from: string; to: string; mime: string; ehloDomain: string }): Promise<Reply> {
    const { host, port, security } = this.settings;
    const connectTimer = setTimeout(() => this.stop(new MailError('SMTP_TIMEOUT', { detail: 'connect' })), SMTP_TIMEOUTS.connectMs);
    try {
      const connecting = connect({ host, port, security }).then(
        (socket) => {
          // A socket that opens after a timeout or an abort is closed at once.
          if (this.failed) socket.close();
          else this.socket = socket;
        },
        (error: unknown) => Promise.reject(asConnectionError(error)),
      );
      await this.race(connecting);
    } finally {
      clearTimeout(connectTimer);
    }

    this.expect(await this.reply(), [220]);
    let capabilities = await this.ehlo(m.ehloDomain);
    if (security === 'starttls') {
      if (!capabilities.some((c) => /^STARTTLS$/i.test(c))) throw new MailError('SMTP_STARTTLS_UNAVAILABLE', { configuration: true });
      await this.command('STARTTLS');
      const reply = await this.reply();
      if (reply.code !== 220) throw classify(reply, this.secrets.mask);
      // Bytes after the 220 were sent before TLS: a man in the middle injecting commands.
      if (this.buffer.length > 0) throw new MailError('SMTP_TLS_INJECTION');
      const plain = this.socket!;
      this.socket = await this.race(plain.startTls().catch((error: unknown) => Promise.reject(error instanceof MailError ? error : new MailError('SMTP_TLS'))));
      capabilities = await this.ehlo(m.ehloDomain); // the pre-TLS list is discarded
    }

    const { username, password } = this.settings;
    if (username && password) {
      if (!capabilities.some((c) => /^AUTH[ =]/i.test(c) && c.slice(5).toUpperCase().split(/\s+/).includes('PLAIN'))) {
        throw new MailError('SMTP_AUTH_UNSUPPORTED', { configuration: true });
      }
      await this.command(`AUTH PLAIN ${base64(encoder.encode(`\u0000${username}\u0000${password}`))}`);
      this.expect(await this.reply(), [235]);
    }

    await this.command(`MAIL FROM:<${m.from}>`);
    this.expect(await this.reply(), [250]);
    await this.command(`RCPT TO:<${m.to}>`);
    this.expect(await this.reply(), [250, 251]);
    await this.command('DATA');
    this.expect(await this.reply(), [354]);
    await this.write(dotStuff(m.mime));
    const accepted = await this.reply();
    this.expect(accepted, [250]);
    return accepted;
  }

  /** QUIT after the message was accepted: best effort, ≤ 1 s, never throws. */
  async quit(): Promise<void> {
    const timer = setTimeout(() => this.stop(new MailError('SMTP_QUIT_TIMEOUT')), SMTP_TIMEOUTS.quitMs);
    try {
      await this.command('QUIT');
      await this.reply();
    } catch {
      // the message is already accepted
    } finally {
      clearTimeout(timer);
      this.stop(new MailError('SMTP_DONE'));
    }
  }

  private async ehlo(domain: string): Promise<string[]> {
    await this.command(`EHLO ${domain}`);
    const reply = await this.reply();
    this.expect(reply, [250]);
    return reply.lines.slice(1).map((l) => l.trim());
  }

  private expect(reply: Reply, codes: readonly number[]): void {
    if (!codes.includes(reply.code)) throw classify(reply, this.secrets.mask);
  }

  private command(line: string): Promise<void> {
    return this.write(`${line}\r\n`);
  }

  private async write(text: string): Promise<void> {
    if (!this.socket) throw new MailError('SMTP_CONNECTION');
    await this.race(this.socket.write(encoder.encode(text)).catch((error: unknown) => Promise.reject(asConnectionError(error))));
  }

  /** One reply (all its lines), within the reply timeout. */
  private async reply(): Promise<Reply> {
    const timer = setTimeout(() => this.stop(new MailError('SMTP_TIMEOUT')), SMTP_TIMEOUTS.replyMs);
    try {
      const lines: string[] = [];
      let code: number | null = null;
      let size = 0;
      for (;;) {
        const line = await this.line();
        size += line.length + 2;
        const m = /^(\d{3})(?:([ -])(.*))?$/.exec(line);
        if (!m || lines.length >= MAX_LINES || size > MAX_REPLY_BYTES) throw new MailError('SMTP_PROTOCOL');
        const lineCode = Number(m[1]);
        if (code !== null && lineCode !== code) throw new MailError('SMTP_PROTOCOL');
        code = lineCode;
        lines.push(m[3] ?? '');
        if (m[2] !== '-') return { code, lines };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** The next CRLF-terminated line (without it); reads more bytes as needed. */
  private async line(): Promise<string> {
    for (;;) {
      const end = indexOfCrlf(this.buffer);
      if (end >= 0) {
        if (end > MAX_LINE) throw new MailError('SMTP_PROTOCOL');
        const bytes = this.buffer.subarray(0, end);
        this.buffer = this.buffer.slice(end + 2);
        if (bytes.some((b) => b > 0x7e || (b < 0x20 && b !== 0x09))) throw new MailError('SMTP_PROTOCOL');
        return decoder.decode(bytes);
      }
      if (this.buffer.length > MAX_LINE + 1) throw new MailError('SMTP_PROTOCOL');
      if (!this.socket) throw new MailError('SMTP_CONNECTION');
      const chunk = await this.race(this.socket.read().catch((error: unknown) => Promise.reject(asConnectionError(error))));
      if (chunk === null) throw new MailError('SMTP_CONNECTION', { detail: 'closed by the server' });
      const joined = new Uint8Array(this.buffer.length + chunk.length);
      joined.set(this.buffer);
      joined.set(chunk, this.buffer.length);
      this.buffer = joined;
    }
  }
}

function indexOfCrlf(bytes: Uint8Array): number {
  for (let i = 0; i + 1 < bytes.length; i++) if (bytes[i] === 13 && bytes[i + 1] === 10) return i;
  return -1;
}

/** A socket failure: a MailError as it is (the adapter can tell a TLS failure), else SMTP_CONNECTION. */
function asConnectionError(error: unknown): MailError {
  return error instanceof MailError ? error : new MailError('SMTP_CONNECTION');
}

/** A reply that is not the one expected → its MailError (D3.9). */
export function classify(reply: Reply, mask: readonly (string | null)[]): MailError {
  const detail = maskAddresses(`${reply.code} ${reply.lines.join(' ')}`, { also: mask }) || undefined;
  const code = `SMTP_${reply.code}`;
  if (reply.code === 530 || reply.code === 534 || reply.code === 535) return new MailError(code, { configuration: true, detail });
  if (reply.code >= 500 && reply.code < 600) return new MailError(code, { permanent: true, detail });
  if (reply.code >= 400 && reply.code < 500) return new MailError(code, { detail });
  return new MailError('SMTP_PROTOCOL', { detail });
}

/** A leading `.` on any line doubled, and the end-of-data line added. */
export function dotStuff(mime: string): string {
  const body = mime.replace(/(^|\r\n)\./g, '$1..');
  return `${body.endsWith('\r\n') ? body : `${body}\r\n`}.\r\n`;
}

