import { describe, expect, it } from 'vitest';

import { wrapSocket } from './smtp';

type FakeSocket = {
  socket: Socket;
  server: WritableStreamDefaultWriter<Uint8Array>;
  client: ReadableStreamDefaultReader<Uint8Array>;
  toClient: TransformStream<Uint8Array, Uint8Array>;
  fromClient: TransformStream<Uint8Array, Uint8Array>;
  state: { closed: boolean; tls: TlsOptions | null | undefined; upgradedTo: FakeSocket | null };
};

/** A `Socket` with real streams: the test writes what the server says and reads what the client wrote. */
function fakeSocket(): FakeSocket {
  const toClient = new TransformStream<Uint8Array, Uint8Array>(undefined, undefined, { highWaterMark: 16 });
  const fromClient = new TransformStream<Uint8Array, Uint8Array>(undefined, undefined, { highWaterMark: 16 });
  const state: FakeSocket['state'] = { closed: false, tls: null, upgradedTo: null };
  const socket = {
    readable: toClient.readable,
    writable: fromClient.writable,
    opened: Promise.resolve({}),
    closed: new Promise<void>(() => {}),
    upgraded: false,
    secureTransport: 'starttls' as const,
    async close() {
      state.closed = true;
    },
    startTls(options?: TlsOptions) {
      state.tls = options;
      state.upgradedTo = fakeSocket();
      return state.upgradedTo.socket;
    },
  };
  return { socket: socket as unknown as Socket, server: toClient.writable.getWriter(), client: fromClient.readable.getReader(), toClient, fromClient, state };
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe('wrapSocket', () => {
  it('reads what the server sends, writes what the client says, null when closed', async () => {
    const fake = fakeSocket();
    const smtp = wrapSocket(fake.socket, 'smtp.example.net', false);
    await fake.server.write(bytes('220 hi\r\n'));
    expect(new TextDecoder().decode((await smtp.read())!)).toBe('220 hi\r\n');
    const written = fake.client.read();
    await smtp.write(bytes('EHLO example.com\r\n'));
    expect(new TextDecoder().decode((await written).value)).toBe('EHLO example.com\r\n');
    await fake.server.close();
    expect(await smtp.read()).toBeNull();
    smtp.close();
    expect(fake.state.closed).toBe(true);
  });

  it('startTls releases the plain streams and names the host to check the certificate against', async () => {
    const fake = fakeSocket();
    const smtp = wrapSocket(fake.socket, 'smtp.example.net', false);
    const tls = await smtp.startTls();
    expect(fake.toClient.readable.locked).toBe(false);
    expect(fake.fromClient.writable.locked).toBe(false);
    expect(fake.state.tls).toEqual({ expectedServerHostname: 'smtp.example.net' });
    await fake.state.upgradedTo!.server.write(bytes('250 ok\r\n'));
    expect(await tls.read()).toBeTruthy();
  });

  it('a failure before the first read over TLS is SMTP_TLS; after it, SMTP_CONNECTION', async () => {
    const first = fakeSocket();
    const tls = wrapSocket(first.socket, 'smtp.example.net', true);
    await first.server.abort(new Error('certificate verify failed'));
    await expect(tls.read()).rejects.toMatchObject({ code: 'SMTP_TLS', detail: 'certificate verify failed' });

    const second = fakeSocket();
    const established = wrapSocket(second.socket, 'smtp.example.net', true);
    await second.server.write(bytes('220 hi\r\n'));
    await established.read();
    await second.server.abort(new Error('reset'));
    await expect(established.read()).rejects.toMatchObject({ code: 'SMTP_CONNECTION' });
  });
});
