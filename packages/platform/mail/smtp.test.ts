import { afterEach, describe, expect, it, vi } from 'vitest';

import { contractMessage, describeMailerContract } from '../contract/mailer';
import type { MailMessage } from '../ports';
import { scriptedSmtpServer, type SmtpStep } from '../testing/scriptedSmtpServer';

import { MailError } from './error';
import { base64 } from './mime';
import { dotStuff, smtpMailer, SMTP_TIMEOUTS, type SmtpSettings } from './smtp';

const STARTTLS: SmtpSettings = { host: 'smtp.example.net', port: 587, security: 'starttls', username: 'studio-login', password: 'app-password' };
const IMPLICIT: SmtpSettings = { ...STARTTLS, port: 465, security: 'tls' };
const MAILPIT: SmtpSettings = { host: '127.0.0.1', port: 1025, security: 'none', username: null, password: null };
const AUTH_LINE = `AUTH PLAIN ${base64(new TextEncoder().encode('\u0000studio-login\u0000app-password'))}`;

const greeting: SmtpStep[] = [{ send: '220 mx.example.net ESMTP ready\r\n' }];
const ehlo = (caps: string[]): SmtpStep[] => [{ expect: 'EHLO example.com' }, { send: ['mx.example.net', ...caps].map((c, i, all) => `250${i === all.length - 1 ? ' ' : '-'}${c}\r\n`).join('') }];
const starttls: SmtpStep[] = [{ expect: 'STARTTLS' }, { send: '220 2.0.0 Ready to start TLS\r\n' }, { tls: true }];
const auth: SmtpStep[] = [{ expect: AUTH_LINE }, { send: '235 2.7.0 Authentication successful\r\n' }];
const envelope = (rcpt = '250 2.1.5 Ok\r\n'): SmtpStep[] => [
  { expect: 'MAIL FROM:<studio@example.com>' },
  { send: '250 2.1.0 Ok\r\n' },
  { expect: 'RCPT TO:<client@example.org>' },
  { send: rcpt },
];
const data = (end = '250 2.0.0 Ok: queued as 4ABC12\r\n'): SmtpStep[] => [{ expect: 'DATA' }, { send: '354 End data with <CR><LF>.<CR><LF>\r\n' }, { data: true }, { send: end }];
const quit: SmtpStep[] = [{ expect: 'QUIT' }, { send: '221 2.0.0 Bye\r\n' }];
const flow587 = (o: { rcpt?: string; end?: string } = {}): SmtpStep[] => [
  ...greeting,
  ...ehlo(['PIPELINING', 'STARTTLS', 'SIZE 35882577']),
  ...starttls,
  ...ehlo(['AUTH LOGIN PLAIN', 'SIZE 35882577']),
  ...auth,
  ...envelope(o.rcpt),
  ...data(o.end),
  ...quit,
];

function setup(script: SmtpStep[], settings: SmtpSettings = STARTTLS, opts: { connectError?: unknown } = {}) {
  const server = scriptedSmtpServer(script, opts);
  const background: Promise<unknown>[] = [];
  const mailer = smtpMailer(settings, server.connect, { background: (t) => background.push(t), now: () => new Date('2026-11-16T12:00:00Z') });
  return { server, mailer, background, settle: () => Promise.all(background) };
}

const send = (mailer: ReturnType<typeof setup>['mailer'], message: MailMessage = contractMessage(), signal = new AbortController().signal) => mailer.send(message, { signal });
const failure = (promise: Promise<unknown>) => promise.then(() => Promise.reject(new Error('expected a failure')), (e: unknown) => e as MailError);

afterEach(() => {
  vi.useRealTimers();
});

