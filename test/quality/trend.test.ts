/**
 * Quality trend and report — points ordered from the most recent, grouped by
 * subject, and the improving / stable / degrading classification the quality
 * screen displays (bonus axis, spec 13.5).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityReport, qualityTrend, recordEvaluation, trendDirection } from '../../src/pipeline/quality.ts';
import type { QualityMeasurement } from '../../src/pipeline/quality.ts';
import type { QualitySubject } from '../../src/domain/quality.ts';
import { subjectKey } from '../../src/domain/quality.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { fakeServices } from '../pipeline/fakeServices.ts';
import type { FakeBundle } from '../pipeline/fakeServices.ts';

const ATTACHMENT_SUBJECT: QualitySubject = { kind: 'ATTACHMENT', modelId: 'm1', promptVersion: 'attachment-v1' };
const READING_SUBJECT: QualitySubject = { kind: 'READING', modelId: 'm1', promptVersion: 'reading-v1' };

function measurement(metric: QualityMeasurement['metric'], value: number, target: number): QualityMeasurement {
  return { metric, value, target, sampleCount: 10, datasetVersion: 'ds-test' };
}

/** Records one measurement per hour, starting at the bundle's frozen instant. */
async function recordSeries(
  services: FakeBundle,
  subject: QualitySubject,
  metric: QualityMeasurement['metric'],
  values: readonly number[],
  target: number
): Promise<void> {
  for (const [index, value] of values.entries()) {
    (services.clock as FixedClock).set(new Date(Date.UTC(2026, 10, 11, 12 + index)).toISOString());
    await recordEvaluation(services, { subject, records: [measurement(metric, value, target)] });
  }
}

test('the trend is ordered from the most recent measurement', async () => {
  const services = fakeServices({});
  await recordSeries(services, ATTACHMENT_SUBJECT, 'ACCEPTED_WITHOUT_CORRECTION', [0.7, 0.8, 0.9], 0.85);

  const trend = await qualityTrend(services);
  assert.deepEqual(
    trend.map((point) => point.value),
    [0.9, 0.8, 0.7]
  );
  assert.ok(trend[0]!.measuredAt > trend[1]!.measuredAt);
  assert.equal(trend[0]!.subjectKey, subjectKey(ATTACHMENT_SUBJECT));
});

test('the trend groups points of the same subject together', async () => {
  const services = fakeServices({});
  await recordEvaluation(services, { subject: READING_SUBJECT, records: [measurement('FIELD_ACCURACY', 0.95, 0.9)] });
  await recordEvaluation(services, { subject: ATTACHMENT_SUBJECT, records: [measurement('ACCEPTED_WITHOUT_CORRECTION', 0.9, 0.85)] });

  const trend = await qualityTrend(services);
  assert.equal(trend.length, 2);
  const keys = trend.map((point) => point.subjectKey);
  assert.equal(new Set(keys).size, 2);
  const filtered = await qualityTrend(services, { subjectKey: subjectKey(READING_SUBJECT) });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.metric, 'FIELD_ACCURACY');
});

test('a rising ratio is improving, a falling one is degrading', async () => {
  const services = fakeServices({});
  await recordSeries(services, ATTACHMENT_SUBJECT, 'ACCEPTED_WITHOUT_CORRECTION', [0.7, 0.9], 0.85);
  let report = await qualityReport(services);
  let line = report.subjects[0]!.metrics[0]!;
  assert.equal(line.trend, 'improving');
  assert.equal(line.latestValue, 0.9);
  assert.equal(line.verdict, 'PASS');
  assert.equal(report.thresholdInEffect, services.settings.confidenceThreshold);

  const falling = fakeServices({});
  await recordSeries(falling, ATTACHMENT_SUBJECT, 'ACCEPTED_WITHOUT_CORRECTION', [0.9, 0.6], 0.85);
  report = await qualityReport(falling);
  line = report.subjects[0]!.metrics[0]!;
  assert.equal(line.trend, 'degrading');
  assert.equal(line.verdict, 'FAIL');
  assert.ok(report.thresholdInEffect > 1, 'the failing report shows the unreachable threshold');
});

test('a zero-target metric improves by falling, and equal values are stable', async () => {
  assert.equal(trendDirection('WRONG_HIGH_CONFIDENCE', 0, 3), 'improving');
  assert.equal(trendDirection('WRONG_HIGH_CONFIDENCE', 2, 0), 'degrading');
  assert.equal(trendDirection('INVENTED_ANSWERS', 1, 1), 'stable');
  assert.equal(trendDirection('FIELD_ACCURACY', 0.9, null), 'stable');

  const services = fakeServices({});
  await recordSeries(services, ATTACHMENT_SUBJECT, 'WRONG_HIGH_CONFIDENCE', [2, 2], 0);
  const report = await qualityReport(services);
  assert.equal(report.subjects[0]!.metrics[0]!.trend, 'stable');
});

test('the report exposes one block per subject with the threshold in effect', async () => {
  const services = fakeServices({});
  await recordEvaluation(services, { subject: READING_SUBJECT, records: [measurement('FIELD_ACCURACY', 0.95, 0.9)] });
  await recordEvaluation(services, {
    subject: ATTACHMENT_SUBJECT,
    records: [measurement('ACCEPTED_WITHOUT_CORRECTION', 0.9, 0.85), measurement('WRONG_HIGH_CONFIDENCE', 0, 0)]
  });

  const report = await qualityReport(services);
  assert.equal(report.subjects.length, 2);
  const keys = report.subjects.map((subject) => subject.subjectKey);
  assert.deepEqual(keys, [subjectKey(ATTACHMENT_SUBJECT), subjectKey(READING_SUBJECT)].sort());
  const attachment = report.subjects.find((subject) => subject.subjectKey === subjectKey(ATTACHMENT_SUBJECT))!;
  assert.equal(attachment.metrics.length, 2);
  assert.equal(report.thresholdInEffect, services.settings.confidenceThreshold);
  assert.equal(report.generatedAt, services.clock.now());
});
