/**
 * Framework routes — chapter 15, EF-REF-01/02/03/05, EF-FRA-02/03/04.
 *
 * `POST /v1/frameworks` imports a framework (Annex A payload); the list and the
 * two read routes expose controls, their current state, the readiness snapshot
 * and its history. A framework marked `RESTRICTED` is invisible below the
 * quality lead (spec 16.1, ENF-CONF-03).
 */

import type { Control, ControlStatus, Role } from '../../domain/types.ts';
import { json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import { assertLevelReadable, requireRole } from '../access.ts';
import { frameworkImportFrom, queryInt, queryValue } from '../validate.ts';
import { controlView, frameworkView, readinessView } from '../views.ts';
import { requireFramework } from './shared.ts';

/** Roles that may import a framework (EF-REF-01). */
const IMPORT_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN'];

/** Roles that may read a framework (spec chapter 6). */
const READ_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN', 'EXECUTIVE', 'INTERNAL_AUDITOR', 'CONTROL_OWNER'];

/** Number of trend points returned by default (EF-FRA-04). */
const DEFAULT_TREND_POINTS = 6;

/** `POST /v1/frameworks` — import a framework, return the version diff. */
async function importFramework(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, IMPORT_ROLES, 'framework', 'new');
  const input = frameworkImportFrom(context.json());
  const result = await context.pipeline.importFramework(context.services, input, context.principal);
  return json(201, {
    framework: frameworkView(result.framework),
    controls: result.controls.map((control) => ({
      id: control.id,
      domain: control.domain,
      title: control.title,
      periodicity: control.periodicity,
      owner: control.owner,
      mandatory: control.mandatory
    })),
    diff: result.diff
  });
}

/** True when the principal may see a framework of this confidentiality (ENF-CONF-03). */
function mayListFramework(principal: ApiContext['principal'], level: string): boolean {
  if (level !== 'RESTRICTED') return true;
  return principal.role === 'QUALITY_LEAD' || principal.role === 'ADMIN';
}

/** `GET /v1/frameworks` — list frameworks, optionally by confidentiality. */
async function listFrameworks(context: ApiContext): Promise<ApiResponse> {
  const wanted = queryValue(context.query, 'confidentiality')?.toUpperCase();
  const frameworks = await context.services.state.listFrameworks();
  const visible = frameworks
    .filter((framework) => mayListFramework(context.principal, framework.confidentiality))
    .filter((framework) => wanted === undefined || framework.confidentiality === wanted)
    .map(frameworkView);
  return json(200, { frameworks: visible, total: visible.length });
}

/** States of one framework, indexed by control id. */
async function statusIndex(context: ApiContext, frameworkId: string): Promise<Map<string, ControlStatus>> {
  const { statuses } = await context.pipeline.recomputeFramework(context.services, frameworkId);
  return new Map(statuses.map((status) => [status.controlId, status]));
}

/** `GET /v1/frameworks/{id}/controls` — controls with their current state. */
async function listControls(context: ApiContext): Promise<ApiResponse> {
  const frameworkId = context.params.id ?? '';
  const framework = await requireFramework(context.services, frameworkId);
  await assertLevelReadable(context.services, context.principal, framework.confidentiality, 'framework', frameworkId);
  const index = await statusIndex(context, frameworkId);
  const controls: Control[] = await context.services.state.listControls(frameworkId);
  return json(200, {
    frameworkId,
    total: controls.length,
    controls: controls.map((control) => controlView(control, index.get(control.id) ?? null))
  });
}

/** `GET /v1/frameworks/{id}/readiness` — snapshot, shares and trend. */
async function readiness(context: ApiContext): Promise<ApiResponse> {
  const frameworkId = context.params.id ?? '';
  const framework = await requireFramework(context.services, frameworkId);
  await assertLevelReadable(context.services, context.principal, framework.confidentiality, 'framework', frameworkId);
  const points = queryInt(context.query, 'trend', { fallback: DEFAULT_TREND_POINTS, min: 1, max: 100 });
  const recomputed = await context.pipeline.recomputeFramework(context.services, frameworkId);
  return json(200, readinessView(recomputed.readiness, recomputed.trend.slice(-points)));
}

/** The three framework routes, in table order. */
export const frameworkRoutes: readonly RouteDefinition[] = [
  {
    method: 'POST',
    path: '/v1/frameworks',
    handler: importFramework,
    meta: {
      operationId: 'importFramework',
      summary: 'Import a framework and report the version diff',
      tag: 'frameworks',
      requirement: 'EF-REF-01',
      roles: IMPORT_ROLES,
      requestSchema: 'FrameworkImport',
      responseSchema: 'FrameworkImportResult',
      successStatus: 201,
      errors: [400, 401, 403, 409, 422],
      notes: 'The diff lists controls added, changed or removed against the previous version (EF-REF-05).'
    }
  },
  {
    method: 'GET',
    path: '/v1/frameworks',
    handler: listFrameworks,
    meta: {
      operationId: 'listFrameworks',
      summary: 'List the imported frameworks',
      tag: 'frameworks',
      requirement: 'EF-REF-02',
      roles: READ_ROLES,
      query: [
        {
          name: 'confidentiality',
          description: 'Keep only frameworks of this confidentiality',
          schema: 'string',
          values: ['PUBLIC', 'INTERNAL', 'RESTRICTED']
        }
      ],
      responseSchema: 'FrameworkList',
      errors: [400, 401, 403]
    }
  },
  {
    method: 'GET',
    path: '/v1/frameworks/:id/controls',
    handler: listControls,
    meta: {
      operationId: 'listFrameworkControls',
      summary: 'List the controls of a framework with their current state',
      tag: 'frameworks',
      requirement: 'EF-REF-01, EF-FRA-02',
      roles: READ_ROLES,
      responseSchema: 'ControlList',
      errors: [401, 403, 404],
      notes: 'State is one of COVERED, TO_RENEW, TO_VERIFY, EXPIRED, NO_EVIDENCE (ENF-IA-01).'
    }
  },
  {
    method: 'GET',
    path: '/v1/frameworks/:id/readiness',
    handler: readiness,
    meta: {
      operationId: 'getFrameworkReadiness',
      summary: 'Readiness snapshot, shares and recorded trend',
      tag: 'frameworks',
      requirement: 'EF-FRA-03',
      roles: READ_ROLES,
      query: [
        {
          name: 'trend',
          description: 'Maximum number of trend points returned',
          schema: 'integer',
          default: DEFAULT_TREND_POINTS
        }
      ],
      responseSchema: 'Readiness',
      errors: [400, 401, 403, 404]
    }
  }
];
