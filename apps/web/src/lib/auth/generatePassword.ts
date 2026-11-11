/**
 * A strong admin password for `npm run admin:hash-password -- --generate`.
 * Pure: the random source is injectable so the sampling can be tested.
 */
export const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LENGTH = 24;

/**
 * 24 characters from a 54-symbol alphabet without look-alikes (≈ 138 bits), in
 * four dash-separated groups of six. Rejection sampling: `byte % 54` alone would
 * favour the first 40 symbols (256 is not a multiple of 54), so a byte from the
 * incomplete last block is drawn again.
 */
export function generatePassword(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  const chars: string[] = [];
  while (chars.length < LENGTH) {
    for (const b of random(LENGTH)) {
      if (b < limit && chars.length < LENGTH) chars.push(PASSWORD_ALPHABET.charAt(b % PASSWORD_ALPHABET.length));
    }
  }
  return [0, 6, 12, 18].map((at) => chars.slice(at, at + 6).join('')).join('-');
}
