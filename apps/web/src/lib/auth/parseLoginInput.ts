/** The login form's input (pure; shared by the form and POST /api/admin/login). */
export type LoginInput = { email: string; password: string; turnstileToken: string };

export type ParseLoginResult = { ok: true; value: LoginInput } | { ok: false; field: 'email' | 'password'; message: string };

export function parseLoginInput(raw: unknown): ParseLoginResult {
  const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || email.length > 254 || !email.includes('@')) return { ok: false, field: 'email', message: 'Enter your email.' };
  if (!password || password.length > 1024) return { ok: false, field: 'password', message: 'Enter your password.' };
  return { ok: true, value: { email, password, turnstileToken: typeof body.turnstileToken === 'string' ? body.turnstileToken : '' } };
}
