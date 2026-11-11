#!/usr/bin/env node
/**
 * Local scorer for the four quality measures of spec chapter 13.5.
 *
 * It reads the generated datasets and a run result file — produced by the demo,
 * by a fixture, or by a real Bedrock run — and prints a table. The exit code is
 * non-zero as soon as one target is missed, so CI fails on a regression.
 *
 * Usage:
 *   node tools/eval/score.ts                                  # eval/results/latest.json
 *   node tools/eval/score.ts --results eval/results/x.json
 *   node tools/eval/score.ts --results x.json --json
 *   node tools/eval/score.ts --results x.json --threshold 0.9
 */

import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DEFAULT_SETTINGS } from '../../src/domain/types.ts';
import { loadDatasets } from './lib/datasets.ts';
import { loadEvidenceTexts } from './lib/quotes.ts';
import { parseRunResults } from './lib/results.ts';
import { readJsonFile } from './lib/jsonl.ts';
import { scoreRun } from './lib/scoring.ts';
import { renderReport, toJson } from './lib/report.ts';
import { argValue, hasFlag, parseArgs } from './lib/cli.ts';
import { datasetsDir, resultsDir } from './lib/paths.ts';

const USAGE = `Local quality score (spec 13.5)

  --results <path>    run result file (default: eval/results/latest.json)
  --datasets <dir>    dataset directory (default: eval/datasets)
  --threshold <n>     confidence threshold for "high confidence" (default: 0.85)
  --evidence-dir <dir>  check the cited passages inside the evidence files
  --json              print the machine-readable report instead of the table
  --help              show this text`;

function fail(message: string): number {
  console.error(message);
  return 2;
}

function parseThreshold(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`--threshold must be between 0 and 1, got ${raw}`);
  return value;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (hasFlag(args, 'help')) {
    console.log(USAGE);
    return 0;
  }
  const resultsPath = argValue(args, 'results', join(resultsDir(), 'latest.json'));
  const datasetPath = argValue(args, 'datasets', datasetsDir());
  let threshold = DEFAULT_SETTINGS.confidenceThreshold;
  try {
    threshold = parseThreshold(argValue(args, 'threshold', String(threshold)));
  } catch (error) {
    return fail((error as Error).message);
  }
  if (!existsSync(resultsPath)) {
    return fail(`no results file at ${resultsPath}\n${USAGE}`);
  }
  try {
    const datasets = loadDatasets(datasetPath);
    const results = parseRunResults(readJsonFile<unknown>(resultsPath));
    const evidenceArg = args.values.get('evidence-dir') ?? null;
    const texts = evidenceArg === null ? null : loadEvidenceTexts(evidenceArg);
    const score = scoreRun(datasets, results, threshold, texts);
    if (hasFlag(args, 'json')) {
      console.log(JSON.stringify(toJson(score), null, 2));
    } else {
      const context = [
        'Registre — local quality score',
        `run: ${score.runId} (${score.producedBy})`,
        `results: ${relative(process.cwd(), resultsPath)}`,
        `datasets: ${relative(process.cwd(), datasetPath)}`,
        `confidence threshold: ${threshold}`,
        `quote check: ${texts === null ? 'off (no evidence directory)' : 'on'}`
      ];
      console.log(renderReport(score, context));
    }
    return score.pass ? 0 : 1;
  } catch (error) {
    return fail((error as Error).message);
  }
}

process.exit(main());
