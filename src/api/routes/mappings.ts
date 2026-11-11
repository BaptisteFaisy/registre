/**
 * Cross-framework mapping routes (axis 2) — EF-REF-04.
 *
 * Proposing is mechanical and safe: the pipeline verifies both quotes by code
 * and stores nothing as validated. Deciding is a human act, restricted to the
 * quality lead and the administrator, and keeps author, instant and reason.
 */

import type { Role } from '../../domain/types.ts';
import { json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import { requireRole } from '../access.ts';
import { notFound } from '../../support/errors.ts';
import { optionalString, queryEnum, queryValue, requiredString } from '../validate.ts';
import { decideMapping, proposeMappings, reuseMetric } from '../../pipeline/crossmap.ts';
import { mappingView, reuseView } from '../viewsExt.ts';
import { bodyObject, requireFramework } from './shared.ts';

/** Roles that may propose or decide a mapping. */
const MANAGE_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN'];

/** Roles that may read mappings and the reuse metric. */
const READ_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN', 'EXECUTIVE', 'INTERNAL_AUDITOR', 'CONTROL_OWNER'];

/** Decisions accepted on a mapping. */
const DECISIONS = ['VALIDATE', 'REJECT'] as const;

/** Mapping statuses accepted as a filter. */
const STATUSES = ['PROPOSED', 'VALIDATED', 'REJECTED'] as const;

/** `GET /v1/mappings` — bare list, filtered by status or framework. */
async function list(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, READ_ROLES, 'mapping', 'list');
  const status = queryEnum(context.query, 'status', STATUSES);
  const source = queryValue(context.query, 'sourceFrameworkId');
  const target = queryValue(context.query, 'targetFrameworkId');
  const mappings = await context.services.extensions.listMappings({
    ...(status === undefined ? {} : { status }),
    ...(source === undefined ? {} : { sourceFrameworkId: source }),
    ...(target === undefined ? {} : { targetFrameworkId: target })
  });
  return json(200, mappings.map(mappingView));
}

/** `POST /v1/mappings/propose` — propose equivalences between two frameworks. */
async function propose(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, MANAGE_ROLES, 'mapping', 'propose');
  const body = bodyObject(context);
  const sourceFrameworkId = requiredString(body, 'sourceFrameworkId');
  const targetFrameworkId = requiredString(body, 'targetFrameworkId');
  await requireFramework(context.services, sourceFrameworkId);
  await requireFramework(context.services, targetFrameworkId);
  const created = await proposeMappings(context.services, {
    sourceFrameworkId,
    targetFrameworkId,
    actor: context.principal.id
  });
  return json(201, created.map(mappingView));
}

/** `POST /v1/mappings/{id}/decision` — validate or reject one equivalence. */
async function decide(context: ApiContext): Promise<ApiResponse> {
  const id = context.params.id ?? '';
  await requireRole(context.services, context.principal, MANAGE_ROLES, 'mapping', id);
  const body = bodyObject(context);
  const decision = queryEnumOf(body, 'decision', DECISIONS);
  const decided = await decideMapping(context.services, id, {
    decision,
    by: context.principal.id,
    ...(optionalString(body, 'note') === undefined ? {} : { note: optionalString(body, 'note') })
  });
  return json(200, mappingView(decided));
}

/** `GET /v1/frameworks/{id}/reuse` — what one evidence is worth here. */
async function reuse(context: ApiContext): Promise<ApiResponse> {
  const frameworkId = context.params.id ?? '';
  await requireRole(context.services, context.principal, READ_ROLES, 'framework', frameworkId);
  await requireFramework(context.services, frameworkId);
  return json(200, reuseView(await reuseMetric(context.services, frameworkId)));
}

/** Reads an enum from a JSON body, with the same error shape as the query helper. */
function queryEnumOf<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[]
): T {
  const raw = requiredString(body, field);
  const found = allowed.find((value) => value === raw.toUpperCase());
  if (found === undefined) {
    throw notFound(`"${field}" must be one of ${allowed.join(', ')}, got "${raw}"`);
  }
  return found;
}

/** The mapping and reuse routes. */
export const mappingRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/v1/mappings',
    handler: list,
    meta: {
      operationId: 'listMappings',
      summary: 'List cross-framework equivalences',
      tag: 'mappings',
      requirement: 'EF-REF-04',
      roles: READ_ROLES,
      query: [
        { name: 'status', description: 'Keep one status', schema: 'string', values: [...STATUSES] },
        { name: 'sourceFrameworkId', description: 'Keep mappings leaving this framework', schema: 'string' },
        { name: 'targetFrameworkId', description: 'Keep mappings entering this framework', schema: 'string' }
      ],
      responseSchema: 'ControlMappingArray',
      errors: [401, 403]
    }
  },
  {
    method: 'POST',
    path: '/v1/mappings/propose',
    handler: propose,
    meta: {
      operationId: 'proposeMappings',
      summary: 'Propose equivalences between two frameworks',
      tag: 'mappings',
      requirement: 'EF-REF-04',
      roles: MANAGE_ROLES,
      requestSchema: 'MappingPropose',
      responseSchema: 'ControlMappingArray',
      successStatus: 201,
      errors: [400, 401, 403, 404],
      notes: 'Both quotes are verified in the requirement texts by code; nothing is validated automatically.'
    }
  },
  {
    method: 'POST',
    path: '/v1/mappings/:id/decision',
    handler: decide,
    meta: {
      operationId: 'decideMapping',
      summary: 'Validate or reject one equivalence',
      tag: 'mappings',
      requirement: 'EF-REF-04',
      roles: MANAGE_ROLES,
      requestSchema: 'MappingDecision',
      responseSchema: 'ControlMapping',
      errors: [400, 401, 403, 404]
    }
  },
  {
    method: 'GET',
    path: '/v1/frameworks/:id/reuse',
    handler: reuse,
    meta: {
      operationId: 'getFrameworkReuse',
      summary: 'Reuse metric: how much one deposited evidence is worth',
      tag: 'mappings',
      requirement: 'EF-REF-04',
      roles: READ_ROLES,
      responseSchema: 'ReuseMetric',
      errors: [401, 403, 404]
    }
  }
];
