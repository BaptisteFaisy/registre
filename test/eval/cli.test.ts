/**
 * The command-line surface: dataset generation, staleness detection and the
 * scorer's exit code. Runs the real commands as child processes — no network.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoRoot } from '../../tools/eval/lib/paths.ts';

const ROOT = repoRoot();
const NODE = process.execPath;

interface RunOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: readonly string[]): RunOutcome {
  try {
    const stdout = execFileSync(NODE, args, { cwd: ROOT, encoding: 'utf8', timeout: 60_000, stdio: 'pipe' });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

test('buildDatasets writes the four files into a fresh directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registre-datasets-'));
  const outcome = run(['tools/eval/buildDatasets.ts', '--out', dir]);
  assert.equal(outcome.code, 0, outcome.stderr);
  for (const name of ['reading', 'attachment', 'sufficiency', 'qa']) {
    const text = readFileSync(join(dir, `${name}.jsonl`), 'utf8');
    assert.ok(text.trimEnd().split('\n').length > 0, name);
  }
});

test('buildDatasets --check fails on a tampered dataset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registre-stale-'));
  assert.equal(run(['tools/eval/buildDatasets.ts', '--out', dir]).code, 0);
  const path = join(dir, 'attachment.jsonl');
  writeFileSync(path, `${readFileSync(path, 'utf8').split('\n')[0]}\n`, 'utf8');
  const outcome = run(['tools/eval/buildDatasets.ts', '--check', '--out', dir]);
  assert.equal(outcome.code, 1);
  assert.match(outcome.stderr, /stale/);
});

test('the scorer exits 0 on a perfect run and 1 on a degraded one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registre-results-'));
  assert.equal(run(['tools/eval/makeFixtureResults.ts', '--out', dir]).code, 0);
  const perfect = run(['tools/eval/score.ts', '--results', join(dir, 'fixture-perfect.json')]);
  assert.equal(perfect.code, 0, perfect.stdout);
  assert.match(perfect.stdout, /Overall: PASS/);
  const degraded = run(['tools/eval/score.ts', '--results', join(dir, 'fixture-degraded.json')]);
  assert.equal(degraded.code, 1);
  assert.match(degraded.stdout, /Overall: FAIL/);
});

test('the scorer prints JSON when asked and refuses an absent file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registre-json-'));
  assert.equal(run(['tools/eval/makeFixtureResults.ts', '--out', dir]).code, 0);
  const json = run(['tools/eval/score.ts', '--results', join(dir, 'fixture-perfect.json'), '--json']);
  assert.equal(json.code, 0);
  const report = JSON.parse(json.stdout) as { pass: boolean; reading: { accuracy: number } };
  assert.equal(report.pass, true);
  assert.equal(report.reading.accuracy, 1);
  const absent = run(['tools/eval/score.ts', '--results', join(dir, 'nope.json')]);
  assert.equal(absent.code, 2);
  assert.match(absent.stderr, /no results file/);
});

test('the scorer can check the cited passages inside the evidence files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registre-quotes-'));
  assert.equal(run(['tools/eval/makeFixtureResults.ts', '--out', dir]).code, 0);
  const evidenceDir = mkdtempSync(join(tmpdir(), 'registre-evidence-'));
  writeFileSync(join(evidenceDir, 'information-security-policy-v4.pdf'), 'Information Security Policy, version 4.0.', 'utf8');
  const outcome = run([
    'tools/eval/score.ts',
    '--results',
    join(dir, 'fixture-perfect.json'),
    '--evidence-dir',
    evidenceDir
  ]);
  assert.equal(outcome.code, 0, outcome.stdout);
  assert.match(outcome.stdout, /quote check: on/);
});

test('bedrockEval writes the payloads without touching AWS', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registre-bedrock-'));
  const outcome = run(['tools/eval/bedrockEval.ts', '--out', dir]);
  assert.equal(outcome.code, 0, outcome.stderr);
  assert.match(outcome.stdout, /no job created/);
  const judge = JSON.parse(readFileSync(join(dir, 'attachment-job.json'), 'utf8')) as Record<string, unknown>;
  assert.ok(JSON.stringify(judge).includes('attachment-dataset.jsonl'));
  const config = JSON.parse(readFileSync(join(dir, 'eval-config.json'), 'utf8')) as { counts: { evidence: number } };
  assert.equal(config.counts.evidence, 60);
});

test('bedrockEval --submit explains what is missing instead of failing hard', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registre-submit-'));
  const outcome = run(['tools/eval/bedrockEval.ts', '--out', dir, '--submit']);
  assert.equal(outcome.code, 3);
  assert.match(outcome.stderr, /create-evaluation-job/);
});
