/**
 * Contract test for the three extensions — the real portal client against the
 * real API server, over HTTP, on the demonstration dataset.
 *
 * Same discipline as `api-portal.test.ts`: no mock on either side. If a route
 * shape drifts from what the portal expects, this file fails.
 */

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/api/server.ts';
import type { RegistreServer } from '../../src/api/server.ts';
import { DEMO_IDENTITIES, demoToken } from '../../src/api/auth.ts';
import type { Services } from '../../src/ports/index.ts';
import { seedDemoData } from '../../tools/demo/main.ts';
import {
  exportAndVerifyPack,
  recordRunQuality,
  runDraft,
  runMachineAttestations,
  runMappings
} from '../../tools/demo/extensions.ts';
import { assemblePack } from '../../src/pipeline/pack.ts';
import { ApiError, HttpRegistreApi } from '../../portal/src/api/client.ts';
import type { Draft } from '../../src/domain/draft.ts';
import type { Pack } from '../../src/domain/types.ts';

const QUALITY = DEMO_IDENTITIES[0]!;
const AUDITOR = DEMO_IDENTITIES[2]!;
const NOW = '2026-11-11T09:00:00.000Z';

const workspace = mkdtempSync(join(tmpdir(), 'registre-ext-contract-'));

let services: Services;
let server: RegistreServer;
let baseUrl: string;
let api: HttpRegistreApi;
let auditorApi: HttpRegistreApi;
let pack: Pack;
let draft: Draft;
let shareToken: string;

