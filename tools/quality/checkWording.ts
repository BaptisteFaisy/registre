/**
 * CI guard — ENF-IA-01: "the tool never uses the word compliant for a control".
 *
 * Scans every source file of the product (backend, portal, tools) for the
 * forbidden stems. The vocabulary guard itself and its test are excluded: they
 * legitimately contain the words they forbid.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { findViolations } from '../../src/domain/vocabulary.ts';

const ROOTS = ['src', 'tools', 'portal/src'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);
const EXCLUDED_FILES = new Set([
  'src/domain/vocabulary.ts',
  'test/domain/vocabulary.test.ts',
  'tools/quality/checkWording.ts'
]);
const SCANNED = /\.(ts|tsx|mts|cts|js|jsx|json|html|css)$/;

interface Hit {
  file: string;
  line: number;
  word: string;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, out);
    else if (SCANNED.test(entry)) out.push(full);
  }
  return out;
}

/** True when the whole line is a comment (//, /*, *, or a closing *\/). */
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.endsWith('*/')
  );
}

function scanFile(file: string, hits: Hit[]): void {
  const normalised = relative(process.cwd(), file).split(sep).join('/');
  if (EXCLUDED_FILES.has(normalised)) return;
  const content = readFileSync(file, 'utf8');
  content.split('\n').forEach((line, index) => {
    // Comments may quote the rule they enforce; only code and strings are
    // scanned, so a doc comment saying "never compliant" stays legitimate.
    if (isCommentLine(line)) return;
    for (const violation of findViolations(line)) {
      hits.push({ file: normalised, line: index + 1, word: violation.word, text: line.trim().slice(0, 120) });
    }
  });
}

function main(): number {
  const files: string[] = [];
  for (const root of ROOTS) walk(root, files);
  const hits: Hit[] = [];
  for (const file of files) scanFile(file, hits);

  console.log(`scanned ${files.length} file(s) for forbidden wording`);
  for (const hit of hits) {
    console.error(`::error::${hit.file}:${hit.line}: "${hit.word}" — ${hit.text}`);
  }
  if (hits.length > 0) {
    console.error(`${hits.length} occurrence(s): use COVERED / TO_RENEW / TO_VERIFY / EXPIRED / NO_EVIDENCE instead.`);
    return 1;
  }
  console.log('OK — no control is ever described as compliant.');
  return 0;
}

process.exit(main());
