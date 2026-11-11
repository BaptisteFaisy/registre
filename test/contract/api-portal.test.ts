/**
 * Contract test — the real portal client against the real API server.
 *
 * Two modules were written in parallel and each kept its own copy of the
 * shapes: `portal/src/api/types.ts` (the consumer) and `src/api/views.ts` (the
 * producer). This file is the proof that they agree: it boots `src/api/server.ts`
 * on an ephemeral port, seeds it with the demonstration set, and drives every
 * method of `HttpRegistreApi` over real HTTP.
 *
 * No network outside 127.0.0.1, no AWS, no fixed port, no long sleeps.
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
import { ApiError, HttpRegistreApi } from '../../portal/src/api/client.ts';
import { EVIDENCE } from '../../eval/catalogue.ts';

const QUALITY = DEMO_IDENTITIES[0]!;
const AUDITOR = DEMO_IDENTITIES[2]!;

const workspace = mkdtempSync(join(tmpdir(), 'registre-contract-'));

let services: Services;
let server: RegistreServer;
let baseUrl: string;
let api: HttpRegistreApi;
let auditorApi: HttpRegistreApi;

before(async () => {
  const seeded = await seedDemoData({ vaultRoot: join(workspace, 'vault') });
  services = seeded.services;
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

/** Portal client authenticated as one demonstration identity. */
function clientFor(login: string, password: string): HttpRegistreApi {
  const token = demoToken(login, password);
  return new HttpRegistreApi({ baseUrl, tokens: { token: () => token } });
}

/** Reads a demonstration identity by role. */
function identityOf(role: string): { principal: { email: string }; password: string } {
  const found = DEMO_IDENTITIES.find((identity) => identity.principal.role === role);
  assert.ok(found, `no demonstration identity for role ${role}`);
  return found;
}

/* ------------------------------------------------------------- session */

test('POST /v1/auth/session returns a usable token and the principal', async () => {
  const response = await fetch(`${baseUrl}/v1/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: QUALITY.principal.email, password: QUALITY.password })
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { token: string; principal: { id: string; role: string } };
  assert.equal(typeof body.token, 'string');
  assert.equal(body.principal.role, 'QUALITY_LEAD');
  assert.match(response.headers.get('set-cookie') ?? '', /registre_session=/);

  const refused = await fetch(`${baseUrl}/v1/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: QUALITY.principal.email, password: 'wrong' })
  });
  assert.equal(refused.status, 401);
});

test('GET /v1/auth/accounts lists identities without any password', async () => {
  const response = await fetch(`${baseUrl}/v1/auth/accounts`);
  assert.equal(response.status, 200);
  const raw = await response.text();
  const accounts = JSON.parse(raw) as Array<{ login: string; role: string; name: string }>;
  assert.equal(accounts.length, DEMO_IDENTITIES.length);
  for (const account of accounts) {
    assert.equal(typeof account.login, 'string');
    assert.equal(typeof account.role, 'string');
    assert.equal(typeof account.name, 'string');
  }
  for (const identity of DEMO_IDENTITIES) {
    assert.ok(!raw.includes(identity.password), 'a password must never leave the server');
  }
});

/* ---------------------------------------------------------- frameworks */

test('GET /v1/frameworks returns a bare array of frameworks', async () => {
  const frameworks = await api.listFrameworks();
  assert.ok(Array.isArray(frameworks));
  const demo = frameworks.find((framework) => framework.id === 'demo-msp');
  assert.ok(demo, 'the demonstration framework must be listed');
  assert.equal(typeof demo.name, 'string');
  assert.equal(typeof demo.version, 'string');
  assert.equal(typeof demo.importedAt, 'string');
});

test('GET /v1/frameworks/{id}/controls returns bare controls', async () => {
  const controls = await api.listControls('demo-msp');
  assert.ok(Array.isArray(controls));
  assert.equal(controls.length, 30);
  for (const control of controls) {
    assert.equal(typeof control.id, 'string');
    assert.equal(typeof control.requirement, 'string');
    assert.ok(Array.isArray(control.expectedEvidence));
    assert.match(control.periodicity, /^P/);
    assert.equal(typeof control.mandatory, 'boolean');
  }
});

