import { connect } from 'cloudflare:sockets';

import { MailError } from '@repo/platform/mail/error';
import { maskAddresses } from '@repo/platform/mail/mask';
import type { SmtpConnect, SmtpSocket } from '@repo/platform/mail/smtp';

/**
 * The SMTP client's sockets on Cloudflare (plan p03 → SMTP and MIME): `cloudflare:sockets`
 * `connect()`, wrapped as an `SmtpSocket`. Only the relay uses it (it sends; the app never does).
 *
 * - `tls` → `secureTransport: 'on'`, `starttls` → `'starttls'` (upgraded once by `startTls()`),
 *   `none` → `'off'` (development only; the edge refuses private addresses anyway).
 * - The certificate is checked against the host: workerd checks it (the smoke deploy saw a wrong
 *   host and an expired certificate refused), and `startTls` names the host explicitly.
 * - A socket error before the first byte read over TLS is reported as `SMTP_TLS` (the handshake or
 *   the certificate failed); any other socket error is left to the client (`SMTP_CONNECTION`).
 */
export const cloudflareSmtpConnect: SmtpConnect = async ({ host, port, security }) => {
  const socket = connect({ hostname: host, port }, { secureTransport: security === 'tls' ? 'on' : security === 'starttls' ? 'starttls' : 'off', allowHalfOpen: false });
  try {
    await socket.opened;
  } catch (error) {
    socket.close().catch(() => {});
    throw new MailError('SMTP_CONNECTION', { detail: errorText(error) });
  }
  return wrapSocket(socket, host, security === 'tls');
};

/** Exported for tests (a fake `Socket` with real streams). */
export function wrapSocket(socket: Socket, host: string, tls: boolean): SmtpSocket {
  const reader = socket.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const writer = socket.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
  // Until something has been read over TLS, a failure is the handshake's.
  let established = !tls;
  const fail = (error: unknown): never => {
    if (error instanceof MailError) throw error;
    throw new MailError(established ? 'SMTP_CONNECTION' : 'SMTP_TLS', { detail: errorText(error) });
  };
  return {
    async read() {
      const { value, done } = await reader.read().catch(fail);
      established = true;
      return done ? null : value;
    },
    async write(bytes) {
      await writer.write(bytes).catch(fail);
    },
    async startTls() {
      // startTls() needs the streams unlocked; the plain socket is not used again.
      reader.releaseLock();
      writer.releaseLock();
      return wrapSocket(socket.startTls({ expectedServerHostname: host }), host, true);
    },
    close() {
      socket.close().catch(() => {});
    },
  };
}

function errorText(error: unknown): string | undefined {
  return error instanceof Error ? maskAddresses(error.message) || undefined : undefined;
}
