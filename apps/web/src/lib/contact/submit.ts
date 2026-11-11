import 'server-only';

import { batch, type Options } from '@repo/db/client';

import { createContactMessageStatement } from '@/lib/db/queries/contact_messages';

import type { ContactInput } from './parseContactInput';

/**
 * Store a validated message. One batch: add any row that must be written with
 * it (a counter, a notification job) to the same `batch([...])` — there are no
 * transactions on D1.
 */
export async function storeContactMessage(input: ContactInput, opts?: Options & { now?: Date }): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  const consentAt = (opts?.now ?? new Date()).toISOString();
  await batch([createContactMessageStatement(id, { ...input, consentAt }, opts)], opts);
  return { id };
}
