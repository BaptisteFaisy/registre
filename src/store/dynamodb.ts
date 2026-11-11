/**
 * DynamoDB implementation of `StateStore` (chapter 14, production target).
 *
 * Key layout lives in `dynamoKeys.ts`; this file only translates the port
 * methods into the smallest possible number of calls. Nothing here is executed
 * by the test suite (CONTRACTS.md rule 8): it must compile, be complete, and
 * surface every failure as `upstream(...)`.
 *
 * Queries are never scans: each port method maps to one partition query, one
 * batch get, or a merge of the status partitions (see `QUEUE_STATUSES`).
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
import { sha256Json } from '../support/hash.ts';
import { DynamoGateway, itemOf, payloadOf } from './dynamoClient.ts';
import {
  attachmentKeys,
  controlKeys,
  dynamoConfigFromEnv,
  evidenceKeys,
  evidenceLookupKeys,
  frameworkKeys,
  itemKeys,
  packKeys,
  QUEUE_STATUSES,
  QUERY_TARGETS,
  reminderKeys,
  reminderLookupKeys,
  SCOPE,
  settingsKeys,
  statusKeys,
  sufficiencyKeys,
  trendKeys,
  typeValidationKeys,
  validationKeys
} from './dynamoKeys.ts';
import type { DynamoConfig, DynamoItem } from './dynamoKeys.ts';

/** Payload of every item that carries one, in query order. */
function payloads<T>(items: readonly DynamoItem[]): T[] {
  const out: T[] = [];
  for (const item of items) {
    const value = payloadOf<T>(item);
    if (value !== null) out.push(value);
  }
  return out;
}

/** Newest first, id as tie-breaker so the order is total and stable. */
function newestFirst<T>(items: T[], at: (item: T) => string, id: (item: T) => string): T[] {
  return items.sort((a, b) => at(b).localeCompare(at(a)) || id(a).localeCompare(id(b)));
}

/** Applies the optional status filter of a queue listing. */
function onlyStatus<T extends { status: string }>(items: T[], status: string | undefined): T[] {
  return status === undefined ? items : items.filter((item) => item.status === status);
}

export class DynamoStateStore implements StateStore {
  readonly id = 'dynamo-state';

  private readonly db: DynamoGateway;
  private readonly clock: Clock;

  /** Builds the store from the environment; the SDK is imported on first use. */
  constructor(config: DynamoConfig = dynamoConfigFromEnv(), clock: Clock = new SystemClock()) {
    this.db = new DynamoGateway(config);
    this.clock = clock;
  }

  /* ---------------------------------------------------------- frameworks */

  /** Stores one framework header (EF-REF-01). */
  async putFramework(framework: Framework): Promise<void> {
    await this.db.put(frameworkKeys(framework.id), 'FRAMEWORK', framework);
  }

  /** Lists every imported framework (EF-REF-02). */
  async listFrameworks(): Promise<Framework[]> {
    return payloads<Framework>(await this.db.query(QUERY_TARGETS.list, 'LIST#FRAMEWORK'));
  }

  /** Reads one framework, `null` when absent. */
  async getFramework(id: FrameworkId): Promise<Framework | null> {
    return payloadOf<Framework>(await this.db.get(frameworkKeys(id)));
  }

  /* ------------------------------------------------------------ controls */

  /** Writes controls in batches of 25 (EF-REF-01). */
  async putControls(controls: Control[]): Promise<void> {
    await this.db.putMany(controls.map((control) => itemOf(controlKeys(control), 'CONTROL', control)));
  }

  /** Controls of one framework, one partition query. */
  async listControls(frameworkId: FrameworkId): Promise<Control[]> {
    const items = await this.db.query(QUERY_TARGETS.primary, SCOPE.framework(frameworkId), {
      skPrefix: 'CONTROL#'
    });
    return payloads<Control>(items);
  }

  /** Reads one control through the scope index. */
  async getControl(id: ControlId): Promise<Control | null> {
    const items = await this.db.query(QUERY_TARGETS.scope, SCOPE.control(id), {
      skPrefix: 'META',
      limit: 1
    });
    return items.length === 0 ? null : payloadOf<Control>(items[0]!);
  }

