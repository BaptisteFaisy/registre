/**
 * In-memory `StateStore` — the offline implementation used by tests, the demo
 * and the evaluation harness (CONTRACTS.md rule 8: tests never touch AWS).
 *
 * Every read returns a deep copy, so a caller can never mutate stored state by
 * accident. Writes are equally defensive: what is stored is a copy of what the
 * caller passed.
 *
 * Requirements covered: chapter 14 (data model), EF-FRA-04 (readiness history),
 * EF-SUF-03 (type validation), EF-VAL-01/02 (validation queue), EF-DOS-03
 * (frozen packs), EF-ADM-01 (settings).
 */

import type {
  Attachment,
  Control,
  ControlId,
  ControlStatus,
  Evidence,
  EvidenceId,
  Framework,
  FrameworkId,
  Pack,
  PackId,
  ReadinessTrendPoint,
  Reminder,
  ReminderId,
  Settings,
  Sufficiency,
  ValidationItem
} from '../domain/types.ts';
import { DEFAULT_SETTINGS } from '../domain/types.ts';
import type { Clock, StateStore } from '../ports/index.ts';
import { SystemClock } from '../support/clock.ts';

/** Recorded human approval of a (control, evidence type) pair (EF-SUF-03). */
export interface TypeValidation {
  controlId: ControlId;
  evidenceType: string;
  validatedBy: string;
  validatedAt: string;
}

export interface InMemoryStateStoreOptions {
  clock?: Clock;
  settings?: Settings;
}

/** Deep copy: stored state and caller state never alias. */
function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Deterministic ascending order on a string key. */
function orderedBy<T>(items: Iterable<T>, key: (item: T) => string): T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}

/** Most recent first, id as tie-breaker so the order is total. */
function newestFirst<T>(items: Iterable<T>, at: (item: T) => string, id: (item: T) => string): T[] {
  return [...items].sort((a, b) => at(b).localeCompare(at(a)) || id(a).localeCompare(id(b)));
}

/** True when the filter has no value, or the value matches. */
function matches<T>(filterValue: T | undefined, value: T): boolean {
  return filterValue === undefined || filterValue === value;
}

export class InMemoryStateStore implements StateStore {
  readonly id = 'memory-state';

  private readonly clock: Clock;
  private readonly frameworks = new Map<FrameworkId, Framework>();
  private readonly controls = new Map<ControlId, Control>();
  private readonly evidences = new Map<EvidenceId, Evidence>();
  private readonly attachments = new Map<string, Attachment>();
  private readonly sufficiencies = new Map<string, Sufficiency>();
  private readonly statuses = new Map<ControlId, ControlStatus>();
  private readonly trends = new Map<FrameworkId, ReadinessTrendPoint[]>();
  private readonly reminders = new Map<ReminderId, Reminder>();
  private readonly validations = new Map<string, ValidationItem>();
  private readonly packs = new Map<PackId, Pack>();
  private readonly typeValidations = new Map<string, TypeValidation>();
  private settings: Settings;

  /** Builds an empty store; `clock` stamps type validations. */
  constructor(options: InMemoryStateStoreOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.settings = { ...DEFAULT_SETTINGS, ...options.settings };
  }

  /* ---------------------------------------------------------- frameworks */

  /** Stores one framework, replacing the previous version of the same id. */
  async putFramework(framework: Framework): Promise<void> {
    this.frameworks.set(framework.id, clone(framework));
  }

  /** Lists every imported framework, ordered by id (EF-REF-02). */
  async listFrameworks(): Promise<Framework[]> {
    return orderedBy(this.frameworks.values(), (item) => item.id).map(clone);
  }

  /** Reads one framework, `null` when it was never imported (EF-REF-01). */
  async getFramework(id: FrameworkId): Promise<Framework | null> {
    return this.read(this.frameworks, id);
  }

  /* ------------------------------------------------------------ controls */

  /** Upserts controls in bulk, as an import does (EF-REF-01). */
  async putControls(controls: Control[]): Promise<void> {
    for (const control of controls) this.controls.set(control.id, clone(control));
  }

  /** Controls of one framework, ordered by id (EF-REF-02). */
  async listControls(frameworkId: FrameworkId): Promise<Control[]> {
    return orderedBy(
      [...this.controls.values()].filter((control) => control.frameworkId === frameworkId),
      (control) => control.id
    ).map(clone);
  }

  /** Reads one control, `null` when unknown. */
  async getControl(id: ControlId): Promise<Control | null> {
    return this.read(this.controls, id);
  }

  /* ------------------------------------------------------------ evidence */

