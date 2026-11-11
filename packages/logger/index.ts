/**
 * Structured logger. Zero dependencies, works in Node and the browser.
 *
 * Log an EVENT, not a sentence: `logger.info({ event: 'thing_created', id })`.
 * An `event` key is what you grep for in production; free text is not.
 *
 * Formats: `text` (dev, coloured on a TTY) and `json` (one record per line, for
 * log shipping). Set with LOG_FORMAT; level with LOG_LEVEL.
 *
 * Every structured field passes through `redactSensitive` first, so an
 * accidental `logger.info({ row })` cannot emit a password or a token. That is a
 * safety net, not a licence: a secret logged as a bare string has no key to
 * match and goes out as-is.
 */

export enum LogLevel {
  debug = 10,
  info = 20,
  warn = 30,
  error = 40,
  silent = 90,
}

export type LogFormat = 'text' | 'json';

type Sink = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;

export type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  child: (name: string) => Logger;
};

const env: Record<string, string | undefined> =
  typeof process !== 'undefined' && process.env ? process.env : {};

function parseLevel(raw: string | undefined): LogLevel {
  switch ((raw ?? '').toLowerCase()) {
    case 'debug':
      return LogLevel.debug;
    case 'warn':
    case 'warning':
      return LogLevel.warn;
    case 'error':
      return LogLevel.error;
    case 'silent':
    case 'none':
      return LogLevel.silent;
    default:
      return LogLevel.info;
  }
}

let globalLevel = parseLevel(env.LOG_LEVEL);
const globalFormat: LogFormat = env.LOG_FORMAT === 'json' ? 'json' : 'text';

export function setGlobalLogLevel(level: LogLevel): void {
  globalLevel = level;
}

// ---------- Secret redaction ----------

const REDACTED = '[REDACTED]';
const REDACT_MAX_DEPTH = 8;

/**
 * Matched against the NORMALIZED key (camelCase split on `_`, separators
 * unified, lowercased), word-bounded on `_` segments: `consider` is not `sid`,
 * `passed` is not `pass`. Extend it when a new kind of secret appears; keep
 * generic words (`code`, `state`, `value`) out — masking them blinds debugging.
 */
const SENSITIVE_KEY_RE =
  /(^|_)(password|passwd|pwd|pass|passphrase|secret|secrets|token|tokens|otp|totp|apikey|api_key|authorization|auth|bearer|cookie|cookies|sid|session_id|sessionid|jwt|nonce|csrf|xsrf|iban|private_key|secret_key|access_key|client_secret|encryption_key|credential|credentials|creds|magic_link|login_link|dsn|database_url|connection_string)($|_)/;

function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s.]+/g, '_')
    .toLowerCase();
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value;
  // Keep Error/Date identity so `instanceof` downstream still works.
  if (value instanceof Error || value instanceof Date) return value;
  if (depth >= REDACT_MAX_DEPTH) return '[Truncated]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redactValue(v, seen, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(normalizeKey(k))) {
      // Mask strings and whole objects; numbers/booleans pass (`*_tokens` counts).
      out[k] = typeof v === 'string' || (v !== null && typeof v === 'object' && !(v instanceof Date)) ? REDACTED : v;
    } else {
      out[k] = redactValue(v, seen, depth + 1);
    }
  }
  return out;
}

/** Deep copy of `value` with secret-named string/object fields replaced by `[REDACTED]`. */
export function redactSensitive<T>(value: T): T {
  return redactValue(value, new WeakSet<object>(), 0) as T;
}

// ---------- Rendering ----------

const LABEL: Record<Exclude<LogLevel, LogLevel.silent>, string> = {
  [LogLevel.debug]: 'DEBUG',
  [LogLevel.info]: 'INFO',
  [LogLevel.warn]: 'WARN',
  [LogLevel.error]: 'ERROR',
};

const METHOD: Record<Exclude<LogLevel, LogLevel.silent>, keyof Sink> = {
  [LogLevel.debug]: 'debug',
  [LogLevel.info]: 'info',
  [LogLevel.warn]: 'warn',
  [LogLevel.error]: 'error',
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Plain objects merge into top-level fields; Errors become err/errMsg/errStack; the rest is argN. */
function toRecord(level: Exclude<LogLevel, LogLevel.silent>, name: string | undefined, args: unknown[]) {
  const rec: Record<string, unknown> = { time: new Date().toISOString(), level: LABEL[level] };
  if (name) rec.name = name;
  args.forEach((arg, i) => {
    if (arg === undefined) return;
    if (arg instanceof Error) {
      rec.err ??= arg.name;
      rec.errMsg ??= arg.message;
      rec.errStack ??= arg.stack;
    } else if (isPlainObject(arg)) {
      for (const [k, v] of Object.entries(arg)) rec[k in rec ? `${k}_${i}` : k] = v;
    } else {
      rec[`arg${i}`] = arg;
    }
  });
  return rec;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, v: unknown) => {
      if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      return v;
    });
  } catch {
    return String(value);
  }
}

const useColors = typeof process !== 'undefined' && Boolean(process.stdout?.isTTY);
const COLOR: Record<Exclude<LogLevel, LogLevel.silent>, string> = {
  [LogLevel.debug]: '\u001b[36m',
  [LogLevel.info]: '\u001b[32m',
  [LogLevel.warn]: '\u001b[33m',
  [LogLevel.error]: '\u001b[31m',
};

export function createLogger(options: { name?: string; format?: LogFormat; sink?: Sink } = {}): Logger {
  const { name } = options;
  const format = options.format ?? globalFormat;
  const sink = options.sink ?? console;

  const write = (level: Exclude<LogLevel, LogLevel.silent>, args: unknown[]) => {
    if (globalLevel === LogLevel.silent || level < globalLevel) return;
    const redacted = args.map((a) => redactSensitive(a));
    if (format === 'json') {
      sink[METHOD[level]](safeStringify(toRecord(level, name, redacted)));
      return;
    }
    const label = `${LABEL[level]}${name ? ` [${name}]` : ''}`;
    const prefix = useColors ? `${COLOR[level]}${label}\u001b[0m` : label;
    sink[METHOD[level]](prefix, ...redacted);
  };

  return {
    debug: (...args) => write(LogLevel.debug, args),
    info: (...args) => write(LogLevel.info, args),
    warn: (...args) => write(LogLevel.warn, args),
    error: (...args) => write(LogLevel.error, args),
    child: (childName) =>
      createLogger({ name: name ? `${name}:${childName}` : childName, format, sink }),
  };
}

/** The default logger. Use `logger.child('feature')` for a namespace. */
export const logger = createLogger({ name: 'app' });