describe('smtpMailer: the flows', () => {
  it('587: STARTTLS, EHLO again, AUTH PLAIN after TLS, the message, resolve at 250, QUIT after', async () => {
    const { server, mailer, settle } = setup(flow587());
    await expect(send(mailer)).resolves.toEqual({ providerMessageId: '4ABC12' });
    await settle();
    expect(server.errors).toEqual([]);
    expect(server.target).toEqual({ host: 'smtp.example.net', port: 587, security: 'starttls' });
    expect(server.lines).toEqual(['EHLO example.com', 'STARTTLS', 'EHLO example.com', AUTH_LINE, 'MAIL FROM:<studio@example.com>', 'RCPT TO:<client@example.org>', 'DATA', 'QUIT']);
    expect(server.events).toEqual(['connect', 'tls', 'close']);
    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]).toContain('Subject: Hello\r\n');
    expect(server.messages[0]).toContain('Message-ID: <c0ffee00-0000-4000-8000-000000000001@example.com>\r\n');
    expect(server.messages[0]!.endsWith('\r\n.\r\n')).toBe(true);
  });

  it('465: TLS from the start, no STARTTLS', async () => {
    const { server, mailer } = setup([...greeting, ...ehlo(['AUTH=PLAIN']), ...auth, ...envelope(), ...data('250 ok\r\n'), ...quit], IMPLICIT);
    await expect(send(mailer)).resolves.toEqual({ providerMessageId: null });
    expect(server.target?.security).toBe('tls');
    expect(server.lines).not.toContain('STARTTLS');
    expect(server.errors).toEqual([]);
  });

  it('none (development): no TLS, no AUTH without a username', async () => {
    const { server, mailer } = setup([...greeting, ...ehlo(['SIZE 1']), ...envelope(), ...data(), ...quit], MAILPIT);
    await expect(send(mailer)).resolves.toBeTruthy();
    expect(server.lines.some((l) => l.startsWith('AUTH'))).toBe(false);
    expect(server.errors).toEqual([]);
  });

  it('a reply split across chunks, mid-line, is read whole', async () => {
    const { server, mailer } = setup([
      ...greeting,
      { expect: 'EHLO example.com' },
      { send: '250-mx.example.net\r\n250-STA' },
      { send: 'RTTLS\r' },
      { send: '\n250 SIZE 1\r\n' },
      ...starttls,
      ...ehlo(['AUTH PLAIN']),
      ...auth,
      ...envelope(),
      ...data(),
      ...quit,
    ]);
    await expect(send(mailer)).resolves.toBeTruthy();
    expect(server.errors).toEqual([]);
  });

  it('a leading dot on a line is doubled, and the end line added', () => {
    expect(dotStuff('.a\r\nb\r\n..c\r\n')).toBe('..a\r\nb\r\n...c\r\n.\r\n');
    expect(dotStuff('x')).toBe('x\r\n.\r\n');
  });
});

describe('smtpMailer: TLS and AUTH', () => {
  it('no STARTTLS offered → SMTP_STARTTLS_UNAVAILABLE (configuration), never clear text', async () => {
    const { server, mailer } = setup([...greeting, ...ehlo(['AUTH PLAIN'])]);
    expect(await failure(send(mailer))).toMatchObject({ code: 'SMTP_STARTTLS_UNAVAILABLE', permanent: false, configuration: true });
    expect(server.lines).toEqual(['EHLO example.com']);
  });

  it('STARTTLS answered 454 → transient, no AUTH sent', async () => {
    const { server, mailer } = setup([...greeting, ...ehlo(['STARTTLS']), { expect: 'STARTTLS' }, { send: '454 4.7.0 TLS not available\r\n' }]);
    expect(await failure(send(mailer))).toMatchObject({ code: 'SMTP_454', permanent: false });
    expect(server.lines.some((l) => l.startsWith('AUTH'))).toBe(false);
  });

  it('bytes after the STARTTLS 220 → SMTP_TLS_INJECTION, TLS not started', async () => {
    const { server, mailer } = setup([...greeting, ...ehlo(['STARTTLS']), { expect: 'STARTTLS' }, { send: '220 go\r\n250 injected\r\n' }]);
    expect(await failure(send(mailer))).toMatchObject({ code: 'SMTP_TLS_INJECTION', permanent: false });
    expect(server.events).not.toContain('tls');
  });

  it('the capabilities are read again after TLS (AUTH offered only before → unsupported)', async () => {
    const { server, mailer } = setup([...greeting, ...ehlo(['STARTTLS', 'AUTH PLAIN']), ...starttls, ...ehlo(['SIZE 1'])]);
    expect(await failure(send(mailer))).toMatchObject({ code: 'SMTP_AUTH_UNSUPPORTED', configuration: true });
    expect(server.lines.some((l) => l.startsWith('AUTH'))).toBe(false);
  });

  it('no PLAIN → SMTP_AUTH_UNSUPPORTED', async () => {
    const { mailer } = setup([...greeting, ...ehlo(['AUTH LOGIN XOAUTH2'])], IMPLICIT);
    expect(await failure(send(mailer))).toMatchObject({ code: 'SMTP_AUTH_UNSUPPORTED' });
  });

  it('a failed TLS upgrade → SMTP_TLS', async () => {
    const { mailer } = setup([...greeting, ...ehlo(['STARTTLS']), { expect: 'STARTTLS' }, { send: '220 go\r\n' }]);
    expect(await failure(send(mailer))).toMatchObject({ code: 'SMTP_TLS', permanent: false });
  });

  it.each([
    ['a refused connection', new Error('ECONNREFUSED'), 'SMTP_CONNECTION'],
    ['the adapter’s own MailError (a bad certificate)', new MailError('SMTP_TLS'), 'SMTP_TLS'],
  ])('connect fails: %s', async (_label, error, code) => {
    const { mailer } = setup([], STARTTLS, { connectError: error });
    expect(await failure(send(mailer))).toMatchObject({ code, permanent: false });
  });
});

