/** The password gate's input (pure; shared by the gate form and POST /api/g/[slug]/access). */
export type GateInput = { password: string; turnstileToken: string };

export type ParseGateResult = { ok: true; value: GateInput } | { ok: false; field: 'password'; message: string };

/** Longer than any gallery password can be (Phase 5's PASSWORD_MAX is 64): a cap on the work, not a rule. */
export const GATE_PASSWORD_MAX = 256;

export function parseGateInput(raw: unknown): ParseGateResult {
  const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  // Trimmed: a password pasted from an email often carries a space or a line break.
  const password = typeof body.password === 'string' ? body.password.trim() : '';
  if (!password || password.length > GATE_PASSWORD_MAX) return { ok: false, field: 'password', message: 'Enter the gallery password.' };
  return { ok: true, value: { password, turnstileToken: typeof body.turnstileToken === 'string' ? body.turnstileToken : '' } };
}
