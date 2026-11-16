import { flattenColors } from './cssVars.mjs';
import studio from './studio.mjs';

/**
 * A colour role → its hex value, for places that cannot use the CSS variables: emails (inline
 * styles, plan p03) and the contrast tests. Plain JS: the relay Worker imports it too.
 *
 * @param {string} token a role as Tailwind names it (`accent-ink`, `ink`, `line`)
 * @param {import('./cssVars.mjs').ColorRoles} [colors] default the studio theme
 * @returns {string}
 */
export function tokenHex(token, colors = studio.colors) {
  const resolved = new Map(flattenColors(colors)).get(token);
  if (!resolved) throw new Error(`unknown colour token ${token}`);
  return resolved;
}
