/**
 * The router: a small, dependency-free dispatcher over `node:http`.
 *
 * Responsibilities, all of them in one place so every endpoint behaves the
 * same way (spec chapter 15):
 *  - path patterns with `:param` segments, matched in declaration order;
 *  - body reading with a hard size limit (413 above it);
 *  - authentication (401) then role check (403) before the handler runs;
 *  - centralised error mapping: `RegistreError`/`ApiError` → `{error:{...}}`;
 *  - baseline security headers and a configurable CORS policy.
 */

import type { Principal, Role } from '../domain/types.ts';
import { badRequest } from '../support/errors.ts';
import type { CredentialDirectory } from './auth.ts';
import { ANONYMOUS_PRINCIPAL, authenticate } from './auth.ts';
import { describeError, errorBody, methodNotAllowed, payloadTooLarge, routeNotFound } from './errors.ts';
import { HTTP_METHODS, empty, json, mergeHeaders, text } from './http.ts';
import type { ApiRequest, ApiResponse } from './http.ts';
import type { PipelineApi } from './pipeline.ts';
import type { ApiContext, RouteDefinition } from './types.ts';

/** Options of the dispatcher. */
export interface RouterOptions {
  services: ApiContext['services'];
  pipeline: PipelineApi;
  directory: CredentialDirectory;
  /** Maximum accepted body size in bytes (default 8 MiB). */
  maxBodyBytes?: number;
  /** `*` by default: the demonstration portal is served from another origin. */
  corsOrigins?: readonly string[] | '*';
  /** Extra headers merged into every response. */
  extraHeaders?: Record<string, string>;
}

/** Default body limit: 8 MiB, enough for a scanned PDF of a few dozen pages. */
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Baseline security headers (spec 16, ENF-CONF-01..03). */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'cross-origin-resource-policy': 'same-site',
  'strict-transport-security': 'max-age=31536000; includeSubDomains'
};

/** A path pattern split into its segments. */
export interface CompiledPath {
  pattern: string;
  segments: readonly string[];
}

/** One route with its compiled pattern. */
interface CompiledRoute {
  route: RouteDefinition;
  compiled: CompiledPath;
}

/** Compiles `/v1/controls/:id` into its segments. */
export function compilePath(pattern: string): CompiledPath {
  return { pattern, segments: pattern.split('/').filter((segment) => segment.length > 0) };
}

/** Splits a request path into its segments, ignoring a trailing slash. */
export function pathSegments(path: string): string[] {
  return (path.split('?')[0] ?? '').split('/').filter((segment) => segment.length > 0);
}

