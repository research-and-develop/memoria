import { first, statement, type Options } from '@repo/db/client';

/** Is any setup code live (sign-in step 1 decides between 'setup' and "not set up")? */
export async function hasLiveSetupCode(now: string, opts?: Options): Promise<boolean> {
  return (await first(statement('SELECT 1 AS one FROM admin_setup_codes WHERE expires_at > ? LIMIT 1', [now]), opts)) !== null;
}
