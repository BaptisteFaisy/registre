/**
 * Framework routes — chapter 15, EF-REF-01/02/03/05, EF-FRA-02/03/04.
 *
 * `POST /v1/frameworks` imports a framework (Annex A payload); the list and the
 * two read routes expose controls, their current state, the readiness snapshot
 * and its history. A framework marked `RESTRICTED` is invisible below the
 * quality lead (spec 16.1, ENF-CONF-03).
 */

import type { Control, Role } from '../../domain/types.ts';
import { json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import { assertLevelReadable, requireRole } from '../access.ts';
import { frameworkImportFrom, queryInt, queryValue } from '../validate.ts';
import {
  byDomainView,
  controlOnlyView,
  costReportView,
  frameworkView,
  readinessOverviewView
} from '../views.ts';
import { requireFramework } from './shared.ts';
import { controlDocument, feedKnowledgeBase, frameworksTarget } from '../../ai/bedrock/knowledgeSync.ts';

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
  await feedControls(context, result.framework.id);
  // Bare framework: the portal client is typed `Promise<Framework>`. The version
  // diff is journalled and served by `GET /v1/frameworks/{id}/diff` (EF-REF-05).
  return json(201, frameworkView(result.framework));
}

/**
 * On AWS, the imported controls feed the frameworks knowledge base, which
 * proposes the controls an evidence may support (EF-RAT-01). The register is
 * the source of truth: a feed failure is logged, the import stands.
 */
async function feedControls(context: ApiContext, frameworkId: string): Promise<void> {
  const target = frameworksTarget(process.env);
  if (target === null) return;
  try {
    const controls = await context.services.state.listControls(frameworkId);
    const fed = await feedKnowledgeBase(target, controls.map((control) => controlDocument(control, target.prefix)));
    console.info(`[api] frameworks knowledge base: ${fed.written} control(s) written, sync ${fed.sync.join(', ') || 'not requested'}`);
  } catch (error) {
    console.error(`[api] frameworks knowledge base feed failed: ${(error as Error).message}`);
  }
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
  return json(200, visible);
}

/** `GET /v1/frameworks/{id}/controls` — controls with their current state. */
async function listControls(context: ApiContext): Promise<ApiResponse> {
  const frameworkId = context.params.id ?? '';
  const framework = await requireFramework(context.services, frameworkId);
  await assertLevelReadable(context.services, context.principal, framework.confidentiality, 'framework', frameworkId);
  const controls: Control[] = await context.services.state.listControls(frameworkId);
  // Bare controls: the dashboard reads the states from the readiness overview,
  // so this route stays a cheap projection of the imported framework.
  return json(200, controls.map(controlOnlyView));
}

/** `GET /v1/frameworks/{id}/readiness` — snapshot, shares and trend. */
async function readiness(context: ApiContext): Promise<ApiResponse> {
  const frameworkId = context.params.id ?? '';
  const framework = await requireFramework(context.services, frameworkId);
  await assertLevelReadable(context.services, context.principal, framework.confidentiality, 'framework', frameworkId);
  const points = queryInt(context.query, 'trend', { fallback: DEFAULT_TREND_POINTS, min: 1, max: 100 });
  const recomputed = await context.pipeline.recomputeFramework(context.services, frameworkId);
  const controls = await context.services.state.listControls(frameworkId);
  const trend = (await context.services.state.listTrend(frameworkId, points)).slice(-points);
  const evidence = await context.services.state.listEvidence();
  const costs = costReportView(context.services.costs.report(), evidence.length);
  return json(
    200,
    readinessOverviewView({
      framework,
      snapshot: recomputed.readiness,
      trend,
      statuses: recomputed.statuses,
      byDomain: byDomainView(controls, recomputed.statuses),
      costs
    })
  );
}

/** `GET /v1/frameworks/{id}/diff` — controls added, changed or removed (EF-REF-05). */
async function frameworkDiff(context: ApiContext): Promise<ApiResponse> {
  const frameworkId = context.params.id ?? '';
  const framework = await requireFramework(context.services, frameworkId);
  await assertLevelReadable(context.services, context.principal, framework.confidentiality, 'framework', frameworkId);
  const events = await context.services.audit.list({
    action: 'FRAMEWORK_IMPORTED',
    objectId: frameworkId,
    limit: 1
  });
  const detail = (events[0]?.detail ?? {}) as Record<string, unknown>;
  const diff = idList(detail.addedIds) === null ? null : {
    added: idList(detail.addedIds) ?? [],
    changed: idList(detail.changedIds) ?? [],
    removed: idList(detail.removedIds) ?? []
  };
  return json(200, {
    frameworkId,
    version: typeof detail.version === 'string' ? detail.version : framework.version,
    importedAt: events[0]?.at ?? framework.importedAt,
    firstImport: diff === null,
    diff
  });
}

/** Reads an id list journalled in an audit detail, `null` when absent. */
function idList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : null;
}

/** The framework routes, in table order. */
export const frameworkRoutes: readonly RouteDefinition[] = [
  {
    method: 'POST',
    path: '/v1/frameworks',
    handler: importFramework,
    meta: {
      operationId: 'importFramework',
      summary: 'Import a framework (Annex A payload)',
      tag: 'frameworks',
      requirement: 'EF-REF-01',
      roles: IMPORT_ROLES,
      requestSchema: 'FrameworkImport',
      responseSchema: 'Framework',
      successStatus: 201,
      errors: [400, 401, 403, 409, 422],
      notes: 'The version diff is journalled and served by GET /v1/frameworks/{id}/diff (EF-REF-05).'
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
      responseSchema: 'FrameworkArray',
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
      responseSchema: 'ControlArray',
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
      summary: 'Dashboard in one call: snapshot, trend, per-control states, domains and costs',
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
      responseSchema: 'ReadinessOverview',
      errors: [400, 401, 403, 404]
    }
  },
  {
    method: 'GET',
    path: '/v1/frameworks/:id/diff',
    handler: frameworkDiff,
    meta: {
      operationId: 'getFrameworkDiff',
      summary: 'Controls added, changed or removed by the last version import',
      tag: 'frameworks',
      requirement: 'EF-REF-05',
      roles: READ_ROLES,
      responseSchema: 'FrameworkDiff',
      errors: [401, 403, 404]
    }
  }
];
