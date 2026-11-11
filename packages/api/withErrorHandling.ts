import { unstable_rethrow } from 'next/navigation';
import { NextResponse } from 'next/server';

import { AppError } from '@repo/core/error';
import { logger } from '@repo/logger';

import { publicErrorMessage } from './publicErrorMessage';
import { withResponseHeaders } from './responseHeaders';

type Handler<Args extends unknown[]> = (...args: Args) => Promise<Response>;

function statusFromAppError(error: AppError): number {
  const status = error.details?.status;
  if (typeof status === 'number') return status;
  switch (error.code) {
    case 'NOT_FOUND':
      return 404;
    case 'UNAUTHORIZED':
      return 401;
    case 'FORBIDDEN':
      return 403;
    case 'CONFLICT':
      return 409;
    default:
      return 400;
  }
}

function appErrorBody(error: AppError) {
  if (!error.details) return { error: error.message, errorCode: error.code };
  const { status: _status, ...rest } = error.details;
  return {
    error: error.message,
    errorCode: error.code,
    ...(Object.keys(rest).length ? { details: rest } : {}),
  };
}

/**
 * The one error boundary for route handlers. Wrap EVERY exported method:
 *
 *   export const POST = withErrorHandling(async (req) => { ... }, { route: 'POST /api/admin/things' });
 *
 *   - An AppError becomes its typed 4xx/5xx JSON.
 *   - Next's control-flow signals (`redirect()`, `notFound()`) are rethrown for Next.
 *   - Anything else becomes a logged 500 carrying a `reqId` that is also on the
 *     log line, its message filtered through `publicErrorMessage`.
 *   - Headers added through `responseHeaders()` during the handler go on its
 *     response when it succeeds (not on an error).
 *
 * The `route` label is what the log line names, so it must match the file.
 * Guard: scripts/guards/every-route-wrapped.test.ts.
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: Handler<Args>,
  meta?: { route?: string },
): Handler<Args> {
  return async (...args: Args): Promise<Response> => {
    try {
      const { result: response, headers } = await withResponseHeaders(() => handler(...args));
      // A redirect's headers are immutable; such a response carries none of ours.
      if (response.ok) headers.forEach((value, name) => response.headers.set(name, value));
      return response;
    } catch (error) {
      unstable_rethrow(error);

      if (error instanceof AppError) {
        return NextResponse.json(appErrorBody(error), { status: statusFromAppError(error) });
      }

      const reqId = crypto.randomUUID();
      const err = error as Error;
      logger.error({
        event: 'unhandled_route_exception',
        reqId,
        route: meta?.route,
        message: err?.message,
        stack: err?.stack,
      });

      return NextResponse.json(
        {
          error: 'Server error',
          errorCode: 'SERVER_ERROR',
          details: { reqId, message: publicErrorMessage(err, reqId) },
        },
        { status: 500 },
      );
    }
  };
}
