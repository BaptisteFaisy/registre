/**
 * Audit trail route — chapter 15, EF-ADM-02, ENF-INT-02.
 *
 * `GET /v1/audit-log` pages through the append-only, hash-chained log, newest
 * first. `?limit=&offset=` page; `?action=&objectId=` filter; `?verify=chain`
 * runs `verifyChain()` and reports the first broken sequence, which is the
 * signal that the log was tampered with.
 */

import type { AuditAction, Role } from '../../domain/types.ts';
import { json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import { requireRole } from '../access.ts';
import { queryEnum, queryInt, queryValue } from '../validate.ts';
import { auditEventView } from '../views.ts';

/** Roles allowed to read the audit log (docs/API.md §16). */
const READ_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN', 'INTERNAL_AUDITOR'];

/** Every action the log can carry (domain `AuditAction`). */
export const AUDIT_ACTIONS: readonly AuditAction[] = [
  'FRAMEWORK_IMPORTED',
  'EVIDENCE_COLLECTED',
  'EVIDENCE_READ',
  'EVIDENCE_DUPLICATE',
  'ATTACHMENT_PROPOSED',
  'ATTACHMENT_APPLIED',
  'ATTACHMENT_REJECTED',
  'VALIDATION_DECIDED',
  'STATE_RECOMPUTED',
  'REMINDER_SENT',
  'QUESTION_ASKED',
  'PACK_ASSEMBLED',
  'PACK_VERIFIED',
  'SHARE_CREATED',
  'SHARE_REVOKED',
  'SHARE_USED',
  'MAPPING_PROPOSED',
  'MAPPING_DECIDED',
  'DRIFT_DETECTED',
  'DRIFT_ACKNOWLEDGED',
  'DRAFT_GENERATED',
  'QUALITY_RECORDED',
  'PACK_DOWNLOADED',
  'SETTINGS_UPDATED',
  'ACCESS_DENIED'
];

/** Default and maximum page size of the audit log. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

/** `GET /v1/audit-log` — one page of the log, newest first. */
async function listAuditLog(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, READ_ROLES, 'audit', 'log');
  const limit = queryInt(context.query, 'limit', { fallback: DEFAULT_LIMIT, min: 1, max: MAX_LIMIT });
  const offset = queryInt(context.query, 'offset', { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER });
  const action = queryEnum(context.query, 'action', AUDIT_ACTIONS);
  const objectId = queryValue(context.query, 'objectId');
  const verify = queryValue(context.query, 'verify');

  const events = await context.services.audit.list({
    ...(action === undefined ? {} : { action }),
    ...(objectId === undefined ? {} : { objectId })
  });
  const page = events.slice(offset, offset + limit);
  const headers: Record<string, string> = {
    'x-audit-total': String(events.length),
    'x-audit-limit': String(limit),
    'x-audit-offset': String(offset)
  };
  if (verify === 'chain') {
    const chain = await context.services.audit.verifyChain();
    headers['x-audit-chain'] = chain.ok ? 'ok' : `broken:${chain.brokenAt ?? 'unknown'}`;
  }
  // Bare list: the portal client is typed `Promise<AuditEvent[]>`. Pagination
  // and the chain verdict travel in the headers.
  return { status: 200, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(page.map(auditEventView)) };
}

/** The audit-log route. */
export const auditRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/v1/audit-log',
    handler: listAuditLog,
    meta: {
      operationId: 'listAuditLog',
      summary: 'Page through the hash-chained action log',
      tag: 'audit',
      requirement: 'EF-ADM-02',
      roles: READ_ROLES,
      query: [
        { name: 'limit', description: 'Page size', schema: 'integer', default: DEFAULT_LIMIT },
        { name: 'offset', description: 'Number of events to skip', schema: 'integer', default: 0 },
        {
          name: 'action',
          description: 'Keep only this action',
          schema: 'string',
          values: AUDIT_ACTIONS
        },
        { name: 'objectId', description: 'Keep only events about this object', schema: 'string' },
        {
          name: 'verify',
          description: 'Set to "chain" to verify the hash chain in the same call',
          schema: 'string',
          values: ['chain']
        }
      ],
      responseSchema: 'AuditEventArray',
      errors: [400, 401, 403],
      notes: 'nextOffset is null on the last page; chain reports the first broken sequence when verified.'
    }
  }
];
