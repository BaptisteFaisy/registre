/**
 * Measured quality — the system grades itself and degrades itself (spec 13.5,
 * bonus axis).
 *
 * Evaluation runs (local scorer or Bedrock evaluation jobs) produce metrics;
 * `recordEvaluation` turns them into `QualityRecord`s, persists them through
 * the `ExtensionStore` port and journalls every write (`QUALITY_RECORDED`).
 *
 * The records are not cosmetic: `attachmentThreshold` feeds the latest
 * `ACCEPTED_WITHOUT_CORRECTION` verdict into `effectiveConfidenceThreshold`,
 * and `src/pipeline/attach.ts` reads THAT value instead of the setting. A
 * failing measurement therefore stops auto-application entirely — every
 * attachment goes to the human validation queue until quality is measured
 * again above target. The doubt goes to verify, never to covered.
 *
 * `qualityReport` shapes what the quality screen displays: per subject and
 * per metric, the latest value, the target, the verdict, the trend, and the
 * confidence threshold in effect.
 */

import type { Services } from '../ports/index.ts';
import type {
  QualityMetric,
  QualityRecord,
  QualitySubject,
  QualityTrendPoint,
  QualityVerdict
} from '../domain/quality.ts';
import { effectiveConfidenceThreshold, subjectKey } from '../domain/quality.ts';
import { sha256Text } from '../support/hash.ts';
import { record } from '../audit/log.ts';

/** Metrics whose target is an absolute zero: any occurrence is a failure. */
export const ZERO_TARGET_METRICS: readonly QualityMetric[] = ['WRONG_HIGH_CONFIDENCE', 'INVENTED_ANSWERS'];

/** One metric measured for a subject, before id and verdict are computed. */
export interface QualityMeasurement {
  metric: QualityMetric;
  /** 0..1 for ratios, absolute count for the two "must be zero" metrics. */
  value: number;
  target: number;
  sampleCount: number;
  datasetVersion: string;
  /** Bedrock evaluation job id, `null` for a local scoring run. */
  jobId?: string | null;
}

/** What `recordEvaluation` receives: one subject, its measured metrics. */
export interface EvaluationInput {
  subject: QualitySubject;
  records: readonly QualityMeasurement[];
}

/** Filter accepted by `qualityTrend`, the shape of the store port. */
export interface QualityTrendFilter {
  subjectKey?: string;
  metric?: QualityMetric;
  limit?: number;
}

/** True for the metrics that must count zero occurrences. */
export function isZeroTargetMetric(metric: QualityMetric): boolean {
  return ZERO_TARGET_METRICS.includes(metric);
}

/** Verdict computed by code (ENF-IA-04): ratios `value >= target`, zeros `value === 0`. */
export function metricVerdict(metric: QualityMetric, value: number, target: number): QualityVerdict {
  if (isZeroTargetMetric(metric)) return value === 0 ? 'PASS' : 'FAIL';
  return value >= target ? 'PASS' : 'FAIL';
}

/** Deterministic id: one record per subject, metric and measurement instant. */
export function qualityRecordId(subject: QualitySubject, metric: QualityMetric, measuredAt: string): string {
  return `qr-${sha256Text(`${subjectKey(subject)}|${metric}|${measuredAt}`).slice(0, 12)}`;
}

/** Builds one complete record; id, verdict and instant are computed here. */
export function buildQualityRecord(
  subject: QualitySubject,
  measurement: QualityMeasurement,
  measuredAt: string
): QualityRecord {
  return {
    id: qualityRecordId(subject, measurement.metric, measuredAt),
    measuredAt,
    subject,
    metric: measurement.metric,
    value: measurement.value,
    target: measurement.target,
    sampleCount: measurement.sampleCount,
    datasetVersion: measurement.datasetVersion,
    jobId: measurement.jobId ?? null,
    verdict: metricVerdict(measurement.metric, measurement.value, measurement.target)
  };
}

/**
 * Persists and journalls one evaluation batch (EF-QUA-01, spec 13.5).
 * Returns the complete records, in input order.
 */
