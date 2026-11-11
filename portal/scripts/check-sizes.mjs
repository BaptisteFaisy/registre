#!/usr/bin/env node
/**
 * Size guard: every file stays under 500 lines and every function under 50.
 *
 * The function counter is a brace-depth heuristic that handles the shapes used
 * by this codebase (`function f() {}`, `const f = () => {}`, nested closures).
 * It reports the file and the line where an oversized function starts.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_FILE_LINES = 500;
const MAX_FUNCTION_LINES = 50;

const FUNCTION_START = /^\s*(export\s+)?(default\s+)?(async\s+)?function\s+\w+/;
const ARROW_START = /^\s*(export\s+)?const\s+\w+\s*=\s*(async\s*)?\([^)]*\)?\s*(:\s*[^=]+)?=>\s*\{?\s*$/;

/** Lists every source file under a directory. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css|json|html)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Returns the functions of a file that exceed the limit. */
function oversizedFunctions(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const offenders = [];
  let depth = 0;
  let start = -1;
  let name = '';
  lines.forEach((line, index) => {
    if (start === -1 && (FUNCTION_START.test(line) || ARROW_START.test(line))) {
      start = index;
      name = line.trim().slice(0, 70);
    }
    for (const char of line) {
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
    }
    if (start !== -1 && depth <= 0 && index > start) {
      const length = index - start + 1;
      if (length >= MAX_FUNCTION_LINES) offenders.push({ line: start + 1, length, name });
      start = -1;
    }
  });
  return offenders;
}

const problems = [];
for (const file of walk('src')) {
  const lineCount = readFileSync(file, 'utf8').split('\n').length;
  if (lineCount >= MAX_FILE_LINES) problems.push(`${file}: ${lineCount} lines`);
  for (const offender of oversizedFunctions(file)) {
    problems.push(`${file}:${offender.line}: ${offender.length} lines — ${offender.name}`);
  }
}

if (problems.length > 0) {
  console.error('Size guard failed:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `check:sizes OK — every file < ${MAX_FILE_LINES} lines, every function < ${MAX_FUNCTION_LINES} lines`
);
