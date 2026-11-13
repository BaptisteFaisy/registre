/**
 * Registre — ports (hexagonal boundaries).
 *
 * Every adapter (Bedrock, DynamoDB, S3, SES, in-memory mocks) implements one
 * of these interfaces. Domain and pipeline code import ports only, so the
 * whole product runs offline with mocks and on AWS with real services.
 *
 * Keep under 500 lines; no I/O here.
 */

import type { ControlMapping } from '../domain/mapping.ts';
import type { QualityRecord } from '../domain/quality.ts';
import type { DriftEvent } from '../domain/quality.ts';
import type { ShareGrant, VerificationResult } from '../domain/verification.ts';
import type {
  AccessLevel,
  Answer,
  Attachment,
  AuditAction,
  AuditEvent,
  Control,
  ControlId,
  ControlStatus,
  CostRecord,
  Evidence,
  EvidenceFields,
  EvidenceId,
  Framework,
  FrameworkId,
  FrameworkImport,
  Pack,
  PackId,
  Passage,
  Principal,
  ReadFlags,
  ReadinessSnapshot,
  ReadinessTrendPoint,
  Reminder,
  ReminderId,
  Settings,
  Sufficiency,
  SufficiencyElement,
  TextPage,
  ValidationItem
} from '../domain/types.ts';

/* ------------------------------------------------------------------ clock */

export interface Clock {
  /** Current instant, ISO-8601. Injected so tests and demos are reproducible. */
  now(): string;
}

/* ----------------------------------------------------------------- reader */

export interface ReadInput {
  evidenceId: EvidenceId;
  contentType: string;
  sizeBytes: number;
  /** Object location (S3 URI or local file URI). */
  uri: string;
  /** Raw bytes, when the caller already holds them (manual upload). */
  bytes?: Uint8Array;
  /** File-level metadata used to cross-check the document date. */
  fileDate?: string | null;
  suggestedControlId?: ControlId | null;
}

export interface ReadResult {
  fields: EvidenceFields;
  flags: ReadFlags;
  textPages: TextPage[];
  accessLevel: AccessLevel;
  cost?: CostRecord;
}

/** Bedrock Data Automation (or a mock) reads one document (EF-LEC-01..04). */
export interface EvidenceReader {
  readonly id: string;
  read(input: ReadInput): Promise<ReadResult>;
}

/* ------------------------------------------------------------- retrievers */

export interface ControlCandidate {
  control: Control;
  score: number;
  /** Why the knowledge base returned this control. */
  matchedOn: string;
}

/** Bedrock knowledge base holding the frameworks (EF-RAT-01 candidate step). */
export interface ControlRetriever {
  readonly id: string;
  candidates(input: {
    type: string | null;
    title: string | null;
    summary: string | null;
    text: string;
    frameworkId?: FrameworkId;
    limit?: number;
  }): Promise<ControlCandidate[]>;
}

/** Bedrock knowledge base holding the evidence, filtered by access rights. */
export interface EvidenceRetriever {
  readonly id: string;
  search(input: {
    query: string;
    allowedLevels: readonly AccessLevel[];
    limit?: number;
    frameworkId?: FrameworkId;
  }): Promise<Passage[]>;
}

/* --------------------------------------------------------------- reasoner */

export interface ProposedAttachment {
  controlId: ControlId;
  supports: boolean;
  confidence: number;
  quote: string;
  page: number | null;
  reason: string;
}

export interface AttachmentRequest {
  evidence: Pick<Evidence, 'id' | 'fields' | 'textPages' | 'accessLevel'>;
  candidates: ControlCandidate[];
}

/** Structured-output model call (Annex C / D shapes). */
export interface Reasoner {
  readonly id: string;
  proposeAttachments(request: AttachmentRequest): Promise<ProposedAttachment[]>;
  /** Element-by-element presence check against the control's expectations. */
  assessSufficiency(input: {
    evidence: Pick<Evidence, 'id' | 'fields' | 'textPages'>;
    control: Control;
  }): Promise<SufficiencyElement[]>;
}

/* --------------------------------------------------------------- answering */

export interface DraftAnswer {
  text: string;
  citations: Array<{ evidenceId: EvidenceId; quote: string; page: number | null }>;
  cost?: CostRecord;
}

export interface AnswerComposer {
  readonly id: string;
  compose(input: { question: string; passages: Passage[] }): Promise<DraftAnswer>;
}

export interface AnchoringResult {
  anchored: boolean;
  /** Citations that could not be found in the retrieved passages. */
  unsupported: string[];
}

export interface RedactionResult {
  text: string;
  redacted: boolean;
  hits: number;
}

