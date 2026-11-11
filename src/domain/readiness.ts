/**
 * Readiness aggregation — EF-FRA-03 and EF-FRA-04 (spec 4.1, 8.4).
 *
 * Counts and shares of every control state for one framework, the trend kept
 * over time, and the list of known gaps that goes into the audit pack.
 */

import type {
  ControlState,
  ControlStatus,
  FrameworkId,
  KnownGap,
  ReadinessSnapshot,
  ReadinessTrendPoint
} from './types.ts';
import { CONTROL_STATES } from './types.ts';
import { STATE_NOTE_TEXT } from './states.ts';

/** Zeroed counter for every control state — EF-FRA-03. */
export function emptyCounts(): Record<ControlState, number> {
  return { COVERED: 0, TO_RENEW: 0, TO_VERIFY: 0, EXPIRED: 0, NO_EVIDENCE: 0 };
}

/** Counts the controls of a framework by state — EF-FRA-03. */
export function countStates(statuses: readonly ControlStatus[]): Record<ControlState, number> {
  const counts = emptyCounts();
  for (const status of statuses) counts[status.state] += 1;
  return counts;
}

/** Share of the total, rounded to 4 decimals (0 when empty) — EF-FRA-03. */
export function shareOf(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 10_000) / 10_000;
}

/** Builds the readiness snapshot of one framework — EF-FRA-03. */
export function computeReadiness(
  frameworkId: FrameworkId,
  statuses: readonly ControlStatus[],
  now: string
): ReadinessSnapshot {
  const counts = countStates(statuses);
  const total = statuses.length;
  const shares = emptyCounts();
  for (const state of CONTROL_STATES) shares[state] = shareOf(counts[state], total);
  return { frameworkId, computedAt: now, total, counts, shares };
}

/** One point of the readiness history, ready to be appended to the store — EF-FRA-04. */
export function computeTrendPoint(
  frameworkId: FrameworkId,
  statuses: readonly ControlStatus[],
  now: string
): ReadinessTrendPoint {
  return { frameworkId, at: now, counts: countStates(statuses) };
}

/** Direction of the covered count over the recorded history. */
export type TrendDirection = 'UP' | 'DOWN' | 'FLAT' | 'UNKNOWN';

/** Summary of a readiness history, oldest point first — EF-FRA-04. */
export interface TrendSummary {
  samples: number;
  from: ReadinessTrendPoint | null;
  to: ReadinessTrendPoint | null;
  coveredDelta: number;
  direction: TrendDirection;
}

/** Summarises a readiness history, oldest point first — EF-FRA-04. */
export function summariseTrend(points: readonly ReadinessTrendPoint[]): TrendSummary {
  if (points.length === 0) {
    return { samples: 0, from: null, to: null, coveredDelta: 0, direction: 'UNKNOWN' };
  }
  const from = points[0]!;
  const to = points[points.length - 1]!;
  const coveredDelta = to.counts.COVERED - from.counts.COVERED;
  return { samples: points.length, from, to, coveredDelta, direction: directionOf(coveredDelta) };
}

function directionOf(delta: number): TrendDirection {
  if (delta > 0) return 'UP';
  if (delta < 0) return 'DOWN';
  return 'FLAT';
}

/** Human-readable reason of a gap, built from the computed status — EF-FRA-03. */
export function gapDetail(status: ControlStatus): string {
  if (status.state === 'NO_EVIDENCE') return 'no applied evidence supports this control';
  if (status.state === 'EXPIRED') return `applied evidence expired on ${status.expiresAt ?? 'an unknown date'}`;
  if (status.state === 'TO_RENEW') return `best evidence expires on ${status.expiresAt ?? 'an unknown date'}`;
  if (status.state === 'TO_VERIFY') {
    return status.notes.length > 0 ? status.notes.map(noteText).join('; ') : 'evidence requires a human review';
  }
  return 'evidence is fresh and complete';
}

/** Turns a machine-readable note code into its sentence — EF-FRA-03. */
function noteText(note: string): string {
  return STATE_NOTE_TEXT[note] ?? note;
}

/**
 * Lists every control that is not COVERED, as known gaps of the audit pack —
 * EF-FRA-03 (spec 8.4 step 3).
 */
export function detectKnownGaps(statuses: readonly ControlStatus[]): KnownGap[] {
  return [...statuses]
    .filter((status) => status.state !== 'COVERED')
    .sort((a, b) => a.controlId.localeCompare(b.controlId))
    .map((status) => ({ controlId: status.controlId, state: status.state, detail: gapDetail(status) }));
}
