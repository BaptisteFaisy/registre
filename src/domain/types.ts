/**
 * Registre — domain model (single source of truth).
 *
 * Rules enforced by this file and its siblings:
 *  - states, dates and counts are ALWAYS computed by code, never by a model;
 *  - no state is ever named "compliant"/"conforme" (see `vocabulary.ts`);
 *  - every claim carried to a user must trace back to a verifiable quote.
 *
 * Pure types only: no I/O, no dependencies. Keep under 500 lines.
 */

/* ------------------------------------------------------------------ ids */

export type FrameworkId = string;
export type ControlId = string;
export type EvidenceId = string;
export type AttachmentId = string;
export type PackId = string;
export type ReminderId = string;

/* ------------------------------------------------------------- framework */

/** How sensitive a framework's text is (ENF-CONF-03). */
export type Confidentiality = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';

export interface Framework {
  id: FrameworkId;
  name: string;
  version: string;
  importedAt: string; // ISO-8601
  confidentiality: Confidentiality;
  /** Optional human note about the provenance of the import. */
  source?: string;
}

/**
 * A single requirement of a framework.
 * `periodicity` is an ISO-8601 duration ("P3M", "P1Y", "P30D").
 */
export interface Control {
  id: ControlId;
  frameworkId: FrameworkId;
  domain: string;
  title: string;
  requirement: string;
  /** What an evidence must contain to support this control. */
  expectedEvidence: string[];
  periodicity: string;
  owner: string;
  mandatory: boolean;
}

/** Payload accepted by `POST /v1/frameworks` (Annex A of the spec). */
export interface FrameworkImport {
  framework: {
    id: FrameworkId;
    name: string;
    version: string;
    confidentiality?: Confidentiality;
    source?: string;
  };
  controls: ControlInput[];
}

export interface ControlInput {
  id: ControlId;
  domain: string;
  title: string;
  requirement: string;
  expectedEvidence: string[];
  periodicity: string;
  owner: string;
  mandatory?: boolean;
}

/* -------------------------------------------------------------- evidence */

/** Closed list (Annex B of the spec). */
export type EvidenceType =
  | 'POLICY'
  | 'PROCEDURE'
  | 'MINUTES'
  | 'REPORT'
  | 'EXPORT'
  | 'SCREENSHOT'
  | 'LIST'
  | 'ATTESTATION';

export const EVIDENCE_TYPES: readonly EvidenceType[] = [
  'POLICY',
  'PROCEDURE',
  'MINUTES',
  'REPORT',
  'EXPORT',
  'SCREENSHOT',
  'LIST',
  'ATTESTATION'
] as const;

/** Access level; RESTRICTED covers HR / customer data (ENF-CONF-01). */
export type AccessLevel = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';

export const ACCESS_ORDER: readonly AccessLevel[] = ['PUBLIC', 'INTERNAL', 'RESTRICTED'] as const;

export type CollectorKind = 'S3' | 'MANUAL' | 'ITSM' | 'AWS_REPORT';

export interface EvidenceLocation {
  kind: CollectorKind;
  uri: string;
  collectedAt: string;
  /** True when this location is a duplicate of an already stored object. */
  duplicate?: boolean;
}

export interface EvidencePeriod {
  start: string | null;
  end: string | null;
}

/** Fields read from a document by Bedrock Data Automation (Annex B). */
export interface EvidenceFields {
  type: EvidenceType | null;
  title: string | null;
  documentDate: string | null;
  period: EvidencePeriod;
  version: string | null;
  author: string | null;
  approver: string | null;
  approvalDate: string | null;
  client: string | null;
  summary: string | null;
  personalData: boolean;
}

/** Reading warnings that force a human review (EF-LEC-04). */
export interface ReadFlags {
  unreadable: boolean;
  missingDate: boolean;
  missingAuthor: boolean;
  /** Document date differs from the file date (screenshots). */
  dateToConfirm: boolean;
}

export interface TextPage {
  page: number;
  text: string;
}

export interface CostRecord {
  usd: number;
  tokensIn: number;
  tokensOut: number;
  /** Adapter that produced the cost ("bedrock-data-automation", ...). */
  source: string;
}

export interface Evidence {
  id: EvidenceId;
  sha256: string;
  /** Incremented when the same content is stored again under another name. */
  revision: number;
  fields: EvidenceFields;
  flags: ReadFlags;
  accessLevel: AccessLevel;
  locations: EvidenceLocation[];
  /** Extracted plain text, page by page, used for quote verification. */
  textPages: TextPage[];
  sizeBytes: number;
  contentType: string;
  ingestedAt: string;
  reader: string;
  cost?: CostRecord;
}

