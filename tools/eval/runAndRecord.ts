#!/usr/bin/env node
/**
 * Scores a run against the four datasets and RECORDS the six metrics as
 * measured quality (spec 13.5, bonus axis) — the system measuring itself.
 *
 * The scorer of `score.ts` is reused as-is; this command only adds the
 * conversion (`lib/qualityRecords.ts`), the persistence through
 * `recordEvaluation` and the `--check` gate. Everything is offline: the
 * services bundle is the mock one, the vault lives in a temporary directory.
 *
 * Usage:
 *   node tools/eval/runAndRecord.ts                       # perfect fixture run
 *   node tools/eval/runAndRecord.ts --results eval/results/fixture-degraded.json --check
 *   node tools/eval/runAndRecord.ts --out /tmp/quality.json --json
 *
 * Exit codes: 0 recorded; 1 with --check when a metric is below its target;
 * 2 on a usage or I/O error.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { DEFAULT_SETTINGS } from '../../src/domain/types.ts';
import type { QualityRecord } from '../../src/domain/quality.ts';
import { createServices } from '../../src/bootstrap.ts';
import { recordEvaluation } from '../../src/pipeline/quality.ts';
import { loadDatasets } from './lib/datasets.ts';
import { readJsonFile } from './lib/jsonl.ts';
import { parseRunResults } from './lib/results.ts';
import { scoreRun } from './lib/scoring.ts';
import type { RunScore } from './lib/scoring.ts';
import { renderReport } from './lib/report.ts';
import { datasetVersionOf, evaluationInputsForScore } from './lib/qualityRecords.ts';
import { argValue, hasFlag, parseArgs } from './lib/cli.ts';
import type { Args } from './lib/cli.ts';
import { datasetsDir, resultsDir } from './lib/paths.ts';

const USAGE = `Score a run and record measured quality (spec 13.5)

  --results <path>      run result file (default: eval/results/fixture-perfect.json)
  --datasets <dir>      dataset directory (default: eval/datasets)
  --threshold <n>       confidence threshold for "high confidence" (default: 0.85)
  --out <path>          where the recorded QualityRecords are written as JSON
                        (default: eval/results/quality-records.json)
  --now <iso>           freeze the measurement instant (deterministic ids)
  --check               exit 1 when a recorded metric is below its target
  --help                show this text`;

interface RunOptions {
  resultsPath: string;
  datasetPath: string;
  threshold: number;
  outPath: string;
  now?: string;
  check: boolean;
}

function fail(message: string): number {
  console.error(message);
  return 2;
}

function parseThreshold(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`--threshold must be between 0 and 1, got ${raw}`);
  return value;
}

function optionsFrom(args: Args): RunOptions {
  const now = argValue(args, 'now', '');
  return {
    resultsPath: argValue(args, 'results', join(resultsDir(), 'fixture-perfect.json')),
    datasetPath: argValue(args, 'datasets', datasetsDir()),
    threshold: parseThreshold(argValue(args, 'threshold', String(DEFAULT_SETTINGS.confidenceThreshold))),
    outPath: argValue(args, 'out', join(resultsDir(), 'quality-records.json')),
    ...(now === '' ? {} : { now }),
    check: hasFlag(args, 'check')
  };
}

/** Scores the run with the existing scorer — no duplicated measuring logic. */
function scoreFromDisk(options: RunOptions): { score: RunScore; datasetVersion: string } {
  const datasets = loadDatasets(options.datasetPath);
  const results = parseRunResults(readJsonFile<unknown>(options.resultsPath));
  return { score: scoreRun(datasets, results, options.threshold, null), datasetVersion: datasetVersionOf(datasets) };
}

/** Persists the six metrics through `recordEvaluation` and writes them out. */
async function recordAll(options: RunOptions, score: RunScore, datasetVersion: string): Promise<QualityRecord[]> {
  const { services } = await createServices({
    provider: 'mock',
    ...(options.now === undefined ? {} : { now: options.now }),
    vaultRoot: join(tmpdir(), 'registre-eval-vault')
  });
  const inputs = evaluationInputsForScore(score, datasetVersion);
  const recorded: QualityRecord[] = [];
  for (const input of inputs) {
    recorded.push(...(await recordEvaluation(services, input)));
  }
  mkdirSync(dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, `${JSON.stringify(recorded, null, 2)}\n`);
  return recorded;
}

function reportFailures(recorded: readonly QualityRecord[]): number {
  const failed = recorded.filter((entry) => entry.verdict === 'FAIL');
  for (const entry of failed) {
    console.error(`below target: ${entry.metric} = ${entry.value} (target ${entry.target})`);
  }
  console.error(`--check: ${failed.length} metric(s) below target`);
  return 1;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (hasFlag(args, 'help')) {
    console.log(USAGE);
    return 0;
  }
  let options: RunOptions;
  try {
    options = optionsFrom(args);
  } catch (error) {
    return fail((error as Error).message);
  }
  if (!existsSync(options.resultsPath)) {
    return fail(`no results file at ${options.resultsPath}\nrun: node tools/eval/makeFixtureResults.ts\n${USAGE}`);
  }
  try {
    const { score, datasetVersion } = scoreFromDisk(options);
    const recorded = await recordAll(options, score, datasetVersion);
    const context = [
      'Registre — score and record measured quality',
      `run: ${score.runId} (${score.producedBy})`,
      `results: ${relative(process.cwd(), options.resultsPath)}`,
      `datasets: ${relative(process.cwd(), options.datasetPath)} (${datasetVersion})`,
      `confidence threshold: ${options.threshold}`
    ];
    console.log(renderReport(score, context));
    console.log(`recorded ${recorded.length} quality measurements -> ${relative(process.cwd(), options.outPath)}`);
    if (options.check && recorded.some((entry) => entry.verdict === 'FAIL')) return reportFailures(recorded);
    return 0;
  } catch (error) {
    return fail((error as Error).message);
  }
}

process.exit(await main());
