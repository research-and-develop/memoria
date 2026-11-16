import { AwsV4Signer } from 'aws4fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { contractMessage, describeMailerContract } from '../contract/mailer';
import { scriptedFetch } from '../testing/scriptedFetch';

import { MailError } from './error';
import { sesErrorType, sesMailer, sesUrl, type SesSettings } from './ses';
import { isSesRegion, type SesRegion } from './sesRegions';

const SETTINGS: SesSettings = { region: 'eu-west-1', accessKeyId: 'AKIDEXAMPLE12345', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
const NOW = new Date('2026-11-16T18:56:08.123Z');
const now = () => NOW;
const signal = () => new AbortController().signal;

describeMailerContract('ses (scripted fetch)', () => {
  const s = scriptedFetch();
  let next: 'permanent' | 'transient' | null = null;
  s.otherwise(() => {
    const how = next;
    next = null;
    if (how === 'permanent') return { status: 400, body: { message: 'Email address is not verified.' }, headers: { 'x-amzn-errortype': 'MessageRejected:http://internal.amazon.com/coral/com.amazonaws.sesv2/' } };
    if (how === 'transient') return { status: 429, body: { message: 'Maximum sending rate exceeded.' }, headers: { 'x-amzn-errortype': 'TooManyRequestsException' } };
    return { status: 200, body: { MessageId: '0102018f-abc' } };
  });
  return {
    mailer: sesMailer(SETTINGS, s.fetch, { now }),
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

describe('sesMailer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the signed request with the raw MIME and returns the MessageId', async () => {
    const s = scriptedFetch();
    s.reply({ status: 200, body: { MessageId: '0102018f-abc-000000' } });
    const message = contractMessage();
    await expect(sesMailer(SETTINGS, s.fetch, { now }).send(message, { signal: signal() })).resolves.toEqual({ providerMessageId: '0102018f-abc-000000' });
    const [request] = s.requests;
    expect(request).toMatchObject({ url: 'https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails', method: 'POST' });
    const body = JSON.parse(request!.body) as { FromEmailAddress: string; Destination: unknown; Content: { Raw: { Data: string } } };
    expect(body.FromEmailAddress).toBe('studio@example.com');
    expect(body.Destination).toEqual({ ToAddresses: ['client@example.org'] });
    const mime = atob(body.Content.Raw.Data);
    expect(mime).toContain(`Message-ID: <${message.id}@example.com>\r\n`);
    expect(mime).toContain('Date: Mon, 16 Nov 2026 18:56:08 +0000\r\n');
    expect(mime).toContain('To: "Client" <client@example.org>\r\n');

    // SigV4 for service `ses` in the region, at the given time, over exactly this body (the payload
    // hash is part of the signature; aws4fetch signs host and x-amz-* headers only).
    expect(request!.headers['x-amz-date']).toBe('20261116T185608Z');
    expect(request!.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE12345\/20261116\/eu-west-1\/ses\/aws4_request, SignedHeaders=host;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    const expected = await new AwsV4Signer({
      method: 'POST',
      url: request!.url,
      headers: { 'content-type': 'application/json' },
      body: request!.body,
      accessKeyId: SETTINGS.accessKeyId,
      secretAccessKey: SETTINGS.secretAccessKey,
      service: 'ses',
      region: 'eu-west-1',
      datetime: '20261116T185608Z',
    }).sign();
    expect(request!.headers.authorization).toBe(expected.headers.get('authorization'));
  });

  it.each([
    ['MessageRejected', 400, { code: 'SES_MessageRejected', permanent: true, configuration: false }],
    ['BadRequestException', 400, { code: 'SES_BadRequestException', permanent: true, configuration: false }],
    ['NotFoundException', 404, { code: 'SES_NotFoundException', permanent: true, configuration: false }],
    ['MailFromDomainNotVerifiedException', 400, { code: 'SES_MailFromDomainNotVerifiedException', permanent: false, configuration: true }],
    ['AccountSuspendedException', 400, { code: 'SES_AccountSuspendedException', permanent: false, configuration: true }],
    ['SendingPausedException', 400, { code: 'SES_SendingPausedException', permanent: false, configuration: true }],
    ['UnrecognizedClientException', 403, { code: 'SES_UnrecognizedClientException', permanent: false, configuration: true }],
    ['SignatureDoesNotMatch', 403, { code: 'SES_SignatureDoesNotMatch', permanent: false, configuration: true }],
    ['AccessDeniedException', 403, { code: 'SES_AccessDeniedException', permanent: false, configuration: true }],
    ['TooManyRequestsException', 429, { code: 'SES_TooManyRequestsException', permanent: false, configuration: false }],
    ['LimitExceededException', 400, { code: 'SES_LimitExceededException', permanent: false, configuration: false }],
    ['ThrottlingException', 400, { code: 'SES_ThrottlingException', permanent: false, configuration: false }],
    ['InternalFailure', 500, { code: 'SES_InternalFailure', permanent: false, configuration: false }],
  ])('%s (%i) → %o', async (type, status, expected) => {
    const s = scriptedFetch();
    s.reply({ status, body: { message: 'no' }, headers: { 'x-amzn-errortype': `${type}:http://internal.amazon.com/coral/com.amazonaws.sesv2/` } });
    expect(await failure(sesMailer(SETTINGS, s.fetch, { now }).send(contractMessage(), { signal: signal() }))).toMatchObject(expected);
  });

  it.each([
    [403, undefined, { code: 'SES_403', configuration: true, permanent: false }],
    [502, undefined, { code: 'SES_502', configuration: false, permanent: false }],
    [400, { __type: 'com.amazonaws.sesv2#MessageRejected' }, { code: 'SES_MessageRejected', permanent: true }],
    [400, { code: 'BadRequestException' }, { code: 'SES_BadRequestException', permanent: true }],
    [422, undefined, { code: 'SES_422', permanent: true }],
  ])('without the header: %i %o → %o', async (status, body, expected) => {
    const s = scriptedFetch();
    s.reply({ status, body });
    expect(await failure(sesMailer(SETTINGS, s.fetch, { now }).send(contractMessage(), { signal: signal() }))).toMatchObject(expected);
  });

  it('surfaces Retry-After on throttling', async () => {
    const s = scriptedFetch();
    s.reply({ status: 429, headers: { 'x-amzn-errortype': 'TooManyRequestsException', 'retry-after': '30' } });
    expect(await failure(sesMailer(SETTINGS, s.fetch, { now }).send(contractMessage(), { signal: signal() }))).toMatchObject({ retryAfterSeconds: 30 });
  });

  it('masks addresses and the credentials in detail', async () => {
    const s = scriptedFetch();
    s.reply({
      status: 400,
      body: { message: `Email address is not verified. The following identities failed the check: studio@example.com, client@example.org (key ${SETTINGS.accessKeyId})` },
      headers: { 'x-amzn-errortype': 'MessageRejected' },
    });
    const error = await failure(sesMailer(SETTINGS, s.fetch, { now }).send(contractMessage(), { signal: signal() }));
    expect(error.detail).toBe('Email address is not verified. The following identities failed the check: ***, *** (key ***)');
  });

  it('refuses a region outside the list before any request', async () => {
    const s = scriptedFetch();
    const settings = { ...SETTINGS, region: 'evil.example.com/x?' as SesRegion };
    expect(await failure(sesMailer(settings, s.fetch, { now }).send(contractMessage(), { signal: signal() }))).toMatchObject({
      code: 'MAIL_INVALID_SETTINGS',
      permanent: true,
      configuration: true,
    });
    expect(s.requests).toHaveLength(0);
  });

  it('times out after 18 s with SES_TIMEOUT (transient)', async () => {
    vi.useFakeTimers();
    const s = scriptedFetch();
    s.reply({ hang: true });
    const sent = failure(sesMailer(SETTINGS, s.fetch, { now }).send(contractMessage(), { signal: signal() }));
    await s.received(1);
    await vi.advanceTimersByTimeAsync(18_000);
    expect(await sent).toMatchObject({ code: 'SES_TIMEOUT', permanent: false });
  });

  it('aborting a request in flight rejects MAIL_ABORTED', async () => {
    const s = scriptedFetch();
    s.reply({ hang: true });
    const controller = new AbortController();
    const sent = failure(sesMailer(SETTINGS, s.fetch, { now }).send(contractMessage(), { signal: controller.signal }));
    await s.received(1);
    controller.abort();
    expect(await sent).toMatchObject({ code: 'MAIL_ABORTED' });
  });
});

describe('sesErrorType', () => {
  it.each([
    ['MessageRejected:http://internal.amazon.com/coral/com.amazonaws.sesv2/', 'MessageRejected'],
    ['com.amazonaws.sesv2#TooManyRequestsException', 'TooManyRequestsException'],
    ['Bad Request!', 'BadRequest'],
    ['', undefined],
    [undefined, undefined],
  ])('%j → %j', (raw, expected) => {
    expect(sesErrorType(raw)).toBe(expected);
  });
});

describe('SES regions', () => {
  it.each([
    ['eu-west-1', true],
    ['us-east-1', true],
    ['EU-WEST-1', false],
    ['eu-west-1.evil.test', false],
    ['', false],
    [42, false],
  ])('%j → %s', (region, ok) => {
    expect(isSesRegion(region)).toBe(ok);
  });

  it('builds the endpoint from the region', () => {
    expect(sesUrl('us-east-2')).toBe('https://email.us-east-2.amazonaws.com/v2/email/outbound-emails');
  });
});
