/**
 * `cloudflare:sockets` under vitest (vitest.config.ts alias): Node has no such module. Tests drive
 * the SMTP adapter through `wrapSocket` with a fake socket; a real `connect` here is a mistake.
 */
export function connect(): never {
  throw new Error('cloudflare:sockets is not available under vitest: test wrapSocket with a fake socket');
}
