/**
 * In-memory cost meter and notifier — the offline halves of the two remaining
 * platform ports (ENF-COUT-01, EF-REL-01/02/03).
 *
 * `MemoryCostMeter` aggregates the `CostRecord`s every adapter reports;
 * `MemoryNotifier` captures the messages instead of sending them, which is what
 * the demo and the tests assert on.
 */

import type { CostRecord } from '../domain/types.ts';
import type { Clock, CostMeter, NotificationMessage, Notifier } from '../ports/index.ts';
import { SystemClock } from '../support/clock.ts';

/** Rounds to 6 decimals so summed floats stay readable in the portal. */
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export class MemoryCostMeter implements CostMeter {
  private readonly records: CostRecord[] = [];

  /** Records one adapter cost (ENF-COUT-01: cost per evidence is displayed). */
  record(cost: CostRecord): void {
    this.records.push({ ...cost });
  }

  /** Totals by adapter, plus the number of recorded calls. */
  report(): { totalUsd: number; bySource: Record<string, number>; count: number } {
    const bySource: Record<string, number> = {};
    let totalUsd = 0;
    for (const record of this.records) {
      totalUsd += record.usd;
      bySource[record.source] = round6((bySource[record.source] ?? 0) + record.usd);
    }
    return { totalUsd: round6(totalUsd), bySource, count: this.records.length };
  }

  /** Every recorded cost, oldest first (used to build `CostReport`). */
  all(): CostRecord[] {
    return this.records.map((record) => ({ ...record }));
  }
}

export interface MemoryNotifierOptions {
  clock?: Clock;
  /** Prefix of the generated message ids, e.g. `nt`. */
  idPrefix?: string;
}

export class MemoryNotifier implements Notifier {
  readonly id = 'memory-notifier';

  private readonly clock: Clock;
  private readonly idPrefix: string;
  private messages: NotificationMessage[] = [];

  /** Builds an empty capture; `clock` stamps every receipt. */
  constructor(options: MemoryNotifierOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.idPrefix = options.idPrefix ?? 'nt';
  }

  /** Captures one message; deterministic id so demos replay identically. */
  async send(message: NotificationMessage): Promise<{ id: string; sentAt: string }> {
    this.messages.push(structuredClone(message));
    return { id: `${this.idPrefix}-${this.messages.length}`, sentAt: this.clock.now() };
  }

  /** Every message captured so far, oldest first (EF-REL-01/02/03 assertions). */
  sent(): NotificationMessage[] {
    return this.messages.map((message) => structuredClone(message));
  }

  /** Clears the capture, for a scenario that restarts counting. */
  clear(): void {
    this.messages = [];
  }
}