  /** Stores one evidence; the fingerprint is the natural key (EF-COL-05). */
  async putEvidence(evidence: Evidence): Promise<void> {
    this.evidences.set(evidence.id, clone(evidence));
  }

  /** Reads one evidence by id. */
  async getEvidence(id: EvidenceId): Promise<Evidence | null> {
    return this.read(this.evidences, id);
  }

  /** Finds the evidence carrying this fingerprint — the duplicate check (R8). */
  async findEvidenceByHash(sha256: string): Promise<Evidence | null> {
    const hits = orderedBy(
      [...this.evidences.values()].filter((evidence) => evidence.sha256 === sha256),
      (evidence) => evidence.id
    );
    return hits[0] === undefined ? null : clone(hits[0]);
  }

  /**
   * Evidences, most recently ingested first.
   * `frameworkId` keeps the evidences attached to a control of that framework
   * (an evidence has no framework of its own: the attachment carries it).
   */
  async listEvidence(filter: { frameworkId?: FrameworkId; limit?: number } = {}): Promise<Evidence[]> {
    let items = [...this.evidences.values()];
    if (filter.frameworkId !== undefined) {
      const scoped = this.evidenceIdsOf(filter.frameworkId);
      items = items.filter((evidence) => scoped.has(evidence.id));
    }
    const ordered = newestFirst(items, (item) => item.ingestedAt, (item) => item.id);
    return this.limited(ordered, filter.limit).map(clone);
  }

  /* --------------------------------------------------------- attachments */

  /** Stores one attachment proposal or decision (EF-RAT-03). */
  async putAttachment(attachment: Attachment): Promise<void> {
    this.attachments.set(attachment.id, clone(attachment));
  }

  /** Reads one attachment by id. */
  async getAttachment(id: string): Promise<Attachment | null> {
    return this.read(this.attachments, id);
  }

  /** Attachments matching any combination of evidence, control and status. */
  async listAttachments(
    filter: { evidenceId?: EvidenceId; controlId?: ControlId; status?: Attachment['status'] } = {}
  ): Promise<Attachment[]> {
    const items = [...this.attachments.values()].filter(
      (item) =>
        matches(filter.evidenceId, item.evidenceId) &&
        matches(filter.controlId, item.controlId) &&
        matches(filter.status, item.status)
    );
    return newestFirst(items, (item) => item.createdAt, (item) => item.id).map(clone);
  }

  /* -------------------------------------------------------- sufficiency */

  /** Stores the sufficiency of one attachment, keyed by attachment (Annex D). */
  async putSufficiency(sufficiency: Sufficiency): Promise<void> {
    this.sufficiencies.set(sufficiency.attachmentId, clone(sufficiency));
  }

  /** Sufficiency of one attachment, `null` when it was never assessed. */
  async getSufficiencyForAttachment(attachmentId: string): Promise<Sufficiency | null> {
    return this.read(this.sufficiencies, attachmentId);
  }

  /** Sufficiencies filtered by control and/or evidence, newest first. */
  async listSufficiency(
    filter: { controlId?: ControlId; evidenceId?: EvidenceId } = {}
  ): Promise<Sufficiency[]> {
    const items = [...this.sufficiencies.values()].filter(
      (item) => matches(filter.controlId, item.controlId) && matches(filter.evidenceId, item.evidenceId)
    );
    return newestFirst(items, (item) => item.computedAt, (item) => item.id).map(clone);
  }

  /* ------------------------------------------------------------- states */

  /** Stores the latest computed state of one control (EF-FRA-02). */
  async putStatus(status: ControlStatus): Promise<void> {
    this.statuses.set(status.controlId, clone(status));
  }

  /** Latest computed state of one control, `null` before the first run. */
  async getStatus(controlId: ControlId): Promise<ControlStatus | null> {
    return this.read(this.statuses, controlId);
  }

  /** Every stored state of one framework, ordered by control id (EF-FRA-03). */
  async listStatuses(frameworkId: FrameworkId): Promise<ControlStatus[]> {
    return orderedBy(
      [...this.statuses.values()].filter((status) => status.frameworkId === frameworkId),
      (status) => status.controlId
    ).map(clone);
  }

  /* -------------------------------------------------------------- trend */

  /** Appends one readiness point to the framework history (EF-FRA-04). */
  async appendTrend(point: ReadinessTrendPoint): Promise<void> {
    const history = this.trends.get(point.frameworkId) ?? [];
    history.push(clone(point));
    history.sort((a, b) => a.at.localeCompare(b.at));
    this.trends.set(point.frameworkId, history);
  }

  /** Readiness history in chronological order, most recent `limit` points. */
  async listTrend(frameworkId: FrameworkId, limit = 100): Promise<ReadinessTrendPoint[]> {
    const history = this.trends.get(frameworkId) ?? [];
    const tail = limit >= 0 ? history.slice(Math.max(0, history.length - limit)) : [...history];
    return tail.map(clone);
  }

