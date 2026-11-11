/**
 * JSONL reading and writing. One object per line, `\n` terminated, stable key
 * order (the object as built), so regenerating a dataset produces no diff.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Parses JSONL text; throws on the first unreadable line, with its number. */
export function parseJsonl(text: string): unknown[] {
  const rows: unknown[] = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    try {
      rows.push(JSON.parse(trimmed) as unknown);
    } catch (error) {
      throw new Error(`line ${index + 1}: ${(error as Error).message}`);
    }
  });
  return rows;
}

/** Serialises rows to JSONL text (one compact object per line). */
export function serializeJsonl(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
}

/** Reads a JSONL file from disk. */
export function readJsonlFile(path: string): unknown[] {
  return parseJsonl(readFileSync(path, 'utf8'));
}

/** Writes rows to a JSONL file, creating the directory when needed. */
export function writeJsonlFile(path: string, rows: readonly unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeJsonl(rows), 'utf8');
}

/** Reads a JSON file from disk. */
export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Writes a pretty-printed JSON file, creating the directory when needed. */
export function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
