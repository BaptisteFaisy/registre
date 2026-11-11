/**
 * Access control — ENF-CONF-01, ENF-CONF-02, EF-QR-03 (spec 6, 16.2).
 *
 * "Accès par rôle. Les preuves contenant des données sociales ou des données
 *  de clients ont un accès restreint." "Une preuve réservée n'est pas citée à
 *  qui n'y a pas accès."
 *
 * A refusal is a value, never a silent exception: callers can log it as an
 * `ACCESS_DENIED` audit event (ENF-INT-02 / EF-ADM-02).
 */

import type {
  AccessLevel,
  AuditAction,
  ControlId,
  Evidence,
  EvidenceId,
  Passage,
  Principal,
  Role,
  ValidationItem
} from './types.ts';
import { ACCESS_ORDER } from './types.ts';

/** Highest access level each role may read — ENF-CONF-01. */
export const ROLE_MAX_LEVEL: Readonly<Record<Role, AccessLevel>> = {
  QUALITY_LEAD: 'RESTRICTED',
  ADMIN: 'RESTRICTED',
  INTERNAL_AUDITOR: 'INTERNAL',
  EXECUTIVE: 'INTERNAL',
  CONTROL_OWNER: 'INTERNAL'
};

/** Why an access was refused. */
export type AccessDenialReason =
  | 'ROLE_NOT_ALLOWED'
  | 'INSUFFICIENT_CLEARANCE'
  | 'NOT_CONTROL_OWNER'
  | 'ALREADY_DECIDED';

/** Outcome of an access check; `reason` is null when allowed. */
export interface AccessDecision {
  allowed: boolean;
  reason: AccessDenialReason | null;
}

const ALLOW: AccessDecision = { allowed: true, reason: null };

const deny = (reason: AccessDenialReason): AccessDecision => ({ allowed: false, reason });

/** Every level at or below `level`, in `ACCESS_ORDER` — ENF-CONF-01. */
export function levelsUpTo(level: AccessLevel): AccessLevel[] {
  const index = ACCESS_ORDER.indexOf(level);
  return ACCESS_ORDER.slice(0, index + 1);
}

/** True when `level` is readable by a principal cleared at `max` — ENF-CONF-01. */
export function isLevelAllowed(level: AccessLevel, max: AccessLevel): boolean {
  return ACCESS_ORDER.indexOf(level) <= ACCESS_ORDER.indexOf(max);
}

/** Effective maximum level of a principal: role ceiling AND personal clearance — ENF-CONF-01. */
export function maxLevel(principal: Principal): AccessLevel {
  const roleMax = ROLE_MAX_LEVEL[principal.role];
  return isLevelAllowed(principal.clearance, roleMax) ? principal.clearance : roleMax;
}

/** Access levels a principal may read — ENF-CONF-01. */
export function allowedLevels(principal: Principal): AccessLevel[] {
  return levelsUpTo(maxLevel(principal));
}

/**
 * True when a control owner owns the control; other roles see everything —
 * ENF-CONF-01 (a CONTROL_OWNER only reads the evidence of its own controls).
 */
export function canReadControl(principal: Principal, controlId: ControlId): AccessDecision {
  if (principal.role !== 'CONTROL_OWNER') return ALLOW;
  return principal.ownedControls.includes(controlId) ? ALLOW : deny('NOT_CONTROL_OWNER');
}

/**
 * Reads one evidence: level check plus, for a control owner, ownership of at
 * least one supported control — ENF-CONF-01. Without ownership information a
 * control owner is refused (doubt never grants access).
 */
export function canReadEvidence(
  principal: Principal,
  evidence: Pick<Evidence, 'id' | 'accessLevel'>,
  supportedControlIds: readonly ControlId[] = []
): AccessDecision {
  const roleMax = ROLE_MAX_LEVEL[principal.role];
  if (!isLevelAllowed(evidence.accessLevel, roleMax)) return deny('ROLE_NOT_ALLOWED');
  if (!isLevelAllowed(evidence.accessLevel, principal.clearance)) return deny('INSUFFICIENT_CLEARANCE');
  if (principal.role !== 'CONTROL_OWNER') return ALLOW;
  return supportedControlIds.some((id) => principal.ownedControls.includes(id))
    ? ALLOW
    : deny('NOT_CONTROL_OWNER');
}

/** Keeps only the passages a principal may read — EF-QR-03. */
export function filterPassages(principal: Principal, passages: readonly Passage[]): Passage[] {
  const level = maxLevel(principal);
  return passages.filter((passage) => isLevelAllowed(passage.accessLevel, level));
}

/** Keeps only the evidence ids a principal may cite — EF-QR-03. */
export function filterEvidenceIds(principal: Principal, evidences: readonly Evidence[]): EvidenceId[] {
  const level = maxLevel(principal);
  return evidences.filter((evidence) => isLevelAllowed(evidence.accessLevel, level)).map((e) => e.id);
}

/** Roles allowed to decide a validation item (quality lead and admin) — EF-VAL-01. */
export const DECIDING_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN'] as const;

/**
 * Decides a validation item: only the quality lead and the admin, and only on
 * a pending item — EF-VAL-01 / ENF-CONF-01.
 */
export function canDecide(principal: Principal, item: Pick<ValidationItem, 'status'>): AccessDecision {
  if (!DECIDING_ROLES.includes(principal.role)) return deny('ROLE_NOT_ALLOWED');
  if (item.status !== 'PENDING') return deny('ALREADY_DECIDED');
  return ALLOW;
}

/** Audit event payload recording a refusal (action `ACCESS_DENIED`) — EF-ADM-02. */
export interface AccessDenialEvent {
  actor: string;
  action: AuditAction;
  objectType: string;
  objectId: string;
  detail: Record<string, unknown>;
}

/** Builds the `ACCESS_DENIED` audit payload of a refused access — EF-ADM-02. */
export function denialEvent(
  principal: Principal,
  decision: AccessDecision,
  objectType: string,
  objectId: string
): AccessDenialEvent {
  return {
    actor: principal.id,
    action: 'ACCESS_DENIED',
    objectType,
    objectId,
    detail: { reason: decision.reason, role: principal.role, clearance: principal.clearance }
  };
}

/** Filters passages and returns the refused evidence ids for the audit log — EF-QR-03. */
export function filterPassagesWithDenials(
  principal: Principal,
  passages: readonly Passage[]
): { allowed: Passage[]; denied: EvidenceId[] } {
  const allowed = filterPassages(principal, passages);
  const kept = new Set(allowed.map((passage) => passage.evidenceId));
  const denied = [...new Set(passages.filter((p) => !kept.has(p.evidenceId)).map((p) => p.evidenceId))];
  return { allowed, denied };
}
