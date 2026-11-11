/**
 * Every route handler is wrapped in `withErrorHandling`, with the right `route` label.
 *
 * The wrapper is the one error boundary. An unwrapped handler that throws
 * answers with Next's bare 500 — no JSON body, no `reqId`, nothing in the log to
 * find it by. The label is what that log line names, so it must match the file.
 *
 * Checked by AST, per exported HTTP method:
 *   export const GET = withErrorHandling(fn, { route: 'GET /api/…' });   ✓
 *   export async function GET(…) { … }                                    ✗ unwrapped
 *   export { handler as GET }                                             ✗ cannot be verified
 *   withErrorHandling(fn) / a label naming another method or path         ✗
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { readSourceFiles } from '@repo/core/testing/sourceIndex';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** App roots: the directory whose sub-path is the route's URL. Add each new app here. */
const APPS = ['apps/web/src/app'];

export function routeFileProblems(appPath: string, sourceText: string): string[] {
  // Route groups `(name)` are not part of the URL.
  const urlPath = '/' + appPath.replace(/\/route\.tsx?$/, '').replace(/\([^/]+\)\//g, '');
  const source = ts.createSourceFile(appPath, sourceText, ts.ScriptTarget.Latest, true);
  const problems: string[] = [];
  const exported = (n: ts.Node) =>
    ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  for (const st of source.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && METHODS.has(st.name.text) && exported(st)) {
      problems.push(`${st.name.text}: an unwrapped function`);
    }
    if (ts.isVariableStatement(st) && exported(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !METHODS.has(d.name.text)) continue;
        const method = d.name.text;
        const init = d.initializer;
        if (!init || !ts.isCallExpression(init) || init.expression.getText(source) !== 'withErrorHandling') {
          problems.push(`${method}: not wrapped in withErrorHandling`);
          continue;
        }
        const meta = init.arguments[1];
        const label =
          meta && ts.isObjectLiteralExpression(meta)
            ? meta.properties.find(
                (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(source) === 'route',
              )
            : undefined;
        const value =
          label && (ts.isStringLiteral(label.initializer) || ts.isNoSubstitutionTemplateLiteral(label.initializer))
            ? label.initializer.text
            : null;
        const expected = `${method} ${urlPath}`;
        if (value === null) problems.push(`${method}: no { route: '${expected}' } label`);
        else if (value !== expected) problems.push(`${method}: labelled '${value}', expected '${expected}'`);
      }
    }
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        if (METHODS.has(el.name.text)) problems.push(`${el.name.text}: re-exported, so its wrapping cannot be checked`);
      }
    }
  }
  return problems;
}

describe('every route handler is wrapped in withErrorHandling', () => {
  let routes = 0;
  const offenders: string[] = [];
  for (const app of APPS) {
    const files = readSourceFiles({ roots: [app], extensions: ['.ts', '.tsx'] }).filter((f) =>
      /\/route\.tsx?$/.test(f.path),
    );
    for (const file of files) {
      routes++;
      const appPath = file.path.slice(app.length + 1);
      for (const problem of routeFileProblems(appPath, file.text)) offenders.push(`${file.path} — ${problem}`);
    }
  }

  it('wraps and labels every exported HTTP method', () => {
    expect(offenders).toEqual([]);
  });

  it('still finds the route files it is meant to be scanning', () => {
    // Raise this floor as the app grows: a broken walk must not pass vacuously.
    expect(routes).toBeGreaterThanOrEqual(1);
  });
});

describe('routeFileProblems', () => {
  const path = 'api/admin/things/[id]/route.ts';

  it('accepts a wrapped, correctly labelled handler', () => {
    expect(
      routeFileProblems(
        path,
        `export const GET = withErrorHandling(async () => x, { route: 'GET /api/admin/things/[id]' });
         export const runtime = 'nodejs';`,
      ),
    ).toEqual([]);
  });

  it('drops route groups from the expected label', () => {
    expect(
      routeFileProblems('(admin)/api/x/route.ts', `export const GET = withErrorHandling(async () => x, { route: 'GET /api/x' });`),
    ).toEqual([]);
  });

  it.each([
    ['an unwrapped function', `export async function GET() { return x; }`, 'an unwrapped function'],
    ['a bare arrow', `export const GET = async () => x;`, 'not wrapped'],
    ['another wrapper', `export const GET = withAuth(async () => x);`, 'not wrapped'],
    ['a missing label', `export const GET = withErrorHandling(async () => x);`, 'no { route'],
    ['a label for another method', `export const GET = withErrorHandling(async () => x, { route: 'POST /api/admin/things/[id]' });`, 'expected'],
    ['a label for another path', `export const GET = withErrorHandling(async () => x, { route: 'GET /api/admin/things' });`, 'expected'],
    ['a re-export', `export { handler as GET } from './impl';`, 're-exported'],
  ])('flags %s', (_label, src, fragment) => {
    const problems = routeFileProblems(path, src);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(fragment);
  });
});
