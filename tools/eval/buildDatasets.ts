#!/usr/bin/env node
/**
 * Generates the four measurement datasets of spec chapter 13.5 from the
 * catalogue, so the datasets and the demonstration data never drift apart.
 *
 * Usage:
 *   node tools/eval/buildDatasets.ts              # writes eval/datasets/*.jsonl
 *   node tools/eval/buildDatasets.ts --check      # fails if the files are stale
 *   node tools/eval/buildDatasets.ts --out <dir>  # writes somewhere else
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EXPECTED_COUNTS, validateCatalogue } from '../../eval/catalogue.ts';
import { DATASET_FILES, DATASET_ORDER, validateDataset } from './lib/schema.ts';
import type { DatasetName } from './lib/schema.ts';
import { buildDatasetRows } from './lib/rows.ts';
import { serializeJsonl, writeJsonlFile } from './lib/jsonl.ts';
import { argValue, hasFlag, parseArgs } from './lib/cli.ts';
import { datasetsDir } from './lib/paths.ts';

interface DatasetSummary {
  name: DatasetName;
  rows: number;
  expected: number;
}

function expectedRowCount(name: DatasetName): number {
  if (name === 'sufficiency') return EXPECTED_COUNTS.incompleteEvidence;
  if (name === 'qa') return EXPECTED_COUNTS.questionsWithEvidence + EXPECTED_COUNTS.trapQuestions;
  return EXPECTED_COUNTS.evidence;
}

function rowsFor(name: DatasetName): unknown[] {
  const built = buildDatasetRows();
  return built[name];
}

function summarise(): DatasetSummary[] {
  return DATASET_ORDER.map((name) => ({ name, rows: rowsFor(name).length, expected: expectedRowCount(name) }));
}

function reportProblems(title: string, problems: readonly string[]): void {
  console.error(`${title}: ${problems.length} problem(s)`);
  for (const problem of problems.slice(0, 20)) console.error(`  - ${problem}`);
}

function checkCatalogue(): boolean {
  const problems = validateCatalogue().map((problem) => `${problem.code}: ${problem.detail}`);
  if (problems.length === 0) return true;
  reportProblems('catalogue', problems);
  return false;
}

function checkRows(): boolean {
  let ok = true;
  for (const summary of summarise()) {
    if (summary.rows === summary.expected) continue;
    console.error(`::error::${DATASET_FILES[summary.name]}: expected ${summary.expected} rows, found ${summary.rows}`);
    ok = false;
  }
  for (const name of DATASET_ORDER) {
    const problems = validateDataset(name, rowsFor(name));
    if (problems.length === 0) continue;
    reportProblems(DATASET_FILES[name], problems);
    ok = false;
  }
  return ok;
}

function checkOnDisk(outDir: string): boolean {
  let ok = true;
  for (const name of DATASET_ORDER) {
    const path = join(outDir, DATASET_FILES[name]);
    if (!existsSync(path)) {
      console.error(`::error::${relative(process.cwd(), path)} is missing`);
      ok = false;
      continue;
    }
    const onDisk = readFileSync(path, 'utf8');
    if (onDisk === serializeJsonl(rowsFor(name))) continue;
    console.error(`::error::${relative(process.cwd(), path)} is stale: run node tools/eval/buildDatasets.ts`);
    ok = false;
  }
  return ok;
}

function writeAll(outDir: string): void {
  for (const name of DATASET_ORDER) {
    const path = join(outDir, DATASET_FILES[name]);
    writeJsonlFile(path, rowsFor(name));
    console.log(`wrote ${relative(process.cwd(), path)} (${rowsFor(name).length} rows)`);
  }
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const outDir = argValue(args, 'out', datasetsDir());
  if (!checkCatalogue() || !checkRows()) return 1;
  if (hasFlag(args, 'check')) {
    const ok = checkOnDisk(outDir);
    console.log(ok ? 'OK — datasets are up to date.' : 'datasets are stale.');
    return ok ? 0 : 1;
  }
  writeAll(outDir);
  return 0;
}

process.exit(main());
