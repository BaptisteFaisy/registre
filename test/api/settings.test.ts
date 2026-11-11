/**
 * Settings routes — EF-ADM-01 (beyond the sixteen endpoints of chapter 15).
 *
 * The settings are read, updated, validated, and every update is journalled as
 * `SETTINGS_UPDATED`. A value that would describe a control with the forbidden
 * vocabulary is refused (ENF-IA-01).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { TOKENS, startTestApi } from './harness.ts';

test('EF-ADM-01: GET /v1/settings returns the tunables', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('GET', '/v1/settings', { token: TOKENS.qualityLead });
    assert.equal(response.status, 200);
    const body = response.json as {
      confidenceThreshold: number;
      reminderLeadDays: number;
      defaultPeriodicity: string;
      nightlyServiceTier: string;
    };
    assert.equal(body.confidenceThreshold, 0.85);
    assert.equal(body.reminderLeadDays, 30);
    assert.equal(body.defaultPeriodicity, 'P1Y');
    assert.ok(['FLEX', 'STANDARD'].includes(body.nightlyServiceTier));
  } finally {
    await api.close();
  }
});

test('EF-ADM-01: PUT /v1/settings stores the change and journals it', async () => {
  const api = await startTestApi();
  try {
    const response = await api.request('PUT', '/v1/settings', {
      token: TOKENS.qualityLead,
      body: { confidenceThreshold: 0.92, reminderLeadDays: 45 }
    });
    assert.equal(response.status, 200);
    const body = response.json as { confidenceThreshold: number; reminderLeadDays: number };
    assert.equal(body.confidenceThreshold, 0.92);
    assert.equal(body.reminderLeadDays, 45);
    const read = await api.request('GET', '/v1/settings', { token: TOKENS.qualityLead });
    assert.equal((read.json as { confidenceThreshold: number }).confidenceThreshold, 0.92);
    const events = await api.services.audit.list({ action: 'SETTINGS_UPDATED' });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.actor, 'u-quality');
  } finally {
    await api.close();
  }
});

test('EF-ADM-01: an out-of-range value is 400', async () => {
  const api = await startTestApi();
  try {
    const tooHigh = await api.request('PUT', '/v1/settings', {
      token: TOKENS.qualityLead,
      body: { confidenceThreshold: 4 }
    });
    assert.equal(tooHigh.status, 400);
    const badPeriodicity = await api.request('PUT', '/v1/settings', {
      token: TOKENS.qualityLead,
      body: { defaultPeriodicity: 'every year' }
    });
    assert.equal(badPeriodicity.status, 400);
    const badTier = await api.request('PUT', '/v1/settings', {
      token: TOKENS.qualityLead,
      body: { nightlyServiceTier: 'TURBO' }
    });
    assert.equal(badTier.status, 400);
  } finally {
    await api.close();
  }
});

test('ENF-IA-01: a setting that uses the forbidden wording is refused', async () => {
  const api = await startTestApi();
  try {
    const forbidden = ['conf', 'orme'].join('');
    const response = await api.request('PUT', '/v1/settings', {
      token: TOKENS.qualityLead,
      body: { region: `zone ${forbidden}` }
    });
    assert.equal(response.status, 400);
    assert.match(response.text, /ENF-IA-01/);
    const read = await api.request('GET', '/v1/settings', { token: TOKENS.qualityLead });
    assert.equal((read.json as { region: string }).region, 'eu-central-1', 'the stored value is unchanged');
  } finally {
    await api.close();
  }
});

test('EF-ADM-01: the settings are closed to an internal auditor', async () => {
  const api = await startTestApi();
  try {
    const read = await api.request('GET', '/v1/settings', { token: TOKENS.auditor });
    assert.equal(read.status, 403);
    const write = await api.request('PUT', '/v1/settings', { token: TOKENS.auditor, body: {} });
    assert.equal(write.status, 403);
  } finally {
    await api.close();
  }
});
