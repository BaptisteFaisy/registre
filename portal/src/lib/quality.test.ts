import test from 'node:test';
import assert from 'node:assert/strict';

import {
  METRIC_META,
  TREND_SYMBOL,
  VERDICT_META,
  formatMetricValue,
  metricLabel,
  qualityRows,
  subjectLabel,
  thresholdNotice,
  trendDirection,
  trendIsGood
} from './quality.ts';
import type { QualityMetric, QualityReport, QualitySubjectRow } from '../api/types.ts';

function row(patch: Partial<QualitySubjectRow> = {}): QualitySubjectRow {
  return {
    subject: { kind: 'ATTACHMENT', modelId: 'claude-sonnet-4', promptVersion: 'v3' },
    metric: 'ACCEPTED_WITHOUT_CORRECTION',
    value: 0.81,
    target: 0.9,
    verdict: 'FAIL',
    trend: [0.92, 0.88, 0.81],
    measuredAt: '2026-11-10T02:00:00.000Z',
    ...patch
  };
}

function report(rows: QualitySubjectRow[], threshold = 1.01): QualityReport {
  return {
    subjects: rows,
    thresholdInEffect: threshold,
    trend: rows.flatMap((item) =>
      item.trend.map((value, index) => ({
        measuredAt: `2026-1${index + 1}-01T02:00:00.000Z`,
        subjectKey: `${item.subject.kind}:${item.subject.modelId}:${item.subject.promptVersion}`,
        metric: item.metric,
        value,
        verdict: value >= item.target ? ('PASS' as const) : ('FAIL' as const)
      }))
    )
  };
}

test('every metric has a label, a direction and a meaning', () => {
  const metrics = Object.keys(METRIC_META) as QualityMetric[];
  assert.equal(metrics.length, 6);
  for (const metric of metrics) {
    assert.ok(metricLabel(metric).length > 3, `label of ${metric}`);
    assert.ok(METRIC_META[metric].description.length > 20, `description of ${metric}`);
    assert.equal(typeof METRIC_META[metric].higherIsBetter, 'boolean');
  }
});

test('ratios render as percentages, "must be zero" metrics as counts', () => {
  assert.equal(formatMetricValue('FIELD_ACCURACY', 0.942), '94.2 %');
  assert.equal(formatMetricValue('INVENTED_ANSWERS', 0), '0');
  assert.equal(formatMetricValue('WRONG_HIGH_CONFIDENCE', 0), '0.0 %');
});

test('a subject reads as kind, model and prompt version', () => {
  assert.equal(
    subjectLabel({ kind: 'ATTACHMENT', modelId: 'claude-sonnet-4', promptVersion: 'v3' }),
    'Attachment · claude-sonnet-4 · prompt v3'
  );
});

test('the trend direction compares the last two measurements', () => {
  assert.equal(trendDirection([0.9, 0.8]), 'DOWN');
  assert.equal(trendDirection([0.8, 0.9]), 'UP');
  assert.equal(trendDirection([0.9, 0.9]), 'FLAT');
  assert.equal(trendDirection([0.9]), 'FLAT');
  assert.equal(trendDirection([]), 'FLAT');
  assert.equal(TREND_SYMBOL.DOWN, '↓');
});

test('good news depends on the metric direction', () => {
  assert.equal(trendIsGood('ACCEPTED_WITHOUT_CORRECTION', 'UP'), true);
  assert.equal(trendIsGood('ACCEPTED_WITHOUT_CORRECTION', 'DOWN'), false);
  assert.equal(trendIsGood('INVENTED_ANSWERS', 'DOWN'), true);
  assert.equal(trendIsGood('INVENTED_ANSWERS', 'UP'), false);
});

test('the report turns into one table row per subject × metric', () => {
  const rows = qualityRows(
    report([
      row(),
      row({
        subject: { kind: 'READING', modelId: 'bedrock-data-automation', promptVersion: 'v7' },
        metric: 'FIELD_ACCURACY',
        value: 0.96,
        verdict: 'PASS',
        trend: [0.93, 0.96]
      })
    ])
  );
  assert.equal(rows.length, 2);
  const first = rows[0];
  assert.ok(first);
  assert.equal(first.metric, 'ACCEPTED_WITHOUT_CORRECTION');
  assert.equal(first.metricLabel, 'Accepted without correction');
  assert.equal(first.valueLabel, '81.0 %');
  assert.equal(first.targetLabel, '90.0 %');
  assert.equal(first.verdict, 'FAIL');
  assert.equal(first.trend, 'DOWN');
  assert.equal(first.trendGood, false);
  assert.equal(first.promptVersion, 'v3');
  assert.equal(VERDICT_META.FAIL.label, 'Below target');
  // Keys are unique per subject × metric.
  assert.equal(new Set(rows.map((item) => item.key)).size, rows.length);
});

test('below target, the notice explains the all-human degradation', () => {
  const notice = thresholdNotice(report([row()], 1.01));
  assert.match(notice, /1\.01/);
  assert.match(notice, /above every confidence/);
  assert.match(notice, /validation queue/);
  assert.match(notice, /human/);
});

test('on target, the notice explains the configured threshold', () => {
  const passing = row({ value: 0.94, verdict: 'PASS', trend: [0.9, 0.94] });
  const notice = thresholdNotice(report([passing], 0.85));
  assert.match(notice, /0\.85/);
  assert.match(notice, /on target/i);
  assert.match(notice, /rises above 1/);
});
