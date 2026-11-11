/**
 * CI guard — code size limits (rule: files < 500 lines, functions < 50 lines).
 *
 * Uses the TypeScript compiler API to measure real function bodies, including
 * arrow functions and methods. Exits non-zero with a precise report.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

const MAX_FILE_LINES = 500;
const MAX_FUNCTION_LINES = 50;
const ROOTS = ['src', 'tools', 'test', 'infra/lib', 'infra/bin', 'portal/src'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', 'cdk.out']);

interface Offender {
  file: string;
  name: string;
  lines: number;
  limit: number;
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
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) out.push(full);
  }
  return out;
}

function functionName(node: ts.Node, source: ts.SourceFile): string {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.name?.getText(source) ?? '<anonymous>';
  }
  if (ts.isVariableDeclaration(node) && node.name) return node.name.getText(source);
  if (ts.isPropertyAssignment(node)) return node.name.getText(source);
  return '<anonymous>';
}

function measureFunctions(file: string, offenders: Offender[]): void {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const visit = (node: ts.Node): void => {
    const isFunctionLike =
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node);
    if (isFunctionLike) {
      const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const end = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      const lines = end - start + 1;
      if (lines > MAX_FUNCTION_LINES) {
        offenders.push({
          file,
          name: functionName(ts.isArrowFunction(node) || ts.isFunctionExpression(node) ? node.parent : node, source),
          lines,
          limit: MAX_FUNCTION_LINES
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function main(): number {
  const files: string[] = [];
  for (const root of ROOTS) walk(root, files);
  const offenders: Offender[] = [];
  let checked = 0;

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n').length;
    checked += 1;
    if (lines > MAX_FILE_LINES) {
      offenders.push({ file, name: '<file>', lines, limit: MAX_FILE_LINES });
    }
    try {
      measureFunctions(file, offenders);
    } catch (error) {
      console.error(`::warning::unable to parse ${file}: ${(error as Error).message}`);
    }
  }

  console.log(`checked ${checked} file(s), limit ${MAX_FILE_LINES} lines / ${MAX_FUNCTION_LINES} lines per function`);
  for (const item of offenders) {
    const where = relative(process.cwd(), item.file).split(sep).join('/');
    console.error(`::error::${where}: ${item.name} = ${item.lines} lines (max ${item.limit})`);
  }
  if (offenders.length > 0) {
    console.error(`${offenders.length} offence(s): split the code (rule: files < 500 lines, functions < 50 lines).`);
    return 1;
  }
  console.log('OK — every file and function is inside the limits.');
  return 0;
}

process.exit(main());