/** Bedrock Guardrails: PII redaction + grounding check (ENF-CONF-02, ENF-IA-02). */
export interface Guardrail {
  readonly id: string;
  /** `question` is the user query the contextual-grounding check scores relevance against. */
  verifyAnchoring(input: { answer: string; passages: Passage[]; question?: string }): Promise<AnchoringResult>;
  redact(text: string): Promise<RedactionResult>;
}

/* ------------------------------------------------------------------ stores */

export interface StoredObject {
  uri: string;
  versionId: string | null;
  sha256: string;
  sizeBytes: number;
}

/** Versioned, write-once evidence vault (S3 + Object Lock) — ENF-INT-01. */
export interface EvidenceStore {
  readonly id: string;
  put(input: {
    key: string;
    bytes: Uint8Array;
    contentType: string;
    /** Legal-hold style retention, in days; 0 = no lock. */
    retainDays?: number;
  }): Promise<StoredObject>;
  get(uri: string): Promise<Uint8Array>;
  list(prefix: string): Promise<StoredObject[]>;
}

/** Everything the state engine reads and writes (DynamoDB in production). */
export interface StateStore {
  readonly id: string;

  putFramework(framework: Framework): Promise<void>;
  listFrameworks(): Promise<Framework[]>;
  getFramework(id: FrameworkId): Promise<Framework | null>;

  putControls(controls: Control[]): Promise<void>;
  listControls(frameworkId: FrameworkId): Promise<Control[]>;
  getControl(id: ControlId): Promise<Control | null>;

  putEvidence(evidence: Evidence): Promise<void>;
  getEvidence(id: EvidenceId): Promise<Evidence | null>;
  findEvidenceByHash(sha256: string): Promise<Evidence | null>;
  listEvidence(filter?: { frameworkId?: FrameworkId; limit?: number }): Promise<Evidence[]>;

  putAttachment(attachment: Attachment): Promise<void>;
  getAttachment(id: string): Promise<Attachment | null>;
  listAttachments(filter?: {
    evidenceId?: EvidenceId;
    controlId?: ControlId;
    status?: Attachment['status'];
  }): Promise<Attachment[]>;

  putSufficiency(sufficiency: Sufficiency): Promise<void>;
  getSufficiencyForAttachment(attachmentId: string): Promise<Sufficiency | null>;
  listSufficiency(filter?: { controlId?: ControlId; evidenceId?: EvidenceId }): Promise<Sufficiency[]>;

  putStatus(status: ControlStatus): Promise<void>;
  getStatus(controlId: ControlId): Promise<ControlStatus | null>;
  listStatuses(frameworkId: FrameworkId): Promise<ControlStatus[]>;

  appendTrend(point: ReadinessTrendPoint): Promise<void>;
  listTrend(frameworkId: FrameworkId, limit?: number): Promise<ReadinessTrendPoint[]>;

  putReminder(reminder: Reminder): Promise<void>;
  listReminders(filter?: { controlId?: ControlId; status?: Reminder['status'] }): Promise<Reminder[]>;
  getReminder(id: ReminderId): Promise<Reminder | null>;

  putValidation(item: ValidationItem): Promise<void>;
  listValidations(filter?: { status?: ValidationItem['status']; kind?: ValidationItem['kind'] }): Promise<ValidationItem[]>;
  getValidation(id: string): Promise<ValidationItem | null>;

  putPack(pack: Pack): Promise<void>;
  getPack(id: PackId): Promise<Pack | null>;
  listPacks(frameworkId: FrameworkId): Promise<Pack[]>;

  getSettings(): Promise<Settings>;
  putSettings(settings: Settings): Promise<void>;

  /** Records a human approval of a (control, evidence type) pair — EF-SUF-03. */
  markTypeValidated(controlId: ControlId, evidenceType: string, by: string): Promise<void>;
  isTypeValidated(controlId: ControlId, evidenceType: string): Promise<boolean>;
}

/* -------------------------------------------------------------- audit log */

export interface AuditSink {
  readonly id: string;
  append(input: {
    actor: string;
    action: AuditAction;
    objectType: string;
    objectId: string;
    detail?: Record<string, unknown>;
  }): Promise<AuditEvent>;
  list(filter?: { limit?: number; action?: AuditAction; objectId?: string }): Promise<AuditEvent[]>;
  /** Verifies the hash chain; returns the first broken sequence, if any. */
  verifyChain(): Promise<{ ok: boolean; brokenAt: number | null }>;
}

/* --------------------------------------------------------------- notifier */

