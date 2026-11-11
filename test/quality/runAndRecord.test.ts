/**
 * `runAndRecord` — the runner scores the real datasets with the existing
 * scorer, records the six metrics as measured quality, and `--check` fails
 * when a metric is below its target. Runs the real command as a child
 * process, fully offline.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QualityRecord } from '../../src/domain/quality.ts';
import { PROMPT_VERSIONS } from '../../src/ai/versioning.ts';
import { repoRoot } from '../../tools/eval/lib/paths.ts';

const ROOT = repoRoot();
const NODE = process.execPath;
const SIX_METRICS = [
  'FIELD_ACCURACY',
  'ACCEPTED_WITHOUT_CORRECTION',
  'WRONG_HIGH_CONFIDENCE',
  'GAPS_DETECTED',
  'CITATION_ACCURACY',
  'INVENTED_ANSWERS'
];

interface RunOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: readonly string[]): RunOutcome {
  try {
    const stdout = execFileSync(NODE, args, { cwd: ROOT, encoding: 'utf8', timeout: 120_000, stdio: 'pipe' });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

function freshOut(): { dir: string; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'registre-quality-'));
  return { dir, out: join(dir, 'quality-records.json') };
}

function readRecords(out: string): QualityRecord[] {
  return JSON.parse(readFileSync(out, 'utf8')) as QualityRecord[];
}

test('runAndRecord scores the real datasets and records six measurements', () => {
  const { out } = freshOut();
  const outcome = run(['tools/eval/runAndRecord.ts', '--out', out]);
  assert.equal(outcome.code, 0, outcome.stderr || outcome.stdout);

  // The six metrics of the scorer's table are displayed.
  assert.match(outcome.stdout, /Reading: fields read correctly/);
  assert.match(outcome.stdout, /Attachment: accepted without correction/);
  assert.match(outcome.stdout, /Answers: correct citations/);
  assert.match(outcome.stdout, /Overall: PASS/);

  const records = readRecords(out);
  assert.equal(records.length, 6);
  assert.deepEqual(records.map((entry) => entry.metric).sort(), [...SIX_METRICS].sort());
  for (const entry of records) {
    assert.equal(entry.verdict, 'PASS', `${entry.metric} on the perfect fixture`);
    assert.equal(entry.jobId, null, 'a local run has no Bedrock job');
    assert.match(entry.datasetVersion, /^ds-[0-9a-f]{12}$/);
    assert.match(entry.id, /^qr-[0-9a-f]{12}$/);
  }
  const versions = records.map((entry) => entry.subject.promptVersion);
  assert.ok(versions.includes(PROMPT_VERSIONS.ATTACHMENT));
  assert.ok(versions.includes(PROMPT_VERSIONS.ANSWER));
});

test('recorded ids are deterministic across two runs', () => {
  const first = freshOut();
  const second = freshOut();
  const now = '2026-11-11T12:00:00.000Z';
  assert.equal(run(['tools/eval/runAndRecord.ts', '--out', first.out, '--now', now]).code, 0);
  assert.equal(run(['tools/eval/runAndRecord.ts', '--out', second.out, '--now', now]).code, 0);
  const idsOf = (out: string): string[] => readRecords(out).map((entry) => entry.id).sort();
  assert.deepEqual(idsOf(first.out), idsOf(second.out));
});

test('--check passes when every metric reaches its target', () => {
  const { out } = freshOut();
  const outcome = run(['tools/eval/runAndRecord.ts', '--out', out, '--check']);
  assert.equal(outcome.code, 0, outcome.stderr || outcome.stdout);
});

test('--check fails when a metric falls below its target', () => {
  const { out } = freshOut();
  const outcome = run([
    'tools/eval/runAndRecord.ts',
    '--results',
    'eval/results/fixture-degraded.json',
    '--out',
    out,
    '--check'
  ]);
  assert.equal(outcome.code, 1, `expected a failing check, got ${outcome.code}\n${outcome.stdout}\n${outcome.stderr}`);
  assert.match(outcome.stderr, /below target/);

  const records = readRecords(out);
  assert.equal(records.length, 6);
  const failed = records.filter((entry) => entry.verdict === 'FAIL').map((entry) => entry.metric);
  assert.ok(failed.includes('WRONG_HIGH_CONFIDENCE'), failed.join(','));
  assert.ok(failed.includes('INVENTED_ANSWERS'), failed.join(','));
});

test('without --check a degraded run is still recorded and exits 0', () => {
  const { out } = freshOut();
  const outcome = run([
    'tools/eval/runAndRecord.ts',
    '--results',
    'eval/results/fixture-degraded.json',
    '--out',
    out
  ]);
  assert.equal(outcome.code, 0, outcome.stderr || outcome.stdout);
  const records = readRecords(out);
  assert.equal(records.length, 6);
  assert.ok(records.some((entry) => entry.verdict === 'FAIL'));
});

test('a missing results file exits 2 with a hint', () => {
  const { out } = freshOut();
  const outcome = run(['tools/eval/runAndRecord.ts', '--results', join(tmpdir(), 'absent-results.json'), '--out', out]);
  assert.equal(outcome.code, 2);
  assert.match(outcome.stderr, /makeFixtureResults/);
});
