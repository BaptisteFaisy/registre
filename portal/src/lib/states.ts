/**
 * Single source of truth for control states: order, wording and colour.
 *
 * ENF-IA-01: a control is never described with the word "compliant" (or its
 * French counterpart). The portal only says whether evidence exists, is fresh
 * and carries what was expected. See `docs/spec-fr.md` chapter 12.
 */

import type {
  AccessLevel,
  AttachmentStatus,
  ControlState,
  EvidenceFreshness,
  Role,
  SufficiencyClass,
  ValidationKind
} from '../api/types.ts';

export interface StateMeta {
  /** Short label shown in badges. */
  label: string;
  /** One-line explanation shown in tooltips and detail panels. */
  description: string;
  /** Hex colour used by badges, bars and charts. */
  color: string;
}

/** Display order of the five states (best first, blockers last). */
export const STATE_ORDER: readonly ControlState[] = [
  'COVERED',
  'TO_RENEW',
  'TO_VERIFY',
  'EXPIRED',
  'NO_EVIDENCE'
] as const;

export const STATE_META: Record<ControlState, StateMeta> = {
  COVERED: {
    label: 'Covered',
    description: 'Applied evidence is fresh and carries every expected element.',
    color: '#3fb950'
  },
  TO_RENEW: {
    label: 'To renew',
    description: 'The best evidence expires within the renewal lead time.',
    color: '#d29922'
  },
  TO_VERIFY: {
    label: 'To verify',
    description: 'Only proposed attachments, or a partial sufficiency, are available.',
    color: '#db6d28'
  },
  EXPIRED: {
    label: 'Expired',
    description: 'Every applied evidence is older than the control periodicity.',
    color: '#f85149'
  },
  NO_EVIDENCE: {
    label: 'No evidence',
    description: 'No evidence is applied to this control yet.',
    color: '#da3633'
  }
};

/** Wording and colour of a state, with a safe fallback for unknown values. */
export function stateMeta(state: ControlState): StateMeta {
  return STATE_META[state] ?? STATE_META.NO_EVIDENCE;
}

export function stateLabel(state: ControlState): string {
  return stateMeta(state).label;
}

export function stateColor(state: ControlState): string {
  return stateMeta(state).color;
}

/** Sorts states by the canonical display order. */
export function sortStates(states: readonly ControlState[]): ControlState[] {
  return [...states].sort((a, b) => STATE_ORDER.indexOf(a) - STATE_ORDER.indexOf(b));
}

/** Counts per state, always containing every state (zero when absent). */
export function emptyCounts(): Record<ControlState, number> {
  return {
    COVERED: 0,
    TO_RENEW: 0,
    TO_VERIFY: 0,
    EXPIRED: 0,
    NO_EVIDENCE: 0
  };
}

/* ------------------------------------------------------------ sufficiency */

export const SUFFICIENCY_META: Record<SufficiencyClass, StateMeta> = {
  COMPLETE: {
    label: 'Complete',
    description: 'Every expected element is present in the attached evidence.',
    color: '#3fb950'
  },
  PARTIAL: {
    label: 'Partial',
    description: 'One or more expected elements are missing.',
    color: '#d29922'
  },
  TO_VERIFY: {
    label: 'To verify',
    description: 'The reading confidence is too low to trust the assessment.',
    color: '#db6d28'
  }
};

export function sufficiencyLabel(value: SufficiencyClass): string {
  return SUFFICIENCY_META[value].label;
}

export function sufficiencyColor(value: SufficiencyClass): string {
  return SUFFICIENCY_META[value].color;
}

/* -------------------------------------------------------------- freshness */

export const FRESHNESS_LABEL: Record<EvidenceFreshness, string> = {
  FRESH: 'Fresh',
  TO_RENEW: 'Renew soon',
  EXPIRED: 'Expired',
  UNDETERMINED: 'Undetermined'
};

/* ------------------------------------------------------ attachment status */

export const ATTACHMENT_STATUS_LABEL: Record<AttachmentStatus, string> = {
  PROPOSED: 'Proposed',
  APPLIED: 'Applied',
  REJECTED: 'Rejected'
};

export const ATTACHMENT_STATUS_COLOR: Record<AttachmentStatus, string> = {
  PROPOSED: '#db6d28',
  APPLIED: '#3fb950',
  REJECTED: '#8b949e'
};

/* ------------------------------------------------------------ access level */

export const ACCESS_LABEL: Record<AccessLevel, string> = {
  PUBLIC: 'Public',
  INTERNAL: 'Internal',
  RESTRICTED: 'Restricted'
};

export const ACCESS_COLOR: Record<AccessLevel, string> = {
  PUBLIC: '#8b949e',
  INTERNAL: '#58a6ff',
  RESTRICTED: '#a371f7'
};

/* ------------------------------------------------------------------- role */

export const ROLE_LABEL: Record<Role, string> = {
  QUALITY_LEAD: 'Quality lead',
  CONTROL_OWNER: 'Control owner',
  EXECUTIVE: 'Executive',
  INTERNAL_AUDITOR: 'Internal auditor',
  ADMIN: 'Administrator'
};

/** One-line description of what a role may do (chapter 6). */
export const ROLE_HINT: Record<Role, string> = {
  QUALITY_LEAD: 'Imports frameworks, validates attachments, assembles the audit pack.',
  CONTROL_OWNER: 'Provides and renews the evidence of the controls they own.',
  EXECUTIVE: 'Reads the readiness dashboard only.',
  INTERNAL_AUDITOR: 'Reads the register and asks questions during an audit.',
  ADMIN: 'Connects the sources and manages access and settings.'
};

/* -------------------------------------------------------- validation kind */

export const VALIDATION_KIND_LABEL: Record<ValidationKind, string> = {
  ATTACHMENT: 'Uncertain attachment',
  SUFFICIENCY: 'Partial sufficiency',
  UNREADABLE_EVIDENCE: 'Unreadable evidence'
};