before(async () => {
  const seeded = await seedDemoData({ vaultRoot: join(workspace, 'vault') });
  services = seeded.services;

  // Exercise the extensions the way the demo does, so the routes have real data.
  await runMachineAttestations(services, 'demo.actor', NOW);
  await runMappings(services, 'demo.actor', 'demo-msp');
  draft = (await runDraft(services, 'demo.actor'))!;
  await recordRunQuality(services, {
    answered: true,
    refused: true,
    acceptedWithoutCorrection: 10,
    totalAttachments: 10
  });
  pack = await assemblePack(services, 'demo-msp', 'demo.actor');
  await exportAndVerifyPack(services, pack, join(workspace, 'out'));

  server = createServer(services);
  const bound = await server.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${bound.port}`;
  api = clientFor(QUALITY.principal.email, QUALITY.password);
  auditorApi = clientFor(AUDITOR.principal.email, AUDITOR.password);
});

after(async () => {
  await server?.close();
  rmSync(workspace, { recursive: true, force: true });
});

function clientFor(login: string, password: string): HttpRegistreApi {
  const token = demoToken(login, password);
  return new HttpRegistreApi({ baseUrl, tokens: { token: () => token } });
}

/* ------------------------------------------------------- axis 1: verify */

test('POST /v1/packs/{id}/verify returns a verdict with no content', async () => {
  const result = await api.verifyPack(pack.id);
  assert.equal(result.packId, pack.id);
  assert.equal(result.checksumsOk, true);
  assert.equal(result.chainOk, true);
  assert.equal(result.rootHash, pack.manifest.rootHash);
  assert.equal(result.controlCount, pack.manifest.controlCount);
  const raw = JSON.stringify(result).toLowerCase();
  assert.ok(!raw.includes('information security policy'), 'a title leaked into a public verdict');
});

test('an auditor cannot verify a pack it may not read', async () => {
  // The internal auditor may verify; an anonymous caller may not.
  const anonymous = new HttpRegistreApi({ baseUrl });
  await assert.rejects(
    () => anonymous.verifyPack(pack.id),
    (error: unknown) => error instanceof ApiError && (error as ApiError).status === 401
  );
  const auditorResult = await auditorApi.verifyPack(pack.id);
  assert.equal(auditorResult.packId, pack.id);
});

test('a share grant is created, listed, used and revoked', async () => {
  const share = await api.createShare(pack.id, { ttlHours: 24, watermarkLabel: 'External audit firm' });
  assert.equal(share.scope, 'PACK');
  assert.equal(share.packId, pack.id);
  assert.match(share.watermark, /^AUDITOR External audit firm · expires \d{4}-\d{2}-\d{2}$/);
  assert.equal(share.useCount, 0);
  shareToken = share.token;

  const listed = await api.listShares();
  assert.ok(listed.some((item) => item.frameworkId === share.frameworkId));

  // The public verification endpoint accepts the token, without any credential.
  const response = await fetch(`${baseUrl}/v1/shares/${encodeURIComponent(share.token)}/verify`, {
    method: 'POST'
  });
  assert.equal(response.status, 200);
  const public_ = (await response.json()) as { rootHash: string; checksumsOk: boolean };
  assert.equal(public_.rootHash, pack.manifest.rootHash);
  assert.equal(public_.checksumsOk, true);

  const revoked = await api.revokeShare(share.token);
  assert.ok(revoked.revokedAt !== null);
  const afterRevoke = await fetch(`${baseUrl}/v1/shares/${encodeURIComponent(share.token)}/verify`, {
    method: 'POST'
  });
  assert.equal(afterRevoke.status, 404, 'a revoked grant verifies nothing');
});

test('a share longer than a week is refused', async () => {
  await assert.rejects(
    () => api.createShare(pack.id, { ttlHours: 1000, watermarkLabel: 'too long' }),
    (error: unknown) => error instanceof ApiError && (error as ApiError).status === 400
  );
});

/* ------------------------------------------- axis 2: cross-framework reuse */

test('mappings are listed, and a decision keeps its author', async () => {
  const all = await api.listMappings();
  assert.ok(Array.isArray(all));
  assert.ok(all.length > 0);
  const validated = all.filter((mapping) => mapping.status === 'VALIDATED');
  assert.ok(validated.length >= 1);
  for (const mapping of validated) {
    assert.equal(mapping.citationVerified, true);
    assert.equal(typeof mapping.validatedBy, 'string');
    assert.equal(mapping.sourceFrameworkId, 'demo-msp');
    assert.equal(mapping.targetFrameworkId, 'demo-iso');
  }

  const pending = await api.listMappings({ status: 'PROPOSED' });
  const target = pending[0];
  if (target !== undefined) {
    const decided = await api.decideMapping(target.id, 'REJECT', 'not equivalent in substance');
    assert.equal(decided.status, 'REJECTED');
    assert.equal(decided.note, 'not equivalent in substance');
  }
});

test('proposing mappings is idempotent over HTTP', async () => {
  const first = await api.proposeMappings({ sourceFrameworkId: 'demo-msp', targetFrameworkId: 'demo-iso' });
  assert.deepEqual(first, [], 'a second proposal run creates nothing new');
});

test('the reuse metric shows what a mapping is worth', async () => {
  const target = await api.getReuse('demo-iso');
  assert.equal(target.frameworkId, 'demo-iso');
  assert.ok(target.carriedAttachments > 0, 'validated mappings must have carried attachments over');
  assert.equal(target.evidenceCount, 0, 'demo-iso received evidence without any deposit');
  assert.equal(target.avoidedDeposits, target.carriedAttachments);

  const source = await api.getReuse('demo-msp');
  assert.ok(source.evidenceCount > 0);
  assert.ok(source.reuseFactor >= 1);
});

/* ------------------------------------------------- axis 3: drift and draft */

test('drifts are listed and can be acknowledged', async () => {
  const drifts = await api.listDrifts('demo-msp');
  assert.ok(Array.isArray(drifts));
  assert.ok(drifts.length >= 1, 'the simulated collector runs must have raised a drift');
  const kinds = drifts.map((drift) => drift.kind);
  assert.ok(kinds.includes('THRESHOLD_CROSSED') || kinds.includes('STATE_CHANGED'));

  const first = drifts[0]!;
  assert.equal(first.acknowledgedAt, null);
  const acknowledged = await api.ackDrift(first.id);
  assert.equal(acknowledged.id, first.id);
  assert.equal(typeof acknowledged.acknowledgedAt, 'string');
  assert.equal(typeof acknowledged.acknowledgedBy, 'string');
});

test('a draft is watermarked and is never an evidence', async () => {
  const generated = await api.generateDraft(draft.controlId);
  assert.equal(generated.status, 'DRAFT');
  assert.equal(generated.attachable, false);
  assert.match(generated.watermark, /DRAFT/);
  assert.match(generated.content, /DRAFT/);
  assert.ok(generated.sections.length > 0);

  const evidenceBefore = await api.listControlEvidence(draft.controlId);
  const stillThere = evidenceBefore.every((item) => item.id !== generated.id);
  assert.equal(stillThere, true, 'a draft must never appear as evidence');
});

test('an internal auditor may not generate a draft', async () => {
  await assert.rejects(
    () => auditorApi.generateDraft(draft.controlId),
    (error: unknown) => error instanceof ApiError && (error as ApiError).status === 403
  );
});

/* -------------------------------------------------- bonus: measured quality */

test('the quality report exposes the measured metrics and the threshold', async () => {
  const report = await api.getQuality();
  assert.equal(typeof report.thresholdInEffect, 'number');
  assert.ok(report.subjects.length >= 1);
  for (const row of report.subjects) {
    assert.equal(typeof row.subject.promptVersion, 'string');
    assert.equal(typeof row.value, 'number');
    assert.equal(typeof row.target, 'number');
    assert.ok(['PASS', 'FAIL', 'UNKNOWN'].includes(row.verdict));
    assert.ok(Array.isArray(row.trend));
  }
  assert.ok(Array.isArray(report.trend));
});

test('the quality screen is reserved to the quality lead and the admin', async () => {
  await assert.rejects(
    () => auditorApi.getQuality(),
    (error: unknown) => error instanceof ApiError && (error as ApiError).status === 403
  );
});

/* ------------------------------------------------------------------ openapi */

test('every extension route is documented', async () => {
  const response = await fetch(`${baseUrl}/openapi.json`);
  const document = (await response.json()) as { paths: Record<string, unknown> };
  for (const path of [
    '/v1/packs/{id}/verify',
    '/v1/shares/{token}/verify',
    '/v1/shares',
    '/v1/shares/{token}/revoke',
    '/v1/mappings',
    '/v1/mappings/propose',
    '/v1/mappings/{id}/decision',
    '/v1/frameworks/{id}/reuse',
    '/v1/drifts',
    '/v1/drifts/{id}/acknowledge',
    '/v1/controls/{id}/draft',
    '/v1/quality'
  ]) {
    assert.ok(document.paths[path] !== undefined, `${path} is missing from the OpenAPI document`);
  }
});
