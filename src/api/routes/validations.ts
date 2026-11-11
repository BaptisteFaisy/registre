/**
 * Validation routes — chapter 15, EF-VAL-01/02, ENF-CONF-01.
 *
 * `GET /v1/validations?status=pending` is the queue of uncertain attachments,
 * partial sufficiencies and unreadable evidence. `POST /v1/validations/{id}/
 * decision` records a decision with its author, its date and its note
 * (EF-VAL-02) and returns the recomputed states of the affected framework.
 */

import type { Role, ValidationDecision } from '../../domain/types.ts';
import { badRequest } from '../../support/errors.ts';
import { json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import { assertCanDecide, requireRole } from '../access.ts';
import { optionalString, queryEnum, requiredEnum } from '../validate.ts';
import { controlView, validationView } from '../views.ts';
import { bodyObject, requireValidation } from './shared.ts';

/** Roles allowed in the validation queue (EF-VAL-01). */
const QUEUE_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN', 'CONTROL_OWNER'];

/** Roles allowed to decide (EF-VAL-01). */
const DECIDE_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN'];

/** Queue statuses accepted by the query string. */
const QUEUE_STATUSES = ['PENDING', 'DECIDED'] as const;

/** The three decisions of EF-VAL-02. */
const DECISIONS: readonly ValidationDecision[] = ['ACCEPT', 'REJECT', 'CORRECT'];

/** Keeps only the items about controls the principal owns (control owner). */
function visibleItems<T extends { controlId?: string }>(context: ApiContext, items: readonly T[]): T[] {
  if (context.principal.role !== 'CONTROL_OWNER') return [...items];
  const owned = new Set(context.principal.ownedControls);
  return items.filter((item) => item.controlId !== undefined && owned.has(item.controlId));
}

/** `GET /v1/validations` — the validation queue. */
async function listValidations(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, QUEUE_ROLES, 'validation', 'queue');
  const status = queryEnum(context.query, 'status', QUEUE_STATUSES) ?? 'PENDING';
  const queue = await context.pipeline.listValidationQueue(context.services);
  const filtered = visibleItems(
    context,
    queue.filter((item) => item.status === status)
  );
  return json(200, { status, total: filtered.length, items: filtered.map(validationView) });
}

/** `POST /v1/validations/{id}/decision` — record a decision (EF-VAL-02). */
async function decideValidation(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, DECIDE_ROLES, 'validation', context.params.id ?? '');
  const item = await requireValidation(context.services, context.params.id ?? '');
  await assertCanDecide(context.services, context.principal, item);
  const body = bodyObject(context);
  const decision = requiredEnum(body, 'decision', DECISIONS);
  const note = optionalString(body, 'note');
  if (decision === 'CORRECT' && optionalString(body, 'controlId') === undefined) {
    throw badRequest('"controlId" is required when the decision is CORRECT', { field: 'controlId' });
  }
  const outcome = await context.pipeline.decideValidation(context.services, item.id, {
    decision,
    by: context.principal.id,
    ...(note === undefined ? {} : { note })
  });
  const controls = [];
  for (const status of outcome.statuses) {
    const control = await context.services.state.getControl(status.controlId);
    if (control !== null) controls.push(controlView(control, status));
  }
  return json(200, { item: validationView(outcome.item), controls });
}

/** The two validation routes, in table order. */
export const validationRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/v1/validations',
    handler: listValidations,
    meta: {
      operationId: 'listValidations',
      summary: 'Read the validation queue',
      tag: 'validations',
      requirement: 'EF-VAL-01',
      roles: QUEUE_ROLES,
      query: [
        {
          name: 'status',
          description: 'Queue status to read (pending by default)',
          schema: 'string',
          values: QUEUE_STATUSES,
          default: 'PENDING'
        }
      ],
      responseSchema: 'ValidationQueue',
      errors: [400, 401, 403]
    }
  },
  {
    method: 'POST',
    path: '/v1/validations/:id/decision',
    handler: decideValidation,
    meta: {
      operationId: 'decideValidation',
      summary: 'Decide one validation item',
      tag: 'validations',
      requirement: 'EF-VAL-02',
      roles: DECIDE_ROLES,
      requestSchema: 'DecisionRequest',
      responseSchema: 'DecisionResult',
      errors: [400, 401, 403, 404, 409],
      notes: 'Author, date and note are kept on the item; CORRECT requires a target controlId.'
    }
  }
];
