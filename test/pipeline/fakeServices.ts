/**
 * In-memory `Services` bundle for the pipeline tests.
 *
 * Every port is a plain object with scripted answers, so a test states what the
 * reader, the model, the retriever and the guardrail return, and then asserts on
 * what the pipeline did with it. No network, no file system, no clock drift.
 */

import type {
  AccessLevel,
  AnswerCitation,
  Attachment,
  AuditAction,
  AuditEvent,
  Control,
  ControlStatus,
  CostRecord,
  Evidence,
  EvidenceFields,
  Framework,
  Passage,
  Principal,
  ReadFlags,
  Settings,
  SufficiencyElement,
  TextPage,
  ValidationItem
} from '../../src/domain/types.ts';
import type {
  AnchoringResult,
  AnswerComposer,
  AuditSink,
  ControlCandidate,
  CostMeter,
  DraftAnswer,
  EvidenceReader,
  EvidenceStore,
  Guardrail,
  NotificationMessage,
  Notifier,
  ReadInput,
  ReadResult,
  Reasoner,
  RedactionResult,
  Services,
  StoredObject
} from '../../src/ports/index.ts';

/** Payload of one audit event, as the `AuditSink` port declares it. */
interface AuditInput {
  actor: string;
  action: AuditAction;
  objectType: string;
  objectId: string;
  detail?: Record<string, unknown>;
}

/** Filter of the audit log, as the `AuditSink` port declares it. */
interface AuditFilter {
  limit?: number;
  action?: AuditAction;
  objectId?: string;
}
import { DEFAULT_SETTINGS } from '../../src/domain/types.ts';
import { sha256Bytes } from '../../src/support/hash.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { signerFromEnv } from '../../src/crypto/localSigner.ts';
import { createMemoryExtensions } from '../../src/store/extensionsMemory.ts';
import { redactText } from '../../src/domain/redaction.ts';
import { unsupportedSpans } from '../../src/ai/anchoring.ts';
import { MemoryState } from './memoryState.ts';
import { TEST_NOW, makeFields, makeFlags, makeFramework } from '../fixtures/builders.ts';

/** A read the reader must return; `pages` are the extracted text of the document. */
export interface ScriptedRead {
  fields?: Partial<EvidenceFields>;
  flags?: Partial<ReadFlags>;
  pages?: TextPage[];
  accessLevel?: AccessLevel;
  cost?: CostRecord;
}

/** The bundle, plus the captures a test asserts on. */
export interface FakeBundle extends Services {
  /** Messages handed to the notifier, oldest first. */
  sent(): NotificationMessage[];
  /** Audit events, oldest first. */
  events(action?: AuditAction): AuditEvent[];
  /** Objects written to the evidence vault. */
  vaultKeys(): string[];
  /** Alters one stored object behind the product's back (integrity test). */
  corruptObject(uri: string): void;
}

/** Options of `fakeServices`; everything has a deterministic default. */
export interface FakeOptions {
  controls?: Control[];
  read?: ScriptedRead;
  proposals?: Array<{ controlId: string; supports: boolean; confidence: number; quote: string; page?: number | null }>;
  elements?: SufficiencyElement[];
  draft?: DraftAnswer;
  passages?: Passage[];
  anchored?: boolean;
  settings?: Settings;
  now?: string;
}

/** The reading a test wants the reader to return — EF-LEC-01..04. */
function readResult(read: ScriptedRead = {}): ReadResult {
  return {
    fields: makeFields(read.fields),
    flags: makeFlags(read.flags),
    textPages: read.pages ?? [{ page: 1, text: 'Information security policy reviewed on 1 August 2026.' }],
    accessLevel: read.accessLevel ?? 'INTERNAL',
    ...(read.cost === undefined ? {} : { cost: read.cost })
  };
}

/** `EvidenceReader` that always returns the same scripted reading — EF-LEC-01. */
class FakeReader implements EvidenceReader {
  readonly id = 'fake-reader';
  private readonly result: ReadResult;

  constructor(result: ReadResult) {
    this.result = result;
  }

  async read(_input: ReadInput): Promise<ReadResult> {
    return structuredClone(this.result);
  }
}

