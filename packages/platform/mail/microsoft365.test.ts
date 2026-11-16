import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contractMessage, describeMailerContract } from '../contract/mailer';
import { scriptedFetch, type RecordedRequest, type ScriptedFetch, type ScriptedReply } from '../testing/scriptedFetch';

import { MailError } from './error';
import { isTenantId, microsoft365Mailer, resetMicrosoftTokenCache, sendMailUrl, tokenUrl, type Microsoft365Settings } from './microsoft365';

const SETTINGS: Microsoft365Settings = {
  tenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47',
  clientId: '11111111-2222-3333-4444-555555555555',
  clientSecret: 'client~secret~value~123',
  mailbox: 'studio@example.com',
};
const TOKEN_URL = 'https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/oauth2/v2.0/token';
const SEND_URL = 'https://graph.microsoft.com/v1.0/users/studio%40example.com/sendMail';
const signal = () => new AbortController().signal;

const isToken = (r: RecordedRequest) => r.url.startsWith('https://login.microsoftonline.com/');
const isSend = (r: RecordedRequest) => r.url.startsWith('https://graph.microsoft.com/');

/** A scripted Microsoft: tokens `tok-1`, `tok-2`, … (1 h); sends answered from `sendReplies`, else 202. */
function microsoft(): ScriptedFetch & { sendReplies: ScriptedReply[]; tokenReplies: ScriptedReply[]; tokens: () => number; sends: () => RecordedRequest[] } {
  const s = scriptedFetch();
  const sendReplies: ScriptedReply[] = [];
  const tokenReplies: ScriptedReply[] = [];
  let issued = 0;
  s.otherwise((request) => {
    if (isToken(request)) {
      const scripted = tokenReplies.shift();
      if (scripted) return scripted;
      issued += 1;
      return { status: 200, body: { token_type: 'Bearer', expires_in: 3599, access_token: `tok-${issued}` } };
    }
    return sendReplies.shift() ?? { status: 202 };
  });
  return { ...s, sendReplies, tokenReplies, tokens: () => s.requests.filter(isToken).length, sends: () => s.requests.filter(isSend) };
}

