/**
 * Which SMTP hosts and ports we connect to (plan p03 → HTTPS adapters, "Values that reach a URL or a
 * socket"). Shared by the env fallback (`parseConfig`) and the studio's mail settings. Pure.
 *
 * A host is a DNS name (≤ 253 characters, labels of `[A-Za-z0-9-]`, at least one dot): never an IP
 * literal, `localhost`, or a `.local` / `.internal` / `.localhost` name, so the certificate can be
 * checked against it. Development may also use `localhost` and `127.0.0.1` (Mailpit). Any public
 * host is accepted: Cloudflare's edge refuses private and Cloudflare addresses itself.
 */
const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const LOCAL_SUFFIX_RE = /(?:^|\.)(?:localhost|local|internal)$/i;
const DEV_HOSTS = new Set(['localhost', '127.0.0.1']);

/** The ports the studio's settings offer: 465 = TLS from the start, 587 and 2525 = STARTTLS. */
export const SMTP_PORTS = { 465: 'tls', 587: 'starttls', 2525: 'starttls' } as const;
export type SmtpPort = keyof typeof SMTP_PORTS;

export function isSmtpHost(value: string, opts: { development: boolean }): boolean {
  if (opts.development && DEV_HOSTS.has(value)) return true;
  if (value.length === 0 || value.length > 253 || LOCAL_SUFFIX_RE.test(value)) return false;
  const labels = value.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return false;
  // An all-numeric last label is an IPv4 literal (or nonsense): a TLD has letters.
  return /[A-Za-z]/.test(labels[labels.length - 1] ?? '');
}

export function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}
