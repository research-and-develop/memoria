import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { batch, run, statement, type Statement } from '@repo/db/client';
import { createTestDb, type TestDb } from '@repo/db/test-utils';

import { insertGalleryStatement } from '../galleries';
import { at, galleryInsert, photoUpload, uuid } from '../galleries/testFixtures';
import { bulkDeleteStatement, bulkHideStatement, insertUploadingPhotoStatement, markReadyStatement } from '../photos';
import {
  deleteSetStatement,
  incrementSetCountsStatement,
  insertSetStatement,
  listSets,
  MAX_SETS,
  recountSetsStatement,
  renameSetStatement,
  reorderSetsStatements,
} from './index';

let testDb: TestDb;
const opts = () => ({ db: testDb.db });

beforeAll(async () => {
  testDb = await createTestDb();
});
afterEach(() => testDb.reset());
afterAll(() => testDb.dispose());

const changes = async (s: Statement) => (await run(s, opts())).changes;

async function newGallery() {
  const g = galleryInsert();
  const setId = uuid('5e7');
  await batch([insertGalleryStatement(g), insertSetStatement({ id: setId, galleryId: g.id, name: 'Photos', now: at(0) })], opts());
  return { id: g.id, setId };
}

describe('photo_sets', () => {
  it('refuses a set of an unknown gallery (the FK holds on D1)', async () => {
    await expect(
      run(statement(`INSERT INTO photo_sets (id, gallery_id, name, position) VALUES (?, ?, 'x', 0)`, [uuid('5e7'), uuid('9a11e7')]), opts()),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it('appends sets at the end and refuses the 51st', async () => {
    const { id } = await newGallery();
    const statements = Array.from({ length: MAX_SETS - 1 }, (_, i) => insertSetStatement({ id: uuid('5e7'), galleryId: id, name: `Set ${i + 2}`, now: at(1) }));
    await batch(statements, opts());
    const sets = await listSets(id, opts());
    expect(sets).toHaveLength(MAX_SETS);
    expect(sets.map((s) => s.position)).toEqual(Array.from({ length: MAX_SETS }, (_, i) => i));
    expect(await changes(insertSetStatement({ id: uuid('5e7'), galleryId: id, name: 'One too many', now: at(2) }))).toBe(0);
  });

  it('adds nothing to a deleted gallery', async () => {
    const { id } = await newGallery();
    await run(statement('UPDATE galleries SET deleted_at = ? WHERE id = ?', [at(1), id]), opts());
    expect(await changes(insertSetStatement({ id: uuid('5e7'), galleryId: id, name: 'Late', now: at(2) }))).toBe(0);
  });

  it('renames only a set of this gallery, and only when the name differs', async () => {
    const a = await newGallery();
    const b = await newGallery();
    expect(await changes(renameSetStatement({ id: a.setId, galleryId: b.id, name: 'Hijack', now: at(1) }))).toBe(0);
    expect(await changes(renameSetStatement({ id: a.setId, galleryId: a.id, name: 'Ceremony', now: at(1) }))).toBe(1);
    expect(await changes(renameSetStatement({ id: a.setId, galleryId: a.id, name: 'Ceremony', now: at(2) }))).toBe(0);
  });

  it('reorders 50 sets in two statements, ignoring ids of another gallery', async () => {
    const { id, setId } = await newGallery();
    const other = await newGallery();
    const more = Array.from({ length: MAX_SETS - 1 }, () => uuid('5e7'));
    await batch(more.map((sid, i) => insertSetStatement({ id: sid, galleryId: id, name: `S${i}`, now: at(1) })), opts());
    const wanted = [...more].reverse().concat(setId);
    const statements = reorderSetsStatements({ galleryId: id, orderedIds: [...wanted, other.setId], now: at(2) });
    expect(statements).toHaveLength(2);
    expect(statements.every((s) => s.params.length <= 100)).toBe(true);
    await batch(statements, opts());
    expect((await listSets(id, opts())).map((s) => s.id)).toEqual(wanted);
    expect((await listSets(other.id, opts()))[0]!.position).toBe(0);
  });

  it('never deletes the last set, nor one any photo row references (a deleted photo included)', async () => {
    const { id, setId } = await newGallery();
    expect(await changes(deleteSetStatement({ id: setId, galleryId: id }))).toBe(0);
    const second = uuid('5e7');
    await run(insertSetStatement({ id: second, galleryId: id, name: 'Two', now: at(1) }), opts());
    const p = photoUpload(id, second);
    await run(insertUploadingPhotoStatement(p), opts());
    await run(markReadyStatement({ galleryId: id, id: p.id, batchNow: at(2) }), opts());
    await run(bulkDeleteStatement({ galleryId: id, ids: [p.id], batchNow: at(3) }), opts());
    expect(await changes(deleteSetStatement({ id: second, galleryId: id }))).toBe(0);
    await run(statement('DELETE FROM photos WHERE id = ?', [p.id]), opts());
    expect(await changes(deleteSetStatement({ id: second, galleryId: id }))).toBe(1);
  });

  it('increments by the photos marked in this batch only; a repeat adds 0; a recount equals the rows', async () => {
    const { id, setId } = await newGallery();
    const photos = [photoUpload(id, setId), photoUpload(id, setId), photoUpload(id, setId)];
    await batch(photos.map((p) => insertUploadingPhotoStatement(p)), opts());
    const complete = (batchNow: string) => [
      ...photos.map((p) => markReadyStatement({ galleryId: id, id: p.id, batchNow })),
      incrementSetCountsStatement({ galleryId: id, setIds: [setId], photoIds: photos.map((p) => p.id), batchNow }),
    ];
    await batch(complete(at(1)), opts());
    expect((await listSets(id, opts()))[0]!.photo_count).toBe(3);
    await batch(complete(at(2)), opts());
    expect((await listSets(id, opts()))[0]!.photo_count).toBe(3);

    await run(bulkHideStatement({ galleryId: id, ids: [photos[0]!.id], hidden: true, batchNow: at(3) }), opts());
    await run(statement('UPDATE photo_sets SET photo_count = 9 WHERE id = ?', [setId]), opts());
    expect(await changes(recountSetsStatement({ galleryId: id, setIds: [setId] }))).toBe(1);
    expect((await listSets(id, opts()))[0]!.photo_count).toBe(2);
    expect(await changes(recountSetsStatement({ galleryId: id, setIds: [setId] }))).toBe(0);
  });
});