describeMailerContract('microsoft 365 (scripted fetch)', () => {
  resetMicrosoftTokenCache();
  const s = microsoft();
  return {
    mailer: microsoft365Mailer(SETTINGS, s.fetch),
    delivered: () => s.sends().length,
    refuseNext: (how) => {
      s.sendReplies.push(how === 'permanent' ? { status: 400, body: { error: { code: 'ErrorMimeContentInvalid', message: 'bad' } } } : { status: 503 });
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

describe('microsoft365Mailer', () => {
  beforeEach(() => {
    resetMicrosoftTokenCache();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetMicrosoftTokenCache();
  });

  it('gets a token, then sends the base64 MIME with our Message-ID', async () => {
    const s = microsoft();
    const message = contractMessage();
    await expect(microsoft365Mailer(SETTINGS, s.fetch).send(message, { signal: signal() })).resolves.toEqual({ providerMessageId: null });
    expect(s.requests).toHaveLength(2);
    const [token, send] = s.requests;
    expect(token).toMatchObject({ url: TOKEN_URL, method: 'POST' });
    expect(token!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(token!.body))).toEqual({
      client_id: SETTINGS.clientId,
      client_secret: SETTINGS.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    expect(send).toMatchObject({ url: SEND_URL, method: 'POST' });
    expect(send!.headers).toMatchObject({ authorization: 'Bearer tok-1', 'content-type': 'text/plain' });
    const mime = atob(send!.body);
    expect(mime).toContain(`Message-ID: <${message.id}@example.com>\r\n`);
    expect(mime).toContain('From: "Studio" <studio@example.com>\r\n');
  });

  it('caches the token across sends (and mailers with the same settings)', async () => {
    const s = microsoft();
    await microsoft365Mailer(SETTINGS, s.fetch).send(contractMessage(), { signal: signal() });
    await microsoft365Mailer(SETTINGS, s.fetch).send(contractMessage(), { signal: signal() });
    expect(s.tokens()).toBe(1);
    expect(s.sends().map((r) => r.headers.authorization)).toEqual(['Bearer tok-1', 'Bearer tok-1']);
  });

  it('keys the cache by tenant, client and secret: a new secret gets a new token', async () => {
    const s = microsoft();
    await microsoft365Mailer(SETTINGS, s.fetch).send(contractMessage(), { signal: signal() });
    await microsoft365Mailer({ ...SETTINGS, clientSecret: 'another~secret~456' }, s.fetch).send(contractMessage(), { signal: signal() });
    await microsoft365Mailer({ ...SETTINGS, clientId: '99999999-2222-3333-4444-555555555555' }, s.fetch).send(contractMessage(), { signal: signal() });
    expect(s.tokens()).toBe(3);
  });

  it('two concurrent sends share one token request', async () => {
    const s = microsoft();
    const mailer = microsoft365Mailer(SETTINGS, s.fetch);
    await Promise.all([mailer.send(contractMessage(), { signal: signal() }), mailer.send(contractMessage(), { signal: signal() })]);
    expect(s.tokens()).toBe(1);
    expect(s.sends()).toHaveLength(2);
  });

  it('fetches a new token 5 minutes before the old one expires', async () => {
    const s = microsoft();
    let at = Date.parse('2026-11-16T10:00:00Z');
    const mailer = microsoft365Mailer(SETTINGS, s.fetch, { now: () => new Date(at) });
    await mailer.send(contractMessage(), { signal: signal() });
    at += 3599_000 - 5 * 60_000 - 1;
    await mailer.send(contractMessage(), { signal: signal() });
    expect(s.tokens()).toBe(1);
    at += 1;
    await mailer.send(contractMessage(), { signal: signal() });
    expect(s.tokens()).toBe(2);
    expect(s.sends().at(-1)!.headers.authorization).toBe('Bearer tok-2');
  });

  it('a 401 on send refreshes the token once and sends again', async () => {
    const s = microsoft();
    s.sendReplies.push({ status: 401, body: { error: { code: 'InvalidAuthenticationToken', message: 'expired' } } });
    await expect(microsoft365Mailer(SETTINGS, s.fetch).send(contractMessage(), { signal: signal() })).resolves.toEqual({ providerMessageId: null });
    expect(s.tokens()).toBe(2);
    expect(s.sends().map((r) => r.headers.authorization)).toEqual(['Bearer tok-1', 'Bearer tok-2']);
  });

  it('a second 401 is a configuration error (no third try)', async () => {
    const s = microsoft();
    s.sendReplies.push({ status: 401 }, { status: 401 });
    const error = await failure(microsoft365Mailer(SETTINGS, s.fetch).send(contractMessage(), { signal: signal() }));
    expect(error).toMatchObject({ code: 'GRAPH_401', configuration: true, permanent: false });
    expect(s.tokens()).toBe(2);
    expect(s.sends()).toHaveLength(2);
  });

  it.each([
    [400, 'ErrorMimeContentInvalid', { code: 'GRAPH_400', permanent: true, configuration: false }],
    [404, 'ErrorInvalidUser', { code: 'GRAPH_404', permanent: true, configuration: false }],
    [413, 'ErrorMessageSizeExceeded', { code: 'GRAPH_413', permanent: true, configuration: false }],
    [403, 'ErrorAccessDenied', { code: 'GRAPH_403', permanent: false, configuration: true }],
    [409, 'ErrorIrresolvableConflict', { code: 'GRAPH_409', permanent: false, configuration: false }],
    [423, 'ErrorMailboxMoveInProgress', { code: 'GRAPH_423', permanent: false, configuration: false }],
    [429, 'ApplicationThrottled', { code: 'GRAPH_429', permanent: false, configuration: false }],
    [500, 'generalException', { code: 'GRAPH_500', permanent: false, configuration: false }],
    [502, 'badGateway', { code: 'GRAPH_502', permanent: false, configuration: false }],
    [503, 'serviceNotAvailable', { code: 'GRAPH_503', permanent: false, configuration: false }],
    [504, 'gatewayTimeout', { code: 'GRAPH_504', permanent: false, configuration: false }],
  ])('send %i %s → %o', async (status, graphCode, expected) => {
    const s = microsoft();
    s.sendReplies.push({ status, body: { error: { code: graphCode, message: 'no' } } });
    expect(await failure(microsoft365Mailer(SETTINGS, s.fetch).send(contractMessage(), { signal: signal() }))).toMatchObject(expected);
  });

  it('surfaces Retry-After on a 429', async () => {
    const s = microsoft();
    s.sendReplies.push({ status: 429, headers: { 'retry-after': '17' } });
    expect(await failure(microsoft365Mailer(SETTINGS, s.fetch).send(contractMessage(), { signal: signal() }))).toMatchObject({ code: 'GRAPH_429', retryAfterSeconds: 17 });
  });

  it.each([
    [400, 'invalid_scope', { code: 'GRAPH_TOKEN_400', configuration: true, permanent: false }],
    [401, 'invalid_client', { code: 'GRAPH_TOKEN_401', configuration: true, permanent: false }],
    [500, 'temporarily_unavailable', { code: 'GRAPH_TOKEN_500', configuration: false, permanent: false }],
    [429, 'throttled', { code: 'GRAPH_TOKEN_429', configuration: false, permanent: false }],
  ])('token %i %s → %o, and the failed token is not cached', async (status, error, expected) => {
    const s = microsoft();
    s.tokenReplies.push({ status, body: { error, error_description: `AADSTS7000215: Invalid client secret ${SETTINGS.clientSecret} for app ${SETTINGS.clientId}.` } });
    const mailer = microsoft365Mailer(SETTINGS, s.fetch);
    const failed = await failure(mailer.send(contractMessage(), { signal: signal() }));
    expect(failed).toMatchObject(expected);
    expect(failed.detail).toBe(`${error}: AADSTS7000215: Invalid client secret *** for app ***.`);
    expect(s.sends()).toHaveLength(0);
    await expect(mailer.send(contractMessage(), { signal: signal() })).resolves.toEqual({ providerMessageId: null });
    expect(s.tokens()).toBe(2);
  });

  it('a token answer without a token is a configuration error', async () => {
    const s = microsoft();
    s.tokenReplies.push({ status: 200, body: { token_type: 'Bearer' } });
    expect(await failure(microsoft365Mailer(SETTINGS, s.fetch).send(contractMessage(), { signal: signal() }))).toMatchObject({ code: 'GRAPH_TOKEN_200', configuration: true });
  });

  it('masks the mailbox, the recipient, the token and the ids in detail', async () => {
    const s = microsoft();
    s.sendReplies.push({ status: 403, body: { error: { code: 'ErrorAccessDenied', message: `Access to studio@example.com denied for ${SETTINGS.clientId}; token tok-1; Bearer abc.def` } } });
    const error = await failure(microsoft365Mailer(SETTINGS, s.fetch).send(contractMessage(), { signal: signal() }));
    expect(error.detail).toBe('ErrorAccessDenied: Access to *** denied for ***; token ***; Bearer ***');
  });

  it.each([
    ['a tenant with a slash', { tenantId: 'contoso.com/../x' }, 'tenantId'],
    ['a tenant without a dot', { tenantId: 'localhost' }, 'tenantId'],
    ['a bad mailbox', { mailbox: 'not an address' }, 'mailbox'],
  ])('refuses %s before any request', async (_label, override, field) => {
    const s = microsoft();
    const error = await failure(microsoft365Mailer({ ...SETTINGS, ...override }, s.fetch).send(contractMessage(), { signal: signal() }));
    expect(error).toMatchObject({ code: 'MAIL_INVALID_SETTINGS', permanent: true, configuration: true, detail: field });
    expect(s.requests).toHaveLength(0);
  });

  it('aborting while the token request hangs rejects MAIL_ABORTED', async () => {
    const s = microsoft();
    s.tokenReplies.push({ hang: true });
    const controller = new AbortController();
    const sent = failure(microsoft365Mailer(SETTINGS, s.fetch).send(contractMessage(), { signal: controller.signal }));
    await s.received(1);
    controller.abort();
    expect(await sent).toMatchObject({ code: 'MAIL_ABORTED', permanent: false });
    expect(s.sends()).toHaveLength(0);
  });

  it('times out a hanging send after 18 s with GRAPH_TIMEOUT', async () => {
    vi.useFakeTimers();
    const s = microsoft();
    s.sendReplies.push({ hang: true });
    const sent = failure(microsoft365Mailer(SETTINGS, s.fetch).send(contractMessage(), { signal: signal() }));
    await s.received(2);
    await vi.advanceTimersByTimeAsync(18_000);
    expect(await sent).toMatchObject({ code: 'GRAPH_TIMEOUT', permanent: false });
  });
});

describe('Microsoft 365 settings shapes', () => {
  it.each([
    ['72f988bf-86f1-41af-91ab-2d7cd011db47', true],
    ['72F988BF-86F1-41AF-91AB-2D7CD011DB47', true],
    ['contoso.onmicrosoft.com', true],
    ['contoso.com', true],
    ['contoso', false],
    ['contoso..com', false],
    ['.contoso.com', false],
    ['contoso.com/x', false],
    ['contoso.com?x', false],
    ['', false],
    [null, false],
  ])('tenant %j → %s', (tenant, ok) => {
    expect(isTenantId(tenant)).toBe(ok);
  });

  it('encodes the mailbox and tenant into the URLs', () => {
    expect(sendMailUrl('a+b@example.com')).toBe('https://graph.microsoft.com/v1.0/users/a%2Bb%40example.com/sendMail');
    expect(tokenUrl('contoso.com')).toBe('https://login.microsoftonline.com/contoso.com/oauth2/v2.0/token');
  });
});
