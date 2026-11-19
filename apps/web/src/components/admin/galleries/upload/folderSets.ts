import { cleanText } from '@/lib/galleries/parseGalleryInput';
import { SET_NAME_MAX } from '@/lib/galleries/parseManagerInput';

/**
 * Folders → sets (plan p05: "each first-level subfolder becomes a set, created by name, or the
 * existing set of that name"). Pure. A folder's set name is cleaned like the server cleans it
 * (`parseSetName`) and cut to 60 characters; an existing set matches it ignoring case. The sets
 * route does not de-duplicate names, so matching happens here, before anything is created.
 */

export type SetRef = { id: string; name: string };
export type FolderPlan = {
  /** Folder → the id of an existing set. */
  existing: Map<string, string>;
  /** Folder → the name of the set to create (one per distinct name, in drop order). */
  create: Map<string, string>;
  /** Folders whose name cleans to nothing: their files go to the chosen set. */
  unnamed: Set<string>;
};

export function setNameOf(folder: string): string {
  return [...cleanText(folder)].slice(0, SET_NAME_MAX).join('').trim();
}

const key = (name: string) => name.toLocaleLowerCase();

export function planFolderSets(folders: Iterable<string>, sets: readonly SetRef[]): FolderPlan {
  const byName = new Map(sets.map((s) => [key(s.name), s.id]));
  const plan: FolderPlan = { existing: new Map(), create: new Map(), unnamed: new Set() };
  const creating = new Map<string, string>(); // key → the name to create
  for (const folder of folders) {
    const name = setNameOf(folder);
    if (!name) plan.unnamed.add(folder);
    else if (byName.has(key(name))) plan.existing.set(folder, byName.get(key(name))!);
    else {
      if (!creating.has(key(name))) creating.set(key(name), name);
      plan.create.set(folder, creating.get(key(name))!);
    }
  }
  return plan;
}
