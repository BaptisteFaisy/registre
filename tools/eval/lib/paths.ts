/**
 * Repository paths shared by the eval tools. Everything is resolved from this
 * file's location, so the commands work whatever the current directory is.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the repository root (`tools/eval/lib` → root). */
export function repoRoot(): string {
  return resolve(HERE, '../../..');
}

/** Default dataset directory (`eval/datasets`). */
export function datasetsDir(): string {
  return join(repoRoot(), 'eval', 'datasets');
}

/** Default results directory (`eval/results`). */
export function resultsDir(): string {
  return join(repoRoot(), 'eval', 'results');
}

/** Default directory for the Bedrock task payloads (`eval/bedrock`). */
export function bedrockDir(): string {
  return join(repoRoot(), 'eval', 'bedrock');
}
