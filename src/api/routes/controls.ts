/**
 * Control routes — chapter 15, EF-FRA-02, EF-REL-01/02, ENF-CONF-01.
 *
 * `GET /v1/controls/{id}` returns the control and its current state;
 * `GET /v1/controls/{id}/evidence` lists its attachments with their
 * sufficiency (evidence above the caller's clearance is omitted, never
 * redacted — docs/API.md §8); `POST /v1/controls/{id}/remind` sends a reminder
 * now, listing what the owner must provide.
 */

import type { Evidence, Role } from '../../domain/types.ts';
import { conflict } from '../../support/errors.ts';
import { json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import { assertControlVisible, requireRole } from '../access.ts';
import { isLevelAllowed, maxLevel } from '../../domain/access.ts';
import { queryEnum } from '../validate.ts';
import {
  attachmentDomainView,
  controlOnlyView,
  controlWithRelationsView,
  evidenceView,
  reminderView,
  sufficiencyView
} from '../views.ts';
import { bodyObject, requireControl, requireControlOwnership, statusOf } from './shared.ts';

/** Roles that may read a control (spec chapter 6). */
const READ_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN', 'EXECUTIVE', 'INTERNAL_AUDITOR', 'CONTROL_OWNER'];

/** Roles that may send a reminder (EF-REL-01/02). */
const REMIND_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN', 'CONTROL_OWNER'];

/** Attachment statuses accepted by the evidence listing. */
const ATTACHMENT_STATUSES = ['PROPOSED', 'APPLIED', 'REJECTED'] as const;

/** `GET /v1/controls/{id}` — the control and its current state. */
async function readControl(context: ApiContext): Promise<ApiResponse> {
  const control = await requireControl(context.services, context.params.id ?? '');
  await assertControlVisible(context.services, context.principal, control.id);
  const status = await statusOf(context, control);
  const attachments = await context.services.state.listAttachments({ controlId: control.id });
  const sufficiencies = await context.services.state.listSufficiency({ controlId: control.id });
  const evidence: Evidence[] = [];
  for (const attachment of attachments) {
    const found = await context.services.state.getEvidence(attachment.evidenceId);
    if (found === null) continue;
    if (!isLevelAllowed(found.accessLevel, maxLevel(context.principal))) continue;
    evidence.push(found);
  }
  const levelOf = (evidenceId: string): Evidence['accessLevel'] =>
    evidence.find((item) => item.id === evidenceId)?.accessLevel ?? 'INTERNAL';
  return json(
    200,
    controlWithRelationsView({ control, status, attachments, sufficiencies, evidence, principal: context.principal, levelOf })
  );
}

/** `GET /v1/controls/{id}/evidence` — attachments, quotes and sufficiency. */
async function listControlEvidence(context: ApiContext): Promise<ApiResponse> {
  const control = await requireControl(context.services, context.params.id ?? '');
  await assertControlVisible(context.services, context.principal, control.id);
  const status = queryEnum(context.query, 'status', ATTACHMENT_STATUSES);
  const attachments = await context.services.state.listAttachments({
    controlId: control.id,
    ...(status === undefined ? {} : { status })
  });
  const rows: Evidence[] = [];
  for (const attachment of attachments) {
    const evidence = await context.services.state.getEvidence(attachment.evidenceId);
    // Evidence above the caller clearance is omitted, never redacted
    // (docs/API.md §8, ENF-CONF-01).
    if (evidence === null) continue;
    if (!isLevelAllowed(evidence.accessLevel, maxLevel(context.principal))) continue;
    rows.push(evidence);
  }
  // Bare evidences: the quotes and the sufficiency come with the control
  // detail (`GET /v1/controls/{id}`).
  return json(200, rows.map((evidence) => evidenceView(evidence, context.principal)));
}

/** `POST /v1/controls/{id}/remind` — send a reminder now (EF-REL-01/02). */
async function remindControl(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, REMIND_ROLES, 'control', context.params.id ?? '');
  const control = await requireControl(context.services, context.params.id ?? '');
  await requireControlOwnership(context.services, context.principal, control.id);
  const body = bodyObject(context, true);
  const reason = typeof body.reason === 'string' ? body.reason.toUpperCase() : undefined;
  const reminders = await context.pipeline.runReminders(context.services, control.frameworkId);
  const forControl = reminders.filter(
    (reminder) => reminder.controlId === control.id && (reason === undefined || reminder.reason === reason)
  );
  if (forControl.length === 0) {
    throw conflict('no reminder is due for this control', { controlId: control.id });
  }
  // Bare reminder: the portal client is typed `Promise<Reminder>`.
  return json(201, reminderView(forControl[0]!));
}

/** The three control routes, in table order. */
export const controlRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/v1/controls/:id',
    handler: readControl,
    meta: {
      operationId: 'getControl',
      summary: 'Read one control and its current state',
      tag: 'controls',
      requirement: 'EF-FRA-02',
      roles: READ_ROLES,
      responseSchema: 'ControlWithRelations',
      errors: [401, 403, 404]
    }
  },
  {
    method: 'GET',
    path: '/v1/controls/:id/evidence',
    handler: listControlEvidence,
    meta: {
      operationId: 'listControlEvidence',
      summary: 'List the evidence attached to a control',
      tag: 'controls',
      requirement: 'EF-RAT-02',
      roles: READ_ROLES,
      query: [
        {
          name: 'status',
          description: 'Keep only attachments in this status',
          schema: 'string',
          values: ATTACHMENT_STATUSES
        }
      ],
      responseSchema: 'EvidenceArray',
      errors: [400, 401, 403, 404],
      notes: 'Evidence above the caller clearance is omitted, never redacted.'
    }
  },
  {
    method: 'POST',
    path: '/v1/controls/:id/remind',
    handler: remindControl,
    meta: {
      operationId: 'remindControl',
      summary: 'Send a reminder for one control now',
      tag: 'controls',
      requirement: 'EF-REL-01',
      roles: REMIND_ROLES,
      requestSchema: 'RemindRequest',
      responseSchema: 'Reminder',
      successStatus: 201,
      errors: [400, 401, 403, 404, 409],
      notes: 'The message lists what to provide, taken from the sufficiency gaps when relevant.'
    }
  }
];
