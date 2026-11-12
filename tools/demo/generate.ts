/**
 * Deterministic generator for the demonstration dataset (`demo/data/`).
 *
 * Reads the shared catalogue (`eval/catalogue.ts`), validates its invariants,
 * and writes:
 *   - `demo/data/framework.json` (Annex A import payload, R1)
 *   - `demo/data/evidence/<fileName>` for each of the 60 evidence items
 *   - `demo/data/offline-text.json` (text twins of the three screenshots)
 *   - `demo/data/README.md` explaining the generated files and format note
 *
 * Notice on formats: the corpus is made of real binaries (PDF with extractable
 * text, OOXML DOCX/XLSX, PNG, CSV). The offline readers extract their text with
 * the deterministic parsers of `src/support/documents/`, and the three
 * screenshots are read from the generated `offline-text.json` twin manifest —
 * the scripted reader never pretends to do OCR.
 *
 * Usage:
 *   node tools/demo/generate.ts           # write files deterministically
 *   node tools/demo/generate.ts --check   # verify SHA-256 against disk (CI)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { EVIDENCE, toFrameworkImport, validateCatalogue } from '../../eval/catalogue.ts';
import { sha256Bytes } from '../../src/support/hash.ts';
import { needsTextTwin, renderEvidenceBytes, renderEvidenceText } from './lib/document.ts';

export const DEMO_DATA_DIR = 'demo/data';
export const FRAMEWORK_PATH = join(DEMO_DATA_DIR, 'framework.json');
export const EVIDENCE_DIR = join(DEMO_DATA_DIR, 'evidence');
export const DATA_README_PATH = join(DEMO_DATA_DIR, 'README.md');
/** Offline text twins of the screenshots, read by the scripted reader only. */
export const TWIN_MANIFEST_PATH = join(DEMO_DATA_DIR, 'offline-text.json');

export interface PlannedFile {
  path: string;
  bytes: Uint8Array;
  sha256: string;
}

const DATA_README = `# Demonstration data (generated)

Generated deterministically from \`eval/catalogue.ts\` by \`node tools/demo/generate.ts\`.

- \`framework.json\`: Annex A import payload for the 30 demonstration controls (R1).
- \`evidence/\`: 60 evidence documents matching the catalogue \`fileName\` list.
  They are real binaries: \`.pdf\` files with extractable text, real \`.docx\` and
  \`.xlsx\` (OOXML in a ZIP), real \`.png\` for the three screenshots, and CSV for
  the exports. The offline extractor in \`src/support/documents/\` reads the same
  bytes Bedrock Data Automation would read.
- \`offline-text.json\`: text twins of the three screenshots only. The scripted
  offline reader does no OCR, so a screenshot is read from its twin; on AWS the
  image itself is read. No twin means "unreadable", never a guess (EF-LEC-04).
`;

/** Text twins of every screenshot, keyed by file name. */
export function twinManifest(): Record<string, string> {
  const twins: Record<string, string> = {};
  for (const item of EVIDENCE) {
    if (needsTextTwin(item)) twins[item.fileName] = renderEvidenceText(item);
  }
  return twins;
}

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

  const twinBytes = encoder.encode(`${JSON.stringify(twinManifest(), null, 2)}\n`);
  planned.push({ path: join(rootDir, TWIN_MANIFEST_PATH), bytes: twinBytes, sha256: sha256Bytes(twinBytes) });

  for (const item of EVIDENCE) {
    const bytes = renderEvidenceBytes(item);
    planned.push({
      path: join(rootDir, EVIDENCE_DIR, item.fileName),
      bytes,
      sha256: sha256Bytes(bytes)
    });
  }
  return planned;
}

/** Loads the generated twin manifest; an empty map when it is absent. */
export function loadTwinManifest(rootDir = process.cwd()): Map<string, string> {
  try {
    const raw = readFileSync(join(rootDir, TWIN_MANIFEST_PATH), 'utf8');
    return new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
  } catch {
    return new Map();
  }
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
    console.log(`OK — ${EVIDENCE.length + 3} demonstration data files match the catalogue.`);
    return 0;
  }
  const written = writeDemoData();
  console.log(
    `Generated ${written.length} files (${EVIDENCE.length} evidence + framework.json + offline-text.json + README.md).`
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
