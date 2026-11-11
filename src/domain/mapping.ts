/**
 * Cross-framework mapping entities — "one evidence serves every framework".
 *
 * An MSP passes several audits a year and hunts the same evidence each time. A
 * mapping says that a control of one framework is equivalent to a control of
 * another, so an attachment accepted once is **proposed** everywhere else.
 *
 * Non-negotiable rules (same discipline as attachments):
 *   - a mapping is NEVER auto-applied: a human validates it (EF-REF-04);
 *   - a mapping carries a quoted justification taken from the two controls'
 *     requirement texts, and the code verifies the quote exists;
 *   - a proposed mapping never changes a control's state by itself.
 */

import type { ControlId, FrameworkId } from './types.ts';

export type MappingStatus = 'PROPOSED' | 'VALIDATED' | 'REJECTED';

/** Which direction the equivalence was proposed in. */
export type MappingDirection = 'SOURCE_TO_TARGET' | 'TARGET_TO_SOURCE';

/** One proposed or validated equivalence between two controls. */
export interface ControlMapping {
  id: string;
  sourceFrameworkId: FrameworkId;
  sourceControlId: ControlId;
  targetFrameworkId: FrameworkId;
  targetControlId: ControlId;
  direction: MappingDirection;
  /** Model confidence, 0..1. */
  confidence: number;
  /** Passage quoted from the source control's requirement. */
  sourceQuote: string;
  /** Passage quoted from the target control's requirement. */
  targetQuote: string;
  reason: string;
  status: MappingStatus;
  /** Both quotes were found in their control text by code. */
  citationVerified: boolean;
  proposedBy: string;
  proposedAt: string;
  validatedBy?: string;
  validatedAt?: string;
  note?: string;
}

/** How much one deposited evidence is worth across frameworks. */
export interface ReuseMetric {
  frameworkId: FrameworkId;
  computedAt: string;
  /** Distinct evidence supporting at least one control of this framework. */
  evidenceCount: number;
  /** Attachments to this framework's controls. */
  attachmentCount: number;
  /** Attachments that exist only because a validated mapping carried them over. */
  carriedAttachments: number;
  /** Deposits avoided thanks to those carried attachments. */
  avoidedDeposits: number;
  /** `attachmentCount / evidenceCount`, rounded to 2 decimals. */
  reuseFactor: number;
  /** Validated mappings leaving or entering this framework. */
  validatedMappings: number;
  pendingMappings: number;
}

/** Deterministic id for one (source, target) pair. */
export function mappingId(
  sourceFrameworkId: FrameworkId,
  sourceControlId: ControlId,
  targetFrameworkId: FrameworkId,
  targetControlId: ControlId
): string {
  return `mp-${[sourceFrameworkId, sourceControlId, targetFrameworkId, targetControlId].join('|')}`;
}
