import type { SmtpConnect, SmtpSecurity, SmtpSocket } from '../mail/smtp';

/**
 * An SMTP server in memory, driven by a script (plan p03 → SMTP and MIME): what it sends, what it
 * expects the client to write, when TLS starts. It records everything the client wrote. Test-only.
 *
 *   const server = scriptedSmtpServer([
 *     { send: '220 mx.example ESMTP\r\n' },
 *     { expect: /^EHLO / }, { send: '250-mx.example\r\n250 STARTTLS\r\n' },
 *     { expect: 'STARTTLS' }, { send: '220 go ahead\r\n' }, { tls: true },
 *     …
 *   ]);
 *   smtpMailer(settings, server.connect, { background })
 *
 * - `send`: bytes to the client (one chunk; several `send` steps = a reply split across chunks).
 * - `expect`: the next line the client writes (a string = the whole line). A mismatch is recorded in
 *   `errors` and the server closes the connection.
 * - `data`: the message after `DATA`, up to and including `\r\n.\r\n` (kept in `messages`).
 * - `tls`: the client must call `startTls()` here.
 * - `close`: the server closes the connection.
 * - `wait`: the server pauses this many ms (`setTimeout`: fake timers drive it) before going on.
 * When the script ends the server goes quiet (a hang: the client's timeouts fire).
 */
export type SmtpStep = { send: string } | { expect: string | RegExp } | { data: true } | { tls: true } | { close: true } | { wait: number };

export type ScriptedSmtpServer = {
  connect: SmtpConnect;
  /** Every line the client wrote (the message body excluded), in order. */
  readonly lines: string[];
  /** Each message received after DATA, dot-stuffing and the final `.` line as sent. */
  readonly messages: string[];
  /** What went wrong on the server's side (an unexpected line, an unexpected TLS start). */
  readonly errors: string[];
  /** `connect`, `tls`, `close`, in order. */
  readonly events: string[];
  /** The target the client connected to. */
  target: { host: string; port: number; security: SmtpSecurity } | null;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function scriptedSmtpServer(script: readonly SmtpStep[], opts: { connectError?: unknown } = {}): ScriptedSmtpServer {
  const steps = [...script];
  const outgoing: Uint8Array[] = [];
  let pendingRead: ((chunk: Uint8Array | null) => void) | null = null;
  let closed = false;
  let input = '';
  const server: ScriptedSmtpServer = {
    lines: [],
    messages: [],
    errors: [],
    events: [],
    target: null,
    async connect(target) {
      server.events.push('connect');
      server.target = target;
      if (opts.connectError !== undefined) throw opts.connectError;
      advance();
      return socket(false);
    },
  };

  function deliver(chunk: Uint8Array | null): void {
    if (pendingRead) {
      const resolve = pendingRead;
      pendingRead = null;
      resolve(chunk);
    } else if (chunk) {
      outgoing.push(chunk);
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    deliver(null);
  }

  /** Run `send` / `close` steps until one waits for the client. */
  function advance(): void {
    for (;;) {
      const step = steps[0];
      if (!step || closed) return;
      if ('send' in step) {
        steps.shift();
        deliver(encoder.encode(step.send));
      } else if ('close' in step) {
        steps.shift();
        server.events.push('close');
        close();
      } else if ('wait' in step) {
        steps.shift();
        setTimeout(() => {
          advance();
          consume();
        }, step.wait);
        return;
      } else {
        return;
      }
    }
  }

  function consume(): void {
    for (;;) {
      const step = steps[0];
      if (!step || closed) return;
      if ('data' in step) {
        const end = input.indexOf('\r\n.\r\n');
        if (end < 0) return;
        server.messages.push(input.slice(0, end + 5));
        input = input.slice(end + 5);
      } else if ('expect' in step) {
        const end = input.indexOf('\r\n');
        if (end < 0) return;
        const line = input.slice(0, end);
        input = input.slice(end + 2);
        server.lines.push(line);
        const ok = typeof step.expect === 'string' ? line === step.expect : step.expect.test(line);
        if (!ok) {
          server.errors.push(`expected ${String(step.expect)}, got ${JSON.stringify(line)}`);
          close();
          return;
        }
      } else {
        return;
      }
      steps.shift();
      advance();
    }
  }

  function socket(secure: boolean): SmtpSocket {
    let upgraded = false;
    return {
      read() {
        const chunk = outgoing.shift();
        if (chunk) return Promise.resolve(chunk);
        if (closed) return Promise.resolve(null);
        return new Promise((resolve) => {
          pendingRead = resolve;
        });
      },
      async write(bytes) {
        if (closed || upgraded) throw new Error('write after close');
        const text = decoder.decode(bytes);
        input += text;
        // Lines written while no step expects them are still recorded.
        if (!steps[0] || !('expect' in steps[0] || 'data' in steps[0])) {
          for (const line of text.split('\r\n').slice(0, -1)) server.lines.push(line);
          input = '';
          return;
        }
        consume();
      },
      async startTls() {
        const step = steps[0];
        if (secure || !step || !('tls' in step)) {
          server.errors.push('unexpected startTls');
          close();
          throw new Error('TLS refused');
        }
        steps.shift();
        upgraded = true;
        server.events.push('tls');
        advance();
        return socket(true);
      },
      close() {
        if (!closed) server.events.push('close');
        close();
      },
    };
  }

  return server;
}
