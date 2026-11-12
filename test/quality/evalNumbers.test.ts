/**
 * Shape of the recorded evaluation summary — the offline run of 2026-11-12.
 *
 * `node tools/eval/runAndRecord.ts` writes `eval/results/quality-records.json`.
 * These tests check the recorded summary offline (no child process, no
 * network): the four metric keys behind the impact numbers are present, every
 * value sits in its legal range, and each measurement carries the execution
 * timestamp and a positive sample count.
 *
 * The four keys are the Devpost mapping of spec 13.5:
 *   FIELD_ACCURACY               reading fields        ratio, target > 0.90
 *   ACCEPTED_WITHOUT_CORRECTION  attachment acceptance ratio, target > 0.85
 *   GAPS_DETECTED                expected gaps         ratio 0..1 or integer count
 *   CITATION_ACCURACY            correct citations     ratio, target > 0.90
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QualityRecord } from '../../src/domain/quality.ts';
import { resultsDir } from '../../tools/eval/lib/paths.ts';

/** The four metric keys behind the impact numbers of the submission form. */
const FOUR_METRICS: readonly string[] = [
  'FIELD_ACCURACY',
  'ACCEPTED_WITHOUT_CORRECTION',
  'GAPS_DETECTED',
  'CITATION_ACCURACY'
];

function loadSummary(): QualityRecord[] {
  const path = join(resultsDir(), 'quality-records.json');
  const summary = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  assert.ok(Array.isArray(summary), `${path} must hold a JSON array of quality records`);
  return summary as QualityRecord[];
}

function isRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

test('the recorded summary contains the four metric keys', () => {
  const records = loadSummary();
  assert.ok(records.length >= FOUR_METRICS.length, 'expected at least four recorded measurements');
  const metrics = new Set(records.map((record) => record.metric));
  for (const metric of FOUR_METRICS) {
    assert.ok(metrics.has(metric as QualityRecord['metric']), `metric ${metric} is missing from the summary`);
  }
});

test('ratios are numbers between 0 and 1; gaps detected also accepts an integer count', () => {
  for (const record of loadSummary()) {
    if (!FOUR_METRICS.includes(record.metric)) continue;
    assert.equal(typeof record.value, 'number', `${record.metric} must be a number`);
    if (record.metric === 'GAPS_DETECTED') {
      const legal = isRatio(record.value) || (Number.isInteger(record.value) && record.value >= 0);
      assert.ok(legal, `GAPS_DETECTED must be a ratio in 0..1 or an integer count, got ${record.value}`);
      continue;
    }
    assert.ok(isRatio(record.value), `${record.metric} must be between 0 and 1, got ${record.value}`);
  }
});

test('every recorded measurement carries an execution timestamp and a positive sample count', () => {
  for (const record of loadSummary()) {
    const measured = Date.parse(record.measuredAt);
    assert.ok(Number.isFinite(measured), `bad measuredAt on ${record.metric}: ${record.measuredAt}`);
    assert.ok(
      Number.isInteger(record.sampleCount) && record.sampleCount > 0,
      `bad sampleCount on ${record.metric}: ${record.sampleCount}`
    );
  }
});
