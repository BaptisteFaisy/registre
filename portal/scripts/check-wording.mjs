#!/usr/bin/env node
/**
 * ENF-IA-01 guard: the portal never describes a control with the word
 * "compliant" (or its French counterpart). The only allowed occurrence is the
 * comment in `src/lib/states.ts` that explains the rule.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN = /compliant|conforme/i;
const ALLOWED_FILE = join('src', 'lib', 'states.ts');
const ALLOWED_PATTERN = /ENF-IA-01/;

/** Lists every source file under a directory. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];
for (const file of walk('src')) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (!FORBIDDEN.test(line)) return;
    if (file === ALLOWED_FILE && ALLOWED_PATTERN.test(line)) return;
    violations.push(`${file}:${index + 1}: ${line.trim()}`);
  });
}

if (violations.length > 0) {
  console.error('ENF-IA-01 violation — forbidden wording found:');
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log('check:wording OK — no forbidden wording in src/');
