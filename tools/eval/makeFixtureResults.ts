#!/usr/bin/env node
/**
 * Writes two reference run result files, so `score.ts` can be exercised before
 * the demo or a real Bedrock run exists:
 *
 *   eval/results/fixture-perfect.json   every measure at 100%
 *   eval/results/fixture-degraded.json  the same run with named mistakes
 *
 * Usage: node tools/eval/makeFixtureResults.ts [--out <dir>]
 */

import { join, relative } from 'node:path';
import { buildDatasetRows } from './lib/rows.ts';
import type { Degradation } from './lib/fixtures.ts';
import { degradedResults, perfectResults } from './lib/fixtures.ts';
import { writeJsonFile } from './lib/jsonl.ts';
import { argValue, parseArgs } from './lib/cli.ts';
import { resultsDir } from './lib/paths.ts';

/** The degraded run misses every target, on purpose, by a small margin. */
const PLAN: Degradation = {
  dropReading: 'EV-060',
  wrongField: { evidenceId: 'EV-001', field: 'documentDate', value: '2026-05-12' },
  wrongHighConfidence: { evidenceId: 'EV-060', controlId: 'CONT-04' },
  dropAttachment: { evidenceId: 'EV-033', controlId: 'CONT-16' },
  forgetGap: { evidenceId: 'EV-033', controlId: 'CONT-16' },
  inventAnswer: 'Q-23',
  wrongCitation: 'Q-12'
};

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const outDir = argValue(args, 'out', resultsDir());
  const datasets = buildDatasetRows();
  const perfectPath = join(outDir, 'fixture-perfect.json');
  const degradedPath = join(outDir, 'fixture-degraded.json');
  writeJsonFile(perfectPath, perfectResults(datasets));
  writeJsonFile(degradedPath, degradedResults(datasets, PLAN));
  console.log(`wrote ${relative(process.cwd(), perfectPath)}`);
  console.log(`wrote ${relative(process.cwd(), degradedPath)}`);
  return 0;
}

process.exit(main());
