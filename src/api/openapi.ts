/**
 * OpenAPI 3.1 document, generated from the route table itself.
 *
 * A route cannot be served without being documented, and cannot be documented
 * without being served: both come from `ROUTES` (src/api/routes/index.ts).
 * The document is what the judges read, so every operation carries its
 * requirement reference, its roles, its parameters and its error codes.
 */

import { API_VERSION } from './routes/health.ts';
import { ROUTES } from './routes/index.ts';
import type { RouteDefinition } from './types.ts';
import { COMPONENT_SCHEMAS, ERROR_RESPONSES } from './schemas.ts';

/** OpenAPI path template: `/v1/controls/:id` becomes `/v1/controls/{id}`. */
export function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** Path-level parameters of a pattern, in declaration order. */
export function pathParameters(path: string): Array<Record<string, unknown>> {
  const names = [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1] ?? '');
  return names.map((name) => ({
    name,
    in: 'path',
    required: true,
    description: `Identifier of the ${name}`,
    schema: { type: 'string' }
  }));
}

/** Query parameters declared by a route. */
function queryParameters(route: RouteDefinition): Array<Record<string, unknown>> {
  return (route.meta.query ?? []).map((parameter) => ({
    name: parameter.name,
    in: 'query',
    required: parameter.required === true,
    description: parameter.description,
    schema: {
      type: parameter.schema,
      ...(parameter.values === undefined ? {} : { enum: [...parameter.values] }),
      ...(parameter.default === undefined ? {} : { default: parameter.default })
    }
  }));
}

/** Request body of an operation, when the route declares a schema. */
function requestBody(route: RouteDefinition): Record<string, unknown> | undefined {
  const schema = route.meta.requestSchema;
  if (schema === undefined) return undefined;
  return {
    required: true,
    description: `Payload of ${route.meta.summary}.`,
    content: {
      'application/json': { schema: { $ref: `#/components/schemas/${schema}` } },
      ...(schema === 'EvidenceDeposit'
        ? {
            'application/octet-stream': {
              schema: { type: 'string', format: 'binary' },
              description: 'The raw document, with the file own Content-Type and ?filename= for its name.'
            }
          }
        : {})
    }
  };
}

/** Success response of an operation. */
function successResponse(route: RouteDefinition): Record<string, unknown> {
  const status = String(route.meta.successStatus ?? 200);
  const schema = route.meta.responseSchema;
  const description = route.meta.summary;
  if (schema === undefined) {
    return { [status]: { description } };
  }
  return {
    [status]: {
      description,
      content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } }
    }
  };
}

/** Error responses of an operation, from its declared statuses. */
function errorResponses(route: RouteDefinition): Record<string, unknown> {
  const responses: Record<string, unknown> = {};
  for (const status of route.meta.errors ?? []) {
    const template = ERROR_RESPONSES[status];
    if (template === undefined) continue;
    responses[String(status)] = template;
  }
  return responses;
}

/** One operation object of the document. */
function operationOf(route: RouteDefinition): Record<string, unknown> {
  const parameters = [...pathParameters(route.path), ...queryParameters(route)];
  return {
    operationId: route.meta.operationId,
    summary: route.meta.summary,
    description: [
      route.meta.requirement === undefined ? '' : `Requirement: ${route.meta.requirement}.`,
      route.meta.notes ?? ''
    ]
      .filter((part) => part.length > 0)
      .join(' '),
    tags: [route.meta.tag],
    security: route.meta.roles === 'public' ? [] : [{ bearerAuth: [] }, { sessionCookie: [] }],
    'x-roles': route.meta.roles === 'public' ? 'public' : [...route.meta.roles],
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(requestBody(route) === undefined ? {} : { requestBody: requestBody(route) }),
    responses: { ...successResponse(route), ...errorResponses(route) }
  };
}

/** Groups the route table by OpenAPI path, keeping declaration order. */
function pathItems(): Record<string, Record<string, unknown>> {
  const items: Record<string, Record<string, unknown>> = {};
  for (const route of ROUTES) {
    const path = openApiPath(route.path);
    const current = items[path] ?? {};
    current[route.method.toLowerCase()] = operationOf(route);
    items[path] = current;
  }
  return items;
}

/** Builds the whole OpenAPI 3.1 document. */
export function buildOpenApiDocument(baseUrl = '/'): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Registre API',
      version: API_VERSION,
      summary: 'Continuous audit-evidence registry for AWS MSP partners, on Amazon Bedrock.',
      description: [
        'Registre never says a control is covered by a judgement: it reports whether evidence exists,',
        'is fresh and contains what the control expects. Control states are COVERED, TO_RENEW,',
        'TO_VERIFY, EXPIRED and NO_EVIDENCE, computed by code (ENF-IA-04, ENF-IA-01).',
        '',
        'Demonstration credentials (EF-ADM-03): the bearer token is the base64url of "login:password",',
        'and the same token is accepted in the registre_session cookie. Roles: quality lead, control',
        'owner, internal auditor, administrator.'
      ].join('\n')
    },
    servers: [{ url: baseUrl, description: 'Current deployment' }],
    tags: [
      { name: 'frameworks', description: 'Imported frameworks, controls and readiness' },
      { name: 'evidence', description: 'Manual deposit and evidence detail' },
      { name: 'controls', description: 'One control, its evidence and its reminders' },
      { name: 'validations', description: 'Validation queue and decisions' },
      { name: 'ask', description: 'Questions answered from the evidence, with citations' },
      { name: 'packs', description: 'Audit pack assembly and download' },
      { name: 'reminders', description: 'Reminder log' },
      { name: 'audit', description: 'Hash-chained action log' },
      { name: 'settings', description: 'Tunables of the tool' },
      { name: 'health', description: 'Liveness' }
    ],
    paths: pathItems(),
    components: {
      schemas: COMPONENT_SCHEMAS,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Token = base64url("login:password") of a demonstration identity (EF-ADM-03).'
        },
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'registre_session',
          description: 'Same token, sent by the portal as a session cookie.'
        }
      }
    }
  };
}

/** Every documented operation, as `METHOD /path` with `{param}` placeholders. */
export function documentedOperations(): Array<{ method: string; path: string }> {
  return ROUTES.map((route) => ({ method: route.method, path: openApiPath(route.path) }));
}

/** True when the document exposes this method and path. */
export function documentExposes(document: Record<string, unknown>, method: string, path: string): boolean {
  const paths = document.paths as Record<string, Record<string, unknown>> | undefined;
  const item = paths?.[path];
  if (item === undefined) return false;
  return item[method.toLowerCase()] !== undefined;
}
