/**
 * Health route — unauthenticated, used by the load balancer, the CDK health
 * check and the demo script ("the API answers").
 *
 * It reports the build identity and a cheap liveness verdict. It never reports
 * the content of the store: a health check is not a data leak.
 */

import { json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';

/** Version advertised in the health payload and the OpenAPI document. */
export const API_VERSION = '1.0.0';

/** `GET /healthz` — liveness. */
async function health(context: ApiContext): Promise<ApiResponse> {
  return json(200, {
    status: 'ok',
    version: API_VERSION,
    at: context.services.clock.now(),
    region: context.services.settings.region
  });
}

/** The health route. */
export const healthRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/healthz',
    handler: health,
    meta: {
      operationId: 'health',
      summary: 'Liveness probe',
      tag: 'health',
      roles: 'public',
      responseSchema: 'Health',
      errors: []
    }
  }
];