test('GET /v1/frameworks/{id}/readiness returns the whole dashboard', async () => {
  const overview = await api.getReadiness('demo-msp');
  for (const key of ['framework', 'snapshot', 'trend', 'statuses', 'byDomain', 'costs'] as const) {
    assert.ok(overview[key] !== undefined, `ReadinessOverview is missing "${key}"`);
  }
  assert.equal(overview.framework.id, 'demo-msp');
  assert.equal(overview.snapshot.total, 30);
  assert.equal(overview.statuses.length, 30);
  const sum = Object.values(overview.snapshot.counts).reduce((total, value) => total + value, 0);
  assert.equal(sum, 30);
  assert.ok(Object.keys(overview.byDomain).length >= 5, 'the domains must be broken down');
  assert.equal(typeof overview.costs.totalUsd, 'number');
  assert.equal(typeof overview.costs.perEvidenceUsd, 'number');
  assert.ok(Array.isArray(overview.trend));
});

/* ------------------------------------------------------------ controls */

test('GET /v1/controls/{id} returns the control with its relations', async () => {
  const detail = await api.getControl('CONT-01');
  for (const key of ['control', 'status', 'attachments', 'sufficiencies', 'evidence'] as const) {
    assert.ok(key in detail, `ControlWithRelations is missing "${key}"`);
  }
  assert.equal(detail.control.id, 'CONT-01');
  assert.ok(Array.isArray(detail.attachments));
  assert.ok(Array.isArray(detail.sufficiencies));
  assert.ok(Array.isArray(detail.evidence));
  const first = detail.attachments[0];
  if (first !== undefined) {
    assert.equal(typeof first.id, 'string');
    assert.equal(typeof first.quote, 'string');
    assert.ok('page' in first.quoteLocation);
  }
});

test('GET /v1/controls/{id}/evidence returns bare evidence with excerpts', async () => {
  const evidence = await api.listControlEvidence('CONT-01');
  assert.ok(Array.isArray(evidence));
  assert.ok(evidence.length > 0);
  for (const item of evidence) {
    assert.equal(typeof item.id, 'string');
    assert.equal(item.sha256.length, 64);
    assert.ok(Array.isArray(item.textPages));
    assert.ok(item.fields !== undefined);
    assert.ok(item.flags !== undefined);
  }
});

/* ------------------------------------------------------------ evidence */

test('POST /v1/evidence accepts base64 bytes and GET returns the evidence', async () => {
  const text = [
    '---',
    'Title: Contract test note',
    'Type: Report',
    `Date: ${new Date().toISOString().slice(0, 10)}`,
    'Author: Contract test',
    'Personal data: no',
    'Summary: Note deposited by the portal contract test.',
    '---',
    '',
    'The quarterly access review was performed and every account was checked.'
  ].join('\n');
  const bytes = new TextEncoder().encode(text);
  const uploaded = await api.uploadEvidence({
    fileName: 'contract-test-note.md',
    contentType: 'text/markdown',
    bytes
  });
  assert.equal(typeof uploaded.id, 'string');
  assert.equal(uploaded.sha256.length, 64);
  assert.equal(uploaded.fields.title, 'Contract test note');

  const read = await api.getEvidence(uploaded.id);
  assert.equal(read.id, uploaded.id);
  assert.ok(Array.isArray(read.textPages));
  assert.ok(read.textPages.length > 0);
});

/* ---------------------------------------------------------- validation */

test('the validation queue is a bare array and a decision is recorded', async () => {
  const queue = await api.listValidations('PENDING');
  assert.ok(Array.isArray(queue));
  assert.ok(queue.length > 0, 'the demonstration set leaves items to review');
  const item = queue[0]!;
  assert.equal(item.status, 'PENDING');

  const decided = await api.decideValidation(item.id, 'ACCEPT', 'Accepted by the contract test.');
  assert.equal(decided.id, item.id);
  assert.equal(decided.status, 'DECIDED');
  assert.equal(decided.decision, 'ACCEPT');
  assert.equal(decided.note, 'Accepted by the contract test.');
  assert.equal(typeof decided.decidedAt, 'string');
  assert.equal(typeof decided.decidedBy, 'string');
});

/* ---------------------------------------------------------------- ask */

