/**
 * In-memory `AuditSink` — append-only action log chained by fingerprint
 * (ENF-INT-02, EF-ADM-02).
 *
 * Every event is sealed against the previous one by `auditChain.ts`, so the log
 * is tamper-evident: `verifyChain()` reports the first altered sequence.
 * Used by the demo, the tests and the evaluation harness.
 */

import type { AuditAction, AuditEvent } from '../domain/types.ts';
import type { AuditSink, Clock } from '../ports/index.ts';
import { SystemClock } from '../support/clock.ts';
import { GENESIS_HASH, sealEvent, verifyEvents } from './auditChain.ts';
import type { ChainVerification } from './auditChain.ts';

export interface InMemoryAuditSinkOptions {
  clock?: Clock;
}

export class InMemoryAuditSink implements AuditSink {
  readonly id = 'memory-audit';

  private readonly clock: Clock;
  private events: AuditEvent[] = [];

  /** Builds an empty chain; `clock` stamps every appended event. */
  constructor(options: InMemoryAuditSinkOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
  }

  /** Appends one sealed event; `prevHash` is the last hash of the chain. */
  async append(input: {
    actor: string;
    action: AuditAction;
    objectType: string;
    objectId: string;
    detail?: Record<string, unknown>;
  }): Promise<AuditEvent> {
    const previous = this.events[this.events.length - 1];
    const event = sealEvent(
      {
        seq: this.events.length + 1,
        at: this.clock.now(),
        actor: input.actor,
        action: input.action,
        objectType: input.objectType,
        objectId: input.objectId,
        detail: input.detail
      },
      previous?.hash ?? GENESIS_HASH
    );
    this.events.push(event);
    return structuredClone(event);
  }

  /**
   * Reads the log, most recent first. `limit` keeps the last N events before
   * ordering; `action` and `objectId` filter.
   */
  async list(filter: { limit?: number; action?: AuditAction; objectId?: string } = {}): Promise<AuditEvent[]> {
    const selected = this.events.filter(
      (event) =>
        (filter.action === undefined || event.action === filter.action) &&
        (filter.objectId === undefined || event.objectId === filter.objectId)
    );
    const tail = filter.limit === undefined ? selected : selected.slice(-filter.limit);
    return tail.slice().reverse().map((event) => structuredClone(event));
  }

  /** Verifies the whole chain and returns the first broken sequence (ENF-INT-02). */
  async verifyChain(): Promise<ChainVerification> {
    return verifyEvents(this.events);
  }

  /** Read-only view of the raw log, oldest first (tests, exports, packs). */
  entries(): readonly AuditEvent[] {
    return this.events;
  }
}