  /* ------------------------------------------------------------ evidence */

  /** Stores one evidence with its fingerprint index (EF-COL-05). */
  async putEvidence(evidence: Evidence): Promise<void> {
    await this.db.put(evidenceKeys(evidence), 'EVIDENCE', evidence);
  }

  /** Reads one evidence by id. */
  async getEvidence(id: EvidenceId): Promise<Evidence | null> {
    return payloadOf<Evidence>(await this.db.get(evidenceLookupKeys(id)));
  }

  /** Finds the evidence holding this fingerprint — the duplicate check (R8). */
  async findEvidenceByHash(sha256: string): Promise<Evidence | null> {
    const items = await this.db.query(QUERY_TARGETS.scope, SCOPE.hash(sha256), {
      skPrefix: 'EVIDENCE#',
      limit: 1
    });
    return items.length === 0 ? null : payloadOf<Evidence>(items[0]!);
  }

  /**
   * Evidences, most recently ingested first.
   * `frameworkId` is resolved through the attachments: an evidence carries no
   * framework of its own, the attachment does (chapter 14).
   */
  async listEvidence(filter: { frameworkId?: FrameworkId; limit?: number } = {}): Promise<Evidence[]> {
    if (filter.frameworkId === undefined) {
      const items = await this.db.query(QUERY_TARGETS.list, 'LIST#EVIDENCE', {
        descending: true,
        ...(filter.limit === undefined ? {} : { limit: filter.limit })
      });
      return payloads<Evidence>(items);
    }
    const ids = await this.evidenceIdsOfFramework(filter.frameworkId);
    const items = await this.db.batchGet(ids.map(evidenceLookupKeys));
    const evidences = newestFirst(payloads<Evidence>(items), (item) => item.ingestedAt, (item) => item.id);
    return filter.limit === undefined ? evidences : evidences.slice(0, filter.limit);
  }

  /* --------------------------------------------------------- attachments */

  /** Stores one attachment with its three access paths (EF-RAT-03). */
  async putAttachment(attachment: Attachment): Promise<void> {
    await this.db.put(attachmentKeys(attachment), 'ATTACHMENT', attachment);
  }

  /** Reads one attachment by id. */
  async getAttachment(id: string): Promise<Attachment | null> {
    return payloadOf<Attachment>(await this.db.get(itemKeys(`ATTACHMENT#${id}`)));
  }

  /** Attachments by evidence, by control, or by status (queue screens). */
  async listAttachments(
    filter: { evidenceId?: EvidenceId; controlId?: ControlId; status?: Attachment['status'] } = {}
  ): Promise<Attachment[]> {
    if (filter.evidenceId !== undefined) {
      const items = await this.db.query(QUERY_TARGETS.scope, SCOPE.evidence(filter.evidenceId), {
        skPrefix: 'ATTACHMENT#'
      });
      return newestFirst(
        onlyStatus(payloads<Attachment>(items), filter.status),
        (item) => item.createdAt,
        (item) => item.id
      );
    }
    if (filter.controlId !== undefined) {
      const items = await this.db.query(QUERY_TARGETS.list, SCOPE.control(filter.controlId), {
        skPrefix: 'ATTACHMENT#'
      });
      return newestFirst(
        onlyStatus(payloads<Attachment>(items), filter.status),
        (item) => item.createdAt,
        (item) => item.id
      );
    }
    return newestFirst(
      await this.byStatusPartitions<Attachment>(
        'ATTACHMENT',
        filter.status === undefined ? QUEUE_STATUSES.attachment : [filter.status]
      ),
      (item) => item.createdAt,
      (item) => item.id
    );
  }

  /* -------------------------------------------------------- sufficiency */

  /** Stores the sufficiency of one attachment (Annex D). */
  async putSufficiency(sufficiency: Sufficiency): Promise<void> {
    await this.db.put(sufficiencyKeys(sufficiency), 'SUFFICIENCY', sufficiency);
  }

  /** Sufficiency of one attachment, `null` when it was never assessed. */
  async getSufficiencyForAttachment(attachmentId: string): Promise<Sufficiency | null> {
    return payloadOf<Sufficiency>(await this.db.get(itemKeys(`ATTACHMENT#${attachmentId}`, 'SUFFICIENCY')));
  }

