/**
 * The local scorer: a perfect run scores 100 %, each named mistake lowers
 * exactly the measure it belongs to, and the run fails as soon as one target is
 * missed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDatasetRows } from '../../tools/eval/lib/rows.ts';
import { degradedResults, perfectResults } from '../../tools/eval/lib/fixtures.ts';
import { TARGETS, fieldEquals, scoreRun } from '../../tools/eval/lib/scoring.ts';
import { metricRows, renderReport, toJson } from '../../tools/eval/lib/report.ts';
import { DEFAULT_SETTINGS } from '../../src/domain/types.ts';

const DATASETS = buildDatasetRows();
const THRESHOLD = DEFAULT_SETTINGS.confidenceThreshold;

function scoreOf(runId: string, plan: Parameters<typeof degradedResults>[1] = {}) {
  return scoreRun(DATASETS, degradedResults(DATASETS, plan, runId), THRESHOLD);
}

test('a perfect run scores 100 % on the four measures', () => {
  const score = scoreRun(DATASETS, perfectResults(DATASETS), THRESHOLD);
  assert.equal(score.reading.accuracy, 1);
  assert.equal(score.attachment.acceptanceRate, 1);
  assert.equal(score.attachment.highConfidenceWrong, 0);
  assert.equal(score.sufficiency.detected, score.sufficiency.gaps);
  assert.equal(score.qa.citationRate, 1);
  assert.equal(score.qa.invented, 0);
  assert.equal(score.pass, true);
});

test('a perfect run renders a PASS table with six metric lines', () => {
  const score = scoreRun(DATASETS, perfectResults(DATASETS), THRESHOLD);
  const rows = metricRows(score);
  assert.equal(rows.length, 6);
  assert.ok(rows.every((row) => row.pass));
  const text = renderReport(score, ['context line']);
  assert.match(text, /Reading: fields read correctly/);
  assert.match(text, /Overall: PASS/);
});

test('reading counts every Annex B field of every evidence', () => {
  const score = scoreRun(DATASETS, perfectResults(DATASETS), THRESHOLD);
  assert.equal(score.reading.evidence, DATASETS.reading.length);
  assert.equal(score.reading.fields, DATASETS.reading.length * 14);
  assert.deepEqual(score.reading.missing, []);
  assert.deepEqual(score.reading.wrongFields, []);
});

test('a single wrong field is located precisely', () => {
  const score = scoreOf('one-wrong-field', {
    wrongField: { evidenceId: 'EV-003', field: 'documentDate', value: '2026-02-11' }
  });
  assert.equal(score.reading.correct, score.reading.fields - 1);
  assert.deepEqual(score.reading.wrongFields, ['EV-003: documentDate']);
  assert.equal(score.reading.accuracy > TARGETS.readingAccuracy, true, 'one field cannot break the target');
});

test('a run that reads nothing fails the reading target', () => {
  const dropped = DATASETS.reading.slice(0, 20).map((row) => row.evidenceId);
  let results = perfectResults(DATASETS);
  for (const id of dropped) {
    for (const result of results.reading) if (result.evidenceId === id) result.fields = null;
  }
  const score = scoreRun(DATASETS, results, THRESHOLD);
  assert.equal(score.reading.accuracy < TARGETS.readingAccuracy, true);
  assert.equal(score.reading.pass, false);
  assert.equal(score.pass, false);
});

test('a wrong link with high confidence fails the attachment measure', () => {
  const score = scoreOf('wrong-link', { wrongHighConfidence: { evidenceId: 'EV-060', controlId: 'CONT-07' } });
  assert.equal(score.attachment.highConfidenceWrong, 1);
  assert.deepEqual(score.attachment.wrongLinks, ['EV-060→CONT-07 (0.94)']);
  assert.equal(score.attachment.pass, false);
  assert.equal(score.pass, false);
});

test('a link below the threshold is not counted as a high-confidence error', () => {
  const results = perfectResults(DATASETS);
  const target = results.attachment.find((item) => item.evidenceId === 'EV-060');
  assert.ok(target !== undefined);
  target.attachments.push({ controlId: 'CONT-07', supports: true, confidence: 0.4, quote: 'weak match', citationVerified: true });
  const score = scoreRun(DATASETS, results, THRESHOLD);
  assert.equal(score.attachment.highConfidenceWrong, 0);
  assert.equal(score.attachment.accepted, DATASETS.attachment.length - 1, 'the set no longer matches');
});

test('a missing expected link is reported and costs acceptance', () => {
  const score = scoreOf('missing-link', { dropAttachment: { evidenceId: 'EV-016', controlId: 'CONT-07' } });
  assert.deepEqual(score.attachment.missingLinks, ['EV-016→CONT-07']);
  assert.equal(score.attachment.accepted, DATASETS.attachment.length - 1);
});

test('a claim whose quote was not found is counted, not accepted', () => {
  const results = perfectResults(DATASETS);
  const target = results.attachment.find((item) => item.evidenceId === 'EV-002');
  assert.ok(target !== undefined);
  for (const entry of target.attachments) entry.citationVerified = false;
  const score = scoreRun(DATASETS, results, THRESHOLD);
  assert.equal(score.attachment.unsupportedClaims, 1);
  assert.deepEqual(score.attachment.missingLinks, ['EV-002→CONT-01']);
});

test('a forgotten gap fails the sufficiency measure', () => {
  const score = scoreOf('forgotten-gap', { forgetGap: { evidenceId: 'EV-033', controlId: 'CONT-16' } });
  assert.equal(score.sufficiency.detected, score.sufficiency.gaps - 1);
  assert.deepEqual(score.sufficiency.missed, ['EV-033/CONT-16: Measured recovery time']);
  assert.equal(score.sufficiency.pass, false);
  assert.equal(score.pass, false);
});

test('a gap invented on a complete element fails the sufficiency measure', () => {
  const score = scoreOf('spurious-gap', {
    spuriousGap: { evidenceId: 'EV-033', controlId: 'CONT-16', element: 'Test result' }
  });
  assert.deepEqual(score.sufficiency.spurious, ['EV-033/CONT-16: Test result']);
  assert.equal(score.sufficiency.pass, false);
});

test('an invented answer on a trap question fails the question measure', () => {
  const score = scoreOf('invented', { inventAnswer: 'Q-24' });
  assert.equal(score.qa.invented, 1);
  assert.deepEqual(score.qa.inventedQuestions, ['Q-24']);
  assert.equal(score.qa.pass, false);
  assert.equal(score.pass, false);
});

test('a wrong citation is located without touching the trap count', () => {
  const score = scoreOf('wrong-citation', { wrongCitation: 'Q-04' });
  assert.deepEqual(score.qa.citationMisses, ['Q-04']);
  assert.equal(score.qa.citationRate < TARGETS.citationAccuracy, false, '19/20 stays above the target');
  assert.equal(score.qa.invented, 0);
});

test('silence on a trap question is the only accepted answer', () => {
  const results = perfectResults(DATASETS);
  const trap = results.answers.find((answer) => answer.questionId === 'Q-21');
  assert.ok(trap !== undefined);
  trap.citations = [{ evidenceId: 'EV-044', quote: 'scan result', page: 2 }];
  const score = scoreRun(DATASETS, results, THRESHOLD);
  assert.equal(score.qa.invented, 1, 'citing a document is an invented answer');
});

test('a degraded run fails with a non-zero exit signal and a JSON report', () => {
  const score = scoreOf('degraded', {
    dropReading: 'EV-060',
    wrongHighConfidence: { evidenceId: 'EV-060', controlId: 'CONT-04' },
    forgetGap: { evidenceId: 'EV-005', controlId: 'CONT-04' },
    inventAnswer: 'Q-23'
  });
  assert.equal(score.pass, false);
  const report = toJson(score) as Record<string, unknown>;
  assert.equal(report.pass, false);
  assert.deepEqual(Object.keys(report).sort(), ['answers', 'attachment', 'pass', 'producedBy', 'reading', 'runId', 'sufficiency', 'targets']);
});

test('an empty run scores zero and fails', () => {
  const score = scoreRun(DATASETS, { runId: 'empty', producedBy: 'test', reading: [], attachment: [], sufficiency: [], answers: [] }, THRESHOLD);
  assert.equal(score.reading.accuracy, 0);
  // The one evidence that must support no control is "accepted" by silence, so
  // acceptance is 1/60 rather than 0; it stays far below the target.
  assert.equal(score.attachment.accepted, 1);
  assert.equal(score.attachment.acceptanceRate < TARGETS.attachmentAcceptance, true);
  assert.equal(score.sufficiency.detected, 0);
  assert.equal(score.qa.citationRate, 0);
  assert.equal(score.pass, false);
  assert.equal(score.reading.missing.length, DATASETS.reading.length);
});

test('field comparison is case-insensitive on text and calendar-based on dates', () => {
  assert.equal(fieldEquals('Information Security Policy', 'information security policy'), true);
  assert.equal(fieldEquals('2026-03-31', '2026-03-31T00:00:00.000Z'), true);
  assert.equal(fieldEquals('2026-03-31', '2026-04-01'), false);
  assert.equal(fieldEquals(true, true), true);
  assert.equal(fieldEquals(null, 'something'), false);
  assert.equal(fieldEquals(null, null), true);
});

test('a missing reading result counts as every field wrong, not as absent', () => {
  const results = perfectResults(DATASETS);
  results.reading = results.reading.filter((result) => result.evidenceId !== 'EV-010');
  const score = scoreRun(DATASETS, results, THRESHOLD);
  assert.deepEqual(score.reading.missing, ['EV-010']);
  assert.equal(score.reading.correct, score.reading.fields - 14);
});
