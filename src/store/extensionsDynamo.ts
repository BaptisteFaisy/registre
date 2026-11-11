/**
 * DynamoDB implementation of `ExtensionStore` — shares, mappings, drifts,
 * measured quality and the verification log.
 *
 * Same table as the rest of the product (`src/store/dynamoKeys.ts`): one item
 * per entity under its own partition, plus a listing partition per kind so the
 * API can read "all mappings" or "all drifts" without a scan. The document is
 * stored as canonical JSON in the `data` attribute, exactly like the other
 * stores, so a domain shape change needs no migration.
 *
 * Never executed by the test suite (no network, CONTRACTS.md §2.8): it must
 * compile, stay complete, and fail with `upstream(...)` on any SDK error.
 */

import type { ExtensionStore } from '../ports/index.ts';
import type { ControlMapping } from '../domain/mapping.ts';
import type { DriftEvent, QualityRecord } from '../domain/quality.ts';
import { subjectKey } from '../domain/quality.ts';
import type { ShareGrant, VerificationResult } from '../domain/verification.ts';
import { isShareActive } from '../domain/verification.ts';
import { DynamoGateway, payloadOf } from './dynamoClient.ts';
import type { DynamoItem, EntityKind } from './dynamoKeys.ts';
import {
  EXTENSION_PARTITION,
  QUERY_TARGETS,
  driftKeys,
  dynamoConfigFromEnv,
  itemKeys,
  mappingKeys,
  qualityKeys,
  shareKeys,
  verificationKeys
} from './dynamoKeys.ts';
import type { DynamoConfig } from './dynamoKeys.ts';
import { upstream } from '../support/errors.ts';
import type { Clock } from '../ports/index.ts';
import { SystemClock } from '../support/clock.ts';

export interface DynamoExtensionOptions {
  config?: DynamoConfig;
  gateway?: DynamoGateway;
  clock?: Clock;
}

/** Default page size of the listing methods. */
const DEFAULT_LIMIT = 200;

export class DynamoExtensionStore implements ExtensionStore {
  readonly id = 'dynamo-extensions';

  private readonly config: DynamoConfig;
  private readonly gateway: DynamoGateway;
  private readonly clock: Clock;

  constructor(options: DynamoExtensionOptions = {}) {
    this.config = options.config ?? dynamoConfigFromEnv();
    this.gateway = options.gateway ?? new DynamoGateway(this.config);
    this.clock = options.clock ?? new SystemClock();
  }

  private get table(): string {
    return this.config.table;
  }

  /** Writes one listing row so a kind can be listed without a scan. */
  private async row(partition: string, entity: EntityKind, sortKey: string, value: unknown): Promise<void> {
    await this.gateway.put({ PK: partition, SK: `ROW#${sortKey}` }, entity, value);
  }