  /** Sufficiencies by control, by evidence, or every stored one. */
  async listSufficiency(
    filter: { controlId?: ControlId; evidenceId?: EvidenceId } = {}
  ): Promise<Sufficiency[]> {
    if (filter.controlId !== undefined) {
      const items = await this.db.query(QUERY_TARGETS.scope, SCOPE.control(filter.controlId), {
        skPrefix: 'SUFFICIENCY#'
      });
      return newestFirst(payloads<Sufficiency>(items), (item) => item.computedAt, (item) => item.id);
    }
    const attachments = await this.listAttachments(
      filter.evidenceId === undefined ? {} : { evidenceId: filter.evidenceId }
    );
    const items = await this.db.batchGet(
      attachments.map((attachment) => itemKeys(`ATTACHMENT#${attachment.id}`, 'SUFFICIENCY'))
    );
    return newestFirst(payloads<Sufficiency>(items), (item) => item.computedAt, (item) => item.id);
  }

  /* ------------------------------------------------------------- states */

  /** Stores the latest state of one control (EF-FRA-02). */
  async putStatus(status: ControlStatus): Promise<void> {
    await this.db.put(statusKeys(status), 'STATUS', status);
  }

  /** Latest state of one control, `null` before the first run. */
  async getStatus(controlId: ControlId): Promise<ControlStatus | null> {
    return payloadOf<ControlStatus>(await this.db.get(itemKeys(SCOPE.control(controlId), 'STATUS')));
  }

  /** Every stored state of one framework, ordered by control id (EF-FRA-03). */
  async listStatuses(frameworkId: FrameworkId): Promise<ControlStatus[]> {
    const items = await this.db.query(QUERY_TARGETS.scope, SCOPE.framework(frameworkId), {
      skPrefix: 'STATUS#'
    });
    return payloads<ControlStatus>(items).sort((a, b) => a.controlId.localeCompare(b.controlId));
  }

  /* -------------------------------------------------------------- trend */

  /** Appends one readiness point to the framework history (EF-FRA-04). */
  async appendTrend(point: ReadinessTrendPoint): Promise<void> {
    const fingerprint = sha256Json(point.counts).slice(0, 8);
    await this.db.put(trendKeys(point.frameworkId, point.at, fingerprint), 'TREND', point);
  }

  /** History in chronological order, keeping the most recent `limit` points. */
  async listTrend(frameworkId: FrameworkId, limit = 100): Promise<ReadinessTrendPoint[]> {
    const items = await this.db.query(QUERY_TARGETS.primary, SCOPE.framework(frameworkId), {
      skPrefix: 'TREND#',
      descending: true,
      limit
    });
    return payloads<ReadinessTrendPoint>(items).reverse();
  }

  /* ---------------------------------------------------------- reminders */

  /** Stores one reminder and its follow-up status (EF-REL-01/02). */
  async putReminder(reminder: Reminder): Promise<void> {
    await this.db.put(reminderKeys(reminder), 'REMINDER', reminder);
  }

  /** Reminders by control or by status, newest first. */
  async listReminders(
    filter: { controlId?: ControlId; status?: Reminder['status'] } = {}
  ): Promise<Reminder[]> {
    const items =
      filter.controlId === undefined
        ? await this.byStatusPartitions<Reminder>(
            'REMINDER',
            filter.status === undefined ? QUEUE_STATUSES.reminder : [filter.status]
          )
        : onlyStatus(
            payloads<Reminder>(
              await this.db.query(QUERY_TARGETS.scope, SCOPE.control(filter.controlId), {
                skPrefix: 'REMINDER#'
              })
            ),
            filter.status
          );
    return newestFirst(items, (item) => item.createdAt, (item) => item.id);
  }

  /** Reads one reminder by id. */
  async getReminder(id: ReminderId): Promise<Reminder | null> {
    return payloadOf<Reminder>(await this.db.get(reminderLookupKeys(id)));
  }

  /* -------------------------------------------------------- validations */