describe('smtpMailer: replies', () => {
  it.each([
    ['a 513-octet line', `220 ${'x'.repeat(509)}\r\n`],
    ['101 lines', `${'220-x\r\n'.repeat(100)}220 x\r\n`],
    ['mixed codes', '220-a\r\n250 b\r\n'],
    ['a non-ASCII byte', '220 héllo\r\n'],
    ['no code', 'hello\r\n'],
  ])('%s → SMTP_PROTOCOL', async (_label, reply) => {
    const { mailer } = setup([{ send: reply }]);
    expect(await failure(send(mailer))).toMatchObject({ code: 'SMTP_PROTOCOL', permanent: false });
  });

  it.each([
    ['550 on RCPT', { rcpt: '550 5.1.1 <client@example.org>: Recipient address rejected\r\n' }, 'SMTP_550', true, false],
    ['552 on RCPT', { rcpt: '552 5.2.2 Mailbox full\r\n' }, 'SMTP_552', true, false],
    ['451 on RCPT', { rcpt: '451 4.3.0 Try again later\r\n' }, 'SMTP_451', false, false],
    ['554 to the message', { end: '554 5.7.1 Message rejected as spam\r\n' }, 'SMTP_554', true, false],
    ['421 to the message', { end: '421 4.7.0 Too many messages\r\n' }, 'SMTP_421', false, false],
  ])('%s → %s', async (_label, o, code, permanent, configuration) => {
    const { mailer } = setup(flow587(o));
    expect(await failure(send(mailer))).toMatchObject({ code, permanent, configuration });
  });

  it.each([
    ['535', '535 5.7.8 Authentication failed for studio-login\r\n'],
    ['534', '534 5.7.9 Application-specific password required\r\n'],
    ['530', '530 5.7.0 Must issue a STARTTLS command first\r\n'],
  ])('%s on AUTH → configuration, retried (not permanent)', async (code, reply) => {
    const { mailer } = setup([...greeting, ...ehlo(['AUTH PLAIN']), { expect: AUTH_LINE }, { send: reply }], IMPLICIT);
    expect(await failure(send(mailer))).toMatchObject({ code: `SMTP_${code}`, permanent: false, configuration: true });
  });

  it('a 4xx/5xx to DATA is classified by its first digit', async () => {
    const make = (reply: string) => setup([...greeting, ...ehlo(['AUTH PLAIN']), ...auth, ...envelope(), { expect: 'DATA' }, { send: reply }], IMPLICIT);
    expect(await failure(send(make('451 later\r\n').mailer))).toMatchObject({ code: 'SMTP_451', permanent: false });
    expect(await failure(send(make('554 no\r\n').mailer))).toMatchObject({ code: 'SMTP_554', permanent: true });
  });

  it('detail is masked (recipient, username, any address) and has no CR/LF', async () => {
    const { mailer } = setup(flow587({ rcpt: '550-5.1.1 <CLIENT@example.org> unknown; login studio-login\r\n550 5.1.1 see postmaster@mx.example.net\r\n' }));
    const error = await failure(send(mailer));
    expect(error.detail).toBe('550 5.1.1 <***> unknown; login *** 5.1.1 see ***');
    expect(error.message).toBe('SMTP_550');
  });

  it('the connection lost after DATA → SMTP_CONNECTION, transient', async () => {
    const { mailer } = setup([...greeting, ...ehlo(['AUTH PLAIN']), ...auth, ...envelope(), { expect: 'DATA' }, { send: '354 go\r\n' }, { data: true }, { close: true }], IMPLICIT);
    expect(await failure(send(mailer))).toMatchObject({ code: 'SMTP_CONNECTION', permanent: false });
  });

  it('resolves at the 250 to the message, even when QUIT is never answered (closed after 1 s)', async () => {
    vi.useFakeTimers();
    const { server, mailer, settle } = setup([...greeting, ...ehlo(['AUTH PLAIN']), ...auth, ...envelope(), ...data()], IMPLICIT);
    await expect(send(mailer)).resolves.toEqual({ providerMessageId: '4ABC12' });
    expect(server.events).not.toContain('close');
    await vi.advanceTimersByTimeAsync(SMTP_TIMEOUTS.quitMs);
    await settle();
    expect(server.events.at(-1)).toBe('close');
  });
});

