/**
 * DynamoDB `AuditSink` — the append-only, hash-chained action log (ENF-INT-02,
 * EF-ADM-02).
 *
 * Append is a two-step optimistic write: read the tail of the chain, seal the
 * new event against it, then write with `attribute_not_exists(PK)`. If another
 * writer took the same sequence number, the write is retried with the new tail,
 * so the chain never forks and no event is ever overwritten.
 */

import type { AuditAction, AuditEvent } from '../domain/types.ts';
import type { AuditSink, Clock } from '../ports/index.ts';
import { SystemClock } from '../support/clock.ts';
import { upstream } from '../support/errors.ts';
import { GENESIS_HASH, sealEvent, verifyEvents } from './auditChain.ts';
import type { ChainVerification } from './auditChain.ts';
import { DynamoGateway, payloadOf } from './dynamoClient.ts';
import { auditKeys, dynamoConfigFromEnv, QUERY_TARGETS } from './dynamoKeys.ts';
import type { DynamoConfig, DynamoItem } from './dynamoKeys.ts';

const AUDIT_PK = 'AUDIT';
const MAX_APPEND_ATTEMPTS = 5;
const MAX_LIST_PAGES = 20;
const DEFAULT_PAGE = 100;

export class DynamoAuditSink implements AuditSink {
  readonly id = 'dynamo-audit';

  private readonly db: DynamoGateway;
  private readonly clock: Clock;

  /** Builds the sink from the environment; the SDK is imported on first use. */
  constructor(config: DynamoConfig = dynamoConfigFromEnv(), clock: Clock = new SystemClock()) {
    this.db = new DynamoGateway(config);
    this.clock = clock;
  }

  /** Appends one sealed event, retrying when another writer took the slot. */
  async append(input: {
    actor: string;
    action: AuditAction;
    objectType: string;
    objectId: string;
    detail?: Record<string, unknown>;
  }): Promise<AuditEvent> {
    for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt += 1) {
      const last = await this.lastEvent();
      const event = sealEvent(
        {
          seq: (last?.seq ?? 0) + 1,
          at: this.clock.now(),
          actor: input.actor,
          action: input.action,
          objectType: input.objectType,
          objectId: input.objectId,
          detail: input.detail
        },
        last?.hash ?? GENESIS_HASH
      );
      const written = await this.db.putIfAbsent(auditKeys(event.seq), 'AUDIT', event);
      if (written) return event;
    }
    throw upstream('audit: unable to append, the chain is contended');
  }

  /** Reads the log, most recent first, filtering on action and object. */
  async list(filter: { limit?: number; action?: AuditAction; objectId?: string } = {}): Promise<AuditEvent[]> {
    const wanted = filter.limit ?? DEFAULT_PAGE;
    const matches: AuditEvent[] = [];
    let start: Record<string, string> | undefined;
    for (let page = 0; page < MAX_LIST_PAGES && matches.length < wanted; page += 1) {
      const items = await this.db.query(QUERY_TARGETS.primary, AUDIT_PK, {
        descending: true,
        limit: DEFAULT_PAGE,
        ...(start === undefined ? {} : { startKey: start })
      });
      if (items.length === 0) break;
      for (const item of items) {
        const event = payloadOf<AuditEvent>(item);
        if (event === null) continue;
        if (filter.action !== undefined && event.action !== filter.action) continue;
        if (filter.objectId !== undefined && event.objectId !== filter.objectId) continue;
        matches.push(event);
      }
      start = pageKey(items);
      if (start === undefined) break;
    }
    return matches.slice(0, wanted);
  }

  /** Verifies the whole chain and reports the first broken sequence. */
  async verifyChain(): Promise<ChainVerification> {
    const items = await this.db.query(QUERY_TARGETS.primary, AUDIT_PK, { skPrefix: 'EVENT#' });
    const events = items.map((item) => payloadOf<AuditEvent>(item)).filter(isEvent);
    return verifyEvents(events);
  }

  /* ------------------------------------------------------------ private */

  private async lastEvent(): Promise<AuditEvent | null> {
    const items = await this.db.query(QUERY_TARGETS.primary, AUDIT_PK, { descending: true, limit: 1 });
    return items.length === 0 ? null : payloadOf<AuditEvent>(items[0]!);
  }
}

function isEvent(event: AuditEvent | null): event is AuditEvent {
  return event !== null;
}

/** Resume token of a page, built from the last item's keys. */
function pageKey(items: readonly DynamoItem[]): Record<string, string> | undefined {
  const last = items[items.length - 1];
  return last === undefined ? undefined : { PK: last.PK, SK: last.SK };
}

/** Primary key of the single audit partition, for exports. */
export const AUDIT_PARTITION = 'AUDIT';
