/**
 * The ports: what domain code may ask of the platform it runs on. Domain code (routes, src/lib,
 * query modules) uses these types and `getPlatform()` from `@repo/platform/current`; adapters
 * (`@repo/platform-cloudflare`, a Docker one later) implement them. Nothing here names a platform.
 */

/** A value a statement may bind. No `undefined` (use `null`), no booleans (use 0/1), no BLOBs. */
export type SqlValue = string | number | null;

/** A query as plain data: the adapter prepares and binds it when it runs. */
export type Statement = { readonly sql: string; readonly params: readonly SqlValue[] };

/**
 * The effect of a write. `changes` may include rows written by triggers (D1 counts them): compare it
 * with 0, never with an exact count. `lastRowId` is the rowid of the last insert, when there was one.
 */
export type WriteResult = { changes: number; lastRowId: number | null };

/** One statement's outcome inside a batch: the rows it returned (if any) and its `changes`. */
export type BatchResult<T = Record<string, unknown>> = { rows: T[]; changes: number };

/** An SQLite-dialect database. */
export interface Db {
  all<T = Record<string, unknown>>(s: Statement): Promise<T[]>;
  first<T = Record<string, unknown>>(s: Statement): Promise<T | null>;
  run(s: Statement): Promise<WriteResult>;
  /**
   * Atomic: the statements run in order and either all commit or all roll back; rejects with the
   * failing statement's error. The only transaction there is (D1 has no BEGIN/COMMIT).
   */
  batch<T = Record<string, unknown>>(s: readonly Statement[]): Promise<BatchResult<T>[]>;
}

export type BlobMeta = {
  key: string;
  size: number;
  contentType: string | null;
  /** Quoted, as in an HTTP `ETag` header. */
  etag: string;
  /** ISO-8601 UTC. */
  uploadedAt: string;
};

export type BlobObject = BlobMeta & { body: ReadableStream<Uint8Array> };

export type BlobPutOptions = {
  contentType: string;
  cacheControl?: string;
  /** Keep an existing object instead of overwriting it (`put` then returns `false`). */
  ifAbsent?: boolean;
};

/** Object storage (R2 on Cloudflare; S3 or MinIO under Docker). */
export interface BlobStore {
  /** Bytes only: no streams until a phase needs them. `false` = `ifAbsent` and the key existed. */
  put(key: string, bytes: ArrayBuffer | Uint8Array, opts: BlobPutOptions): Promise<BlobMeta | false>;
  get(key: string): Promise<BlobObject | null>;
  head(key: string): Promise<BlobMeta | null>;
  /** Missing keys are ignored; adapters chunk as their backend needs. */
  delete(keys: readonly string[]): Promise<void>;
  /** By key, ascending. `limit` ≤ 1000 (default 1000); `cursor` is null when there is nothing more. */
  list(opts: { prefix: string; cursor?: string | null; limit?: number }): Promise<{ blobs: BlobMeta[]; cursor: string | null }>;
}

/** S3-compatible credentials for presigned URLs (R2's S3 endpoint in production). */
export type S3Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string };

/**
 * The runtime configuration, parsed from plain string env by `parseConfig` (config.ts). Holds
 * secrets: server code only. The public subset reaches the browser through the app's `AppConfig`.
 */
export type Config = {
  appName: string;
  /** The canonical origin, without a trailing slash; null = the origin of each request. */
  siteUrl: string | null;
  /** `NEXTJS_ENV=development` (local dev and preview only; never set in production). */
  isDevelopment: boolean;
  /**
   * Empty email or hash = the admin login is closed. The email is lower-cased. `totpKey`: the
   * 32-byte `TOTP_ENCRYPTION_KEY` that protects two-factor secrets; null = two-factor sign-in
   * answers 503 (so the admin is closed too).
   */
  admin: { email: string; passwordHash: string; totpKey: Uint8Array | null };
  turnstile: { siteKey: string; secretKey: string };
  hashSalt: string;
  media: {
    /** Signs the development-only blob routes; null when unset or shorter than 32 characters. */
    devSigningSecret: string | null;
    /** The public media domain (R2 custom domain), without a trailing slash; null = none. */
    publicBaseUrl: string | null;
    /** null unless all four S3 settings are present. */
    s3: S3Config | null;
  };
};

/** Everything domain code gets from the platform. Methods, not values: an adapter may resolve per request. */
export interface Platform {
  readonly name: 'cloudflare' | 'test';
  db(): Db;
  blobs(): BlobStore;
  config(): Config;
  /** Keep `task` running after the response. Rejections are logged (`deferred_task_failed`), never thrown. */
  defer(task: Promise<unknown>): void;
}
