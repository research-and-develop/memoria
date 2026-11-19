import { isUuid } from '@repo/core/validation';

import type { BulkAction } from './manager';
import { cleanText } from './parseGalleryInput';
import { MAX_BULK_PHOTOS } from '@/lib/db/queries/photos/types';

/** The manager's request bodies (plan p05 T5.6). Pure. */

type Parsed<T> = { ok: true; value: T } | { ok: false; field: string; message: string };
const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const uuids = (v: unknown, max: number): v is string[] => Array.isArray(v) && v.length > 0 && v.length <= max && v.every((id) => typeof id === 'string' && isUuid(id));

export const SET_NAME_MAX = 60;

export function parseSetName(body: unknown): Parsed<string> {
  const name = record(body).name;
  const value = typeof name === 'string' ? cleanText(name) : '';
  if (!value || [...value].length > SET_NAME_MAX) return { ok: false, field: 'name', message: `Name the set (up to ${SET_NAME_MAX} characters).` };
  return { ok: true, value };
}

export function parseSetOrder(body: unknown): Parsed<string[]> {
  const ids = record(body).ids;
  return uuids(ids, 50) && new Set(ids).size === ids.length ? { ok: true, value: ids } : { ok: false, field: 'ids', message: 'Send every set of the gallery once, in the new order.' };
}

export function parseBulk(body: unknown): Parsed<{ ids: string[]; bulk: BulkAction }> {
  const input = record(body);
  if (!uuids(input.ids, MAX_BULK_PHOTOS)) return { ok: false, field: 'ids', message: `Select 1–${MAX_BULK_PHOTOS} photos.` };
  const ids = [...new Set(input.ids)];
  switch (input.action) {
    case 'hide':
    case 'show':
    case 'delete':
      return { ok: true, value: { ids, bulk: { action: input.action } } };
    case 'move':
      if (typeof input.setId !== 'string' || !isUuid(input.setId)) return { ok: false, field: 'setId', message: 'Choose the set to move the photos to.' };
      return { ok: true, value: { ids, bulk: { action: 'move', setId: input.setId } } };
    default:
      return { ok: false, field: 'action', message: 'Choose move, hide, show or delete.' };
  }
}

export function parsePhotoId(body: unknown): Parsed<string> {
  const id = record(body).photoId;
  return typeof id === 'string' && isUuid(id) ? { ok: true, value: id } : { ok: false, field: 'photoId', message: 'Choose a photo.' };
}
