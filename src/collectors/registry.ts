/**
 * Collector registry — "collectors are replaceable: one interface per source
 * type" (chapter 7, ENF-REP-01).
 *
 * The registry is what the scheduler enumerates and what the portal shows in the
 * administration screen: an id, a kind, and whether it is configured.
 */

import { conflict, notFound } from '../support/errors.ts';
import type { Collector } from './types.ts';

export class CollectorRegistry {
  private readonly collectors = new Map<string, Collector>();

  /** Adds a collector; an id can only be registered once. */
  register(collector: Collector): this {
    if (this.collectors.has(collector.id)) {
      throw conflict('collector registry: this id is already registered', { id: collector.id });
    }
    this.collectors.set(collector.id, collector);
    return this;
  }

  /** Adds or replaces a collector, for a reconfiguration from the portal. */
  upsert(collector: Collector): this {
    this.collectors.set(collector.id, collector);
    return this;
  }

  /** Removes one collector; returns false when the id was unknown. */
  remove(id: string): boolean {
    return this.collectors.delete(id);
  }

  /** Reads one collector, `null` when it is not registered. */
  get(id: string): Collector | null {
    return this.collectors.get(id) ?? null;
  }

  /** Reads one collector or throws `NOT_FOUND` (scheduler, API). */
  require(id: string): Collector {
    const collector = this.get(id);
    if (collector === null) throw notFound('collector registry: unknown collector', { id });
    return collector;
  }

  /** Every registered collector, ordered by id so runs are reproducible. */
  list(): Collector[] {
    return [...this.collectors.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Number of registered collectors. */
  get size(): number {
    return this.collectors.size;
  }
}

/** Builds a registry from a list, failing fast on a duplicated id. */
export function registryOf(collectors: readonly Collector[]): CollectorRegistry {
  const registry = new CollectorRegistry();
  for (const collector of collectors) registry.register(collector);
  return registry;
}
