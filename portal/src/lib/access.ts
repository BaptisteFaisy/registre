/**
 * Role matrix (spec chapter 6): what each role may see and do.
 *
 * The portal hides what a role may not use, and the API enforces the same
 * rules server-side — hiding is never the only protection.
 */

import type { AccessLevel, Principal, Role } from '../api/types.ts';

export type Capability =
  | 'readiness'
  | 'controls'
  | 'validation'
  | 'ask'
  | 'packs'
  | 'verify'
  | 'mappings'
  | 'quality'
  | 'reminders'
  | 'audit'
  | 'settings'
  | 'upload';

const MATRIX: Record<Role, readonly Capability[]> = {
  QUALITY_LEAD: [
    'readiness',
    'controls',
    'validation',
    'ask',
    'packs',
    'verify',
    'mappings',
    'quality',
    'reminders',
    'audit',
    'settings',
    'upload'
  ],
  CONTROL_OWNER: ['readiness', 'controls', 'reminders', 'upload'],
  EXECUTIVE: ['readiness', 'controls'],
  INTERNAL_AUDITOR: ['readiness', 'controls', 'ask', 'packs', 'verify', 'audit'],
  ADMIN: [
    'readiness',
    'controls',
    'validation',
    'ask',
    'packs',
    'mappings',
    'quality',
    'reminders',
    'audit',
    'settings'
  ]
};

/** True when the role may use the capability. */
export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role].includes(capability);
}

/** True when the principal may read evidence at this access level (ENF-CONF-01). */
export function mayRead(principal: Principal, level: AccessLevel): boolean {
  const order: AccessLevel[] = ['PUBLIC', 'INTERNAL', 'RESTRICTED'];
  return order.indexOf(level) <= order.indexOf(principal.clearance);
}

/** True when at least one attached evidence is hidden from the principal. */
export function hasHiddenEvidence(
  principal: Principal,
  levels: readonly AccessLevel[]
): boolean {
  return levels.some((level) => !mayRead(principal, level));
}

/** Explains, for a role, why some evidence is out of reach. */
export function restrictedNotice(principal: Principal): string {
  return `Evidence marked RESTRICTED is hidden for the ${principal.role
    .toLowerCase()
    .replace(/_/g, ' ')} role. Only a quality lead or an administrator can open it.`;
}