describe('smtpMailer: timeouts and abort', () => {
  it('a server that stops answering → SMTP_TIMEOUT after 15 s, socket closed', async () => {
    vi.useFakeTimers();
    const { server, mailer } = setup([...greeting, { expect: 'EHLO example.com' }]);
    const result = failure(send(mailer));
    await vi.advanceTimersByTimeAsync(SMTP_TIMEOUTS.replyMs);
    expect(await result).toMatchObject({ code: 'SMTP_TIMEOUT', permanent: false });
    expect(server.events).toContain('close');
  });

  it('slow replies under 15 s each still end at 18 s for the whole send', async () => {
    vi.useFakeTimers();
    const { server, mailer } = setup([
      ...greeting,
      { expect: 'EHLO example.com' },
      { wait: 9_000 },
      { send: '250-mx\r\n250 STARTTLS\r\n' },
      { expect: 'STARTTLS' },
      { wait: 9_500 },
      { send: '220 go\r\n' },
      { tls: true },
    ]);
    const result = failure(send(mailer));
    await vi.advanceTimersByTimeAsync(SMTP_TIMEOUTS.sendMs);
    expect(await result).toMatchObject({ code: 'SMTP_TIMEOUT' });
    expect(server.events).not.toContain('tls');
    expect(server.events).toContain('close');
  });

  it('a connect that never opens → SMTP_TIMEOUT after 10 s', async () => {
    vi.useFakeTimers();
    const mailer = smtpMailer(STARTTLS, () => new Promise(() => {}), { background: () => {} });
    const result = failure(send(mailer));
    await vi.advanceTimersByTimeAsync(SMTP_TIMEOUTS.connectMs);
    expect(await result).toMatchObject({ code: 'SMTP_TIMEOUT', detail: 'connect' });
  });

  it('an abort mid-send closes the socket: MAIL_ABORTED, and nothing is sent after it', async () => {
    const controller = new AbortController();
    const { server, mailer } = setup([...greeting, { expect: 'EHLO example.com' }]);
    const result = failure(send(mailer, contractMessage(), controller.signal));
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    expect(await result).toMatchObject({ code: 'MAIL_ABORTED', permanent: false });
    expect(server.events).toContain('close');
    expect(server.messages).toEqual([]);
  });
});

describeMailerContract('smtp (scripted server)', () => {
  let refusal: string | null = null;
  const servers: ReturnType<typeof scriptedSmtpServer>[] = [];
  const mailer = smtpMailer(
    STARTTLS,
    async (target) => {
      const server = scriptedSmtpServer(flow587(refusal ? { rcpt: refusal } : {}));
      refusal = null;
      servers.push(server);
      return server.connect(target);
    },
    { background: () => {} },
  );
  return {
    mailer,
    delivered: () => servers.reduce((n, s) => n + s.messages.length, 0),
    refuseNext: (how) => {
      refusal = how === 'permanent' ? '550 5.1.1 unknown\r\n' : '451 4.3.0 later\r\n';
    },
  };
});
