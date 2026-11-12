/**
 * Colour roles ⇄ CSS variables.
 *
 * A theme's colours are a nested map of roles to hex values (`theme/studio.mjs`). The preset gives
 * Tailwind a utility per role that reads a variable (`bg-accent` → `rgb(var(--color-accent) / 1)`),
 * and declares the variables on `:root` from the studio theme. Another theme (Phase 4's client
 * galleries, a dark mode) only declares the same variables with other values on its own scope:
 * `themeCssVars(otherColors)` on `[data-theme="…"]` or an element's `style`. No component changes.
 *
 * Variables hold space-separated RGB channels (`31 111 92`), so opacity modifiers keep working
 * (`ring-focus/25`). Plain JS, no imports: used by the preset in Node and by tests.
 */

/** @typedef {Record<string, string | Record<string, string>>} ColorRoles */

/**
 * Every role as [tailwindName, hex]: `ink.DEFAULT` → `ink`, `ink.muted` → `ink-muted`.
 * @param {ColorRoles} colors
 * @returns {[string, string][]}
 */
export function flattenColors(colors) {
  return Object.entries(colors).flatMap(([group, value]) =>
    typeof value === 'string'
      ? [[group, value]]
      : Object.entries(value).map(([key, hex]) => [key === 'DEFAULT' ? group : `${group}-${key}`, hex]),
  );
}

/**
 * `#1F6F5C` → `31 111 92`.
 * @param {string} hex
 */
export function hexToChannels(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`theme colours are #RRGGBB, got ${hex}`);
  return [m[1], m[2], m[3]].map((h) => Number.parseInt(/** @type {string} */ (h), 16)).join(' ');
}

/**
 * The CSS variable declarations of a theme: `{ '--color-accent': '31 111 92', … }`.
 * @param {ColorRoles} colors
 * @returns {Record<string, string>}
 */
export function themeCssVars(colors) {
  return Object.fromEntries(flattenColors(colors).map(([name, hex]) => [`--color-${name}`, hexToChannels(hex)]));
}

/**
 * The Tailwind `colors` for a set of roles: same nesting, each value reading its variable.
 * @param {ColorRoles} colors
 * @returns {Record<string, string | Record<string, string>>}
 */
export function tailwindColors(colors) {
  /** @param {string} name */
  const ref = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;
  return Object.fromEntries(
    Object.entries(colors).map(([group, value]) => [
      group,
      typeof value === 'string'
        ? ref(group)
        : Object.fromEntries(Object.keys(value).map((key) => [key, ref(key === 'DEFAULT' ? group : `${group}-${key}`)])),
    ]),
  );
}
