import type { MailAddress, MailMessage } from '../ports';

import { domainOf, parseEmailAddress } from './address';
import { MailError } from './error';

/**
 * The MIME text of one message (plan p03 → SMTP and MIME): what the SMTP client sends after
 * `DATA`, and what SES and Microsoft 365 take as raw MIME. Pure.
 *
 * - `From`, `To`, `Reply-To`: a plain ASCII name is a quoted string (`\` and `"` escaped); any other
 *   name, and one containing `=?`, is RFC 2047 `=?UTF-8?B?…?=` words. `Subject` the same, verbatim
 *   when plain ASCII. Encoded words are ≤ 75 characters, split between characters of the NFC text,
 *   and folded with CRLF + space.
 * - `Date` in `+0000`, `Message-ID: <id@domain>` (the job id: the same across retries),
 *   `MIME-Version`, `Auto-Submitted: auto-generated` (no auto-replies).
 * - `multipart/alternative`: `text/plain` then `text/html`, UTF-8, quoted-printable. Every line is
 *   ≤ 998 octets.
 *
 * Refused before anything is built (`MailError`, permanent): an address `parseEmailAddress` does not
 * accept (`MAIL_INVALID_ADDRESS`); a subject or a name with a control character, a line or paragraph
 * separator or a bidi control (`MAIL_INVALID_HEADER`). No header can be injected.
 */
export type BuildOptions = {
  date: Date;
  /** The Message-ID's domain; default the From address's. */
  domain?: string;
  /** Default `=_` + a random UUID: `=` never appears unencoded in quoted-printable, so no part can contain it. */
  boundary?: string;
};

// C0 (tab included), DEL, C1, U+2028/2029, bidi embeddings/overrides (202A–202E) and isolates (2066–2069).
const FORBIDDEN_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]/;
const PRINTABLE_ASCII_RE = /^[ -~]*$/;
const MESSAGE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
/** Bytes of UTF-8 per encoded word: `=?UTF-8?B?` + 60 base64 characters + `?=` = 72 ≤ 75. */
const WORD_BYTES = 45;
/** A plain ASCII subject longer than this is encoded (and so folded) instead of sent as one line. */
const MAX_PLAIN_SUBJECT = 900;

const encoder = new TextEncoder();

/** The message's headers and parts, checked. Every adapter calls this (or `buildMessage`) before sending. */
export function checkMessage(message: MailMessage): { from: string; to: string; replyTo: string | null } {
  const from = address(message.from, 'from');
  const to = address(message.to, 'to');
  const replyTo = message.replyTo ? address(message.replyTo, 'replyTo') : null;
  headerText(message.subject, 'subject');
  if (!MESSAGE_ID_RE.test(message.id)) throw new MailError('MAIL_INVALID_HEADER', { permanent: true, detail: 'id' });
  return { from, to, replyTo };
}

export function buildMessage(message: MailMessage, opts: BuildOptions): string {
  const { from, to, replyTo } = checkMessage(message);
  const boundary = opts.boundary ?? `=_${crypto.randomUUID().replace(/-/g, '')}`;
  const domain = opts.domain ?? domainOf(from);
  const headers = [
    `From: ${mailbox(message.from, from)}`,
    `To: ${mailbox(message.to, to)}`,
    ...(message.replyTo && replyTo ? [`Reply-To: ${mailbox(message.replyTo, replyTo)}`] : []),
    `Subject: ${subject(message.subject)}`,
    `Date: ${rfc5322Date(opts.date)}`,
    `Message-ID: <${message.id}@${domain}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=utf-8`, 'Content-Transfer-Encoding: quoted-printable', '', quotedPrintable(body)].join('\r\n');
  return [...headers, '', part('text/plain', message.text), part('text/html', message.html), `--${boundary}--`, ''].join('\r\n');
}

function address(value: MailAddress, field: string): string {
  const email = parseEmailAddress(value.email);
  // parseEmailAddress trims; an address that needs trimming came from somewhere unchecked.
  if (!email || value.email !== value.email.trim()) throw new MailError('MAIL_INVALID_ADDRESS', { permanent: true, detail: field });
  if (value.name !== undefined) headerText(value.name, `${field}.name`);
  return email;
}

/** Text that may go into a header (a subject, a name): no control, separator or bidi character. */
export function isHeaderSafe(value: string): boolean {
  return !FORBIDDEN_RE.test(value);
}

function headerText(value: string, field: string): void {
  if (!isHeaderSafe(value)) throw new MailError('MAIL_INVALID_HEADER', { permanent: true, detail: field });
}

/** `"Name" <a@b.c>`, `=?UTF-8?B?…?= <a@b.c>` or `<a@b.c>`. */
function mailbox(value: MailAddress, email: string): string {
  const name = value.name?.normalize('NFC').trim();
  if (!name) return `<${email}>`;
  if (PRINTABLE_ASCII_RE.test(name) && !name.includes('=?')) return `"${name.replace(/[\\"]/g, '\\$&')}" <${email}>`;
  return `${encodedWords(name)} <${email}>`;
}

function subject(value: string): string {
  const text = value.normalize('NFC');
  if (PRINTABLE_ASCII_RE.test(text) && !text.includes('=?') && text.length <= MAX_PLAIN_SUBJECT) return text;
  return encodedWords(text);
}

/** RFC 2047 B-words of ≤ 45 bytes each (never splitting a character), folded with CRLF + space. */
export function encodedWords(text: string): string {
  const words: number[][] = [];
  let chunk: number[] = [];
  for (const ch of text.normalize('NFC')) {
    const bytes = encoder.encode(ch);
    if (chunk.length + bytes.length > WORD_BYTES) {
      words.push(chunk.splice(0));
      chunk = [];
    }
    chunk.push(...bytes);
  }
  if (chunk.length > 0 || words.length === 0) words.push(chunk);
  return words.map((bytes) => `=?UTF-8?B?${base64(Uint8Array.from(bytes))}?=`).join('\r\n ');
}

/** Quoted-printable (RFC 2045) of UTF-8 text: CRLF line ends, lines ≤ 76, a leading `.` encoded. */
export function quotedPrintable(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const bytes = encoder.encode(line);
      let out = '';
      let current = '';
      bytes.forEach((byte, i) => {
        const last = i === bytes.length - 1;
        let token = (byte >= 33 && byte <= 126 && byte !== 61) || ((byte === 32 || byte === 9) && !last) ? String.fromCharCode(byte) : `=${hex(byte)}`;
        if (current.length === 0 && token === '.') token = '=2E';
        if (current.length + token.length > 75) {
          out += `${current}=\r\n`;
          current = token === '.' ? '=2E' : token;
        } else {
          current += token;
        }
      });
      return out + current;
    })
    .join('\r\n');
}

const hex = (byte: number) => byte.toString(16).toUpperCase().padStart(2, '0');

/** Standard base64 of bytes (no line breaks). */
export function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** `Mon, 16 Nov 2026 18:56:08 +0000`. */
export function rfc5322Date(date: Date): string {
  return `${DAYS[date.getUTCDay()]}, ${two(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} +0000`;
}
