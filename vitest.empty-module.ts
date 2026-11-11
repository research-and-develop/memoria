// Stub aliased in for bare `import 'server-only'` / `import 'client-only'` under
// vitest. Next resolves them to vendored no-op modules per bundling layer; they
// are build-time markers with no runtime API. Installing the npm `server-only`
// package is not a fix: its default entry throws on purpose.
export {};
