/**
 * Pure display logic of the cross-framework mappings screen (axis 2).
 * No DOM, no React: unit-testable with `node --test`.
 */

import type { ControlMapping, MappingStatus, ReuseMetric } from '../api/types.ts';
import { formatPercent } from './format.ts';

export const MAPPING_STATUS_META: Record<MappingStatus, { label: string; color: string }> = {
  PROPOSED: { label: 'Proposed', color: '#db6d28' },
  VALIDATED: { label: 'Validated', color: '#3fb950' },
  REJECTED: { label: 'Rejected', color: '#8b949e' }
};

export function mappingStatusMeta(status: MappingStatus): { label: string; color: string } {
  return MAPPING_STATUS_META[status] ?? MAPPING_STATUS_META.PROPOSED;
}

/** Status filter options of the mappings screen (`ALL` keeps everything). */
export type MappingStatusFilter = MappingStatus | 'ALL';

export const MAPPING_FILTERS: ReadonlyArray<{ value: MappingStatusFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'PROPOSED', label: 'Proposed' },
  { value: 'VALIDATED', label: 'Validated' },
  { value: 'REJECTED', label: 'Rejected' }
];

/** Filters mappings by status; `ALL` (or no filter) keeps everything. */
export function filterMappings(
  mappings: readonly ControlMapping[],
  status: MappingStatusFilter = 'ALL'
): ControlMapping[] {
  return status === 'ALL'
    ? [...mappings]
    : mappings.filter((mapping) => mapping.status === status);
}

/**
 * Display order: what waits for a human decision first, then the strongest
 * confidence, then the identifier so the list never moves on its own.
 */
export function sortMappings(mappings: readonly ControlMapping[]): ControlMapping[] {
  const rank: Record<MappingStatus, number> = { PROPOSED: 0, VALIDATED: 1, REJECTED: 2 };
  return [...mappings].sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      b.confidence - a.confidence ||
      a.id.localeCompare(b.id)
  );
}

/** Colour of a model confidence: trusted green, cautious orange, weak red. */
export function confidenceColor(confidence: number): string {
  if (confidence >= 0.85) return '#3fb950';
  if (confidence >= 0.7) return '#d29922';
  return '#db6d28';
}

/** The reuse factor as a readable ratio, e.g. 1.45 -> "1.45 attachments per evidence". */
export function reuseFactorLabel(factor: number): string {
  if (!Number.isFinite(factor)) return '—';
  return `${factor.toFixed(2)} attachments per evidence`;
}

/** One sentence summarising what the framework gained from mappings. */
export function reuseSentence(metric: ReuseMetric): string {
  return (
    `${metric.attachmentCount} attachments rest on ${metric.evidenceCount} deposited ` +
    `evidence: ${metric.carriedAttachments} attachment(s) were carried over by a validated ` +
    `mapping, avoiding ${metric.avoidedDeposits} new deposit(s).`
  );
}

/** Headline counters of the reuse banner, in display order. */
export function reuseStats(metric: ReuseMetric): Array<{ label: string; value: string }> {
  return [
    { label: 'Reuse factor', value: metric.reuseFactor.toFixed(2) },
    { label: 'Deposits avoided', value: String(metric.avoidedDeposits) },
    { label: 'Carried attachments', value: String(metric.carriedAttachments) },
    { label: 'Validated mappings', value: String(metric.validatedMappings) },
    { label: 'Pending mappings', value: String(metric.pendingMappings) },
    { label: 'Evidence deposited', value: String(metric.evidenceCount) }
  ];
}

/** Direction label of a mapping, as reviewers read it. */
export function directionLabel(direction: ControlMapping['direction']): string {
  return direction === 'SOURCE_TO_TARGET' ? 'source → target' : 'target → source';
}

/** Confidence of a mapping as a percentage, e.g. 0.91 -> "91 %". */
export function mappingConfidenceLabel(confidence: number): string {
  return formatPercent(confidence, 0);
}
