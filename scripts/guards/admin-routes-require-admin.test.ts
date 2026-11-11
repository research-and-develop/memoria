/**
 * Guard: every admin API handler calls `requireAdmin(req)` FIRST.
 *
 * The admin API is the whole CMS — one forgotten check is an open door. The
 * call must come before the body or params are touched (`req.json()`,
 * `req.formData()`, `await params`), so an unauthenticated request does no
 * work and cannot probe validation. login/logout are the only exceptions.
 */
import { describe, expect, it } from 'vitest';

import { readSourceFiles, stripComments } from '@repo/core/testing/sourceIndex';

const ADMIN_API = /apps[\\/]web[\\/]src[\\/]app[\\/]api[\\/]admin[\\/]/;
const EXEMPT = /[\\/]admin[\\/](login|logout)[\\/]route\.ts$/;
const HANDLER_RE = /export const (GET|POST|PUT|PATCH|DELETE)\s*=\s*withErrorHandling\(\s*async\s*\(([^)]*)\)\s*=>\s*\{/g;
const BODY_ACCESS_RE = /req\.(json|formData|text|arrayBuffer)\(|await params|searchParams/;

export function handlerProblems(source: string): string[] {
  const text = stripComments(source);
  const problems: string[] = [];
  for (const m of text.matchAll(HANDLER_RE)) {
    const start = (m.index ?? 0) + m[0].length;
    const next = text.slice(start).search(/\nexport const /);
    const body = next === -1 ? text.slice(start) : text.slice(start, start + next);
    const gate = body.search(/await requireAdmin\(\s*req\s*\)/);
    if (gate === -1) {
      problems.push(`${m[1]}: no \`await requireAdmin(req)\``);
      continue;
    }
    const access = body.search(BODY_ACCESS_RE);
    if (access !== -1 && access < gate) problems.push(`${m[1]}: reads the request before requireAdmin`);
  }
  return problems;
}

describe('admin API routes are gated', () => {
  const files = readSourceFiles({ roots: ['apps/web/src/app/api'], extensions: ['.ts'] }).filter(
    (f) => ADMIN_API.test(f.absPath) && /route\.ts$/.test(f.path) && !EXEMPT.test(f.path),
  );

  it('finds admin routes to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('each handler calls requireAdmin before touching the request', () => {
    const offenders = files.flatMap((f) => handlerProblems(f.text).map((p) => `${f.path} → ${p}`));
    expect(offenders).toEqual([]);
  });

  it('catches the mistakes it is for', () => {
    const ok = `export const POST = withErrorHandling(async (req: NextRequest) => {
      const admin = await requireAdmin(req); if (!admin.ok) return admin.response;
      const body = await req.json();
    }, { route: 'POST /api/admin/x' });`;
    expect(handlerProblems(ok)).toEqual([]);
    expect(handlerProblems(ok.replace('await requireAdmin(req)', 'null'))).toHaveLength(1);
    const late = `export const POST = withErrorHandling(async (req: NextRequest) => {
      const body = await req.json();
      const admin = await requireAdmin(req);
    }, { route: 'POST /api/admin/x' });`;
    expect(handlerProblems(late)).toEqual(['POST: reads the request before requireAdmin']);
  });
});
