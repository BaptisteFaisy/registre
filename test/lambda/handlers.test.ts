/**
 * The `HANDLERS` table of the infrastructure must point at real entry points.
 *
 * `infra/lib/handlers.ts` reads each file and looks for an exported `handler`;
 * when it finds none it deploys a 501 stub instead of the Lambda. This test
 * applies the same rule from the application side, so a renamed or missing
 * adapter fails here before `cdk synth` silently ships stubs.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HANDLERS } from '../../infra/lib/config.ts';

/** Repository root, resolved from this file (test/lambda → ../..). */
const REPO_ROOT = join(import.meta.dirname, '..', '..');

/** The same pattern `infra/lib/handlers.ts` uses to accept a handler file. */
const EXPORTS_HANDLER = /export\s+(const|async function|function)\s+handler\b/;

/** The steps of the specification that must have their own adapter. */
const EXPECTED_KEYS = [
  'api',
  'ingest',
  'read',
  'candidates',
  'attach',
  'sufficiency',
  'states',
  'index',
  'reminders',
  'collectS3',
  'collectItsm',
  'collectAwsReport'
] as const;

test('every HANDLERS entry points at a file that exists', () => {
  for (const [key, path] of Object.entries(HANDLERS)) {
    assert.ok(existsSync(join(REPO_ROOT, path)), `${key}: ${path} does not exist`);
  }
});

test('every HANDLERS entry points at a file that exports "handler"', () => {
  for (const [key, path] of Object.entries(HANDLERS)) {
    const source = readFileSync(join(REPO_ROOT, path), 'utf8');
    assert.match(source, EXPORTS_HANDLER, `${key}: ${path} exports no handler`);
  }
});

test('no entry still points at a module that is not an adapter', () => {
  for (const [key, path] of Object.entries(HANDLERS)) {
    const expected = key === 'api' ? 'src/api/lambda.ts' : `src/lambda/${path.split('/').pop()}`;
    assert.equal(path, expected, `${key}: ${path} is not the adapter it should be`);
  }
});

test('the table covers every step of the specification', () => {
  assert.deepEqual(Object.keys(HANDLERS).sort(), [...EXPECTED_KEYS].sort());
});
