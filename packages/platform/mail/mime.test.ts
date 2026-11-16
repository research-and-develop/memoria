import { describe, expect, it } from 'vitest';

import type { MailMessage } from '../ports';

import { buildMessage, encodedWords, quotedPrintable, rfc5322Date } from './mime';

const message = (overrides: Partial<MailMessage> = {}): MailMessage => ({
  id: 'job-1',
  from: { email: 'studio@example.com', name: 'Studio' },
  to: { email: 'client@example.org' },
  subject: 'Your gallery',
  text: 'Hello',
  html: '<p>Hello</p>',
  ...overrides,
});
const opts = { date: new Date('2026-11-16T18:56:08.123Z'), boundary: '=_b' };

/** Decode a header value made of RFC 2047 B-words (folding whitespace between words dropped). */
function decodeWords(value: string): string {
  const words = value.split(/\r\n /);
  const bytes: number[] = [];
  for (const word of words) {
    const m = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=$/.exec(word);
    if (!m) throw new Error(`not an encoded word: ${word}`);
    bytes.push(...Uint8Array.from(atob(m[1]!), (c) => c.charCodeAt(0)));
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
}

function decodeQp(text: string): string {
  const joined = text.replace(/=\r\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === '=') {
      bytes.push(Number.parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(joined.charCodeAt(i));
    }
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes)).replace(/\r\n/g, '\n');
}

const header = (mime: string, name: string): string => {
  const head = mime.split('\r\n\r\n')[0]!;
  const m = new RegExp(`^${name}: (.*(?:\\r\\n .*)*)`, 'm').exec(head);
  if (!m) throw new Error(`no ${name}`);
  return m[1]!;
};