/** Convenience: full text of an evidence (all pages joined). */
export function evidenceText(evidence: Evidence): string {
  return evidence.textPages.map((p) => p.text).join('\n');
}

/* ------------------------------------------------------------ attachment */

export type AttachmentStatus = 'PROPOSED' | 'APPLIED' | 'REJECTED';

export type RejectionReason =
  | 'CITATION_NOT_FOUND'
  | 'HUMAN_REJECTED'
  | 'NO_SUPPORT'
  | 'DUPLICATE';

export interface QuoteLocation {
  page: number | null;
}

/** Annex C of the spec. */
export interface Attachment {
  id: AttachmentId;
  evidenceId: EvidenceId;
  controlId: ControlId;
  frameworkId: FrameworkId;
  supports: boolean;
  confidence: number;
  quote: string;
  quoteLocation: QuoteLocation;
  reason: string;
  status: AttachmentStatus;
  /** Set by code after searching the quote inside the evidence text. */
  citationVerified: boolean;
  rejectionReason?: RejectionReason;
  autoApplied: boolean;
  model: string;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decidedNote?: string;
}

/* ------------------------------------------------------------ sufficiency */

export interface SufficiencyElement {
  expected: string;
  present: boolean;
  quote: string | null;
}

/** Never "COMPLIANT" (ENF-IA-01). */
export type SufficiencyClass = 'COMPLETE' | 'PARTIAL' | 'TO_VERIFY';

/** Annex D of the spec — `class` and `missing` are computed by code. */
export interface Sufficiency {
  id: string;
  attachmentId: AttachmentId;
  evidenceId: EvidenceId;
  controlId: ControlId;
  elements: SufficiencyElement[];
  class: SufficiencyClass;
  missing: string[];
  computedAt: string;
}

/* ---------------------------------------------------------------- states */

/** Freshness of one evidence against one control's periodicity. */
export type EvidenceFreshness = 'FRESH' | 'TO_RENEW' | 'EXPIRED' | 'UNDETERMINED';

/** State of a control (spec chapter 12.3). Never "COMPLIANT". */
export type ControlState = 'COVERED' | 'TO_RENEW' | 'TO_VERIFY' | 'EXPIRED' | 'NO_EVIDENCE';

export const CONTROL_STATES: readonly ControlState[] = [
  'COVERED',
  'TO_RENEW',
  'TO_VERIFY',
  'EXPIRED',
  'NO_EVIDENCE'
] as const;

export interface ControlStatus {
  controlId: ControlId;
  frameworkId: FrameworkId;
  state: ControlState;
  freshness: EvidenceFreshness;
  sufficiencyClass: SufficiencyClass | null;
  bestEvidenceId: EvidenceId | null;
  expiresAt: string | null;
  pendingProposals: number;
  /** Machine-readable reasons, e.g. "mandatory-first-validation-required". */
  notes: string[];
  computedAt: string;
}

export interface ReadinessSnapshot {
  frameworkId: FrameworkId;
  computedAt: string;
  total: number;
  counts: Record<ControlState, number>;
  /** Share of `total`, 0..1, rounded to 4 decimals. */
  shares: Record<ControlState, number>;
}

export interface ReadinessTrendPoint {
  frameworkId: FrameworkId;
  at: string;
  counts: Record<ControlState, number>;
}

/* -------------------------------------------------------------- reminders */

export type ReminderReason = 'EXPIRING_SOON' | 'NO_EVIDENCE' | 'MISSING_ELEMENTS';

export interface Reminder {
  id: ReminderId;
  controlId: ControlId;
  frameworkId: FrameworkId;
  recipient: string;
  reason: ReminderReason;
  /** What the owner must provide; echoes `Sufficiency.missing`. */
  missing: string[];
  message: string;
  createdAt: string;
  expiresAt: string | null;
  status: 'SENT' | 'ACKNOWLEDGED' | 'CLOSED';
  channel: string;
}

/* ------------------------------------------------------------ audit packs */

export interface PackIndexEntry {
  controlId: ControlId;
  controlTitle: string;
  state: ControlState;
  evidence: Array<{
    evidenceId: EvidenceId;
    title: string | null;
    documentDate: string | null;
    sha256: string;
    sufficiencyClass: SufficiencyClass | null;
    quote: string;
    page: number | null;
  }>;
}

