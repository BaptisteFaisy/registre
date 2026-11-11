/**
 * Reminder routes — chapter 15, EF-REL-01/02/03, EF-ADM-02.
 *
 * `GET /v1/reminders` reads the reminder log kept by the pipeline. Filters:
 * `status` (SENT, ACKNOWLEDGED, CLOSED) and `controlId`. A control owner only
 * sees the reminders of its own controls (spec chapter 6).
 */

import type { Reminder, Role } from '../../domain/types.ts';
import { json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import { requireRole } from '../access.ts';
import { queryEnum, queryInt, queryValue } from '../validate.ts';
import { reminderView } from '../views.ts';

/** Roles allowed to read the reminder log (docs/API.md §14). */
const READ_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN', 'CONTROL_OWNER', 'INTERNAL_AUDITOR'];

/** Reminder statuses accepted by the query string. */
const REMINDER_STATUSES = ['SENT', 'ACKNOWLEDGED', 'CLOSED'] as const;

/** Default and maximum page size of the reminder list. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/** Keeps only the reminders a control owner may see (spec chapter 6). */
function visibleReminders(context: ApiContext, reminders: readonly Reminder[]): Reminder[] {
  if (context.principal.role !== 'CONTROL_OWNER') return [...reminders];
  const owned = new Set(context.principal.ownedControls);
  return reminders.filter((reminder) => owned.has(reminder.controlId));
}

/** `GET /v1/reminders` — the reminder log, newest first. */
async function listReminders(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, READ_ROLES, 'reminder', 'log');
  const status = queryEnum(context.query, 'status', REMINDER_STATUSES);
  const controlId = queryValue(context.query, 'controlId');
  const limit = queryInt(context.query, 'limit', { fallback: DEFAULT_LIMIT, min: 1, max: MAX_LIMIT });
  const reminders = await context.services.state.listReminders({
    ...(status === undefined ? {} : { status }),
    ...(controlId === undefined ? {} : { controlId })
  });
  const visible = visibleReminders(context, reminders)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
  // Bare list: the portal client is typed `Promise<Reminder[]>`.
  return json(200, visible.map(reminderView));
}

/** The reminder route. */
export const reminderRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/v1/reminders',
    handler: listReminders,
    meta: {
      operationId: 'listReminders',
      summary: 'List the reminders sent to control owners',
      tag: 'reminders',
      requirement: 'EF-REL-01',
      roles: READ_ROLES,
      query: [
        {
          name: 'status',
          description: 'Keep only reminders in this status',
          schema: 'string',
          values: REMINDER_STATUSES
        },
        { name: 'controlId', description: 'Keep only reminders about this control', schema: 'string' },
        { name: 'limit', description: 'Maximum number of reminders returned', schema: 'integer', default: DEFAULT_LIMIT }
      ],
      responseSchema: 'ReminderArray',
      errors: [400, 401, 403],
      notes: 'reason is EXPIRING_SOON, NO_EVIDENCE or MISSING_ELEMENTS; missing lists what to provide.'
    }
  }
];
