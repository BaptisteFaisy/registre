/**
 * Pure display logic of machine-attestation drifts (axis 3a).
 * No DOM, no React: unit-testable with `node --test`.
 */

import type { DriftEvent, DriftKind } from '../api/types.ts';

export interface DriftMeta {
  label: string;
  color: string;
  description: string;
}

export const DRIFT_KIND_META: Record<DriftKind, DriftMeta> = {
  STATE_CHANGED: {
    label: 'State changed',
    color: '#d29922',
    description: 'The observed state differs from the previous attestation.'
  },
  MISSING_RUN: {
    label: 'Missing run',
    color: '#f85149',
    description: 'No attestation arrived within the cadence plus its grace period.'
  },
  THRESHOLD_CROSSED: {
    label: 'Threshold crossed',
    color: '#db6d28',
    description: 'The attested state names a failed run or a crossed limit.'
  },
  RECOVERED: {
    label: 'Recovered',
    color: '#3fb950',
    description: 'The observed state returned to its earlier value.'
  }
};

export function driftMeta(kind: DriftKind): DriftMeta {
  return DRIFT_KIND_META[kind] ?? DRIFT_KIND_META.STATE_CHANGED;
}

/** Newest detection first; equal timestamps fall back to the id. */
export function sortDrifts(events: readonly DriftEvent[]): DriftEvent[] {
  return [...events].sort(
    (a, b) => b.detectedAt.localeCompare(a.detectedAt) || a.id.localeCompare(b.id)
  );
}

/** Drifts nobody acknowledged yet. */
export function openDrifts(events: readonly DriftEvent[]): DriftEvent[] {
  return sortDrifts(events.filter((event) => event.acknowledgedAt === null));
}

/** The `limit` most recent drifts, newest first. */
export function latestDrifts(events: readonly DriftEvent[], limit: number): DriftEvent[] {
  return sortDrifts(events).slice(0, limit);
}

/** "OK → FAILED"; a first observation has no previous value. */
export function driftTransition(previous: string | null, current: string | null): string {
  if (previous === null && current === null) return 'no value';
  if (previous === null) return `first observation: ${current}`;
  if (current === null) return `${previous} → no value`;
  return `${previous} → ${current}`;
}
