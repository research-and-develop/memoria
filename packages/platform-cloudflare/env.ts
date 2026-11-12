/**
 * The string vars and secrets of a Worker env, for `parseConfig`. Bindings (D1, R2, the version
 * metadata object) are objects and are dropped: config never sees them.
 */
export function stringEnv(env: object): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}
