/**
 * Route-level access checks — spec chapter 6, ENF-CONF-01, EF-QR-03.
 *
 * `src/domain/access.ts` holds the rules (who may read which level, who may
 * decide). This file applies them to a live request: it refuses with 403 (409
 * for an already decided item) and writes the `ACCESS_DENIED` audit event
 * (EF-ADM-02) before throwing, so a refusal is never silent.
 */

import { canDecide, canReadControl, canReadEvidence, denialEvent, isLevelAllowed, maxLevel } from '../domain/access.ts';
import type { AccessDecision } from '../domain/access.ts';
import type { AccessLevel, ControlId, Evidence, Principal, Role, ValidationItem } from '../domain/types.ts';
import type { AuditSink } from '../ports/index.ts';
import { conflict } from '../support/errors.ts';
import { accessDenied } from './errors.ts';
import { isRoleAllowed } from './types.ts';

/** Services slice needed by the access helpers. */
export interface AccessDeps {
  audit: AuditSink;
}

/** Writes an `ACCESS_DENIED` event; a failing log never masks the refusal. */
export async function recordDenial(
  deps: AccessDeps,
  principal: Principal,
  decision: AccessDecision,
  objectType: string,
  objectId: string
): Promise<void> {
  try {
    await deps.audit.append(denialEvent(principal, decision, objectType, objectId));
  } catch (error) {
    console.error('[api] unable to record ACCESS_DENIED', error);
  }
}

/** Refuses (403) when the role is not in the list, after logging the refusal. */
export async function requireRole(
  deps: AccessDeps,
  principal: Principal,
  roles: readonly Role[] | 'public',
  objectType: string,
  objectId: string
): Promise<void> {
  if (isRoleAllowed(principal, roles)) return;
  const decision: AccessDecision = { allowed: false, reason: 'ROLE_NOT_ALLOWED' };
  await recordDenial(deps, principal, decision, objectType, objectId);
  throw accessDenied(`role ${principal.role} is not allowed on this resource`, {
    role: principal.role,
    objectType,
    objectId
  });
}

/** Refuses (403) when the principal may not read `level` — ENF-CONF-01. */
export async function assertLevelReadable(
  deps: AccessDeps,
  principal: Principal,
  level: AccessLevel,
  objectType: string,
  objectId: string
): Promise<void> {
  if (isLevelAllowed(level, maxLevel(principal))) return;
  const decision: AccessDecision = { allowed: false, reason: 'INSUFFICIENT_CLEARANCE' };
  await recordDenial(deps, principal, decision, objectType, objectId);
  throw accessDenied(`access level ${level} is above the clearance of this principal`, {
    accessLevel: level,
    role: principal.role,
    objectType,
    objectId
  });
}

/** Refuses (403) when a control owner does not own the control — chapter 6. */
export async function assertControlVisible(
  deps: AccessDeps,
  principal: Principal,
  controlId: ControlId
): Promise<void> {
  const decision = canReadControl(principal, controlId);
  if (decision.allowed) return;
  await recordDenial(deps, principal, decision, 'control', controlId);
  throw accessDenied(`control ${controlId} is not owned by this principal`, {
    role: principal.role,
    controlId
  });
}

/** Refuses (403) when the evidence is above the clearance or outside the owner's scope. */
export async function assertEvidenceReadable(
  deps: AccessDeps,
  principal: Principal,
  evidence: Pick<Evidence, 'id' | 'accessLevel'>,
  supportedControlIds: readonly ControlId[] = []
): Promise<void> {
  const decision = canReadEvidence(principal, evidence, supportedControlIds);
  if (decision.allowed) return;
  await recordDenial(deps, principal, decision, 'evidence', evidence.id);
  throw accessDenied(`evidence ${evidence.id} is not readable by this principal`, {
    accessLevel: evidence.accessLevel,
    role: principal.role,
    reason: decision.reason
  });
}

/** Refuses when the principal may not decide this item — EF-VAL-01/02. */
export async function assertCanDecide(
  deps: AccessDeps,
  principal: Principal,
  item: Pick<ValidationItem, 'id' | 'status'>
): Promise<void> {
  const decision = canDecide(principal, item);
  if (decision.allowed) return;
  await recordDenial(deps, principal, decision, 'validation', item.id);
  if (decision.reason === 'ALREADY_DECIDED') {
    throw conflict(`validation ${item.id} has already been decided`, { validationId: item.id });
  }
  throw accessDenied(`role ${principal.role} may not decide a validation`, {
    role: principal.role,
    validationId: item.id
  });
}
