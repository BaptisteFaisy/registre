/**
 * Audit pack routes — EF-DOS-01/02/03 (acceptance R14).
 *
 * Acceptance: assembling a pack then reading it returns the index per control,
 * the known gaps, a verified checksum and a downloadable archive; the download
 * is journalised as `PACK_DOWNLOADED`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestServices } from './fakeServices.ts';
import { depositPolicy, importDemoFramework } from './fixtures.ts';
import { TOKENS, startTestApi } from './harness.ts';

/** Shape of the pack payload. */
interface PackBody {
  id: string;
  frameworkId: string;
  frozenAt: string;
  index: Array<{ controlId: string; state: string; evidence: unknown[] }>;
  knownGaps: Array<{ controlId: string; detail: string }>;
  archive: { uri: string; sha256: string; sizeBytes: number };
  checksumsVerified: boolean;
  downloadUrl: string | null;
}

test('EF-DOS-01 (R14): a pack is assembled with an index and its known gaps', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    await depositPolicy(api);
    const response = await api.request('POST', '/v1/frameworks/demo-msp/packs', {
      token: TOKENS.qualityLead,
      body: {}
    });
    assert.equal(response.status, 201);
    const body = response.json as PackBody;
    assert.match(body.id, /^pk-/);
    assert.equal(body.frameworkId, 'demo-msp');
    assert.ok(body.index.length >= 2, 'one index entry per control');
    assert.ok(body.knownGaps.length >= 1, 'the gaps are part of an honest pack');
    assert.equal(body.checksumsVerified, true);
    assert.equal(body.archive.sha256.length, 64);
    assert.equal(body.downloadUrl, `/v1/packs/${body.id}/archive`);
  } finally {
    await api.close();
  }
});

test('EF-DOS-02: GET /v1/packs/{id} returns the frozen pack', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const created = await api.request('POST', '/v1/frameworks/demo-msp/packs', {
      token: TOKENS.qualityLead,
      body: {}
    });
    const packId = (created.json as PackBody).id;
    const read = await api.request('GET', `/v1/packs/${packId}`, { token: TOKENS.auditor });
    assert.equal(read.status, 200);
    const body = read.json as PackBody;
    assert.equal(body.id, packId);
    assert.equal(body.frozenAt, (created.json as PackBody).frozenAt, 'the pack is frozen at its instant');
  } finally {
    await api.close();
  }
});

test('EF-DOS-02: the archive is downloaded as a stream and journalled', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await importDemoFramework(api);
    const created = await api.request('POST', '/v1/frameworks/demo-msp/packs', {
      token: TOKENS.qualityLead,
      body: {}
    });
    const pack = created.json as PackBody;
    const download = await api.request('GET', `/v1/packs/${pack.id}/archive`, { token: TOKENS.auditor });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/zip');
    assert.match(download.headers.get('content-disposition') ?? '', /attachment; filename="registre-pk-/);
    assert.equal(download.headers.get('x-checksum-sha256'), pack.archive.sha256);
    assert.ok(download.text.length > 0, 'the archive is not empty');
    const events = await services.audit.list({ action: 'PACK_DOWNLOADED' });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.objectId, pack.id);
    assert.equal(events[0]?.actor, 'u-auditor');
  } finally {
    await api.close();
  }
});

test('EF-DOS-01: an internal auditor may read a pack but not assemble one', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const denied = await api.request('POST', '/v1/frameworks/demo-msp/packs', {
      token: TOKENS.auditor,
      body: {}
    });
    assert.equal(denied.status, 403);
  } finally {
    await api.close();
  }
});

test('GET /v1/packs/{id} is 404 for an unknown pack, 400 for a bad freezeAt', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const missing = await api.request('GET', '/v1/packs/pk-nope', { token: TOKENS.auditor });
    assert.equal(missing.status, 404);
    const badFreeze = await api.request('POST', '/v1/frameworks/demo-msp/packs', {
      token: TOKENS.qualityLead,
      body: { freezeAt: 'yesterday-ish' }
    });
    assert.equal(badFreeze.status, 400);
  } finally {
    await api.close();
  }
});