/**
 * `ControlRetriever` over the imported framework — EF-RAT-01. The knowledge base
 * is fed from the state store, so a test that imports a framework gets its
 * controls back as candidates.
 */
class FakeControlRetriever {
  readonly id = 'fake-kb-frameworks';
  private readonly controls: Control[];
  private readonly extra: () => Promise<Control[]>;

  constructor(controls: Control[], extra: () => Promise<Control[]>) {
    this.controls = controls;
    this.extra = extra;
  }

  async candidates(input: { frameworkId?: string }): Promise<ControlCandidate[]> {
    const byId = new Map<string, Control>();
    for (const control of [...this.controls, ...(await this.extra())]) byId.set(control.id, control);
    return [...byId.values()]
      .filter((control) => input.frameworkId === undefined || control.frameworkId === input.frameworkId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((control) => ({ control, score: 1, matchedOn: 'test-catalogue' }));
  }
}

/** `EvidenceRetriever` returning scripted passages, filtered by level — EF-QR-03. */
class FakeEvidenceRetriever {
  readonly id = 'fake-kb-evidence';
  private readonly passages: Passage[];

  constructor(passages: Passage[]) {
    this.passages = passages;
  }

  async search(input: { allowedLevels: readonly AccessLevel[] }): Promise<Passage[]> {
    return this.passages
      .filter((passage) => input.allowedLevels.includes(passage.accessLevel))
      .map((passage) => ({ ...passage }));
  }
}

/** `Reasoner` driven by the test, never by a heuristic — EF-RAT-01, EF-SUF-01. */
class FakeReasoner implements Reasoner {
  readonly id = 'fake-reasoner';
  private readonly proposals: NonNullable<FakeOptions['proposals']>;
  private readonly elements: SufficiencyElement[];

  constructor(proposals: NonNullable<FakeOptions['proposals']>, elements: SufficiencyElement[]) {
    this.proposals = proposals;
    this.elements = elements;
  }

  async proposeAttachments(): Promise<Array<{ controlId: string; supports: boolean; confidence: number; quote: string; page: number | null; reason: string }>> {
    return this.proposals.map((proposal) => ({
      controlId: proposal.controlId,
      supports: proposal.supports,
      confidence: proposal.confidence,
      quote: proposal.quote,
      page: proposal.page ?? null,
      reason: 'scripted proposal'
    }));
  }
  async assessSufficiency(): Promise<SufficiencyElement[]> {
    return this.elements.map((element) => ({ ...element }));
  }
}

/** `AnswerComposer` returning the scripted draft — EF-QR-01. */
class FakeComposer implements AnswerComposer {
  readonly id = 'fake-composer';
  private readonly draft: DraftAnswer;

  constructor(draft: DraftAnswer) {
    this.draft = draft;
  }

  async compose(): Promise<DraftAnswer> {
    return structuredClone(this.draft);
  }
}

/** `Guardrail` checking quoted spans literally, then masking PII — ENF-IA-02, ENF-CONF-02. */
class FakeGuardrail implements Guardrail {
  readonly id = 'fake-guardrail';
  private readonly forced: boolean | undefined;

  constructor(forced: boolean | undefined) {
    this.forced = forced;
  }

  async verifyAnchoring(input: { answer: string; passages: readonly Passage[] }): Promise<AnchoringResult> {
    const unsupported = unsupportedSpans(input.answer, input.passages);
    const anchored = this.forced ?? (input.passages.length > 0 && unsupported.length === 0);
    return { anchored, unsupported };
  }
  async redact(text: string): Promise<RedactionResult> {
    const result = redactText(text);
    return { text: result.text, redacted: result.redacted, hits: result.hits };
  }
}

/**
 * `EvidenceStore` keeping the bytes in a map — ENF-INT-01. Like the real vault,
 * a write appends a version and a read re-checks the fingerprint.
 */
class FakeEvidenceStore implements EvidenceStore {
  readonly id = 'fake-vault';
  private readonly objects = new Map<string, { bytes: Uint8Array; sha256: string; contentType: string }>();
  private readonly versions = new Map<string, number>();

