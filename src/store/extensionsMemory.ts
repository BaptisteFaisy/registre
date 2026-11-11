/**
 * In-memory `ExtensionStore` — shares, mappings, drifts, measured quality and
 * the verification log.
 *
 * One implementation for all five, because they share the same needs: a map,
 * deterministic ordering, and clones on the way out so a caller cannot mutate
 * the store by holding a reference. The DynamoDB twin lives in
 * `src/store/extensionsDynamo.ts` and implements the same port.
 */

import type { ExtensionStore } from '../ports/index.ts';
import type { ControlMapping } from '../domain/mapping.ts';
import type { DriftEvent, QualityRecord } from '../domain/quality.ts';
import { subjectKey } from '../domain/quality.ts';
import type { ShareGrant, VerificationResult } from '../domain/verification.ts';
import { isShareActive } from '../domain/verification.ts';
import type { Clock } from '../ports/index.ts';
import { SystemClock } from '../support/clock.ts';
import { notFound } from '../support/errors.ts';

export interface MemoryExtensionStoreOptions {
  clock?: Clock;
}

/** Default page size of the listing methods. */
const DEFAULT_LIMIT = 200;

export class MemoryExtensionStore implements ExtensionStore {
  readonly id = 'memory-extensions';

  private readonly clock: Clock;
  private readonly shares = new Map<string, ShareGrant>();
  private readonly mappings = new Map<string, ControlMapping>();
  private readonly drifts = new Map<string, DriftEvent>();
  private readonly quality: QualityRecord[] = [];
  private readonly verifications: VerificationResult[] = [];

  constructor(options: MemoryExtensionStoreOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
  }

  /* -------------------------------------------------------------- shares */

  async putShare(share: ShareGrant): Promise<void> {
    this.shares.set(share.token, structuredClone(share));
  }

  async getShare(token: string): Promise<ShareGrant | null> {
    const found = this.shares.get(token);
    return found === undefined ? null : structuredClone(found);
  }

  async listShares(filter: {
    packId?: string;
    frameworkId?: string;
    active?: boolean;
    now?: string;
  } = {}): Promise<ShareGrant[]> {
    const now = filter.now ?? this.clock.now();
    const all = [...this.shares.values()];
    return all
      .filter((share) => filter.packId === undefined || share.packId === filter.packId)
      .filter((share) => filter.frameworkId === undefined || share.frameworkId === filter.frameworkId)
      .filter((share) => filter.active === undefined || isShareActive(share, now) === filter.active)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((share) => structuredClone(share));
  }

  async touchShare(token: string, at: string): Promise<void> {
    const share = this.shares.get(token);
    if (share === undefined) throw notFound(`unknown share token`);
    share.useCount += 1;
    share.lastUsedAt = at;
  }

  /* ------------------------------------------------------------ mappings */

  async putMapping(mapping: ControlMapping): Promise<void> {
    this.mappings.set(mapping.id, structuredClone(mapping));
  }

  async getMapping(id: string): Promise<ControlMapping | null> {
    const found = this.mappings.get(id);
    return found === undefined ? null : structuredClone(found);
  }

  async listMappings(filter: {
    status?: ControlMapping['status'];
    sourceFrameworkId?: string;
    targetFrameworkId?: string;
    controlId?: string;
  } = {}): Promise<ControlMapping[]> {
    return [...this.mappings.values()]
      .filter((mapping) => filter.status === undefined || mapping.status === filter.status)
      .filter((mapping) => filter.sourceFrameworkId === undefined || mapping.sourceFrameworkId === filter.sourceFrameworkId)
      .filter((mapping) => filter.targetFrameworkId === undefined || mapping.targetFrameworkId === filter.targetFrameworkId)
      .filter(
        (mapping) =>
          filter.controlId === undefined ||
          mapping.sourceControlId === filter.controlId ||
          mapping.targetControlId === filter.controlId
      )
      .sort((left, right) => right.proposedAt.localeCompare(left.proposedAt) || left.id.localeCompare(right.id))
      .map((mapping) => structuredClone(mapping));
  }

  /* -------------------------------------------------------------- drifts */

  async putDrift(event: DriftEvent): Promise<void> {
    this.drifts.set(event.id, structuredClone(event));
  }

  async listDrifts(filter: {
    controlId?: string;
    frameworkId?: string;
    acknowledged?: boolean;
    limit?: number;
  } = {}): Promise<DriftEvent[]> {
    const limit = filter.limit ?? DEFAULT_LIMIT;
    return [...this.drifts.values()]
      .filter((event) => filter.controlId === undefined || event.controlId === filter.controlId)
      .filter((event) => filter.frameworkId === undefined || event.frameworkId === filter.frameworkId)
      .filter(
        (event) =>
          filter.acknowledged === undefined ||
          (event.acknowledgedAt !== null) === filter.acknowledged
      )
      .sort((left, right) => right.detectedAt.localeCompare(left.detectedAt))
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }

  async acknowledgeDrift(id: string, by: string, at: string): Promise<DriftEvent | null> {
    const event = this.drifts.get(id);
    if (event === undefined) return null;
    event.acknowledgedAt = at;
    event.acknowledgedBy = by;
    return structuredClone(event);
  }

  /* ------------------------------------------------------------- quality */

  async recordQuality(record: QualityRecord): Promise<void> {
    this.quality.push(structuredClone(record));
  }

  async listQuality(filter: {
    subjectKey?: string;
    metric?: QualityRecord['metric'];
    limit?: number;
  } = {}): Promise<QualityRecord[]> {
    const limit = filter.limit ?? DEFAULT_LIMIT;
    return this.quality
      .filter((record) => filter.metric === undefined || record.metric === filter.metric)
      .filter((record) => filter.subjectKey === undefined || subjectKey(record.subject) === filter.subjectKey)
      .sort((left, right) => right.measuredAt.localeCompare(left.measuredAt))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  /* ------------------------------------------------------- verifications */

  async recordVerification(result: VerificationResult): Promise<void> {
    this.verifications.push(structuredClone(result));
  }

  async listVerifications(filter: { packId?: string; limit?: number } = {}): Promise<VerificationResult[]> {
    const limit = filter.limit ?? DEFAULT_LIMIT;
    return this.verifications
      .filter((result) => filter.packId === undefined || result.packId === filter.packId)
      .sort((left, right) => right.verifiedAt.localeCompare(left.verifiedAt))
      .slice(0, limit)
      .map((result) => structuredClone(result));
  }
}

/** Factory used by `src/bootstrap.ts`. */
export function createMemoryExtensions(options: MemoryExtensionStoreOptions = {}): ExtensionStore {
  return new MemoryExtensionStore(options);
}
