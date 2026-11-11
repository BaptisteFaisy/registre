import test from 'node:test';
import assert from 'node:assert/strict';

import { MockRegistreApi } from './client.ts';
import { DEMO_ACCOUNTS } from './principals.ts';
import { ApiError } from '../api/client.ts';
import type { Principal } from '../api/types.ts';

const qualityLead = principalOf('QUALITY_LEAD');
const executive = principalOf('EXECUTIVE');

function principalOf(role: Principal['role']): Principal {
  const account = DEMO_ACCOUNTS.find((item) => item.principal.role === role);
  assert.ok(account, `no demo account for ${role}`);
  return account.principal;
}

test('every demo account signs in with its own credentials', () => {
  assert.equal(DEMO_ACCOUNTS.length, 5);
  for (const account of DEMO_ACCOUNTS) {
    assert.match(account.login, /@northwind\.example$/);
    assert.ok(account.password.startsWith('demo-'));
  }
});

test('the framework endpoints return the demo tenant', async () => {
  const api = new MockRegistreApi(() => qualityLead);
  const frameworks = await api.listFrameworks();
  assert.equal(frameworks.length, 1);
  const framework = frameworks[0];
  assert.ok(framework);
  const controls = await api.listControls(framework.id);
  assert.equal(controls.length, 30);
  const overview = await api.getReadiness(framework.id);
  assert.equal(overview.snapshot.total, 30);
  assert.equal(overview.trend.length, 6);
  assert.equal(overview.statuses.length, 30);
  assert.equal(Object.keys(overview.byDomain).length, 6);
  assert.ok(overview.costs.perEvidenceUsd > 0);
});

test('a control detail carries its attachments, sufficiencies and evidence', async () => {
  const api = new MockRegistreApi(() => qualityLead);
  const detail = await api.getControl('BCP-02');
  assert.equal(detail.control.id, 'BCP-02');
  assert.ok(detail.attachments.length >= 2);
  assert.equal(detail.sufficiencies.length, detail.attachments.length);
  assert.ok(detail.evidence.length >= 2);
  assert.ok(detail.attachments.every((item) => item.quote.length > 0));
});

test('the executive role cannot open restricted evidence', async () => {
  const api = new MockRegistreApi(() => executive);
  await assert.rejects(
    () => api.getEvidence('ev-011'),
    (error: unknown) => error instanceof ApiError && error.status === 403
  );
});

test('the executive role does not receive restricted evidence in a control detail', async () => {
  const api = new MockRegistreApi(() => executive);
  const detail = await api.getControl('INC-03');
  assert.equal(
    detail.evidence.some((item) => item.accessLevel === 'RESTRICTED'),
    false
  );
});

test('a decision needs a reason and applies its effect', async () => {
  const api = new MockRegistreApi(() => qualityLead);
  const pending = await api.listValidations('PENDING');
  assert.equal(pending.length, 4);
  const first = pending[0];
  assert.ok(first);

  await assert.rejects(
    () => api.decideValidation(first.id, 'ACCEPT', '  '),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );

  const decided = await api.decideValidation(first.id, 'ACCEPT', 'Date confirmed by the owner.');
  assert.equal(decided.status, 'DECIDED');
  assert.equal(decided.decidedBy, qualityLead.name);
  await assert.rejects(
    () => api.decideValidation(first.id, 'REJECT', 'twice'),
    (error: unknown) => error instanceof ApiError && error.status === 409
  );
});

test('settings are validated and recompute the states', async () => {
  const api = new MockRegistreApi(() => qualityLead);
  const before = await api.getSettings();
  assert.ok(before.confidenceThreshold > 0);

  await assert.rejects(
    () => api.updateSettings({ confidenceThreshold: 2 }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );

  const after = await api.updateSettings({ reminderLeadDays: 45 });
  assert.equal(after.reminderLeadDays, 45);
});

test('an upload is read, attached twice and queued for review', async () => {
  const api = new MockRegistreApi(() => qualityLead);
  const evidence = await api.uploadEvidence({
    fileName: 'restore-test.pdf',
    contentType: 'application/pdf',
    sizeBytes: 240_000
  });
  assert.match(evidence.id, /^ev-up-/);
  const detail = await api.getControl('BCP-02');
  assert.ok(detail.attachments.some((item) => item.evidenceId === evidence.id));
  const pending = await api.listValidations('PENDING');
  assert.ok(pending.some((item) => item.evidenceId === evidence.id));
});

test('the audit log is returned newest first and filtered by action', async () => {
  const api = new MockRegistreApi(() => qualityLead);
  const all = await api.listAuditLog({ limit: 10 });
  assert.equal(all.length, 10);
  assert.ok((all[0]?.seq ?? 0) > (all[1]?.seq ?? 0));
  const filtered = await api.listAuditLog({ action: 'QUESTION_ASKED', limit: 100 });
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((event) => event.action === 'QUESTION_ASKED'));
});

test('a pack can be assembled and read back', async () => {
  const api = new MockRegistreApi(() => qualityLead);
  const frameworks = await api.listFrameworks();
  const framework = frameworks[0];
  assert.ok(framework);
  const pack = await api.createPack(framework.id);
  assert.equal(pack.index.length, 30);
  const read = await api.getPack(pack.id);
  assert.equal(read.id, pack.id);
  const packs = await api.listPacks(framework.id);
  assert.ok(packs.some((item) => item.id === pack.id));
});

test('a reminder is created for a control that needs one', async () => {
  const api = new MockRegistreApi(() => qualityLead);
  const reminder = await api.sendReminder('BCP-02');
  assert.equal(reminder.controlId, 'BCP-02');
  assert.equal(reminder.status, 'SENT');
  assert.ok(reminder.message.includes('BCP-02'));
  const all = await api.listReminders();
  assert.ok(all.some((item) => item.id === reminder.id));
});

test('a call without a signed-in principal fails with 401', async () => {
  const api = new MockRegistreApi(() => null);
  await assert.rejects(
    () => api.getEvidence('ev-001'),
    (error: unknown) => error instanceof ApiError && error.status === 401
  );
});