  async put(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<StoredObject> {
    const sha256 = sha256Bytes(input.bytes);
    const version = (this.versions.get(input.key) ?? 0) + 1;
    this.versions.set(input.key, version);
    const uri = `vault://${input.key}#v${version}`;
    this.objects.set(uri, { bytes: new Uint8Array(input.bytes), sha256, contentType: input.contentType });
    return { uri, versionId: `v${version}`, sha256, sizeBytes: input.bytes.byteLength };
  }

  async get(uri: string): Promise<Uint8Array> {
    const object = this.objects.get(uri);
    if (!object) throw new Error(`unknown vault object: ${uri}`);
    if (sha256Bytes(object.bytes) !== object.sha256) throw new Error(`fingerprint mismatch: ${uri}`);
    return new Uint8Array(object.bytes);
  }

  async list(prefix: string): Promise<StoredObject[]> {
    return [...this.objects.entries()]
      .filter(([uri]) => uri.startsWith(`vault://${prefix}`))
      .map(([uri, object]) => ({ uri, versionId: 'v1', sha256: object.sha256, sizeBytes: object.bytes.byteLength }));
  }

  /** Simulates an object altered outside the product, for the integrity test. */
  corrupt(uri: string): void {
    const object = this.objects.get(uri);
    if (object) object.bytes = new TextEncoder().encode('{"tampered":true}');
  }

  keys(): string[] {
    return [...this.objects.keys()];
  }
}

/** Builds the whole bundle — the pipeline only ever sees `Services`. */
export function fakeServices(options: FakeOptions = {}): FakeBundle {
  const clock = new FixedClock(options.now ?? TEST_NOW);
  const state = new MemoryState(options.settings);
  const store = new FakeEvidenceStore();
  const messages: NotificationMessage[] = [];
  const events: AuditEvent[] = [];
  const costs: CostRecord[] = [];

  return {
    clock,
    signer: signerFromEnv({}),
    extensions: createMemoryExtensions({ clock }),
    reader: new FakeReader(readResult(options.read)),
    controlRetriever: new FakeControlRetriever(options.controls ?? [], async () => state.allControls()),
    evidenceRetriever: new FakeEvidenceRetriever(options.passages ?? []),
    reasoner: new FakeReasoner(options.proposals ?? [], options.elements ?? []),
    composer: new FakeComposer(options.draft ?? { text: '', citations: [] }),
    guardrail: new FakeGuardrail(options.anchored),
    evidenceStore: store,
    state,
    audit: fakeAudit(clock, events),
    notifier: fakeNotifier(clock, messages),
    costs: fakeCosts(costs),
    settings: { ...DEFAULT_SETTINGS, ...(options.settings ?? {}) },
    sent: () => messages.map((message) => structuredClone(message)),
    events: (action) => events.filter((event) => action === undefined || event.action === action),
    vaultKeys: () => store.keys(),
    corruptObject: (uri) => store.corrupt(uri)
  };
}

/** The audit sink of the bundle: it keeps the events a test asserts on — EF-ADM-02. */
function fakeAudit(clock: FixedClock, events: AuditEvent[]): AuditSink {
  let seq = 0;
  return {
    id: 'fake-audit',
    append: async (input: AuditInput): Promise<AuditEvent> => {
      seq += 1;
      const event: AuditEvent = {
        seq,
        id: `ae-${seq}`,
        at: clock.now(),
        actor: input.actor,
        action: input.action,
        objectType: input.objectType,
        objectId: input.objectId,
        detail: input.detail ?? {},
        prevHash: 'genesis',
        hash: `h-${seq}`
      };
      events.push(event);
      return structuredClone(event);
    },
    list: async (filter: AuditFilter = {}): Promise<AuditEvent[]> =>
      events
        .filter((event) =>
          (filter.action === undefined || event.action === filter.action) &&
          (filter.objectId === undefined || event.objectId === filter.objectId))
        .slice(-(filter.limit ?? events.length))
        .reverse()
        .map((event) => structuredClone(event)),
    verifyChain: async () => ({ ok: true, brokenAt: null })
  };
}

/** The notifier of the bundle: it captures the messages instead of sending them — EF-REL-01. */
function fakeNotifier(clock: FixedClock, messages: NotificationMessage[]): Notifier {
  return {
    id: 'fake-notifier',
    send: async (message: NotificationMessage) => {
      messages.push(structuredClone(message));
      return { id: `nt-${messages.length}`, sentAt: clock.now() };
    },
    sent: () => messages.map((message) => structuredClone(message))
  };
}

/** The cost meter of the bundle — ENF-COUT-01. */
function fakeCosts(costs: CostRecord[]): CostMeter {
  return {
    record: (cost: CostRecord) => costs.push({ ...cost }),
    report: () => ({ totalUsd: costs.reduce((sum, cost) => sum + cost.usd, 0), bySource: {}, count: costs.length })
  };
}

/** Seeds a framework and its controls, as an import does — EF-REF-01. */
export async function seed(
  services: Services,
  controls: Control[],
  framework: Partial<Framework> = {}
): Promise<void> {
  await services.state.putFramework(makeFramework(framework));
  await services.state.putControls(controls);
}

/** Convenience: a passage a test can hand to the retriever — EF-QR-01. */export function passage(overrides: Partial<Passage> = {}): Passage {
  return {
    evidenceId: 'ev-1',
    title: 'Information security policy',
    documentDate: '2026-08-01',
    page: 1,
    text: 'The information security policy was reviewed on 1 August 2026 and approved by C. Bernard.',
    score: 1,
    accessLevel: 'INTERNAL',
    ...overrides
  };
}

/** Convenience: an evidence already stored, for a test that skips ingestion. */
export function storedEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-1',
    sha256: 'a'.repeat(64),
    revision: 1,
    fields: makeFields(),
    flags: makeFlags(),
    accessLevel: 'INTERNAL',
    locations: [{ kind: 'MANUAL', uri: 'vault://evidence/ev-1/v1.pdf#v1', collectedAt: TEST_NOW }],
    textPages: [{ page: 1, text: 'Information security policy reviewed on 1 August 2026.' }],
    sizeBytes: 1024,
    contentType: 'application/pdf',
    ingestedAt: TEST_NOW,
    reader: 'fake-reader',
    ...overrides
  };
}

