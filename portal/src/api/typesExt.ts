/**
 * Extension entities — verification, sharing, mappings, drift, drafts and
 * measured quality (docs/CONTRACTS-EXT.md).
 *
 * Exact mirrors of `src/domain/{verification,mapping,quality,draft}.ts` on the
 * API side: the portal never imports from the repository root, so the shapes
 * are repeated here and the API contract keeps them in sync.
 */

import type { ControlId, EvidenceId, FrameworkId, PackId, ReminderId } from './types.ts';

/* ------------------------------------------------- axis 1: verify and share */

/** How the pack manifest was signed. `NONE` means signing is not configured. */
export type SignatureAlgorithm = 'KMS-ECDSA-P256' | 'ED25519-LOCAL' | 'NONE';

/** Result of a verification, safe to publish: no evidence content, ever. */
export interface VerificationResult {
  packId: PackId;
  frameworkId: FrameworkId;
  verifiedAt: string;
  frozenAt: string;
  rootHash: string;
  controlCount: number;
  evidenceCount: number;
  knownGapCount: number;
  /** Every evidence fingerprint in the archive matches the manifest. */
  checksumsOk: boolean;
  /** The audit hash chain covering the pack's events is intact. */
  chainOk: boolean;
  /** `null` when the deployment has no signing key configured. */
  signatureOk: boolean | null;
  signerKeyId: string | null;
  algorithm: SignatureAlgorithm;
}

/** What a share grant gives access to. */
export type ShareScope = 'PACK' | 'FRAMEWORK';

/** A time-boxed, revocable, watermarked read access for an external auditor. */
export interface ShareGrant {
  token: string;
  packId: PackId | null;
  frameworkId: FrameworkId;
  scope: ShareScope;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  watermark: string;
  useCount: number;
  lastUsedAt: string | null;
}

/** What the portal sends to open a share for an auditor. */
export interface ShareInput {
  /** Lifetime of the grant, in hours (1 to 168 — the API refuses more). */
  ttlHours: number;
  /** Short label naming the recipient, stamped into the watermark. */
  watermarkLabel: string;
}

/* ------------------------------------------------------- axis 2: cross-maps */

export type MappingStatus = 'PROPOSED' | 'VALIDATED' | 'REJECTED';

/** Which direction the equivalence was proposed in. */
export type MappingDirection = 'SOURCE_TO_TARGET' | 'TARGET_TO_SOURCE';

/** The human decision recorded on a proposed mapping. */
export type MappingDecision = 'VALIDATE' | 'REJECT';

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

/** Filter accepted by the mappings list. */
export interface MappingFilter {
  status?: MappingStatus;
  sourceFrameworkId?: FrameworkId;
  targetFrameworkId?: FrameworkId;
}

/** How much one deposited evidence is worth across frameworks. */
export interface ReuseMetric {
  frameworkId: FrameworkId;
  computedAt: string;
  evidenceCount: number;
  attachmentCount: number;
  carriedAttachments: number;
  avoidedDeposits: number;
  /** `attachmentCount / evidenceCount`, rounded to 2 decimals. */
  reuseFactor: number;
  validatedMappings: number;
  pendingMappings: number;
}

/* ----------------------------------------------------------- axis 3: drift */

export type DriftKind = 'STATE_CHANGED' | 'MISSING_RUN' | 'THRESHOLD_CROSSED' | 'RECOVERED';

/** One observed change in a machine attestation. */
export interface DriftEvent {
  id: string;
  controlId: ControlId;
  frameworkId: FrameworkId;
  evidenceId: EvidenceId | null;
  detectedAt: string;
  kind: DriftKind;
  /** Previous observed value, `null` on a first observation. */
  previous: string | null;
  current: string | null;
  /** Human-readable one-liner, safe to put in a reminder. */
  detail: string;
  reminderId: ReminderId | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

/* ----------------------------------------------------------- axis 3: draft */

/** A draft is always a draft: there is no other status on purpose. */
export type DraftStatus = 'DRAFT';

/** Watermark printed at the top of every generated draft. */
export const DRAFT_WATERMARK = 'DRAFT — not evidence until signed and deposited';

export interface DraftSection {
  /** The expected element this section is meant to satisfy. */
  expected: string;
  /** Text carried over from the previous version, or an empty placeholder. */
  body: string;
  /** True when the owner still has to write this part. */
  toComplete: boolean;
}

/** One generated draft — never persisted as evidence, never attachable. */
export interface Draft {
  id: string;
  controlId: ControlId;
  frameworkId: FrameworkId;
  createdAt: string;
  format: 'MARKDOWN';
  title: string;
  watermark: string;
  status: DraftStatus;
  sections: DraftSection[];
  basedOn: EvidenceId[];
  missing: string[];
  content: string;
  /** Never true: a draft cannot be attached. Kept explicit for reviewers. */
  attachable: false;
}

/* ------------------------------------------------------- bonus: self-grading */

export type QualitySubjectKind = 'READING' | 'ATTACHMENT' | 'SUFFICIENCY' | 'QA';

/** The thing being graded: a task, a model, and a prompt version. */
export interface QualitySubject {
  kind: QualitySubjectKind;
  modelId: string;
  promptVersion: string;
}

export type QualityMetric =
  | 'FIELD_ACCURACY'
  | 'ACCEPTED_WITHOUT_CORRECTION'
  | 'WRONG_HIGH_CONFIDENCE'
  | 'GAPS_DETECTED'
  | 'CITATION_ACCURACY'
  | 'INVENTED_ANSWERS';

export type QualityVerdict = 'PASS' | 'FAIL' | 'UNKNOWN';

/** One row of the quality screen: the latest measurement of one metric. */
export interface QualitySubjectRow {
  subject: QualitySubject;
  metric: QualityMetric;
  value: number;
  target: number;
  verdict: QualityVerdict;
  /** Values of the same metric for this subject, oldest first. */
  trend: number[];
  measuredAt: string;
}

/** One point of the trend chart. */
export interface QualityTrendPoint {
  measuredAt: string;
  subjectKey: string;
  metric: QualityMetric;
  value: number;
  verdict: QualityVerdict;
}

/** What the quality screen renders in one call. */
export interface QualityReport {
  subjects: QualitySubjectRow[];
  /** Confidence threshold actually applied (above 1: everything goes to a human). */
  thresholdInEffect: number;
  trend: QualityTrendPoint[];
}