export interface KnownGap {
  controlId: ControlId;
  state: ControlState;
  detail: string;
}

export interface Pack {
  id: PackId;
  frameworkId: FrameworkId;
  frozenAt: string;
  index: PackIndexEntry[];
  knownGaps: KnownGap[];
  archive: {
    uri: string;
    sha256: string;
    sizeBytes: number;
  };
  checksumsVerified: boolean;
}

/* ------------------------------------------------------------- validation */

export type ValidationKind = 'ATTACHMENT' | 'SUFFICIENCY' | 'UNREADABLE_EVIDENCE';

export type ValidationDecision = 'ACCEPT' | 'REJECT' | 'CORRECT';

export interface ValidationItem {
  id: string;
  kind: ValidationKind;
  attachmentId?: AttachmentId;
  evidenceId?: EvidenceId;
  controlId?: ControlId;
  reason: string;
  createdAt: string;
  status: 'PENDING' | 'DECIDED';
  decision?: ValidationDecision;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
}

/* ------------------------------------------------------------ audit trail */

export type AuditAction =
  | 'FRAMEWORK_IMPORTED'
  | 'EVIDENCE_COLLECTED'
  | 'EVIDENCE_READ'
  | 'EVIDENCE_DUPLICATE'
  | 'ATTACHMENT_PROPOSED'
  | 'ATTACHMENT_APPLIED'
  | 'ATTACHMENT_REJECTED'
  | 'VALIDATION_DECIDED'
  | 'STATE_RECOMPUTED'
  | 'REMINDER_SENT'
  | 'QUESTION_ASKED'
  | 'PACK_ASSEMBLED'
  | 'PACK_DOWNLOADED'
  | 'SETTINGS_UPDATED'
  | 'ACCESS_DENIED';

/** Append-only, hash-chained (ENF-INT-02). */
export interface AuditEvent {
  seq: number;
  id: string;
  at: string;
  actor: string;
  action: AuditAction;
  objectType: string;
  objectId: string;
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

/* -------------------------------------------------------------- identity */

export type Role =
  | 'QUALITY_LEAD'
  | 'CONTROL_OWNER'
  | 'EXECUTIVE'
  | 'INTERNAL_AUDITOR'
  | 'ADMIN';

export interface Principal {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Highest access level this principal may read. */
  clearance: AccessLevel;
  /** Controls owned by a CONTROL_OWNER (empty for other roles). */
  ownedControls: ControlId[];
}

/* --------------------------------------------------------------- settings */

export interface Settings {
  /** Attachments at or above this confidence are applied without review. */
  confidenceThreshold: number;
  /** Reminders are sent this many days before expiry. */
  reminderLeadDays: number;
  defaultPeriodicity: string;
  region: string;
  retentionMonths: number;
  readerModel: string;
  reasoningModel: string;
  answerModel: string;
  guardrailId: string | null;
  /** Nightly batch runs on the Bedrock Flex service tier. */
  nightlyServiceTier: 'FLEX' | 'STANDARD';
}

export const DEFAULT_SETTINGS: Settings = {
  confidenceThreshold: 0.85,
  reminderLeadDays: 30,
  defaultPeriodicity: 'P1Y',
  region: 'eu-central-1',
  retentionMonths: 24,
  readerModel: 'bedrock-data-automation',
  reasoningModel: 'anthropic.claude-sonnet-4-20250514-v1:0',
  answerModel: 'anthropic.claude-sonnet-4-20250514-v1:0',
  guardrailId: null,
  nightlyServiceTier: 'FLEX'
};

/* ------------------------------------------------------------------- QA */

export interface Passage {
  evidenceId: EvidenceId;
  title: string | null;
  documentDate: string | null;
  page: number | null;
  text: string;
  score: number;
  accessLevel: AccessLevel;
}

export interface AnswerCitation {
  evidenceId: EvidenceId;
  title: string | null;
  page: number | null;
  documentDate: string | null;
  quote: string;
}

export interface Answer {
  question: string;
  text: string;
  citations: AnswerCitation[];
  /** True when the guardrail replaced an unanchored draft. */
  noEvidence: boolean;
  redacted: boolean;
  passagesUsed: number;
  cost?: CostRecord;
}

export const NO_EVIDENCE_ANSWER = 'No evidence answers this question.';

/* --------------------------------------------------------------- cost UI */

export interface CostReport {
  totalUsd: number;
  perEvidenceUsd: number;
  evidenceCount: number;
  bySource: Record<string, number>;
}
