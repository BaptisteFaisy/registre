/**
 * Minimal in-memory `StateStore` for the pipeline tests.
 *
 * The pipeline is tested against the *ports*, not against the platform module:
 * this store implements exactly the contract of `src/ports/index.ts`, keeps
 * copies (so a caller can never mutate stored state) and does no I/O.
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
} from '../../src/domain/types.ts';
import { DEFAULT_SETTINGS } from '../../src/domain/types.ts';
import type { StateStore } from '../../src/ports/index.ts';

const copy = <T>(value: T): T => structuredClone(value);
const byId = <T>(items: Iterable<T>, key: (item: T) => string): T[] =>
  [...items].sort((left, right) => key(left).localeCompare(key(right))).map(copy);

export class MemoryState implements StateStore {
  readonly id = 'test-memory-state';

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
  private readonly typeValidations = new Set<string>();
  private settings: Settings;

  constructor(settings: Settings = DEFAULT_SETTINGS) {
    this.settings = copy(settings);
  }

  async putFramework(framework: Framework): Promise<void> {
    this.frameworks.set(framework.id, copy(framework));
  }
  async listFrameworks(): Promise<Framework[]> {
    return byId(this.frameworks.values(), (item) => item.id);
  }
  async getFramework(id: FrameworkId): Promise<Framework | null> {
    return this.one(this.frameworks, id);
  }

  async putControls(controls: Control[]): Promise<void> {
    for (const control of controls) this.controls.set(control.id, copy(control));
  }
  async listControls(frameworkId: FrameworkId): Promise<Control[]> {
    const scoped = [...this.controls.values()].filter((control) => control.frameworkId === frameworkId);
    return byId(scoped, (control) => control.id);
  }
  async getControl(id: ControlId): Promise<Control | null> {
    return this.one(this.controls, id);
  }

  /** Every stored control, whatever its framework — the knowledge base catalogue. */
  allControls(): Control[] {
    return byId(this.controls.values(), (control) => control.id);
  }

  async putEvidence(evidence: Evidence): Promise<void> {
    this.evidences.set(evidence.id, copy(evidence));
  }
  async getEvidence(id: EvidenceId): Promise<Evidence | null> {
    return this.one(this.evidences, id);
  }
  async findEvidenceByHash(sha256: string): Promise<Evidence | null> {
    const hit = [...this.evidences.values()].find((evidence) => evidence.sha256 === sha256);
    return hit === undefined ? null : copy(hit);
  }
  async listEvidence(filter: { frameworkId?: FrameworkId; limit?: number } = {}): Promise<Evidence[]> {
    const scoped = [...this.evidences.values()].filter((evidence) => this.inFramework(evidence.id, filter.frameworkId));
    const ordered = byId(scoped, (evidence) => evidence.id);
    return filter.limit === undefined ? ordered : ordered.slice(0, filter.limit);
  }

  async putAttachment(attachment: Attachment): Promise<void> {
    this.attachments.set(attachment.id, copy(attachment));
  }
  async getAttachment(id: string): Promise<Attachment | null> {
    return this.one(this.attachments, id);
  }
  async listAttachments(
    filter: { evidenceId?: EvidenceId; controlId?: ControlId; status?: Attachment['status'] } = {}
  ): Promise<Attachment[]> {
    const scoped = [...this.attachments.values()].filter(
      (item) =>
        (filter.evidenceId === undefined || item.evidenceId === filter.evidenceId) &&
        (filter.controlId === undefined || item.controlId === filter.controlId) &&
        (filter.status === undefined || item.status === filter.status)
    );
    return byId(scoped, (item) => item.id);
  }

  async putSufficiency(sufficiency: Sufficiency): Promise<void> {
    this.sufficiencies.set(sufficiency.attachmentId, copy(sufficiency));
  }
  async getSufficiencyForAttachment(attachmentId: string): Promise<Sufficiency | null> {
    return this.one(this.sufficiencies, attachmentId);
  }
  async listSufficiency(filter: { controlId?: ControlId; evidenceId?: EvidenceId } = {}): Promise<Sufficiency[]> {
    const scoped = [...this.sufficiencies.values()].filter(
      (item) =>
        (filter.controlId === undefined || item.controlId === filter.controlId) &&
        (filter.evidenceId === undefined || item.evidenceId === filter.evidenceId)
    );
    return byId(scoped, (item) => item.attachmentId);
  }

  async putStatus(status: ControlStatus): Promise<void> {
    this.statuses.set(status.controlId, copy(status));
  }
  async getStatus(controlId: ControlId): Promise<ControlStatus | null> {
    return this.one(this.statuses, controlId);
  }
  async listStatuses(frameworkId: FrameworkId): Promise<ControlStatus[]> {
    const scoped = [...this.statuses.values()].filter((status) => status.frameworkId === frameworkId);
    return byId(scoped, (status) => status.controlId);
  }

  async appendTrend(point: ReadinessTrendPoint): Promise<void> {
    const history = this.trends.get(point.frameworkId) ?? [];
    history.push(copy(point));
    history.sort((left, right) => left.at.localeCompare(right.at));
    this.trends.set(point.frameworkId, history);
  }
  async listTrend(frameworkId: FrameworkId, limit = 100): Promise<ReadinessTrendPoint[]> {
    const history = this.trends.get(frameworkId) ?? [];
    return history.slice(Math.max(0, history.length - limit)).map(copy);
  }

  async putReminder(reminder: Reminder): Promise<void> {
    this.reminders.set(reminder.id, copy(reminder));
  }
  async listReminders(filter: { controlId?: ControlId; status?: Reminder['status'] } = {}): Promise<Reminder[]> {
    const scoped = [...this.reminders.values()].filter(
      (item) =>
        (filter.controlId === undefined || item.controlId === filter.controlId) &&
        (filter.status === undefined || item.status === filter.status)
    );
    return byId(scoped, (item) => item.id);
  }
  async getReminder(id: ReminderId): Promise<Reminder | null> {
    return this.one(this.reminders, id);
  }

  async putValidation(item: ValidationItem): Promise<void> {
    this.validations.set(item.id, copy(item));
  }
  async listValidations(
    filter: { status?: ValidationItem['status']; kind?: ValidationItem['kind'] } = {}
  ): Promise<ValidationItem[]> {
    const scoped = [...this.validations.values()].filter(
      (item) =>
        (filter.status === undefined || item.status === filter.status) &&
        (filter.kind === undefined || item.kind === filter.kind)
    );
    return byId(scoped, (item) => item.id);
  }
  async getValidation(id: string): Promise<ValidationItem | null> {
    return this.one(this.validations, id);
  }

  async putPack(pack: Pack): Promise<void> {
    this.packs.set(pack.id, copy(pack));
  }
  async getPack(id: PackId): Promise<Pack | null> {
    return this.one(this.packs, id);
  }
  async listPacks(frameworkId: FrameworkId): Promise<Pack[]> {
    const scoped = [...this.packs.values()].filter((pack) => pack.frameworkId === frameworkId);
    return byId(scoped, (pack) => pack.id);
  }

  async getSettings(): Promise<Settings> {
    return copy(this.settings);
  }
  async putSettings(settings: Settings): Promise<void> {
    this.settings = copy(settings);
  }

  async markTypeValidated(controlId: ControlId, evidenceType: string, _by: string): Promise<void> {
    this.typeValidations.add(`${controlId}|${evidenceType.trim().toUpperCase()}`);
  }
  async isTypeValidated(controlId: ControlId, evidenceType: string): Promise<boolean> {
    return this.typeValidations.has(`${controlId}|${evidenceType.trim().toUpperCase()}`);
  }

  private one<T>(map: Map<string, T>, key: string): T | null {
    const value = map.get(key);
    return value === undefined ? null : copy(value);
  }

  private inFramework(evidenceId: EvidenceId, frameworkId: FrameworkId | undefined): boolean {
    if (frameworkId === undefined) return true;
    return [...this.attachments.values()].some(
      (attachment) => attachment.evidenceId === evidenceId && attachment.frameworkId === frameworkId
    );
  }
}
