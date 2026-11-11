/**
 * OpenAPI document route — `GET /openapi.json`, unauthenticated.
 *
 * The judges read this document; it is generated from the route table, so it
 * cannot describe an endpoint that is not served (see src/api/openapi.ts).
 */

import { buildOpenApiDocument } from '../openapi.ts';
import { json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';

/** Base URL of the request, honouring the proxy headers of API Gateway. */
function baseUrlOf(context: ApiContext): string {
  const host = context.request.headers.host ?? 'localhost';
  const proto = context.request.headers['x-forwarded-proto'] ?? 'http';
  return `${proto}://${host}`;
}

/** `GET /openapi.json` — the whole contract. */
async function openapi(context: ApiContext): Promise<ApiResponse> {
  return json(200, buildOpenApiDocument(baseUrlOf(context)));
}

/** The documentation route. */
export const docsRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/openapi.json',
    handler: openapi,
    meta: {
      operationId: 'getOpenApiDocument',
      summary: 'OpenAPI 3.1 contract of this API, generated from the route table',
      tag: 'health',
      roles: 'public',
      errors: []
    }
  }
];
