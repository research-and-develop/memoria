/**
 * A short, human name for a browser's user agent ("Chrome on macOS"), for the
 * sessions list and the default name of a new authenticator. Pure; a guess,
 * never used for a security decision.
 */

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bMacintosh\b|\bMac OS X\b/, 'macOS'],
  [/\bLinux\b/, 'Linux'],
];

const pick = (ua: string, table: [RegExp, string][]) => table.find(([re]) => re.test(ua))?.[1] ?? null;

export function describeUserAgent(ua: string | null | undefined): string {
  const value = ua ?? '';
  const browser = pick(value, BROWSERS);
  const system = pick(value, SYSTEMS);
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'Unknown device';
}

const LABELS: Record<string, string> = {
  iPhone: 'iPhone',
  iPad: 'iPad',
  Android: 'Android phone',
  macOS: 'Mac',
  Windows: 'Windows PC',
  ChromeOS: 'Chromebook',
  Linux: 'Linux computer',
};

/** The name a new authenticator gets unless the person types another. */
export function defaultAuthenticatorLabel(ua: string | null | undefined): string {
  const system = pick(ua ?? '', SYSTEMS);
  return (system && LABELS[system]) || 'Authenticator app';
}
