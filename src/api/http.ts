/**
 * Transport-neutral HTTP request/response types and helpers.
 *
 * The router never touches `node:http` directly: `server.ts` adapts an
 * `IncomingMessage` to an `ApiRequest`, `lambda.ts` adapts an API Gateway v2
 * event. Both then share one code path, which is why the 16 endpoints of
 * chapter 15 behave identically locally and on AWS.
 */

import { badRequest } from '../support/errors.ts';
import { describeError, errorBody, isClientError } from './errors.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';

/** Methods the router can dispatch. */
export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/** JSON content type used by every JSON response. */
export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** Empty payload, reused instead of allocating on every 204. */
export const EMPTY_BODY = new Uint8Array(0);

/** A request, whatever the underlying runtime. */
export interface ApiRequest {
  method: HttpMethod;
  /** Path only, no query string, always starting with `/`. */
  path: string;
  /** Query parameters; the last occurrence wins. */
  query: Record<string, string>;
  /** Header names lower-cased. */
  headers: Record<string, string>;
  body: Uint8Array;
}

/** A response; `stream` wins over `body` when both are set. */
export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body?: Uint8Array | string;
  /** Chunked payload, used by the audit-pack archive download. */
  stream?: AsyncIterable<Uint8Array>;
}

/** JSON response. */
export function json(status: number, payload: unknown, headers: Record<string, string> = {}): ApiResponse {
  return {
    status,
    headers: { 'content-type': JSON_CONTENT_TYPE, ...headers },
    body: JSON.stringify(payload)
  };
}

/** Plain-text response. */
export function text(status: number, payload: string, contentType = 'text/plain; charset=utf-8'): ApiResponse {
  return { status, headers: { 'content-type': contentType }, body: payload };
}

/** Response with no payload (204, 304). */
export function empty(status: number, headers: Record<string, string> = {}): ApiResponse {
  return { status, headers: { ...headers }, body: EMPTY_BODY };
}

/** Lower-cased header lookup. */
export function headerOf(request: ApiRequest, name: string): string | undefined {
  return request.headers[name.toLowerCase()];
}

/** Body decoded as UTF-8. */
export function textBody(request: ApiRequest): string {
  return new TextDecoder().decode(request.body);
}

/** Body parsed as JSON; an empty or malformed body is a `BAD_REQUEST`. */
export function jsonBody(request: ApiRequest): unknown {
  const raw = textBody(request).trim();
  if (raw.length === 0) throw badRequest('request body is empty, JSON is required');
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw badRequest('request body is not valid JSON');
  }
}

/** Strict base64/base64url decoder; invalid input is a `BAD_REQUEST`. */
export function decodeBase64(value: string, field = 'contentBase64'): Uint8Array {
  const normalised = value.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  if (normalised.length === 0) throw badRequest(`"${field}" is empty`);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalised)) {
    throw badRequest(`"${field}" is not valid base64`, { field });
  }
  const bytes = Buffer.from(normalised, 'base64');
  if (bytes.byteLength === 0) throw badRequest(`"${field}" does not decode to any byte`, { field });
  return new Uint8Array(bytes);
}

/** Base64 encoder (padded, standard alphabet) used by the Lambda adapter. */
export function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** Body of an `ApiResponse` as bytes, buffering a stream when needed. */
export async function responseBytes(response: ApiResponse): Promise<Uint8Array> {
  if (response.stream) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.stream) chunks.push(chunk);
    return concatBytes(chunks);
  }
  if (response.body === undefined) return EMPTY_BODY;
  return typeof response.body === 'string' ? new TextEncoder().encode(response.body) : response.body;
}

/** Concatenates byte chunks (archive download, Lambda body). */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** Splits a payload into fixed-size chunks, for a chunked download. */
export async function* chunked(bytes: Uint8Array, chunkSize = 64 * 1024): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    yield bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
  }
}

/** Turns any throwable into the single error response shape of the API. */
export function errorResponse(error: unknown): ApiResponse {
  const description = describeError(error);
  if (!isClientError(description.status)) {
    console.error(`[api] ${description.status} ${description.code}: ${description.message}`);
  }
  return json(description.status, errorBody(description));
}

/** Merges header maps, later entries winning. */
export function mergeHeaders(
  ...sources: ReadonlyArray<Record<string, string> | undefined>
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    if (source === undefined) continue;
    for (const [name, value] of Object.entries(source)) merged[name.toLowerCase()] = value;
  }
  return merged;
}
