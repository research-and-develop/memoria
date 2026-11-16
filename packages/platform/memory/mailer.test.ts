import { describe, expect, it } from 'vitest';

import { MailError } from '../mail/error';
import { unconfiguredMailer } from '../mail/unconfigured';
import type { MailMessage } from '../ports';

import { memoryMailer } from './mailer';

const message: MailMessage = { id: 'job-1', from: { email: 'studio@example.com' }, to: { email: 'client@example.com' }, subject: 'Hi', text: 'Hi', html: '<p>Hi</p>' };
const opts = () => ({ signal: new AbortController().signal });

describe('memoryMailer', () => {
  it('keeps what it sends, with an id', async () => {
    const mailer = memoryMailer();
    await expect(mailer.send(message, opts())).resolves.toEqual({ providerMessageId: 'memory-1' });
    expect(mailer.sent).toEqual([message]);
  });

  it('fails the next sends as told, once each', async () => {
    const mailer = memoryMailer();
    mailer.failWith(new MailError('SMTP_451'), new MailError('SMTP_550', { permanent: true }));
    await expect(mailer.send(message, opts())).rejects.toMatchObject({ code: 'SMTP_451', permanent: false });
    await expect(mailer.send(message, opts())).rejects.toMatchObject({ code: 'SMTP_550', permanent: true });
    await expect(mailer.send(message, opts())).resolves.toBeTruthy();
    expect(mailer.sent).toHaveLength(1);
  });

  it('refuses an aborted send', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(memoryMailer().send(message, { signal: controller.signal })).rejects.toMatchObject({ code: 'MAIL_ABORTED' });
  });
});

describe('unconfiguredMailer', () => {
  it('rejects every send, transient and as configuration', async () => {
    const error = await unconfiguredMailer('no mail settings').send(message, opts()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MailError);
    expect(error).toMatchObject({ code: 'MAIL_NOT_CONFIGURED', permanent: false, configuration: true, detail: 'no mail settings' });
  });
});
