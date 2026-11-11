/**
 * Reminder route — EF-REL-01/02/03.
 *
 * The body is the bare list of reminders the pipeline sent, newest first; a
 * control owner only sees the reminders of its own controls.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { Reminder } from '../../src/domain/types.ts';
import { TEST_NOW } from '../fixtures/builders.ts';
import { makeTestServices } from './fakeServices.ts';
import { frameworkPayload, importDemoFramework } from './fixtures.ts';
import { TOKENS, startTestApi } from './harness.ts';

/** Seeds one reminder in the store. */
async function seedReminder(
  services: ReturnType<typeof makeTestServices>,
  overrides: Partial<Reminder> = {}
): Promise<Reminder> {
  const reminder: Reminder = {
    id: 'rm-1',
    controlId: 'CONT-03',
    frameworkId: 'demo-msp',
    recipient: 'ops.lead',
    reason: 'NO_EVIDENCE',
    missing: [],
    message: 'No evidence has been recorded for this control.',
    createdAt: TEST_NOW,
    expiresAt: null,
    status: 'SENT',
    channel: 'memory-notifier',
    ...overrides
  };
  await services.state.putReminder(reminder);
  return reminder;
}

test('EF-REL-01: GET /v1/reminders lists the reminders', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await seedReminder(services);
    const response = await api.request('GET', '/v1/reminders', { token: TOKENS.qualityLead });
    assert.equal(response.status, 200);
    const reminders = response.json as Array<{ id: string; reason: string; status: string }>;
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0]?.reason, 'NO_EVIDENCE');
    assert.equal(reminders[0]?.status, 'SENT');
  } finally {
    await api.close();
  }
});

test('EF-REL-01: the reminder list filters on status and control', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await seedReminder(services, { id: 'rm-1', controlId: 'CONT-01', status: 'SENT' });
    await seedReminder(services, { id: 'rm-2', controlId: 'CONT-03', status: 'CLOSED' });
    const closed = await api.request('GET', '/v1/reminders?status=CLOSED', { token: TOKENS.qualityLead });
    assert.equal((closed.json as unknown[]).length, 1);
    const byControl = await api.request('GET', '/v1/reminders?controlId=CONT-01', {
      token: TOKENS.qualityLead
    });
    assert.equal((byControl.json as unknown[]).length, 1);
    const invalid = await api.request('GET', '/v1/reminders?status=LOST', { token: TOKENS.qualityLead });
    assert.equal(invalid.status, 400);
    const badLimit = await api.request('GET', '/v1/reminders?limit=0', { token: TOKENS.qualityLead });
    assert.equal(badLimit.status, 400);
  } finally {
    await api.close();
  }
});

test('EF-REL-01: a control owner sees only the reminders of its own controls', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    await seedReminder(services, { id: 'rm-1', controlId: 'CONT-01' });
    await seedReminder(services, { id: 'rm-2', controlId: 'CONT-99' });
    const response = await api.request('GET', '/v1/reminders', { token: TOKENS.controlOwner });
    assert.equal(response.status, 200);
    const reminders = response.json as Array<{ controlId: string }>;
    assert.equal(reminders.length, 1);
    assert.equal(reminders[0]?.controlId, 'CONT-01');
  } finally {
    await api.close();
  }
});

test('EF-REL-02: a real run records its reminders in the log', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    const payload = frameworkPayload();
    await api.request('POST', '/v1/frameworks', { token: TOKENS.qualityLead, body: payload });
    await api.request('POST', '/v1/controls/CONT-01/remind', { token: TOKENS.qualityLead, body: {} });
    const response = await api.request('GET', '/v1/reminders?controlId=CONT-01', {
      token: TOKENS.qualityLead
    });
    assert.equal(response.status, 200);
    const reminders = response.json as Array<{ message: string }>;
    assert.ok(reminders.length >= 1);
    assert.ok((reminders[0]?.message.length ?? 0) > 0);
  } finally {
    await api.close();
  }
});

test('GET /v1/reminders requires a credential', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('GET', '/v1/reminders', { token: null });
    assert.equal(response.status, 401);
  } finally {
    await api.close();
  }
});

test('importDemoFramework is reusable by the reminder suite', async () => {
  const api = await startTestApi();
  try {
    const response = await importDemoFramework(api);
    assert.equal(response.status, 201);
  } finally {
    await api.close();
  }
});
