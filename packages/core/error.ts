/**
 * The one domain error type. Throw it for any refusal a client should see:
 * `withErrorHandling` turns it into `{ error, errorCode, details }` with the
 * status from `details.status`, or inferred from the code
 * (NOT_FOUND 404, UNAUTHORIZED 401, FORBIDDEN 403, CONFLICT 409, else 400).
 *
 *   throw new AppError('This slug is already taken', 'CONFLICT', { field: 'name' });
 */
export class AppError<T extends Record<string, unknown> = Record<string, unknown>> extends Error {
  public code: string;
  public details: T | null;

  constructor(message: string, code: string, details: T | null = null) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}
