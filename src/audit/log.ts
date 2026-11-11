/**
 * Typed audit-trail helpers — EF-ADM-02 ("journal de toutes les actions :
 * collecte, lecture, rattachement, validation, export") and ENF-INT-02 (the log
 * is append-only and hash-chained).
 *
 * The chain itself lives in the `AuditSink` adapter (`src/store/memory.ts`,
 * `src/store/dynamoAudit.ts`). This module only shapes the call, so no pipeline
 * step writes an event by hand and every event carries the same fields.
 */

import type { AccessDecision } from '../domain/access.ts';
import { denialEvent } from '../domain/access.ts';
import type { AuditAction, AuditEvent, Principal } from '../domain/types.ts';
import type { Services } from '../ports/index.ts';

/** Appends one typed event to the audit log — EF-ADM-02. */
export async function record(
  services: Services,
  actor: string,
  action: AuditAction,
  objectType: string,
  objectId: string,
  detail: Record<string, unknown> = {}
): Promise<AuditEvent> {
  return services.audit.append({ actor, action, objectType, objectId, detail });
}

/**
 * Journalled refusal: the event payload is built by `denialEvent` so the reason
 * codes stay the domain's, not a free-form string — EF-ADM-02, ENF-CONF-01.
 */
export async function auditAccessDenied(
  services: Services,
  principal: Principal,
  decision: AccessDecision,
  objectType: string,
  objectId: string
): Promise<AuditEvent> {
  const event = denialEvent(principal, decision, objectType, objectId);
  return record(services, event.actor, event.action, event.objectType, event.objectId, event.detail);
}