describe('buildMessage', () => {
  it('builds the headers and two quoted-printable parts', () => {
    const mime = buildMessage(message(), opts);
    expect(mime).toBe(
      [
        'From: "Studio" <studio@example.com>',
        'To: <client@example.org>',
        'Subject: Your gallery',
        'Date: Mon, 16 Nov 2026 18:56:08 +0000',
        'Message-ID: <job-1@example.com>',
        'MIME-Version: 1.0',
        'Auto-Submitted: auto-generated',
        'Content-Type: multipart/alternative; boundary="=_b"',
        '',
        '--=_b',
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        'Hello',
        '--=_b',
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: quoted-printable',
        '',
        '<p>Hello</p>',
        '--=_b--',
        '',
      ].join('\r\n'),
    );
  });

  it('adds Reply-To, and takes the Message-ID domain when given', () => {
    const mime = buildMessage(message({ replyTo: { email: 'me@example.net', name: 'Me' } }), { ...opts, domain: 'mail.example.com' });
    expect(header(mime, 'Reply-To')).toBe('"Me" <me@example.net>');
    expect(header(mime, 'Message-ID')).toBe('<job-1@mail.example.com>');
  });

  it('the default boundary is random and starts with =_ (never in quoted-printable text)', () => {
    const a = buildMessage(message(), { date: opts.date });
    const b = buildMessage(message(), { date: opts.date });
    const boundary = (mime: string) => /boundary="([^"]+)"/.exec(mime)![1]!;
    expect(boundary(a)).toMatch(/^=_[0-9a-f]{32}$/);
    expect(boundary(a)).not.toBe(boundary(b));
  });

  it('a body that contains the boundary text cannot end a part early', () => {
    const mime = buildMessage(message({ text: '--=_b--\nhi' }), opts);
    expect(mime.split('\r\n').filter((l) => l === '--=_b--')).toHaveLength(1);
  });

  it('quotes ASCII names with \\ and " escaped', () => {
    const mime = buildMessage(message({ from: { email: 'studio@example.com', name: 'Ana "Lens" \\ Co' } }), opts);
    expect(header(mime, 'From')).toBe('"Ana \\"Lens\\" \\\\ Co" <studio@example.com>');
  });

  it.each([
    ['Cyrillic', 'Студио Мемория'],
    ['an ASCII name with =?', 'a =?UTF-8?B?x?= trick'],
    ['an emoji', 'Studio 📷'],
  ])('encodes a name with %s as B-words that decode to it', (_label, name) => {
    const value = header(buildMessage(message({ from: { email: 'studio@example.com', name } }), opts), 'From');
    const [words, addr] = [value.slice(0, value.lastIndexOf(' <')), value.slice(value.lastIndexOf(' <') + 1)];
    expect(addr).toBe('<studio@example.com>');
    expect(decodeWords(words)).toBe(name);
  });

  it('a 200-character Cyrillic subject: words ≤ 75, lines folded, decodes to the NFC text', () => {
    const subject = 'Ваша галерия е готова — '.repeat(9).slice(0, 200);
    const value = header(buildMessage(message({ subject }), opts), 'Subject');
    for (const word of value.split('\r\n ')) expect(word.length).toBeLessThanOrEqual(75);
    expect(decodeWords(value)).toBe(subject);
  });

  it('normalises to NFC (a decomposed й becomes one character)', () => {
    const decomposed = 'й';
    expect(decodeWords(header(buildMessage(message({ subject: decomposed }), opts), 'Subject'))).toBe('й');
  });

  it.each([
    ['2-byte', 'я'],
    ['3-byte', '€'],
    ['4-byte', '😀'],
  ])('never splits a %s character between words', (_label, ch) => {
    for (let pad = 0; pad < 4; pad++) {
      const text = 'a'.repeat(pad) + ch.repeat(40);
      expect(decodeWords(encodedWords(text))).toBe(text);
    }
  });

  it('keeps every line ≤ 998 octets, a long plain subject included', () => {
    const mime = buildMessage(message({ subject: 'x'.repeat(2000), text: 'y'.repeat(5000), html: `<p>${'z '.repeat(3000)}</p>` }), opts);
    for (const line of mime.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(998);
  });

  it.each([
    ['CR', 'a\rb'],
    ['LF', 'a\nb'],
    ['a tab', 'a\tb'],
    ['NUL', 'a\u0000b'],
    ['DEL', 'a\u007fb'],
    ['a C1 control', 'a\u0085b'],
    ['U+2028', 'a\u2028b'],
    ['U+2029', 'a\u2029b'],
    ['RLO', 'a\u202Eb'],
    ['an isolate', 'a\u2066b'],
  ])('refuses %s in the subject and in a name', (_label, bad) => {
    expect(() => buildMessage(message({ subject: bad }), opts)).toThrow(expect.objectContaining({ code: 'MAIL_INVALID_HEADER', permanent: true }));
    expect(() => buildMessage(message({ to: { email: 'client@example.org', name: bad } }), opts)).toThrow(expect.objectContaining({ code: 'MAIL_INVALID_HEADER' }));
  });

  it.each(['not-an-address', ' client@example.org', 'client@example.org\r\n', 'a<b@example.org', 'клиент@example.org'])('refuses the address %j', (email) => {
    expect(() => buildMessage(message({ to: { email } }), opts)).toThrow(expect.objectContaining({ code: 'MAIL_INVALID_ADDRESS', permanent: true }));
  });

  it('refuses an id that cannot be a Message-ID', () => {
    expect(() => buildMessage(message({ id: 'a b>' }), opts)).toThrow(expect.objectContaining({ code: 'MAIL_INVALID_HEADER' }));
  });
});

describe('quotedPrintable', () => {
  it.each([
    ['plain', 'Hello'],
    ['Cyrillic', 'Здравей, галерията е готова.'],
    ['= and trailing spaces', 'a=b   \nc\t'],
    ['a leading dot', '.\n..hidden'],
    ['a long line', 'ж'.repeat(300)],
    ['CRLF and CR line ends', 'one\r\ntwo\rthree'],
  ])('%s decodes to the input, lines ≤ 76', (_label, text) => {
    const qp = quotedPrintable(text);
    for (const line of qp.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
    expect(qp.split('\r\n').some((l) => l.startsWith('.'))).toBe(false);
    expect(decodeQp(qp)).toBe(text.replace(/\r\n?/g, '\n'));
  });
});

describe('rfc5322Date', () => {
  it('formats in UTC', () => {
    expect(rfc5322Date(new Date('2026-01-04T03:04:05Z'))).toBe('Sun, 04 Jan 2026 03:04:05 +0000');
  });
});
