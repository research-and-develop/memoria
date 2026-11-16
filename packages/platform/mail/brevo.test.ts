import { afterEach, describe, expect, it, vi } from 'vitest';

import { contractMessage, describeMailerContract } from '../contract/mailer';
import { scriptedFetch } from '../testing/scriptedFetch';

import { BREVO_URL, brevoMailer } from './brevo';
import { MailError } from './error';

const API_KEY = 'xkeysib-secret-key-123';
const signal = () => new AbortController().signal;

describeMailerContract('brevo (scripted fetch)', () => {
  const s = scriptedFetch();
  let next: 'permanent' | 'transient' | null = null;
  s.otherwise(() => {
    const how = next;
    next = null;
    if (how === 'permanent') return { status: 400, body: { code: 'invalid_parameter', message: 'email is not valid' } };
    if (how === 'transient') return { status: 503, body: { message: 'unavailable' } };
    return { status: 201, body: { messageId: '<abc@smtp-relay.mailin.fr>' } };
  });
  return {
    mailer: brevoMailer({ apiKey: API_KEY }, s.fetch),
    delivered: () => s.requests.length,
    refuseNext: (how) => {
      next = how;
    },
  };
});

async function failure(promise: Promise<unknown>): Promise<MailError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(MailError);
  return error as MailError;
}

describe('brevoMailer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the exact request and returns the messageId', async () => {
    const s = scriptedFetch();
    s.reply({ status: 201, body: { messageId: '<202611@smtp-relay.mailin.fr>' } });
    const message = contractMessage({ replyTo: { email: 'me@example.net', name: 'Me' }, to: { email: 'client@example.org' } });
    await expect(brevoMailer({ apiKey: API_KEY }, s.fetch).send(message, { signal: signal() })).resolves.toEqual({ providerMessageId: '<202611@smtp-relay.mailin.fr>' });
    expect(s.requests).toHaveLength(1);
    const [request] = s.requests;
    expect(request).toMatchObject({ url: BREVO_URL, method: 'POST' });
    expect(request!.headers).toMatchObject({ 'api-key': API_KEY, 'content-type': 'application/json', accept: 'application/json' });
    expect(JSON.parse(request!.body)).toEqual({
      sender: { email: 'studio@example.com', name: 'Studio' },
      to: [{ email: 'client@example.org' }],
      replyTo: { email: 'me@example.net', name: 'Me' },
      subject: 'Hello',
      textContent: 'Hello there.',
      htmlContent: '<p>Hello there.</p>',
      headers: { idempotencyKey: message.id, 'Auto-Submitted': 'auto-generated' },
    });
  });

  it('202 without a body is sent with no id', async () => {
    const s = scriptedFetch();
    s.reply({ status: 202 });
    await expect(brevoMailer({ apiKey: API_KEY }, s.fetch).send(contractMessage(), { signal: signal() })).resolves.toEqual({ providerMessageId: null });
  });

  it('duplicate_request counts as sent (the idempotency key matched an earlier send)', async () => {
    const s = scriptedFetch();
    s.reply({ status: 400, body: { code: 'duplicate_request', message: 'duplicate request' } });
    await expect(brevoMailer({ apiKey: API_KEY }, s.fetch).send(contractMessage(), { signal: signal() })).resolves.toEqual({ providerMessageId: null });
  });

  it.each([
    [400, { code: 'invalid_parameter', message: 'to is invalid' }, { code: 'BREVO_400', permanent: true, configuration: false }],
    [404, { code: 'not_found', message: 'no' }, { code: 'BREVO_404', permanent: true, configuration: false }],
    [401, { code: 'unauthorized', message: 'Key not found' }, { code: 'BREVO_401', permanent: false, configuration: true }],
    [402, { code: 'not_enough_credits', message: 'no credits' }, { code: 'BREVO_402', permanent: false, configuration: true }],
    [403, { code: 'permission_denied', message: 'unrecognised IP address' }, { code: 'BREVO_403', permanent: false, configuration: true }],
    [429, { message: 'Too many requests' }, { code: 'BREVO_429', permanent: false, configuration: false }],
    [500, { message: 'oops' }, { code: 'BREVO_500', permanent: false, configuration: false }],
    [503, 'Service Unavailable', { code: 'BREVO_503', permanent: false, configuration: false }],
  ])('%i → %o', async (status, body, expected) => {
    const s = scriptedFetch();
    s.reply({ status, body });
    const error = await failure(brevoMailer({ apiKey: API_KEY }, s.fetch).send(contractMessage(), { signal: signal() }));
    expect(error).toMatchObject(expected);
  });

  it('surfaces Retry-After on a 429', async () => {
    const s = scriptedFetch();
    s.reply({ status: 429, body: { message: 'slow down' }, headers: { 'retry-after': '120' } });
    const error = await failure(brevoMailer({ apiKey: API_KEY }, s.fetch).send(contractMessage(), { signal: signal() }));
    expect(error).toMatchObject({ code: 'BREVO_429', retryAfterSeconds: 120 });
  });

  it('masks the recipient, any address and the key in detail', async () => {
    const s = scriptedFetch();
    s.reply({ status: 400, body: { code: 'invalid_parameter', message: `client@example.org rejected; other@x.test; key ${API_KEY}\r\nend` } });
    const error = await failure(brevoMailer({ apiKey: API_KEY }, s.fetch).send(contractMessage(), { signal: signal() }));
    expect(error.detail).toBe('invalid_parameter: *** rejected; *** key *** end');
  });

  it('a network failure is transient BREVO_NETWORK', async () => {
    const s = scriptedFetch();
    s.reply({ network: true });
    const error = await failure(brevoMailer({ apiKey: API_KEY }, s.fetch).send(contractMessage(), { signal: signal() }));
    expect(error).toMatchObject({ code: 'BREVO_NETWORK', permanent: false });
  });

  it('aborting a request in flight rejects MAIL_ABORTED', async () => {
    const s = scriptedFetch();
    s.reply({ hang: true });
    const controller = new AbortController();
    const sent = brevoMailer({ apiKey: API_KEY }, s.fetch).send(contractMessage(), { signal: controller.signal });
    await s.received(1);
    controller.abort();
    expect(await failure(sent)).toMatchObject({ code: 'MAIL_ABORTED', permanent: false });
  });

  it('times out after 18 s with BREVO_TIMEOUT (transient)', async () => {
    vi.useFakeTimers();
    const s = scriptedFetch();
    s.reply({ hang: true });
    const sent = failure(brevoMailer({ apiKey: API_KEY }, s.fetch).send(contractMessage(), { signal: signal() }));
    await s.received(1);
    await vi.advanceTimersByTimeAsync(17_999);
    expect(s.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await sent).toMatchObject({ code: 'BREVO_TIMEOUT', permanent: false });
  });
});
