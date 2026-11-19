import { describe, expect, it } from 'vitest';

import { assignSets, readDrop, type DropItem, type FsEntry } from './folders';

const file = (name: string) => new File([new Uint8Array([1])], name);

/** A fake `webkitGetAsEntry` tree; directories answer in batches of `batch` like Chrome's 100. */
function fileEntry(name: string): FsEntry {
  return { name, isFile: true, isDirectory: false, file: (ok) => ok(file(name)) };
}
function dirEntry(name: string, children: FsEntry[], batch = 2): FsEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let at = 0;
      return {
        readEntries: (ok) => {
          const next = children.slice(at, at + batch);
          at += batch;
          setTimeout(() => ok(next), 0);
        },
      };
    },
  };
}
const item = (entry: FsEntry | null, f: File | null = null): DropItem => ({ kind: 'file', webkitGetAsEntry: () => entry, getAsFile: () => f });
const summary = (dropped: { set: string | null; file: File }[]) => dropped.map((d) => `${d.set ?? '(chosen)'}/${d.file.name}`).sort();

describe('readDrop', () => {
  it('one folder = the shoot: its subfolders are sets, its own files go to the chosen set, deeper levels flatten', async () => {
    const shoot = dirEntry('Wedding', [
      fileEntry('cover.jpg'),
      dirEntry('Ceremony', [fileEntry('c1.jpg'), fileEntry('c2.jpg'), fileEntry('c3.jpg')]),
      dirEntry('Party', [fileEntry('p1.jpg'), dirEntry('Late', [fileEntry('p2.jpg'), dirEntry('Later', [fileEntry('p3.jpg')])])]),
      fileEntry('.DS_Store'),
      dirEntry('__MACOSX', [fileEntry('._c1.jpg')]),
    ]);
    expect(summary(await readDrop({ items: [item(shoot)] }))).toEqual([
      '(chosen)/cover.jpg',
      'Ceremony/c1.jpg',
      'Ceremony/c2.jpg',
      'Ceremony/c3.jpg',
      'Party/p1.jpg',
      'Party/p2.jpg',
      'Party/p3.jpg',
    ]);
  });

  it('several folders and files: each folder is a set, loose files go to the chosen set', async () => {
    const dropped = await readDrop({
      items: [item(dirEntry('Ceremony', [fileEntry('c1.jpg'), dirEntry('raw', [fileEntry('c2.jpg')])])), item(dirEntry('Party', [fileEntry('p1.jpg')])), item(fileEntry('loose.jpg')), item(fileEntry('Thumbs.db'))],
    });
    expect(summary(dropped)).toEqual(['(chosen)/loose.jpg', 'Ceremony/c1.jpg', 'Ceremony/c2.jpg', 'Party/p1.jpg']);
  });

  it('files only (no entry API for an item, or no items at all)', async () => {
    expect(summary(await readDrop({ items: [item(null, file('a.jpg')), item(fileEntry('b.jpg'))] }))).toEqual(['(chosen)/a.jpg', '(chosen)/b.jpg']);
    expect(summary(await readDrop({ files: [file('c.jpg'), file('.hidden.jpg')] }))).toEqual(['(chosen)/c.jpg']);
  });

  it('a single dropped file is not a folder', async () => {
    expect(summary(await readDrop({ items: [item(fileEntry('one.jpg'))] }))).toEqual(['(chosen)/one.jpg']);
  });

  it('the entries are taken synchronously, before the drop handler returns', () => {
    let taken = 0;
    const lateItem: DropItem = { kind: 'file', webkitGetAsEntry: () => (taken++, fileEntry('x.jpg')), getAsFile: () => null };
    void readDrop({ items: [lateItem, { kind: 'string', getAsFile: () => null }] });
    expect(taken).toBe(1);
  });
});

describe('assignSets', () => {
  it.each([
    ['single root: top-level file', [['Shoot']], true, null],
    ['single root: subfolder', [['Shoot', 'Ceremony']], true, 'Ceremony'],
    ['single root: deep', [['Shoot', 'Ceremony', 'a', 'b']], true, 'Ceremony'],
    ['several roots: folder', [['Ceremony']], false, 'Ceremony'],
    ['several roots: deep', [['Ceremony', 'x']], false, 'Ceremony'],
    ['a blank folder name', [['  ']], false, null],
  ])('%s', (_, [dirs], singleRoot, expected) => {
    expect(assignSets([{ dirs: dirs!, file: file('a.jpg') }], singleRoot)[0]?.set).toBe(expected);
  });
});
