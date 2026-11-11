/**
 * Deterministic generator for the demonstration dataset (`demo/data/`).
 *
 * Reads the shared catalogue (`eval/catalogue.ts`), validates its invariants,
 * and writes:
 *   - `demo/data/framework.json` (Annex A import payload, R1)
 *   - `demo/data/evidence/<fileName>` for each of the 60 evidence items
 *   - `demo/data/README.md` explaining the generated files and format note
 *
 * Notice on formats: catalogue filenames keep their target extension (`.pdf`,
 * `.png`, `.docx`, `.xlsx`, `.csv`), while `.pdf`/`.png`/office extensions are
 * currently emitted as deterministic structured text/markdown so the offline
 * `ScriptedReader` can extract every Annex B field directly.
 *
 * Usage:
 *   node tools/demo/generate.ts           # write files deterministically
 *   node tools/demo/generate.ts --check   # verify SHA-256 against disk (CI)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EVIDENCE, toFrameworkImport, validateCatalogue } from '../../eval/catalogue.ts';
import { sha256Bytes } from '../../src/support/hash.ts';
import { renderEvidence } from './lib/document.ts';

export const DEMO_DATA_DIR = 'demo/data';
export const FRAMEWORK_PATH = join(DEMO_DATA_DIR, 'framework.json');
export const EVIDENCE_DIR = join(DEMO_DATA_DIR, 'evidence');
export const DATA_README_PATH = join(DEMO_DATA_DIR, 'README.md');

export interface PlannedFile {
  path: string;
  bytes: Uint8Array;
  sha256: string;
}

const DATA_README = `# Demonstration data (generated)

Generated deterministically from \`eval/catalogue.ts\` by \`node tools/demo/generate.ts\`.

- \`framework.json\`: Annex A import payload for the 30 demonstration controls (R1).
- \`evidence/\`: 60 evidence documents matching the catalogue \`fileName\` list.
  Documents carrying \`.pdf\`, \`.png\`, \`.docx\`, or \`.xlsx\` names are currently
  stored as structured UTF-8 text/markdown so the offline reader can extract
  Annex B fields without binary parsers; CSV exports are stored as real CSV.
`;

/** Builds the complete, deterministic list of files to write or verify. */
export function planDemoData(rootDir = process.cwd()): PlannedFile[] {
  const problems = validateCatalogue();
  if (problems.length > 0) {
    const details = problems.map((problem) => `- ${problem.code}: ${problem.detail}`).join('\n');
    throw new Error(`Catalogue validation failed (${problems.length}):\n${details}`);
  }

  const encoder = new TextEncoder();
  const planned: PlannedFile[] = [];

  const frameworkBytes = encoder.encode(`${JSON.stringify(toFrameworkImport(), null, 2)}\n`);
  planned.push({ path: join(rootDir, FRAMEWORK_PATH), bytes: frameworkBytes, sha256: sha256Bytes(frameworkBytes) });

  const readmeBytes = encoder.encode(DATA_README);
  planned.push({ path: join(rootDir, DATA_README_PATH), bytes: readmeBytes, sha256: sha256Bytes(readmeBytes) });

  for (const item of EVIDENCE) {
    const bytes = encoder.encode(renderEvidence(item));
    planned.push({
      path: join(rootDir, EVIDENCE_DIR, item.fileName),
      bytes,
      sha256: sha256Bytes(bytes)
    });
  }
  return planned;
}

/** Writes every planned file under `rootDir`. */
export function writeDemoData(rootDir = process.cwd()): PlannedFile[] {
  const files = planDemoData(rootDir);
  for (const file of files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.bytes);
  }
  return files;
}

/** Verifies every planned file on disk matches its expected SHA-256. */
export function checkDemoData(rootDir = process.cwd()): { ok: boolean; mismatches: string[] } {
  const files = planDemoData(rootDir);
  const mismatches: string[] = [];
  for (const file of files) {
    try {
      const actual = sha256Bytes(readFileSync(file.path));
      if (actual !== file.sha256) mismatches.push(`${file.path} (hash mismatch)`);
    } catch {
      mismatches.push(`${file.path} (missing)`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

function main(): number {
  const checkOnly = process.argv.includes('--check');
  if (checkOnly) {
    const result = checkDemoData();
    if (!result.ok) {
      for (const issue of result.mismatches) console.error(`::error::${issue}`);
      console.error(`Demo data check failed (${result.mismatches.length} mismatch/missing). Run: node tools/demo/generate.ts`);
      return 1;
    }
    console.log(`OK — ${EVIDENCE.length + 2} demonstration data files match the catalogue.`);
    return 0;
  }
  const written = writeDemoData();
  console.log(`Generated ${written.length} files (${EVIDENCE.length} evidence + framework.json + README.md).`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
