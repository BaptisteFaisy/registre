/**
 * Pure display logic of the measured-quality screen (bonus axis).
 * No DOM, no React: unit-testable with `node --test`.
 */

import type {
  QualityMetric,
  QualityReport,
  QualitySubject,
  QualitySubjectRow,
  QualityVerdict
} from '../api/types.ts';
import { formatPercent } from './format.ts';

export interface MetricMeta {
  label: string;
  /** True when a higher value is a better value. */
  higherIsBetter: boolean;
  /** True for the two "must be zero" count metrics. */
  count: boolean;
  /** One-line meaning, shown under the label. */
  description: string;
}

export const METRIC_META: Record<QualityMetric, MetricMeta> = {
  FIELD_ACCURACY: {
    label: 'Field accuracy',
    higherIsBetter: true,
    count: false,
    description: 'Share of extracted fields that match the ground truth.'
  },
  ACCEPTED_WITHOUT_CORRECTION: {
    label: 'Accepted without correction',
    higherIsBetter: true,
    count: false,
    description: 'Share of attachments a human accepted exactly as proposed.'
  },
  WRONG_HIGH_CONFIDENCE: {
    label: 'Wrong with high confidence',
    higherIsBetter: false,
    count: false,
    description: 'Share of confident proposals that turned out wrong — must stay at zero.'
  },
  GAPS_DETECTED: {
    label: 'Gaps detected',
    higherIsBetter: true,
    count: false,
    description: 'Share of real insufficiencies the sufficiency check caught.'
  },
  CITATION_ACCURACY: {
    label: 'Citation accuracy',
    higherIsBetter: true,
    count: false,
    description: 'Share of quoted passages really present in the document.'
  },
  INVENTED_ANSWERS: {
    label: 'Invented answers',
    higherIsBetter: false,
    count: true,
    description: 'Answers stated without any supporting evidence — must stay at zero.'
  }
};

export function metricLabel(metric: QualityMetric): string {
  return (METRIC_META[metric] ?? { label: metric }).label;
}

export const VERDICT_META: Record<QualityVerdict, { label: string; color: string }> = {
  PASS: { label: 'On target', color: '#3fb950' },
  FAIL: { label: 'Below target', color: '#f85149' },
  UNKNOWN: { label: 'Unknown', color: '#8b949e' }
};

/** Reads a subject as "Attachment · claude-sonnet-4 · prompt v3". */
export function subjectLabel(subject: QualitySubject): string {
  return `${subject.kind.charAt(0)}${subject.kind.slice(1).toLowerCase()} · ${subject.modelId} · prompt ${subject.promptVersion}`;
}

/** Formats a metric value: percentages for ratios, plain integers for counts. */
export function formatMetricValue(metric: QualityMetric, value: number): string {
  const meta = METRIC_META[metric];
  if (!meta || meta.count) return String(Math.round(value));
  return formatPercent(value, 1);
}

export type TrendDirection = 'UP' | 'DOWN' | 'FLAT';

export const TREND_SYMBOL: Record<TrendDirection, string> = {
  UP: '↑',
  DOWN: '↓',
  FLAT: '→'
};

/** Direction of the last movement of a value series (last two points). */
export function trendDirection(values: readonly number[]): TrendDirection {
  if (values.length < 2) return 'FLAT';
  const last = values[values.length - 1] ?? 0;
  const previous = values[values.length - 2] ?? 0;
  if (last > previous) return 'UP';
  if (last < previous) return 'DOWN';
  return 'FLAT';
}

/** True when the movement is good news for this metric. */
export function trendIsGood(metric: QualityMetric, direction: TrendDirection): boolean {
  const meta = METRIC_META[metric];
  if (!meta || direction === 'FLAT') return direction === 'FLAT';
  return meta.higherIsBetter ? direction === 'UP' : direction === 'DOWN';
}

/** One row of the quality table, ready to render. */
export interface QualityTableRow {
  key: string;
  subjectLabel: string;
  promptVersion: string;
  metric: QualityMetric;
  metricLabel: string;
  value: number;
  target: number;
  valueLabel: string;
  targetLabel: string;
  verdict: QualityVerdict;
  /** Raw values of the series, oldest first — drawn by the trend chart. */
  trendValues: number[];
  trend: TrendDirection;
  trendSymbol: string;
  trendGood: boolean;
  measuredAt: string;
}

/** Turns the report into table rows, one per subject × metric. */
export function qualityRows(report: QualityReport): QualityTableRow[] {
  return report.subjects.map((row: QualitySubjectRow) => {
    const direction = trendDirection(row.trend);
    return {
      key: `${subjectKeyOf(row)}·${row.metric}`,
      subjectLabel: subjectLabel(row.subject),
      promptVersion: row.subject.promptVersion,
      metric: row.metric,
      metricLabel: metricLabel(row.metric),
      value: row.value,
      target: row.target,
      valueLabel: formatMetricValue(row.metric, row.value),
      targetLabel: formatMetricValue(row.metric, row.target),
      verdict: row.verdict,
      trendValues: row.trend,
      trend: direction,
      trendSymbol: TREND_SYMBOL[direction],
      trendGood: trendIsGood(row.metric, direction),
      measuredAt: row.measuredAt
    };
  });
}

function subjectKeyOf(row: QualitySubjectRow): string {
  return `${row.subject.kind}:${row.subject.modelId}:${row.subject.promptVersion}`;
}

/**
 * The self-grading argument, in one readable sentence: below target, the
 * threshold in effect rises above 1, so nothing is auto-applied any more.
 */
export function thresholdNotice(report: QualityReport): string {
  if (report.thresholdInEffect > 1) {
    return (
      `A measured metric is below its target, so the confidence threshold in effect is ` +
      `${report.thresholdInEffect.toFixed(2)} — above every confidence a model can return. ` +
      `Auto-application is off: every proposal now goes to the validation queue until a ` +
      `human decides, and stays there until a new measurement passes.`
    );
  }
  return (
    `Every measured metric is on target, so the configured threshold ` +
    `(${report.thresholdInEffect.toFixed(2)}) is in effect: proposals above it are applied, ` +
    `everything below goes to a human. Drop under a target and the threshold rises above 1 — ` +
    `the system degrades to all-human, never to all-automatic.`
  );
}
