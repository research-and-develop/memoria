/**
 * What survives a step change of the sign-in page (each step is a fresh
 * server render): the email typed in step 1, and a note for step 1 when a
 * later step sends the person back ("This sign-in timed out…"). Per tab
 * (sessionStorage); every access may throw (private mode), so it is guarded.
 */
const EMAIL_KEY = 'memoria:login:email';
const NOTE_KEY = 'memoria:login:note';

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Not available: step 1 simply starts empty.
  }
}

export const rememberLoginEmail = (email: string) => write(EMAIL_KEY, email);
export const rememberedLoginEmail = () => read(EMAIL_KEY) ?? '';
export const forgetLoginEmail = () => write(EMAIL_KEY, null);

export const setLoginNote = (note: string) => write(NOTE_KEY, note);
/** The note, once: reading it removes it. */
export function takeLoginNote(): string | null {
  const note = read(NOTE_KEY);
  if (note !== null) write(NOTE_KEY, null);
  return note;
}

/** Only `/admin…` paths are honoured as the page to open after signing in. */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/admin(\/|$|\?)/.test(next) ? next : '/admin';
}