  /** Stores one item of the validation queue (EF-VAL-01/02). */
  async putValidation(item: ValidationItem): Promise<void> {
    await this.db.put(validationKeys(item), 'VALIDATION', item);
  }

  /** Validation queue filtered by status and/or kind, newest first. */
  async listValidations(
    filter: { status?: ValidationItem['status']; kind?: ValidationItem['kind'] } = {}
  ): Promise<ValidationItem[]> {
    const prefix = filter.status === undefined ? 'VALIDATION#' : `VALIDATION#${filter.status}#`;
    const items = await this.db.query(QUERY_TARGETS.scope, SCOPE.validation, { skPrefix: prefix });
    const all = payloads<ValidationItem>(items);
    const filtered = filter.kind === undefined ? all : all.filter((item) => item.kind === filter.kind);
    return newestFirst(filtered, (item) => item.createdAt, (item) => item.id);
  }

  /** Reads one validation item by id. */
  async getValidation(id: string): Promise<ValidationItem | null> {
    return payloadOf<ValidationItem>(await this.db.get(itemKeys(`VALIDATION#${id}`)));
  }

  /* -------------------------------------------------------------- packs */

  /** Stores one frozen audit pack (EF-DOS-03). */
  async putPack(pack: Pack): Promise<void> {
    await this.db.put(packKeys(pack), 'PACK', pack);
  }

  /** Reads one pack by id (EF-DOS-02). */
  async getPack(id: PackId): Promise<Pack | null> {
    return payloadOf<Pack>(await this.db.get(itemKeys(`PACK#${id}`)));
  }

  /** Packs of one framework, most recently frozen first. */
  async listPacks(frameworkId: FrameworkId): Promise<Pack[]> {
    const items = await this.db.query(QUERY_TARGETS.scope, SCOPE.framework(frameworkId), {
      skPrefix: 'PACK#'
    });
    return newestFirst(payloads<Pack>(items), (pack) => pack.frozenAt, (pack) => pack.id);
  }

  /* ----------------------------------------------------------- settings */

  /** Current settings; the domain defaults when the row was never written. */
  async getSettings(): Promise<Settings> {
    const stored = payloadOf<Settings>(await this.db.get(settingsKeys()));
    return stored ?? { ...DEFAULT_SETTINGS };
  }

  /** Replaces the settings row (EF-ADM-01). */
  async putSettings(settings: Settings): Promise<void> {
    await this.db.put(settingsKeys(), 'SETTINGS', settings);
  }

  /* --------------------------------------------------- type validation */

  /** Records the human approval of a (control, evidence type) pair (EF-SUF-03). */
  async markTypeValidated(controlId: ControlId, evidenceType: string, by: string): Promise<void> {
    await this.db.put(typeValidationKeys(controlId, evidenceType), 'TYPE_VALIDATION', {
      controlId,
      evidenceType: evidenceType.trim().toUpperCase(),
      validatedBy: by,
      validatedAt: this.clock.now()
    });
  }

  /** True when a human already approved this pair (EF-SUF-03). */
  async isTypeValidated(controlId: ControlId, evidenceType: string): Promise<boolean> {
    const item = await this.db.get(typeValidationKeys(controlId, evidenceType));
    return item !== null;
  }

  /* ------------------------------------------------------------ private */

  /** Merges the status partitions of one queue (no scan, exact result). */
  private async byStatusPartitions<T>(type: string, statuses: readonly string[]): Promise<T[]> {
    const out: T[] = [];
    for (const status of statuses) {
      const items = await this.db.query(QUERY_TARGETS.status, `${type}#${status}`);
      out.push(...payloads<T>(items));
    }
    return out;
  }

  /** Evidence ids attached to a control of this framework (R8, chapter 14). */
  private async evidenceIdsOfFramework(frameworkId: FrameworkId): Promise<string[]> {
    const controls = await this.listControls(frameworkId);
    const ids = new Set<string>();
    for (const control of controls) {
      const items = await this.db.query(QUERY_TARGETS.list, SCOPE.control(control.id), {
        skPrefix: 'ATTACHMENT#'
      });
      for (const attachment of payloads<Attachment>(items)) ids.add(attachment.evidenceId);
    }
    return [...ids];
  }
}
