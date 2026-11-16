import { beforeEach, describe, expect, it } from 'vitest';

import { MailError } from '../mail/error';
import type { MailMessage, Mailer } from '../ports';

/**
 * The Mailer contract (plan p03 → Ports): what every mail adapter must do, run against each
 * (memory, SMTP over the scripted server, Brevo, SES and Microsoft 365 over a scripted fetch).
 * Test-only: import it from a *.test.ts file (guard: platform-boundary).
 *
 *   describeMailerContract('memory', () => { const m = memoryMailer(); return { mailer: m, delivered: () => m.sent.length, refuseNext: … }; });
 *
 * A fresh harness per test.
 */
export type MailerHarness = {
  mailer: Mailer;
  /** How many messages reached the provider (an SMTP `DATA`, an API request that sends). */
  delivered(): number;
  /** The provider refuses the next message: for good (a 5xx / a rejection) or for now (a 4xx / throttling). */
  refuseNext(how: 'permanent' | 'transient'): void;
};

export const contractMessage = (overrides: Partial<MailMessage> = {}): MailMessage => ({
  id: 'c0ffee00-0000-4000-8000-000000000001',
  from: { email: 'studio@example.com', name: 'Studio' },
  to: { email: 'client@example.org', name: 'Client' },
  subject: 'Hello',
  text: 'Hello there.',
  html: '<p>Hello there.</p>',
  ...overrides,
});

const signal = () => new AbortController().signal;

async function failure(promise: Promise<unknown>): Promise<MailError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(MailError);
  return error as MailError;
}

export function describeMailerContract(name: string, setup: () => MailerHarness): void {
  describe(`Mailer contract: ${name}`, () => {
    let h: MailerHarness;
    beforeEach(() => {
      h = setup();
    });

    it('delivers a message once and resolves', async () => {
      const result = await h.mailer.send(contractMessage(), { signal: signal() });
      expect(result).toHaveProperty('providerMessageId');
      expect(h.delivered()).toBe(1);
    });

    it.each([
      ['a subject with CR/LF', { subject: 'Hi\r\nBcc: x@evil.test' }],
      ['a subject with a NUL', { subject: 'Hi\u0000' }],
      ['a subject with a bidi override', { subject: 'Invoice \u202Egnp.exe' }],
      ['a From name with LF', { from: { email: 'studio@example.com', name: 'Studio\nBcc: x@evil.test' } }],
      ['a To name with a C1 control', { to: { email: 'client@example.org', name: 'Client\u0085' } }],
    ])('refuses %s before anything is written (MAIL_INVALID_HEADER, permanent)', async (_label, overrides) => {
      const error = await failure(h.mailer.send(contractMessage(overrides), { signal: signal() }));
      expect(error).toMatchObject({ code: 'MAIL_INVALID_HEADER', permanent: true });
      expect(h.delivered()).toBe(0);
    });

    it.each([
      ['<', 'client<x@example.org'],
      ['>', 'client@example.org>'],
      ['a space', 'client @example.org'],
      ['a non-ASCII character', 'clïent@example.org'],
      ['CR/LF', 'client@example.org\r\nRCPT TO:<x@evil.test>'],
    ])('refuses an address with %s (MAIL_INVALID_ADDRESS, permanent)', async (_label, email) => {
      const error = await failure(h.mailer.send(contractMessage({ to: { email } }), { signal: signal() }));
      expect(error).toMatchObject({ code: 'MAIL_INVALID_ADDRESS', permanent: true });
      expect(h.delivered()).toBe(0);
    });

    it('a permanent refusal is permanent', async () => {
      h.refuseNext('permanent');
      const error = await failure(h.mailer.send(contractMessage(), { signal: signal() }));
      expect(error.permanent).toBe(true);
    });

    it('a temporary refusal is not permanent', async () => {
      h.refuseNext('transient');
      const error = await failure(h.mailer.send(contractMessage(), { signal: signal() }));
      expect(error.permanent).toBe(false);
    });

    it('an aborted send rejects MAIL_ABORTED, not permanent, and delivers nothing', async () => {
      const controller = new AbortController();
      controller.abort();
      const error = await failure(h.mailer.send(contractMessage(), { signal: controller.signal }));
      expect(error).toMatchObject({ code: 'MAIL_ABORTED', permanent: false });
      expect(h.delivered()).toBe(0);
    });
  });
}
