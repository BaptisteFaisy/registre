/**
 * Router contracts: what a route declares (method, path, roles, documentation)
 * and what a handler receives.
 *
 * A route is data plus one function. The same table feeds the dispatcher
 * (router.ts) and the OpenAPI document (openapi.ts), so a documented route is
 * necessarily a served route.
 */

import type { Principal, Role } from '../domain/types.ts';
import type { Services } from '../ports/index.ts';
import type { ApiRequest, ApiResponse, HttpMethod } from './http.ts';
import type { CredentialDirectory } from './auth.ts';
import type { PipelineApi } from './pipeline.ts';

/** Who acts, as handed to the pipeline (the resolved principal). */
export type Actor = Principal;

/** Builds the pipeline actor from the authenticated principal. */
export function actorOf(principal: Principal): Actor {
  return principal;
}

/** Documentation of one query parameter, reused by the OpenAPI document. */
export interface QueryParameterDoc {
  name: string;
  description: string;
  schema: 'string' | 'integer';
  required?: boolean;
  /** Closed list of accepted values. */
  values?: readonly string[];
  default?: string | number;
}

/** Everything a route declares about itself. */
export interface RouteMeta {
  /** Unique name, used as the OpenAPI `operationId`. */
  operationId: string;
  summary: string;
  /** OpenAPI tag, one per domain file. */
  tag: string;
  /** Specification requirement implemented, e.g. `EF-REF-01`. */
  requirement?: string;
  /** `'public'` skips authentication (health, OpenAPI document). */
  roles: readonly Role[] | 'public';
  query?: readonly QueryParameterDoc[];
  /** Component name of the request body schema, if any. */
  requestSchema?: string;
  /** Component name of the success payload schema. */
  responseSchema?: string;
  /** Status of the nominal response (200 by default). */
  successStatus?: number;
  /** Error statuses the handler can return, for the OpenAPI document. */
  errors?: readonly number[];
  /** Free-form note shown in the OpenAPI description. */
  notes?: string;
}

/** What a handler sees once authentication and role checks have passed. */
export interface ApiContext {
  services: Services;
  pipeline: PipelineApi;
  /** Demonstration credentials; the session routes verify against it. */
  directory: CredentialDirectory;
  principal: Principal;
  params: Readonly<Record<string, string>>;
  query: Readonly<Record<string, string>>;
  request: ApiRequest;
  /** Parsed JSON body; throws `BAD_REQUEST` when absent or malformed. */
  json<T = unknown>(): T;
}

export type RouteHandler = (context: ApiContext) => Promise<ApiResponse>;

/** One served route: a path pattern, a method, its documentation, a handler. */
export interface RouteDefinition {
  method: HttpMethod;
  /** Path pattern with `:param` segments, e.g. `/v1/controls/:id/evidence`. */
  path: string;
  meta: RouteMeta;
  handler: RouteHandler;
}

/** True when the principal's role is in the list (public routes always pass). */
export function isRoleAllowed(principal: Principal, roles: readonly Role[] | 'public'): boolean {
  return roles === 'public' || roles.includes(principal.role);
}
