import type { SettingsCipher } from '@/lib/settings/secrets';

/**
 * Gallery passwords (plan p05, D5.11): a shared, shown password, not a credential. Sealed with the
 * settings cipher (`SETTINGS_ENCRYPTION_KEY`), the additional data naming the gallery, so the
 * photographer can see it again and Phase 6's gate can compare it; a D1 export alone does not reveal
 * it. React- and Next-free (the relay's `gallery.ready` template opens it at send time).
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

export const galleryPasswordAad = (galleryId: string) => `gallery.${galleryId}.password`;

export function sealGalleryPassword(cipher: SettingsCipher, galleryId: string, plain: string): Promise<string> {
  return cipher.encrypt(plain, galleryPasswordAad(galleryId));
}

/** The plain password, or null when it will not open (another gallery's, a changed key). */
export function openGalleryPassword(cipher: SettingsCipher, galleryId: string, sealed: string): Promise<string | null> {
  return cipher.decrypt(sealed, galleryPasswordAad(galleryId));
}

/** Short, plain words a client can type from an email or a phone call. */
const WORDS = [
  'amber', 'apple', 'aspen', 'bloom', 'brook', 'cedar', 'cloud', 'coral', 'daisy', 'dawn', 'delta', 'dune',
  'ember', 'fern', 'field', 'flint', 'frost', 'grove', 'harbor', 'hazel', 'honey', 'iris', 'ivory', 'jade',
  'lake', 'lark', 'leaf', 'lemon', 'lilac', 'linen', 'maple', 'meadow', 'mint', 'moss', 'olive', 'opal',
  'orchid', 'pearl', 'pebble', 'pine', 'plum', 'poppy', 'rain', 'reed', 'river', 'robin', 'rose', 'sage',
  'sand', 'shell', 'silver', 'sky', 'slate', 'snow', 'stone', 'storm', 'sun', 'swan', 'thyme', 'tide',
  'tulip', 'velvet', 'willow', 'wren',
];

function pick<T>(list: readonly T[]): T {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return list[bytes[0]! % list.length]!;
}

/** Two words and two digits (`maple-river-42`): what the form's *Generate* offers. */
export function generateGalleryPassword(): string {
  const digits = String(crypto.getRandomValues(new Uint8Array(1))[0]! % 90 + 10);
  const first = pick(WORDS);
  let second = pick(WORDS);
  while (second === first) second = pick(WORDS);
  return `${first}-${second}-${digits}`;
}
