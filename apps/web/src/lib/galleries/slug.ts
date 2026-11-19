import { randomString } from './keys';

/**
 * Gallery addresses (plan p05, D5.3): `/g/<readable>-<random>`. The readable part comes from the
 * title (≤ 40, `[a-z0-9-]`); the random part is 10 characters of `[a-z2-9]` (≈ 50 bits: with "anyone
 * with the link", the link is the key). Pure.
 */

export const SLUG_BASE_MAX = 40;
export const SUFFIX_LENGTH = 10;
export const SLUG_MIN = 3;
export const SLUG_MAX = 60;

/** Bulgarian (streamlined system) plus the Russian-only letters; upper case is folded first. */
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sht', ъ: 'a', ь: 'y', ю: 'yu', я: 'ya', ё: 'yo', ы: 'y', э: 'e', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

/** The readable part from a title; `gallery` when nothing readable is left. */
export function slugBase(title: string): string {
  const lower = title.toLowerCase();
  let latin = '';
  for (const ch of lower) latin += CYRILLIC[ch] ?? ch;
  const ascii = latin.normalize('NFKD').replace(/\p{M}+/gu, '');
  const base = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_BASE_MAX)
    .replace(/-+$/g, '');
  return base || 'gallery';
}

export function slugSuffix(): string {
  return randomString(SUFFIX_LENGTH);
}

export function joinSlug(base: string, suffix: string): string {
  return `${base}-${suffix}`;
}

/** = ck_galleries_slug: `[a-z0-9-]`, 3–60, no hyphen at either end. */
export function isSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length >= SLUG_MIN && value.length <= SLUG_MAX && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

/** The random part of a slug minted here (its last 10 characters after a hyphen), or null. */
export function suffixOf(slug: string): string | null {
  const match = /-([a-z2-9]{10})$/.exec(slug);
  return match?.[1] ?? null;
}

/** A link gallery's new slug keeps its random part (D5.3): only the readable part may change. */
export function keepsSuffix(slug: string, suffix: string): boolean {
  return isSlug(slug) && slug.endsWith(`-${suffix}`) && slug.length > suffix.length + 1;
}
