/**
 * AWS Lambda handler — API Gateway HTTP API v2 (payload format 2.0).
 *
 * The event is adapted to the same `ApiRequest` the local server builds, so an
 * endpoint behaves identically locally and on AWS. The `Services` bundle is
 * resolved once, outside the handler: a warm invocation reuses the adapters
 * instead of rebuilding DynamoDB/S3/Bedrock clients.
 */

import type { Services } from '../ports/index.ts';
import { EMPTY_BODY, HTTP_METHODS, decodeBase64, encodeBase64, responseBytes } from './http.ts';
import type { ApiRequest, ApiResponse, HttpMethod } from './http.ts';
import { DEFAULT_MAX_BODY_BYTES } from './router.ts';
import type { Router } from './router.ts';
import { createRouter } from './server.ts';
import { servicesSingleton } from './services.ts';
import { claimsFromEvent, headersFromClaims, stripGatewayHeaders } from './cognito.ts';

/** One record of an API Gateway HTTP API v2 event. */
export interface LambdaHttpEvent {
  version?: string;
  routeKey?: string;
  rawPath?: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  cookies?: string[];
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: {
    http?: { method?: string; path?: string; sourceIp?: string };
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
}

/** The slice of the Lambda context this handler uses. */
export interface LambdaContext {
  getRemainingTimeInMillis(): number;
  awsRequestId?: string;
  functionName?: string;
}

/** Response shape API Gateway expects. */
export interface LambdaHttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
}

/** Module-level cache: one router (hence one bundle) per container. */
let routerPromise: Promise<Router> | null = null;

/** Builds the router once per container. */
function routerFor(services: Services): Promise<Router> {
  routerPromise ??= Promise.resolve(createRouter(services));
  return routerPromise;
}

/** Lower-cased headers plus the cookies of the v2 format. */
function headersOf(event: LambdaHttpEvent): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value === undefined) continue;
    headers[name.toLowerCase()] = value;
  }
  if (event.cookies !== undefined && event.cookies.length > 0) {
    headers.cookie = event.cookies.join('; ');
  }
  return headers;
}

/** Query of the v2 event, preferring the raw string when present. */
function queryOf(event: LambdaHttpEvent): Record<string, string> {
  if (event.rawQueryString !== undefined && event.rawQueryString.length > 0) {
    const query: Record<string, string> = {};
    for (const [name, value] of new URLSearchParams(event.rawQueryString)) query[name] = value;
    return query;
  }
  const query: Record<string, string> = {};
  for (const [name, value] of Object.entries(event.queryStringParameters ?? {})) {
    if (value !== undefined) query[name] = value;
  }
  return query;
}

/** Body of the v2 event, decoded when API Gateway base64-encoded it. */
function bodyOf(event: LambdaHttpEvent): Uint8Array {
  if (event.body === null || event.body === undefined || event.body.length === 0) return EMPTY_BODY;
  return event.isBase64Encoded === true
    ? decodeBase64(event.body, 'body')
    : new TextEncoder().encode(event.body);
}

/**
 * Adapts an API Gateway v2 event to the internal request.
 *
 * Client-sent `x-registre-*` headers are dropped first, then the claims the
 * gateway validated are re-injected: an identity can only come from Cognito.
 */
export function toApiRequestFromEvent(event: LambdaHttpEvent): ApiRequest {
  const method = (event.requestContext?.http?.method ?? 'GET').toUpperCase() as HttpMethod;
  const claims = claimsFromEvent(event);
  const headers = stripGatewayHeaders(headersOf(event));
  return {
    method: HTTP_METHODS.includes(method) ? method : 'GET',
    path: event.rawPath ?? event.requestContext?.http?.path ?? '/',
    query: queryOf(event),
    headers: claims === null ? headers : { ...headers, ...headersFromClaims(claims) },
    body: bodyOf(event)
  };
}

/** Serialises one internal response for API Gateway. */
export async function toLambdaResult(response: ApiResponse): Promise<LambdaHttpResult> {
  const bytes = await responseBytes(response);
  const contentType = response.headers['content-type'] ?? 'application/octet-stream';
  const binary = !isTextual(contentType);
  return {
    statusCode: response.status,
    headers: { ...response.headers },
    body: binary ? encodeBase64(bytes) : new TextDecoder().decode(bytes),
    isBase64Encoded: binary
  };
}

/** True for content types API Gateway may carry as UTF-8 text. */
function isTextual(contentType: string): boolean {
  return (
    contentType.startsWith('application/json') ||
    contentType.startsWith('text/') ||
    contentType.startsWith('application/problem+json')
  );
}

/** Lambda entry point: one HTTP request in, one response out. */
export async function handler(event: LambdaHttpEvent, context?: LambdaContext): Promise<LambdaHttpResult> {
  const { services } = await servicesSingleton();
  const router = await routerFor(services);
  const request = toApiRequestFromEvent(event);
  if (request.body.byteLength > DEFAULT_MAX_BODY_BYTES) {
    return {
      statusCode: 413,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'request body is too large', detail: {} }
      }),
      isBase64Encoded: false
    };
  }
  if (context !== undefined) {
    console.log(`[api] ${request.method} ${request.path} remaining=${context.getRemainingTimeInMillis()}ms`);
  }
  return toLambdaResult(await router.handle(request));
}

/** Test helper: forget the cached router (one container, several test cases). */
export function resetLambdaCache(): void {
  routerPromise = null;
}