/** Matches a compiled pattern against request segments; `null` when it differs. */
export function matchPath(
  compiled: CompiledPath,
  segments: readonly string[]
): Record<string, string> | null {
  if (compiled.segments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < compiled.segments.length; index += 1) {
    const expected = compiled.segments[index] ?? '';
    const actual = segments[index] ?? '';
    if (expected.startsWith(':')) {
      if (actual.length === 0) return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

/** CORS headers for one origin; empty when the origin is not allowed. */
export function corsHeaders(
  origin: string | undefined,
  allowed: readonly string[] | '*'
): Record<string, string> {
  if (allowed === '*') {
    return {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': HTTP_METHODS.join(', '),
      'access-control-allow-headers': 'authorization, content-type, x-request-id',
      'access-control-max-age': '600'
    };
  }
  if (origin === undefined || !allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': HTTP_METHODS.join(', '),
    'access-control-allow-headers': 'authorization, content-type, x-request-id',
    'access-control-max-age': '600',
    vary: 'origin'
  };
}

/** Parses the JSON body of a request; empty or malformed is a `BAD_REQUEST`. */
export function parseJsonBody<T>(request: ApiRequest): T {
  const raw = new TextDecoder().decode(request.body).trim();
  if (raw.length === 0) throw badRequest('request body is empty, JSON is required');
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw badRequest('request body is not valid JSON');
  }
}

/** Rejects a route table where two entries claim the same method and pattern. */
function assertNoDuplicateRoutes(routes: readonly CompiledRoute[]): void {
  const seen = new Set<string>();
  for (const entry of routes) {
    const key = `${entry.route.method} ${entry.compiled.pattern}`;
    if (seen.has(key)) throw new Error(`duplicate route declaration: ${key}`);
    seen.add(key);
  }
}

/** The dispatcher. One instance per process; the route table is fixed. */
export class Router {
  private readonly compiled: CompiledRoute[];
  private readonly options: RouterOptions;
  private readonly maxBodyBytes: number;

  constructor(routes: readonly RouteDefinition[], options: RouterOptions) {
    this.compiled = routes.map((route) => ({ route, compiled: compilePath(route.path) }));
    this.options = options;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    assertNoDuplicateRoutes(this.compiled);
  }

  /** Every declared route, for the OpenAPI document and the startup log. */
  routes(): RouteDefinition[] {
    return this.compiled.map((entry) => entry.route);
  }

  /** Handles one request; never throws — every failure becomes a response. */
  async handle(request: ApiRequest): Promise<ApiResponse> {
    const base = mergeHeaders(
      corsHeaders(request.headers.origin, this.options.corsOrigins ?? '*'),
      this.options.extraHeaders
    );
    try {
      const response = await this.dispatch(request);
      return withBase(response, base);
    } catch (error) {
      return withBase(this.failure(error), base);
    }
  }

  /** The nominal path: body limit, resolve, authenticate, run. */
  private async dispatch(request: ApiRequest): Promise<ApiResponse> {
    if (request.method === 'OPTIONS') return empty(204);
    if (request.body.byteLength > this.maxBodyBytes) {
      throw payloadTooLarge(this.maxBodyBytes, request.body.byteLength);
    }
    const { route, params } = this.resolve(request);
    const principal = this.principalFor(request, route.meta.roles);
    return route.handler(this.contextFor(request, params, principal));
  }

  /** Finds the handler for this method and path, or answers 404/405. */
  private resolve(request: ApiRequest): { route: RouteDefinition; params: Record<string, string> } {
    const segments = pathSegments(request.path);
    const matching: CompiledRoute[] = [];
    for (const entry of this.compiled) {
      const params = matchPath(entry.compiled, segments);
      if (params === null) continue;
      if (entry.route.method === request.method) return { route: entry.route, params };
      matching.push(entry);
    }
    if (matching.length > 0) {
      const allowed = [...new Set(matching.map((entry) => entry.route.method))];
      throw methodNotAllowed(request.method, request.path, allowed);
    }
    throw routeNotFound(request.method, request.path);
  }

  /** Public routes run anonymously; every other route needs a valid credential. */
  private principalFor(request: ApiRequest, roles: readonly Role[] | 'public'): Principal {
    if (roles === 'public') return ANONYMOUS_PRINCIPAL;
    return authenticate(request, this.options.directory);
  }

  /** Builds the handler context; the JSON body is parsed on demand. */
  private contextFor(
    request: ApiRequest,
    params: Record<string, string>,
    principal: Principal
  ): ApiContext {
    return {
      services: this.options.services,
      pipeline: this.options.pipeline,
      directory: this.options.directory,
      principal,
      params,
      query: request.query,
      request,
      json: <T>() => parseJsonBody<T>(request)
    };
  }

  /** Maps any throwable to the API error body. */
  private failure(error: unknown): ApiResponse {
    const description = describeError(error);
    if (description.status >= 500) {
      console.error(`[api] ${description.status} ${description.code}: ${description.message}`);
      return text(500, 'unexpected server error');
    }
    return json(description.status, errorBody(description));
  }
}

/** Applies the shared headers to a response. */
function withBase(response: ApiResponse, base: Record<string, string>): ApiResponse {
  return { ...response, headers: mergeHeaders(SECURITY_HEADERS, base, response.headers) };
}