  /* ---------------------------------------------------------- reminders */

  /** Stores one reminder and its follow-up status (EF-REL-01/02). */
  async putReminder(reminder: Reminder): Promise<void> {
    this.reminders.set(reminder.id, clone(reminder));
  }

  /** Reminders filtered by control and/or status, newest first. */
  async listReminders(
    filter: { controlId?: ControlId; status?: Reminder['status'] } = {}
  ): Promise<Reminder[]> {
    const items = [...this.reminders.values()].filter(
      (item) => matches(filter.controlId, item.controlId) && matches(filter.status, item.status)
    );
    return newestFirst(items, (item) => item.createdAt, (item) => item.id).map(clone);
  }

  /** Reads one reminder by id. */
  async getReminder(id: ReminderId): Promise<Reminder | null> {
    return this.read(this.reminders, id);
  }

  /* -------------------------------------------------------- validations */

  /** Stores one item of the validation queue (EF-VAL-01/02). */
  async putValidation(item: ValidationItem): Promise<void> {
    this.validations.set(item.id, clone(item));
  }

  /** Validation queue filtered by status and/or kind, newest first. */
  async listValidations(
    filter: { status?: ValidationItem['status']; kind?: ValidationItem['kind'] } = {}
  ): Promise<ValidationItem[]> {
    const items = [...this.validations.values()].filter(
      (item) => matches(filter.status, item.status) && matches(filter.kind, item.kind)
    );
    return newestFirst(items, (item) => item.createdAt, (item) => item.id).map(clone);
  }

  /** Reads one validation item by id. */
  async getValidation(id: string): Promise<ValidationItem | null> {
    return this.read(this.validations, id);
  }

  /* -------------------------------------------------------------- packs */

  /** Stores one frozen audit pack (EF-DOS-03). */
  async putPack(pack: Pack): Promise<void> {
    this.packs.set(pack.id, clone(pack));
  }

  /** Reads one pack by id (EF-DOS-02). */
  async getPack(id: PackId): Promise<Pack | null> {
    return this.read(this.packs, id);
  }

  /** Packs of one framework, most recently frozen first. */
  async listPacks(frameworkId: FrameworkId): Promise<Pack[]> {
    const items = [...this.packs.values()].filter((pack) => pack.frameworkId === frameworkId);
    return newestFirst(items, (pack) => pack.frozenAt, (pack) => pack.id).map(clone);
  }

  /* ----------------------------------------------------------- settings */

  /** Current settings; defaults when nothing was saved (EF-ADM-01). */
  async getSettings(): Promise<Settings> {
    return clone(this.settings);
  }

  /** Replaces the settings as a whole, never merges silently (EF-ADM-01). */
  async putSettings(settings: Settings): Promise<void> {
    this.settings = clone(settings);
  }

  /* --------------------------------------------------- type validation */

  /** Records the human approval of a (control, evidence type) pair (EF-SUF-03). */
  async markTypeValidated(controlId: ControlId, evidenceType: string, by: string): Promise<void> {
    this.typeValidations.set(this.typeKey(controlId, evidenceType), {
      controlId,
      evidenceType,
      validatedBy: by,
      validatedAt: this.clock.now()
    });
  }

  /** True when a human already approved this pair (EF-SUF-03, chapter 12.4). */
  async isTypeValidated(controlId: ControlId, evidenceType: string): Promise<boolean> {
    return this.typeValidations.has(this.typeKey(controlId, evidenceType));
  }

  /** Every recorded approval, ordered by control then type (audit display). */
  listTypeValidations(): TypeValidation[] {
    return orderedBy(
      this.typeValidations.values(),
      (item) => `${item.controlId}|${item.evidenceType}`
    ).map(clone);
  }

  /* ------------------------------------------------------------ private */

  private read<T>(map: Map<string, T>, key: string): T | null {
    const value = map.get(key);
    return value === undefined ? null : clone(value);
  }

  private typeKey(controlId: ControlId, evidenceType: string): string {
    return `${controlId}|${evidenceType.trim().toUpperCase()}`;
  }

  private evidenceIdsOf(frameworkId: FrameworkId): Set<string> {
    const ids = new Set<string>();
    for (const attachment of this.attachments.values()) {
      if (attachment.frameworkId === frameworkId) ids.add(attachment.evidenceId);
    }
    return ids;
  }

  private limited<T>(items: T[], limit: number | undefined): T[] {
    if (limit === undefined || limit < 0) return items;
    return items.slice(0, limit);
  }
}
