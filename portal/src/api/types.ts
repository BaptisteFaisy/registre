export type FrameworkId = string;
export type ControlId = string;
export type EvidenceId = string;
export type AttachmentId = string;
export type PackId = string;
export type ReminderId = string;

export type Confidentiality = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';

export interface Framework {
  id: FrameworkId;
  name: string;
  version: string;
  importedAt: string;
  confidentiality: Confidentiality;
  source?: string;
}

export interface Control {
  id: ControlId;
  frameworkId: FrameworkId;
  domain: string;
  title: string;
  requirement: string;
  expectedEvidence: string[];
  periodicity: string;
  owner: string;
  mandatory: boolean;
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

export type EvidenceType =
  | 'POLICY'
  | 'PROCEDURE'
  | 'MINUTES'
  | 'REPORT'
  | 'EXPORT'
  | 'SCREENSHOT'
  | 'LIST'
  | 'ATTESTATION';

export type AccessLevel = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';

export type CollectorKind = 'S3' | 'MANUAL' | 'ITSM' | 'AWS_REPORT';

export interface EvidenceLocation {
  kind: CollectorKind;
  uri: string;
  collectedAt: string;
  duplicate?: boolean;
}

export interface EvidencePeriod {
  start: string | null;
  end: string | null;
}

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

export interface ReadFlags {
  unreadable: boolean;
  missingDate: boolean;
  missingAuthor: boolean;
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
  source: string;
}

export interface Evidence {
  id: EvidenceId;
  sha256: string;
  revision: number;
  fields: EvidenceFields;
  flags: ReadFlags;
  accessLevel: AccessLevel;
  locations: EvidenceLocation[];
  textPages: TextPage[];
  sizeBytes: number;
  contentType: string;
  ingestedAt: string;
  reader: string;
  cost?: CostRecord;
}

export type AttachmentStatus = 'PROPOSED' | 'APPLIED' | 'REJECTED';

export type RejectionReason =
  | 'CITATION_NOT_FOUND'
  | 'HUMAN_REJECTED'
  | 'NO_SUPPORT'
  | 'DUPLICATE';

export interface QuoteLocation {
  page: number | null;
}

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
  citationVerified: boolean;
  rejectionReason?: RejectionReason;
  autoApplied: boolean;
  model: string;
  createdAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decidedNote?: string;
}

export interface SufficiencyElement {
  expected: string;
  present: boolean;
  quote: string | null;
}

export type SufficiencyClass = 'COMPLETE' | 'PARTIAL' | 'TO_VERIFY';

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

export type EvidenceFreshness = 'FRESH' | 'TO_RENEW' | 'EXPIRED' | 'UNDETERMINED';

/** State of a control. Kept strictly free of forbidden words. */
export type ControlState = 'COVERED' | 'TO_RENEW' | 'TO_VERIFY' | 'EXPIRED' | 'NO_EVIDENCE';

export interface ControlStatus {
  controlId: ControlId;
  frameworkId: FrameworkId;
  state: ControlState;
  freshness: EvidenceFreshness;
  sufficiencyClass: SufficiencyClass | null;
  bestEvidenceId: EvidenceId | null;
  expiresAt: string | null;
  pendingProposals: number;
  notes: string[];
  computedAt: string;
}

export interface ReadinessSnapshot {
  frameworkId: FrameworkId;
  computedAt: string;
  total: number;
  counts: Record<ControlState, number>;
  shares: Record<ControlState, number>;
}

export interface ReadinessTrendPoint {
  frameworkId: FrameworkId;
  at: string;
  counts: Record<ControlState, number>;
}

export interface ReadinessOverview {
  framework: Framework;
  snapshot: ReadinessSnapshot;
  trend: ReadinessTrendPoint[];
  /** Per-control states, so list screens need a single call. */
  statuses: ControlStatus[];
  byDomain: Record<string, { total: number; counts: Record<ControlState, number> }>;
  costs: CostReport;
}

export type ReminderReason = 'EXPIRING_SOON' | 'NO_EVIDENCE' | 'MISSING_ELEMENTS';

export interface Reminder {
  id: ReminderId;
  controlId: ControlId;
  frameworkId: FrameworkId;
  recipient: string;
  reason: ReminderReason;
  missing: string[];
  message: string;
  createdAt: string;
  expiresAt: string | null;
  status: 'SENT' | 'ACKNOWLEDGED' | 'CLOSED';
  channel: string;
}

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
  | 'PACK_VERIFIED'
  | 'SHARE_CREATED'
  | 'SHARE_REVOKED'
  | 'SHARE_USED'
  | 'MAPPING_PROPOSED'
  | 'MAPPING_DECIDED'
  | 'DRIFT_DETECTED'
  | 'DRIFT_ACKNOWLEDGED'
  | 'DRAFT_GENERATED'
  | 'QUALITY_RECORDED'
  | 'PACK_DOWNLOADED'
  | 'SETTINGS_UPDATED'
  | 'ACCESS_DENIED';

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
  clearance: AccessLevel;
  ownedControls: ControlId[];
}

export interface Settings {
  confidenceThreshold: number;
  reminderLeadDays: number;
  defaultPeriodicity: string;
  region: string;
  retentionMonths: number;
  readerModel: string;
  reasoningModel: string;
  answerModel: string;
  guardrailId: string | null;
  nightlyServiceTier: 'FLEX' | 'STANDARD';
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
  noEvidence: boolean;
  redacted: boolean;
  passagesUsed: number;
  cost?: CostRecord;
}

export const NO_EVIDENCE_ANSWER = 'No evidence answers this question.';

export interface CostReport {
  totalUsd: number;
  perEvidenceUsd: number;
  evidenceCount: number;
  bySource: Record<string, number>;
}

export interface ControlWithRelations {
  control: Control;
  status: ControlStatus;
  attachments: Attachment[];
  sufficiencies: Sufficiency[];
  evidence: Evidence[];
}

/**
 * What the portal sends when a document is deposited.
 *
 * The bytes travel with the request: the API receives a JSON envelope whose
 * `contentBase64` field holds the document (docs/API.md §5), so the deposit
 * works in real mode and the offline mock fingerprints the same bytes.
 */
export interface EvidenceUploadInput {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  suggestedControlId?: string;
  accessLevel?: AccessLevel;
  fileDate?: string | null;
}

/* Verification, sharing, mappings, drift, drafts and measured quality. */
export * from './typesExt.ts';
