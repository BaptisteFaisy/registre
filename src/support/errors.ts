/**
 * Shared error types. Every module throws these instead of bare `Error`,
 * so the API layer can map them to HTTP statuses without inspecting strings.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'UNREADABLE'
  | 'UPSTREAM'
  | 'CONFIG';

export class RegistreError extends Error {
  readonly code: ErrorCode;
  readonly detail: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'RegistreError';
    this.code = code;
    this.detail = detail;
  }

  /** HTTP status this error maps to. */
  get status(): number {
    switch (this.code) {
      case 'BAD_REQUEST':
        return 400;
      case 'FORBIDDEN':
        return 403;
      case 'NOT_FOUND':
        return 404;
      case 'CONFLICT':
        return 409;
      case 'UNREADABLE':
        return 422;
      default:
        return 502;
    }
  }
}

export const badRequest = (message: string, detail?: Record<string, unknown>): RegistreError =>
  new RegistreError('BAD_REQUEST', message, detail);

export const notFound = (message: string, detail?: Record<string, unknown>): RegistreError =>
  new RegistreError('NOT_FOUND', message, detail);

export const forbidden = (message: string, detail?: Record<string, unknown>): RegistreError =>
  new RegistreError('FORBIDDEN', message, detail);

export const conflict = (message: string, detail?: Record<string, unknown>): RegistreError =>
  new RegistreError('CONFLICT', message, detail);

export const unreadable = (message: string, detail?: Record<string, unknown>): RegistreError =>
  new RegistreError('UNREADABLE', message, detail);

export const upstream = (message: string, detail?: Record<string, unknown>): RegistreError =>
  new RegistreError('UPSTREAM', message, detail);

export const configError = (message: string, detail?: Record<string, unknown>): RegistreError =>
  new RegistreError('CONFIG', message, detail);

/** Narrows an unknown throwable to a `RegistreError`, wrapping anything else. */
export function asRegistreError(error: unknown): RegistreError {
  if (error instanceof RegistreError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new RegistreError('UPSTREAM', message);
}