test('POST /v1/ask answers with citations, and refuses when nothing answers', async () => {
  const answered = await api.ask('When was the information security policy last reviewed and who approved it?');
  assert.equal(answered.noEvidence, false);
  assert.ok(answered.citations.length > 0);
  for (const citation of answered.citations) {
    assert.equal(typeof citation.evidenceId, 'string');
    assert.ok(citation.quote.length > 0);
  }

  const refused = await api.ask('What was the result of the penetration test of the production cluster?');
  assert.equal(refused.noEvidence, true);
  assert.equal(refused.citations.length, 0);
  assert.equal(refused.text, 'No evidence answers this question.');
});

/* --------------------------------------------------------------- packs */

test('a pack is assembled, readable and listed', async () => {
  const created = await api.createPack('demo-msp');
  assert.equal(created.frameworkId, 'demo-msp');
  assert.equal(created.checksumsVerified, true);
  assert.ok(created.index.length > 0);
  assert.equal(created.archive.sha256.length, 64);

  const read = await api.getPack(created.id);
  assert.equal(read.id, created.id);

  const all = await api.listPacks('demo-msp');
  assert.ok(Array.isArray(all));
  assert.ok(all.some((pack) => pack.id === created.id));
});

/* ------------------------------------------------- reminders and audit */

test('reminders and the audit log are bare arrays', async () => {
  const reminders = await api.listReminders();
  assert.ok(Array.isArray(reminders));
  for (const reminder of reminders.slice(0, 3)) {
    assert.equal(typeof reminder.controlId, 'string');
    assert.ok(Array.isArray(reminder.missing));
    assert.equal(typeof reminder.message, 'string');
  }

  const events = await api.listAuditLog({ limit: 5 });
  assert.ok(Array.isArray(events));
  assert.ok(events.length <= 5);
  for (const event of events) {
    assert.equal(typeof event.seq, 'number');
    assert.equal(typeof event.hash, 'string');
    assert.equal(typeof event.action, 'string');
  }
});

/* ------------------------------------------------------------ settings */

test('settings are read and patched', async () => {
  const before = await api.getSettings();
  assert.equal(typeof before.confidenceThreshold, 'number');
  assert.equal(typeof before.reminderLeadDays, 'number');

  const updated = await api.updateSettings({ confidenceThreshold: 0.9 });
  assert.equal(updated.confidenceThreshold, 0.9);
  assert.equal(updated.reminderLeadDays, before.reminderLeadDays);

  await api.updateSettings({ confidenceThreshold: before.confidenceThreshold });
});

/* -------------------------------------------------------------- rights */

test('a restricted evidence is refused to an internal auditor (R13)', async () => {
  const restricted = EVIDENCE.filter((item) => item.accessLevel === 'RESTRICTED');
  assert.ok(restricted.length > 0, 'the demonstration set must carry restricted evidence');
  const stored = await services.state.listEvidence();
  const target = stored.find(
    (evidence) => evidence.accessLevel === 'RESTRICTED' && evidence.fields.personalData
  );
  assert.ok(target, 'a restricted evidence must be ingested');

  await assert.rejects(
    () => auditorApi.getEvidence(target.id),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 403);
      return true;
    }
  );
  assert.equal(identityOf('INTERNAL_AUDITOR').principal.email, AUDITOR.principal.email);
});

/* ------------------------------------------------------------- openapi */

test('every path the portal calls is documented', async () => {
  const response = await fetch(`${baseUrl}/openapi.json`);
  assert.equal(response.status, 200);
  const document = (await response.json()) as { paths: Record<string, unknown> };
  const expected = [
    '/v1/frameworks',
    '/v1/frameworks/{id}/controls',
    '/v1/frameworks/{id}/readiness',
    '/v1/frameworks/{id}/packs',
    '/v1/evidence',
    '/v1/evidence/{id}',
    '/v1/controls/{id}',
    '/v1/controls/{id}/evidence',
    '/v1/controls/{id}/remind',
    '/v1/validations',
    '/v1/validations/{id}/decision',
    '/v1/ask',
    '/v1/packs',
    '/v1/packs/{id}',
    '/v1/reminders',
    '/v1/audit-log',
    '/v1/settings',
    '/v1/auth/session',
    '/v1/auth/logout',
    '/v1/auth/accounts'
  ];
  for (const path of expected) {
    assert.ok(document.paths[path] !== undefined, `${path} is missing from the OpenAPI document`);
  }
});