export interface NotificationMessage {
  to: string;
  subject: string;
  body: string;
  kind: 'REMINDER' | 'WEEKLY_DIGEST';
  controlId?: ControlId;
}

export interface Notifier {
  readonly id: string;
  send(message: NotificationMessage): Promise<{ id: string; sentAt: string }>;
  sent(): NotificationMessage[];
}

/* ------------------------------------------------------------------ costs */

export interface CostMeter {
  record(cost: CostRecord): void;
  report(): { totalUsd: number; bySource: Record<string, number>; count: number };
}

/* ------------------------------------------------------------------ bundle */

/** Everything the pipeline needs, injected at bootstrap. */
export interface Services {
  clock: Clock;
  reader: EvidenceReader;
  controlRetriever: ControlRetriever;
  evidenceRetriever: EvidenceRetriever;
  reasoner: Reasoner;
  composer: AnswerComposer;
  guardrail: Guardrail;
  evidenceStore: EvidenceStore;
  state: StateStore;
  audit: AuditSink;
  notifier: Notifier;
  costs: CostMeter;
  settings: Settings;
  /** Signs pack manifests so a third party can verify without trusting us. */
  signer: Signer;
  /** Shares, mappings, drifts, measured quality, verification log. */
  extensions: ExtensionStore;
}

/* ---------------------------------------------------------------- signing */

/** What a signer returns; the signature is base64, the key id is public. */
export interface SignerOutput {
  signature: string;
  keyId: string;
  algorithm: string;
  purpose: string;
  signedAt: string;
}

/**
 * Signs and verifies a payload. KMS in production, a local Ed25519 key offline.
 * The private key never leaves the implementation.
 */
export interface Signer {
  readonly id: string;
  sign(input: { payload: Uint8Array; purpose: string }): Promise<SignerOutput>;
  verify(input: {
    payload: Uint8Array;
    signature: string;
    keyId: string;
    algorithm: string;
  }): Promise<boolean>;
}

/* --------------------------------------------------- extension persistence */

/**
 * Persistence of everything the three extensions add: share grants, cross
 * framework mappings, drift events, measured quality and verification log.
 *
 * One interface instead of five so the `Services` bundle grows by two fields,
 * and one memory implementation keeps the whole product runnable offline.
 */
export interface ExtensionStore {
  readonly id: string;

  /* Auditor share grants (time-boxed, revocable, watermarked). */
  putShare(share: ShareGrant): Promise<void>;
  getShare(token: string): Promise<ShareGrant | null>;
  listShares(filter?: {
    packId?: string;
    frameworkId?: string;
    active?: boolean;
    now?: string;
  }): Promise<ShareGrant[]>;
  /** Records one use: increments the counter and stamps the instant. */
  touchShare(token: string, at: string): Promise<void>;

  /* Cross-framework mappings (never auto-applied). */
  putMapping(mapping: ControlMapping): Promise<void>;
  getMapping(id: string): Promise<ControlMapping | null>;
  listMappings(filter?: {
    status?: ControlMapping['status'];
    sourceFrameworkId?: string;
    targetFrameworkId?: string;
    controlId?: string;
  }): Promise<ControlMapping[]>;

  /* Drift of machine attestations. */
  putDrift(event: DriftEvent): Promise<void>;
  listDrifts(filter?: {
    controlId?: string;
    frameworkId?: string;
    acknowledged?: boolean;
    limit?: number;
  }): Promise<DriftEvent[]>;
  acknowledgeDrift(id: string, by: string, at: string): Promise<DriftEvent | null>;

  /* Measured quality of each model and prompt version. */
  recordQuality(record: QualityRecord): Promise<void>;
  listQuality(filter?: { subjectKey?: string; metric?: QualityRecord['metric']; limit?: number }): Promise<QualityRecord[]>;

  /* Public verification log: who checked which pack, and the verdict. */
  recordVerification(result: VerificationResult): Promise<void>;
  listVerifications(filter?: { packId?: string; limit?: number }): Promise<VerificationResult[]>;
}

/* ------------------------------------------------------- framework import */

export interface ImportResult {
  framework: Framework;
  controls: Control[];
  /** Controls added / changed / removed against the previous version (EF-REF-05). */
  diff: {
    added: ControlId[];
    changed: ControlId[];
    removed: ControlId[];
  } | null;
}

export type FrameworkImporter = (input: FrameworkImport) => Promise<ImportResult>;

/* ----------------------------------------------------------------- helpers */

export interface PrincipalDirectory {
  resolve(idOrEmail: string): Principal | null;
  list(): Principal[];
  demoCredentials(): Array<{ login: string; password: string; principalId: string; role: Principal['role'] }>;
}
