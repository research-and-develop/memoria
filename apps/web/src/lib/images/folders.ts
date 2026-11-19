/**
 * Files and folders dropped on the manager (plan p05: folder drop, M2): each first-level folder
 * becomes a set (created by name, or the existing set of that name); files at the top go to the set
 * chosen in the manager (`set: null`); deeper levels are flattened into their first-level folder.
 *
 * "First level": when the drop is ONE folder, it is the shoot itself, so its subfolders are the sets
 * and its own files go to the chosen set; when several things are dropped, each dropped folder is a
 * set. Hidden files and OS clutter (`.DS_Store`, `Thumbs.db`, `desktop.ini`, `__MACOSX`) are skipped
 * rather than listed as unsupported.
 */

export type DroppedFile = { set: string | null; file: File };
export type PathedFile = { dirs: string[]; file: File };

/** The slice of the File and Directory Entries API used here (fakes in tests). */
export type FsEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (success: (file: File) => void, failure?: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (success: (entries: FsEntry[]) => void, failure?: (error: unknown) => void) => void };
};
export type DropItem = { kind: string; webkitGetAsEntry?: () => FsEntry | null; getAsFile: () => File | null };
export type DropData = { items?: ArrayLike<DropItem> | null; files?: ArrayLike<File> | null };

const CLUTTER = new Set(['thumbs.db', 'desktop.ini', '__macosx']);
export const isClutter = (name: string): boolean => name.startsWith('.') || CLUTTER.has(name.toLowerCase());

/** Pure: sets from paths. `singleRoot` = the drop was one folder (its own name is not a set). */
export function assignSets(files: PathedFile[], singleRoot: boolean): DroppedFile[] {
  return files.map(({ dirs, file }) => {
    const relative = singleRoot ? dirs.slice(1) : dirs;
    const set = relative[0]?.trim();
    return { set: set ? set : null, file };
  });
}

/**
 * Read a drop. The entries are taken synchronously (a `DataTransfer` empties when the event handler
 * returns), so call this inside the `drop` handler, before any `await`.
 */
export function readDrop(data: DropData): Promise<DroppedFile[]> {
  const items = Array.from(data.items ?? []).filter((item) => item.kind === 'file');
  const roots: (FsEntry | File)[] = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.() ?? null;
    const file = entry ? null : item.getAsFile();
    if (entry) roots.push(entry);
    else if (file) roots.push(file);
  }
  if (items.length === 0) roots.push(...Array.from(data.files ?? []));
  return collect(roots);
}

async function collect(roots: (FsEntry | File)[]): Promise<DroppedFile[]> {
  const files: PathedFile[] = [];
  for (const root of roots) {
    if (isEntry(root)) await walk(root, [], files);
    else if (!isClutter(root.name)) files.push({ dirs: [], file: root });
  }
  const singleRoot = roots.length === 1 && isEntry(roots[0]!) && roots[0].isDirectory;
  return assignSets(files, singleRoot);
}

const isEntry = (value: FsEntry | File): value is FsEntry => 'isDirectory' in value;

async function walk(entry: FsEntry, dirs: string[], out: PathedFile[]): Promise<void> {
  if (isClutter(entry.name)) return;
  if (entry.isFile && entry.file) {
    const read = entry.file.bind(entry);
    out.push({ dirs, file: await new Promise<File>((resolve, reject) => read(resolve, reject)) });
    return;
  }
  if (!entry.isDirectory || !entry.createReader) return;
  const reader = entry.createReader();
  const path = [...dirs, entry.name];
  // readEntries answers in batches (100 in Chrome) until it returns an empty one.
  for (;;) {
    const batch = await new Promise<FsEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return;
    for (const child of batch) await walk(child, path, out);
  }
}
