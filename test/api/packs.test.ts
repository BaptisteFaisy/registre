/**
 * Audit pack routes — EF-DOS-01/02/03 (acceptance R14).
 *
 * Acceptance: assembling a pack then reading it returns the index per control,
 * the known gaps, a verified checksum and a downloadable archive; the download
 * is journalised as `PACK_DOWNLOADED`. `GET /v1/packs` lists every pack, newest
 * first, each with the URL that downloads it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Pack } from '../../src/domain/types.ts';
import { TEST_NOW, makeFramework } from '../fixtures/builders.ts';
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

/** A frozen pack written straight into the store, so two can be compared. */
function packFixture(overrides: Partial<Pack> = {}): Pack {
  return {
    id: 'pk-fixture',
    frameworkId: 'demo-msp',
    frozenAt: TEST_NOW,
    index: [],
    knownGaps: [],
    archive: { uri: 'memory://packs/pk-fixture/pack.zip#v1', sha256: 'c'.repeat(64), sizeBytes: 4 },
    checksumsVerified: true,
    ...overrides
  };
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

test('EF-DOS-02: GET /v1/packs lists the packs, newest first, with their download URL', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await services.state.putFramework(makeFramework());
    await services.state.putPack(packFixture({ id: 'pk-old', frozenAt: '2026-11-10T09:00:00.000Z' }));
    await services.state.putPack(packFixture({ id: 'pk-new', frozenAt: TEST_NOW }));
    const response = await api.request('GET', '/v1/packs', { token: TOKENS.auditor });
    assert.equal(response.status, 200);
    const packs = response.json as PackBody[];
    assert.deepEqual(packs.map((pack) => pack.id), ['pk-new', 'pk-old'], 'the newest pack comes first');
    for (const pack of packs) {
      assert.equal(pack.downloadUrl, `/v1/packs/${pack.id}/archive`);
      assert.equal(pack.frameworkId, 'demo-msp');
    }
  } finally {
    await api.close();
  }
});

test('EF-DOS-02: GET /v1/packs keeps only the packs of the requested framework', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await services.state.putFramework(makeFramework());
    await services.state.putFramework(makeFramework({ id: 'other-fw', name: 'Other framework' }));
    await services.state.putPack(packFixture({ id: 'pk-demo' }));
    await services.state.putPack(packFixture({ id: 'pk-other', frameworkId: 'other-fw' }));
    const filtered = await api.request('GET', '/v1/packs?frameworkId=demo-msp', { token: TOKENS.auditor });
    assert.deepEqual((filtered.json as PackBody[]).map((pack) => pack.id), ['pk-demo']);
    const all = await api.request('GET', '/v1/packs', { token: TOKENS.auditor });
    assert.equal((all.json as PackBody[]).length, 2, 'without a filter every framework is walked');
    const none = await api.request('GET', '/v1/packs?frameworkId=nope', { token: TOKENS.auditor });
    assert.deepEqual(none.json, []);
  } finally {
    await api.close();
  }
});

test('EF-DOS-02: a pack assembled through the API appears in the list', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const created = await api.request('POST', '/v1/frameworks/demo-msp/packs', {
      token: TOKENS.qualityLead,
      body: {}
    });
    assert.equal(created.status, 201);
    const pack = created.json as PackBody;
    const list = await api.request('GET', '/v1/packs', { token: TOKENS.auditor });
    assert.ok((list.json as PackBody[]).some((item) => item.id === pack.id));
    const scoped = await api.request('GET', '/v1/packs?frameworkId=demo-msp', { token: TOKENS.auditor });
    assert.deepEqual((scoped.json as PackBody[]).map((item) => item.id), [pack.id]);
  } finally {
    await api.close();
  }
});

test('EF-DOS-02: the pack list is closed to a control owner', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('GET', '/v1/packs', { token: TOKENS.controlOwner });
    assert.equal(response.status, 403);
    const anonymous = await api.request('GET', '/v1/packs', { token: null });
    assert.equal(anonymous.status, 401);
  } finally {
    await api.close();
  }
});