/** Convenience: a citation for a scripted draft — EF-QR-01. */
export function citation(overrides: Partial<AnswerCitation> = {}): AnswerCitation {
  return {
    evidenceId: 'ev-1',
    title: 'Information security policy',
    page: 1,
    documentDate: '2026-08-01',
    quote: 'reviewed on 1 August 2026 and approved by C. Bernard',
    ...overrides
  };
}

/** Convenience: a pending validation item, for a decision test — EF-VAL-02. */
export function pendingItem(overrides: Partial<ValidationItem> = {}): ValidationItem {
  return {
    id: 'va-test-1',
    kind: 'ATTACHMENT',
    attachmentId: 'at-test-1',
    evidenceId: 'ev-1',
    controlId: 'CONT-01',
    reason: 'confidence below threshold',
    createdAt: TEST_NOW,
    status: 'PENDING',
    ...overrides
  };
}

/** Convenience: an attachment waiting for a decision — EF-VAL-01. */
export function pendingAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'at-test-1',
    evidenceId: 'ev-1',
    controlId: 'CONT-01',
    frameworkId: 'demo-msp',
    supports: true,
    confidence: 0.5,
    quote: 'reviewed on 1 August 2026',
    quoteLocation: { page: 1 },
    reason: 'scripted proposal',
    status: 'PROPOSED',
    citationVerified: true,
    autoApplied: false,
    model: 'fake-reasoner',
    createdAt: TEST_NOW,
    ...overrides
  };
}

/** Convenience: a status, for a reminder or digest test — EF-FRA-02. */
export function status(overrides: Partial<ControlStatus> = {}): ControlStatus {
  return {
    controlId: 'CONT-01',
    frameworkId: 'demo-msp',
    state: 'NO_EVIDENCE',
    freshness: 'UNDETERMINED',
    sufficiencyClass: null,
    bestEvidenceId: null,
    expiresAt: null,
    pendingProposals: 0,
    notes: [],
    computedAt: TEST_NOW,
    ...overrides
  };
}

/** Convenience: a principal of a given role and clearance — ENF-CONF-01. */
export function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: 'u-exec',
    name: 'Executive',
    email: 'executive@msp.demo',
    role: 'EXECUTIVE',
    clearance: 'INTERNAL',
    ownedControls: [],
    ...overrides
  };
}
