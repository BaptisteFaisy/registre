/**
 * Formats Data Automation refuses are read by code — EF-LEC-01. No network:
 * the bytes are passed in, as a manual upload carries them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_EXTRACTION_ID, needsLocalExtraction, readLocally } from '../../src/ai/bedrock/localExtraction.ts';

test('EF-LEC-01 spreadsheets, CSV and text bypass Data Automation; documents and images do not', () => {
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  assert.equal(needsLocalExtraction(xlsx, 's3://vault/e/access-review.xlsx#v1'), true);
  assert.equal(needsLocalExtraction('text/csv', 's3://vault/e/patches.csv'), true);
  assert.equal(needsLocalExtraction('application/octet-stream', 's3://vault/e/notes.md#abc'), true);
  assert.equal(needsLocalExtraction('application/pdf', 's3://vault/e/policy.pdf#v1'), false);
  assert.equal(needsLocalExtraction('image/png', 's3://vault/e/console.png'), false);
});

test('EF-LEC-01 a CSV export is read by code at zero cost, without fetching bytes it already holds', async () => {
  const csv = 'Ticket,Opened,Closed,Owner\nINC-1,2026-09-01,2026-09-02,alice\nINC-2,2026-09-03,2026-09-05,bob\n';
  let fetched = false;
  const result = await readLocally(
    { evidenceId: 'ev-1' as never, contentType: 'text/csv', sizeBytes: csv.length, uri: 's3://vault/e/tickets.csv', bytes: new TextEncoder().encode(csv) },
    async () => {
      fetched = true;
      return new Uint8Array();
    }
  );
  assert.equal(fetched, false);
  assert.equal(result.cost?.usd, 0);
  assert.equal(result.cost?.source, LOCAL_EXTRACTION_ID);
  assert.ok(result.textPages.map((page) => page.text).join('').includes('INC-2'));
});
