/**
 * Drift, draft and measured-quality routes (axis 3 and the quality bonus).
 *
 * Three concerns that share one property: they show the system watching itself.
 * Drift says a machine attestation changed or did not arrive; the draft helps an
 * owner close a human gap without ever becoming evidence; quality says how well
 * each model and prompt version measures up, and what threshold that implies.
 */

import type { Role } from '../../domain/types.ts';
import { json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import { requireRole } from '../access.ts';
import { notFound } from '../../support/errors.ts';
import { queryValue } from '../validate.ts';
import { acknowledgeDrift, driftSummary, missingRuns } from '../../pipeline/drift.ts';
import { generateDraft } from '../../pipeline/draft.ts';
import { qualityReport, qualityTrend } from '../../pipeline/quality.ts';
import { draftView, driftView, qualityRows } from '../viewsExt.ts';
import { requireControl } from './shared.ts';

/** Roles that may read drifts and quality. */
const READ_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN', 'EXECUTIVE', 'INTERNAL_AUDITOR', 'CONTROL_OWNER'];

/** Roles that may acknowledge a drift or ask for a draft. */
const ACT_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN', 'CONTROL_OWNER'];

/** Roles that may read the measured quality of the models. */
const QUALITY_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN'];

/** `GET /v1/drifts` — bare list, newest first, with the per-kind counts. */
async function listDrifts(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, READ_ROLES, 'drift', 'list');
  const frameworkId = queryValue(context.query, 'frameworkId');
  const refresh = queryValue(context.query, 'refresh');
  if (frameworkId !== undefined && refresh === 'missing') {
    await missingRuns(context.services, frameworkId);
  }
  const events = await context.services.extensions.listDrifts(
    frameworkId === undefined ? {} : { frameworkId }
  );
  return json(200, events.map(driftView));
}

/** `GET /v1/drifts/summary` — counts by kind, for the dashboard panel. */
async function driftSummaryRoute(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, READ_ROLES, 'drift', 'summary');
  const frameworkId = queryValue(context.query, 'frameworkId');
  if (frameworkId === undefined) throw notFound('frameworkId is required');
  const summary = await driftSummary(context.services, frameworkId);
  return json(200, {
    frameworkId: summary.frameworkId,
    computedAt: summary.computedAt,
    counts: summary.counts,
    unacknowledged: summary.unacknowledged,
    recent: summary.recent.map(driftView)
  });
}

/** `POST /v1/drifts/{id}/acknowledge` — a human has seen it. */
async function acknowledge(context: ApiContext): Promise<ApiResponse> {
  const id = context.params.id ?? '';
  await requireRole(context.services, context.principal, ACT_ROLES, 'drift', id);
  const updated = await acknowledgeDrift(context.services, id, context.principal.id);
  if (updated === null) throw notFound(`drift ${id} does not exist`);
  return json(200, driftView(updated));
}

/** `POST /v1/controls/{id}/draft` — pre-fill the missing document. */
async function draft(context: ApiContext): Promise<ApiResponse> {
  const controlId = context.params.id ?? '';
  await requireRole(context.services, context.principal, ACT_ROLES, 'control', controlId);
  await requireControl(context.services, controlId);
  const generated = await generateDraft(context.services, controlId, context.principal.id);
  return json(201, draftView(generated));
}

/** `GET /v1/quality` — measured quality per subject and metric, plus the trend. */
async function quality(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, QUALITY_ROLES, 'quality', 'report');
  const report = await qualityReport(context.services);
  const records = await context.services.extensions.listQuality({ limit: 500 });
  const rows = report.subjects.flatMap((subject) => qualityRows(subject, records));
  return json(200, {
    generatedAt: report.generatedAt,
    thresholdInEffect: report.thresholdInEffect,
    subjects: rows,
    trend: await qualityTrend(context.services, {})
  });
}

/** The drift, draft and quality routes. */
export const extensionRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/v1/drifts',
    handler: listDrifts,
    meta: {
      operationId: 'listDrifts',
      summary: 'List the drifts detected on machine attestations',
      tag: 'drift',
      requirement: 'EF-FRA-02',
      roles: READ_ROLES,
      query: [
        { name: 'frameworkId', description: 'Keep one framework', schema: 'string' },
        {
          name: 'refresh',
          description: 'Set to "missing" to detect overdue attestations first',
          schema: 'string',
          values: ['missing']
        }
      ],
      responseSchema: 'DriftEventArray',
      errors: [401, 403]
    }
  },
  {
    method: 'GET',
    path: '/v1/drifts/summary',
    handler: driftSummaryRoute,
    meta: {
      operationId: 'driftSummary',
      summary: 'Drift counts by kind, for the dashboard panel',
      tag: 'drift',
      roles: READ_ROLES,
      query: [{ name: 'frameworkId', description: 'Framework to summarise', schema: 'string', required: true }],
      responseSchema: 'DriftSummary',
      errors: [400, 401, 403, 404]
    }
  },
  {
    method: 'POST',
    path: '/v1/drifts/:id/acknowledge',
    handler: acknowledge,
    meta: {
      operationId: 'acknowledgeDrift',
      summary: 'Record that a human has seen one drift',
      tag: 'drift',
      roles: ACT_ROLES,
      responseSchema: 'DriftEvent',
      errors: [401, 403, 404]
    }
  },
  {
    method: 'POST',
    path: '/v1/controls/:id/draft',
    handler: draft,
    meta: {
      operationId: 'generateDraft',
      summary: 'Pre-fill the missing document from the expected elements',
      tag: 'drafts',
      requirement: 'EF-SUF-01',
      roles: ACT_ROLES,
      responseSchema: 'Draft',
      successStatus: 201,
      errors: [401, 403, 404],
      notes: 'A draft is never evidence: no fingerprint, no vault write, never attached.'
    }
  },
  {
    method: 'GET',
    path: '/v1/quality',
    handler: quality,
    meta: {
      operationId: 'getQuality',
      summary: 'Measured quality per model and prompt version, with the threshold in effect',
      tag: 'quality',
      requirement: 'ENF-IA-04',
      roles: QUALITY_ROLES,
      responseSchema: 'QualityReport',
      errors: [401, 403]
    }
  }
];