export async function recordEvaluation(services: Services, input: EvaluationInput): Promise<QualityRecord[]> {
  const measuredAt = services.clock.now();
  const built = input.records.map((measurement) => buildQualityRecord(input.subject, measurement, measuredAt));
  for (const qualityRecord of built) {
    await services.extensions.recordQuality(qualityRecord);
    await record(services, 'system', 'QUALITY_RECORDED', 'quality', qualityRecord.id, {
      subject: subjectKey(qualityRecord.subject),
      metric: qualityRecord.metric,
      value: qualityRecord.value,
      target: qualityRecord.target,
      verdict: qualityRecord.verdict
    });
  }
  return built;
}

/** Trend points, most recent first, grouped by subject key (EF-QUA-02). */
export async function qualityTrend(services: Services, filter: QualityTrendFilter = {}): Promise<QualityTrendPoint[]> {
  const records = await services.extensions.listQuality(filter);
  return records
    .map((entry) => ({
      measuredAt: entry.measuredAt,
      subjectKey: subjectKey(entry.subject),
      metric: entry.metric,
      value: entry.value,
      verdict: entry.verdict
    }))
    .sort(
      (left, right) =>
        right.measuredAt.localeCompare(left.measuredAt) ||
        left.subjectKey.localeCompare(right.subjectKey) ||
        left.metric.localeCompare(right.metric)
    );
}

/**
 * Confidence threshold actually applied to attachments (EF-QUA-03): the
 * configured setting while the latest measurement passes, an unreachable 1.01
 * as soon as it fails — nothing is auto-applied any more.
 */
export async function attachmentThreshold(services: Services): Promise<number> {
  return effectiveConfidenceThreshold(services.settings.confidenceThreshold, await services.extensions.listQuality());
}

/** Direction of a metric between two measurements; zero metrics improve by falling. */
export type QualityTrendDirection = 'improving' | 'stable' | 'degrading';

/** Classifies the movement between the two latest values of one metric. */
export function trendDirection(metric: QualityMetric, latest: number, previous: number | null): QualityTrendDirection {
  if (previous === null || latest === previous) return 'stable';
  const improved = isZeroTargetMetric(metric) ? latest < previous : latest > previous;
  return improved ? 'improving' : 'degrading';
}

/** One metric line of the quality screen. */
export interface QualityMetricLine {
  metric: QualityMetric;
  latestValue: number;
  target: number;
  verdict: QualityVerdict;
  trend: QualityTrendDirection;
  measuredAt: string;
  sampleCount: number;
}

/** One subject block of the quality screen. */
export interface QualitySubjectReport {
  subjectKey: string;
  subject: QualitySubject;
  metrics: QualityMetricLine[];
}

/** What the quality screen displays (EF-QUA-02). */
export interface QualityReport {
  generatedAt: string;
  thresholdInEffect: number;
  subjects: QualitySubjectReport[];
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item)) ?? [];
    group.push(item);
    groups.set(key(item), group);
  }
  return groups;
}

function metricLines(records: readonly QualityRecord[]): QualityMetricLine[] {
  const byMetric = groupBy(records, (entry) => entry.metric);
  return [...byMetric.values()].map((group) => {
    const sorted = [...group].sort((left, right) => right.measuredAt.localeCompare(left.measuredAt));
    const latest = sorted[0] as QualityRecord;
    const previous = sorted[1] ?? null;
    return {
      metric: latest.metric,
      latestValue: latest.value,
      target: latest.target,
      verdict: latest.verdict,
      trend: trendDirection(latest.metric, latest.value, previous === null ? null : previous.value),
      measuredAt: latest.measuredAt,
      sampleCount: latest.sampleCount
    };
  });
}

function subjectReports(records: readonly QualityRecord[]): QualitySubjectReport[] {
  const bySubject = groupBy(records, (entry) => subjectKey(entry.subject));
  return [...bySubject.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([key, group]) => ({
      subjectKey: key,
      subject: (group[0] as QualityRecord).subject,
      metrics: metricLines(group)
    }));
}

/** Latest value, target, verdict and trend per subject, plus the threshold. */
export async function qualityReport(services: Services): Promise<QualityReport> {
  const records = await services.extensions.listQuality();
  return {
    generatedAt: services.clock.now(),
    thresholdInEffect: effectiveConfidenceThreshold(services.settings.confidenceThreshold, records),
    subjects: subjectReports(records)
  };
}