  /** Runs one gateway call, mapping every failure to `upstream`. */
  private async safely<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw upstream(`dynamo extensions: ${operation} failed: ${(error as Error).message}`, { operation });
    }
  }

  /* -------------------------------------------------------------- shares */

  async putShare(share: ShareGrant): Promise<void> {
    await this.safely('putShare', async () => {
      await this.gateway.put(shareKeys(share.token), 'SHARE', share);
      await this.row(EXTENSION_PARTITION.shares, 'SHARE', share.token, share);
    });
  }

  async getShare(token: string): Promise<ShareGrant | null> {
    return this.safely('getShare', async () => payloadOf<ShareGrant>(await this.gateway.get(shareKeys(token))));
  }

  async listShares(filter: {
    packId?: string;
    frameworkId?: string;
    active?: boolean;
    now?: string;
  } = {}): Promise<ShareGrant[]> {
    const now = filter.now ?? this.clock.now();
    return this.safely('listShares', async () => {
      const rows = await this.gateway.query(
        QUERY_TARGETS.primary,
        EXTENSION_PARTITION.shares,
        { limit: DEFAULT_LIMIT }
      );
      return rows
        .map((row) => payloadOf<ShareGrant>(row))
        .filter((share): share is ShareGrant => share !== null)
        .filter((share) => filter.packId === undefined || share.packId === filter.packId)
        .filter((share) => filter.frameworkId === undefined || share.frameworkId === filter.frameworkId)
        .filter((share) => filter.active === undefined || isShareActive(share, now) === filter.active)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    });
  }

  async touchShare(token: string, at: string): Promise<void> {
    await this.safely('touchShare', async () => {
      const current = payloadOf<ShareGrant>(await this.gateway.get(shareKeys(token)));
      if (current === null) return;
      const updated: ShareGrant = { ...current, useCount: current.useCount + 1, lastUsedAt: at };
      await this.gateway.put(shareKeys(token), 'SHARE', updated);
      await this.row(EXTENSION_PARTITION.shares, 'SHARE', token, updated);
    });
  }

  /* ------------------------------------------------------------ mappings */

  async putMapping(mapping: ControlMapping): Promise<void> {
    await this.safely('putMapping', async () => {
      await this.gateway.put(mappingKeys(mapping.id), 'MAPPING', mapping);
      await this.row(EXTENSION_PARTITION.mappings, 'MAPPING', `${mapping.proposedAt}#${mapping.id}`, mapping);
    });
  }

  async getMapping(id: string): Promise<ControlMapping | null> {
    return this.safely('getMapping', async () => payloadOf<ControlMapping>(await this.gateway.get(mappingKeys(id))));
  }

  async listMappings(filter: {
    status?: ControlMapping['status'];
    sourceFrameworkId?: string;
    targetFrameworkId?: string;
    controlId?: string;
  } = {}): Promise<ControlMapping[]> {
    return this.safely('listMappings', async () => {
      const rows = await this.gateway.query(
        QUERY_TARGETS.primary,
        EXTENSION_PARTITION.mappings,
        { limit: DEFAULT_LIMIT }
      );
      return sortMappings(
        rows
          .map((row) => payloadOf<ControlMapping>(row))
          .filter((mapping): mapping is ControlMapping => mapping !== null)
          .filter((mapping) => filter.status === undefined || mapping.status === filter.status)
          .filter(
            (mapping) =>
              filter.sourceFrameworkId === undefined || mapping.sourceFrameworkId === filter.sourceFrameworkId
          )
          .filter(
            (mapping) =>
              filter.targetFrameworkId === undefined || mapping.targetFrameworkId === filter.targetFrameworkId
          )
          .filter(
            (mapping) =>
              filter.controlId === undefined ||
              mapping.sourceControlId === filter.controlId ||
              mapping.targetControlId === filter.controlId
          )
      );
    });
  }

  /* -------------------------------------------------------------- drifts */

  async putDrift(event: DriftEvent): Promise<void> {
    await this.safely('putDrift', async () => {
      await this.gateway.put(driftKeys(event.id), 'DRIFT', event);
      await this.row(EXTENSION_PARTITION.drifts, 'DRIFT', `${event.detectedAt}#${event.id}`, event);
    });
  }

  async listDrifts(filter: {
    controlId?: string;
    frameworkId?: string;
    acknowledged?: boolean;
    limit?: number;
  } = {}): Promise<DriftEvent[]> {
    return this.safely('listDrifts', async () => {
      const rows = await this.gateway.query(
        QUERY_TARGETS.primary,
        EXTENSION_PARTITION.drifts,
        { limit: DEFAULT_LIMIT }
      );
      return rows
        .map((row) => payloadOf<DriftEvent>(row))
        .filter((event): event is DriftEvent => event !== null)
        .filter((event) => filter.controlId === undefined || event.controlId === filter.controlId)
        .filter((event) => filter.frameworkId === undefined || event.frameworkId === filter.frameworkId)
        .filter(
          (event) =>
            filter.acknowledged === undefined || (event.acknowledgedAt !== null) === filter.acknowledged
        )
        .sort((left, right) => right.detectedAt.localeCompare(left.detectedAt))
        .slice(0, filter.limit ?? DEFAULT_LIMIT);
    });
  }

  async acknowledgeDrift(id: string, by: string, at: string): Promise<DriftEvent | null> {
    return this.safely('acknowledgeDrift', async () => {
      const current = payloadOf<DriftEvent>(await this.gateway.get(driftKeys(id)));
      if (current === null) return null;
      const updated: DriftEvent = { ...current, acknowledgedAt: at, acknowledgedBy: by };
      await this.gateway.put(driftKeys(id), 'DRIFT', updated);
      await this.row(EXTENSION_PARTITION.drifts, 'DRIFT', `${updated.detectedAt}#${id}`, updated);
      return updated;
    });
  }

  /* ------------------------------------------------------------- quality */

  async recordQuality(record: QualityRecord): Promise<void> {
    const key = subjectKey(record.subject);
    await this.safely('recordQuality', async () => {
      await this.gateway.put(qualityKeys(key, record.measuredAt, record.id), 'QUALITY', record);
      await this.row(EXTENSION_PARTITION.quality, 'QUALITY', `${record.measuredAt}#${record.id}`, record);
    });
  }

  async listQuality(filter: {
    subjectKey?: string;
    metric?: QualityRecord['metric'];
    limit?: number;
  } = {}): Promise<QualityRecord[]> {
    return this.safely('listQuality', async () => {
      const partition = filter.subjectKey === undefined
        ? EXTENSION_PARTITION.quality
        : `QUALITY#${filter.subjectKey}`;
      const rows: DynamoItem[] = await this.gateway.query(QUERY_TARGETS.primary, partition, { limit: DEFAULT_LIMIT });
      return rows
        .map((row) => payloadOf<QualityRecord>(row))
        .filter((record): record is QualityRecord => record !== null)
        .filter((record) => filter.metric === undefined || record.metric === filter.metric)
        .sort((left, right) => right.measuredAt.localeCompare(left.measuredAt))
        .slice(0, filter.limit ?? DEFAULT_LIMIT);
    });
  }

  /* ------------------------------------------------------- verifications */

  async recordVerification(result: VerificationResult): Promise<void> {
    await this.safely('recordVerification', async () => {
      await this.gateway.put(verificationKeys(result.packId, result.verifiedAt), 'VERIFICATION', result);
      await this.row(
        EXTENSION_PARTITION.verifications,
        'VERIFICATION',
        `${result.verifiedAt}#${result.packId}`,
        result
      );
    });
  }

  async listVerifications(filter: { packId?: string; limit?: number } = {}): Promise<VerificationResult[]> {
    return this.safely('listVerifications', async () => {
      const rows = await this.gateway.query(
        QUERY_TARGETS.primary,
        EXTENSION_PARTITION.verifications,
        { limit: DEFAULT_LIMIT }
      );
      return rows
        .map((row) => payloadOf<VerificationResult>(row))
        .filter((result): result is VerificationResult => result !== null)
        .filter((result) => filter.packId === undefined || result.packId === filter.packId)
        .sort((left, right) => right.verifiedAt.localeCompare(left.verifiedAt))
        .slice(0, filter.limit ?? DEFAULT_LIMIT);
    });
  }
}

/** Mappings sorted newest first, ties broken by id so listings are stable. */
function sortMappings(mappings: ControlMapping[]): ControlMapping[] {
  return mappings.sort(
    (left, right) => right.proposedAt.localeCompare(left.proposedAt) || left.id.localeCompare(right.id)
  );
}

