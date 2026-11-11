/**
 * API-level errors and the single error body shape (docs/API.md "Errors").
 *
 * `RegistreError` (src/support/errors.ts) already carries the domain codes and
 * their HTTP status. This layer only adds what the transport knows and the
 * domain does not: 401 (no credentials), 405 (method not allowed) and
 * 413 (body above the limit). Every error leaves the API as
 * `{ "error": { code, message, detail } }` — one shape, no exception.
 */

import { RegistreError } from '../support/errors.ts';
import type { ErrorCode } from '../support/errors.ts';

/** Codes emitted by the transport itself, on top of the domain `ErrorCode`s. */
export type ApiErrorCode = ErrorCode | 'UNAUTHENTICATED' | 'METHOD_NOT_ALLOWED' | 'PAYLOAD_TOO_LARGE' | 'INTERNAL';

/** An error that already knows its HTTP status and machine-readable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly detail: Record<string, unknown>;

  constructor(status: number, code: ApiErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** No usable credential — EF-ADM-03 (demo identities). */
export const unauthorized = (
  message = 'a bearer token or a session cookie is required',
  detail: Record<string, unknown> = {}
): ApiError => new ApiError(401, 'UNAUTHENTICATED', message, detail);

/** The credential is known but the role is not allowed — spec chapter 6. */
export const accessDenied = (message: string, detail: Record<string, unknown> = {}): ApiError =>
  new ApiError(403, 'FORBIDDEN', message, detail);

/** The path exists for another method — router level. */
export const methodNotAllowed = (
  method: string,
  path: string,
  allowed: readonly string[]
): ApiError =>
  new ApiError(405, 'METHOD_NOT_ALLOWED', `${method} is not allowed on ${path}`, { method, path, allowed });

/** No route matches the request path — router level. */
export const routeNotFound = (method: string, path: string): ApiError =>
  new ApiError(404, 'NOT_FOUND', `no route matches ${method} ${path}`, { method, path });

/** The request body exceeds the configured limit. */
export const payloadTooLarge = (limitBytes: number, receivedBytes: number): ApiError =>
  new ApiError(413, 'PAYLOAD_TOO_LARGE', `request body exceeds ${limitBytes} bytes`, {
    limitBytes,
    receivedBytes
  });

/** Normalised description of any throwable, ready to be serialised. */
export interface ErrorDescription {
  status: number;
  code: string;
  message: string;
  detail: Record<string, unknown>;
}

/** Longest internal message echoed on a 500, so a stack detail stays short. */
const MAX_INTERNAL_MESSAGE = 200;

/** Maps any throwable to `{status, code, message, detail}`. */
export function describeError(error: unknown): ErrorDescription {
  if (error instanceof ApiError) {
    return { status: error.status, code: error.code, message: error.message, detail: error.detail };
  }
  if (error instanceof RegistreError) {
    return { status: error.status, code: error.code, message: error.message, detail: error.detail };
  }
  const reason = error instanceof Error ? error.message : String(error);
  return {
    status: 500,
    code: 'INTERNAL',
    message: 'unexpected server error',
    detail: { reason: reason.slice(0, MAX_INTERNAL_MESSAGE) }
  };
}

/** The one error body of the API (docs/API.md). */
export function errorBody(description: ErrorDescription): {
  error: { code: string; message: string; detail: Record<string, unknown> };
} {
  return {
    error: { code: description.code, message: description.message, detail: description.detail }
  };
}

/** True for a client-side fault (4xx), used to decide whether to log. */
export function isClientError(status: number): boolean {
  return status >= 400 && status < 500;
}
