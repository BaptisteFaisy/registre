/**
 * The two reference result files committed under `eval/results` must stay in
 * step with the catalogue: the perfect one scores 100 %, the degraded one fails
 * exactly where it was designed to. Regenerate them with
 * `node tools/eval/makeFixtureResults.ts` after a catalogue change.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDatasets } from '../../tools/eval/lib/datasets.ts';
import { parseRunResults } from '../../tools/eval/lib/results.ts';
import { scoreRun } from '../../tools/eval/lib/scoring.ts';
import { buildDatasetRows } from '../../tools/eval/lib/rows.ts';
import type { Degradation } from '../../tools/eval/lib/fixtures.ts';
import { degradedResults, perfectResults } from '../../tools/eval/lib/fixtures.ts';
import { datasetsDir, resultsDir } from '../../tools/eval/lib/paths.ts';
import { DEFAULT_SETTINGS } from '../../src/domain/types.ts';

const THRESHOLD = DEFAULT_SETTINGS.confidenceThreshold;

/** Same plan as `tools/eval/makeFixtureResults.ts`. */
const PLAN: Degradation = {
  dropReading: 'EV-060',
  wrongField: { evidenceId: 'EV-001', field: 'documentDate', value: '2026-05-12' },
  wrongHighConfidence: { evidenceId: 'EV-060', controlId: 'CONT-04' },
  dropAttachment: { evidenceId: 'EV-033', controlId: 'CONT-16' },
  forgetGap: { evidenceId: 'EV-033', controlId: 'CONT-16' },
  inventAnswer: 'Q-23',
  wrongCitation: 'Q-12'
};

function readResultFile(file: string): { text: string; run: ReturnType<typeof parseRunResults> } {
  const path = join(resultsDir(), file);
  assert.ok(existsSync(path), `${file} is missing: run node tools/eval/makeFixtureResults.ts`);
  const text = readFileSync(path, 'utf8');
  return { text, run: parseRunResults(JSON.parse(text) as unknown) };
}

test('eval/results/fixture-perfect.json still scores 100 %', () => {
  const score = scoreRun(loadDatasets(datasetsDir()), readResultFile('fixture-perfect.json').run, THRESHOLD);
  assert.equal(score.reading.accuracy, 1);
  assert.equal(score.attachment.acceptanceRate, 1);
  assert.equal(score.attachment.highConfidenceWrong, 0);
  assert.equal(score.sufficiency.detected, score.sufficiency.gaps);
  assert.equal(score.qa.citationRate, 1);
  assert.equal(score.qa.invented, 0);
  assert.equal(score.pass, true);
});

test('eval/results/fixture-degraded.json still fails where it should', () => {
  const score = scoreRun(loadDatasets(datasetsDir()), readResultFile('fixture-degraded.json').run, THRESHOLD);
  assert.equal(score.attachment.highConfidenceWrong, 1);
  assert.equal(score.sufficiency.missed.length, 1);
  assert.equal(score.qa.invented, 1);
  assert.equal(score.pass, false);
});

test('the fixture files are exactly what the builder produces now', () => {
  const built = buildDatasetRows();
  assert.equal(readResultFile('fixture-perfect.json').text, `${JSON.stringify(perfectResults(built), null, 2)}\n`);
  assert.equal(readResultFile('fixture-degraded.json').text, `${JSON.stringify(degradedResults(built, PLAN), null, 2)}\n`);
});
