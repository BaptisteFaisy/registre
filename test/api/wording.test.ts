/**
 * ENF-IA-01 — the tool never describes a control with the forbidden wording.
 *
 * This suite walks every endpoint of chapter 15, reads the whole response body
 * of each, and checks that none of them qualifies a control that way. It also
 * checks the control state vocabulary itself: the five states of chapter 12.3,
 * and nothing else.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { containsForbiddenWord, findViolations } from '../../src/domain/vocabulary.ts';
import { CONTROL_STATES } from '../../src/domain/types.ts';
import { buildOpenApiDocument } from '../../src/api/openapi.ts';
import { depositPolicy, depositRestricted, importDemoFramework } from './fixtures.ts';
import { TOKENS, startTestApi } from './harness.ts';

/** One call of the walk: a method, a path, a body. */
interface Call {
  method: string;
  path: string;
  body?: unknown;
}

/** Every endpoint of chapter 15, called with a payload that succeeds. */
function callsOf(evidenceId: string): Call[] {
  return [
    { method: 'GET', path: '/v1/frameworks' },
    { method: 'GET', path: '/v1/frameworks/demo-msp/controls' },
    { method: 'GET', path: '/v1/frameworks/demo-msp/readiness' },
    { method: 'GET', path: `/v1/evidence/${evidenceId}` },
    { method: 'GET', path: '/v1/evidence/' + evidenceId + '?include=text' },
    { method: 'GET', path: '/v1/controls/CONT-01' },
    { method: 'GET', path: '/v1/controls/CONT-01/evidence' },
    { method: 'GET', path: '/v1/validations?status=pending' },
    { method: 'GET', path: '/v1/reminders' },
    { method: 'GET', path: '/v1/audit-log' },
    { method: 'GET', path: '/v1/settings' },
    { method: 'GET', path: '/openapi.json' },
    { method: 'GET', path: '/healthz' },
    { method: 'POST', path: '/v1/ask', body: { question: 'When was the policy reviewed?' } }
  ];
}

test('ENF-IA-01: no endpoint response qualifies a control with the forbidden wording', async () => {
  const api = await startTestApi();
  const bodies: Array<{ label: string; text: string }> = [];
  try {
    await importDemoFramework(api);
    const deposit = await depositPolicy(api);
    const evidenceId = (deposit.json as { evidenceId: string }).evidenceId;
    for (const call of callsOf(evidenceId)) {
      const response = await api.request(call.method, call.path, {
        token: call.path === '/healthz' || call.path === '/openapi.json' ? null : TOKENS.qualityLead,
        ...(call.body === undefined ? {} : { body: call.body })
      });
      bodies.push({ label: `${call.method} ${call.path}`, text: response.text });
    }
    for (const body of bodies) {
      const violations = findViolations(body.text);
      assert.deepEqual(violations, [], `${body.label} uses the forbidden wording: ${JSON.stringify(violations)}`);
    }
  } finally {
    await api.close();
  }
});

test('ENF-IA-01: the restricted evidence response says nothing about a control either', async () => {
  const api = await startTestApi();
  try {
    const deposit = await depositRestricted(api);
    const evidenceId = (deposit.json as { evidenceId: string }).evidenceId;
    const response = await api.request('GET', `/v1/evidence/${evidenceId}?include=text`, {
      token: TOKENS.qualityLead
    });
    assert.equal(response.status, 200);
    assert.ok(!containsForbiddenWord(response.text));
  } finally {
    await api.close();
  }
});

test('ENF-IA-01: the control state vocabulary is the five states of chapter 12.3', () => {
  assert.deepEqual([...CONTROL_STATES], ['COVERED', 'TO_RENEW', 'TO_VERIFY', 'EXPIRED', 'NO_EVIDENCE']);
  for (const state of CONTROL_STATES) assert.ok(!containsForbiddenWord(state));
});

test('ENF-IA-01: the OpenAPI document is free of the forbidden wording too', () => {
  const text = JSON.stringify(buildOpenApiDocument());
  assert.ok(!containsForbiddenWord(text));
});

test('ENF-IA-01: the state of a control is always one of the five states', async () => {
  const api = await startTestApi();
  try {
    await importDemoFramework(api);
    const response = await api.request('GET', '/v1/frameworks/demo-msp/controls', {
      token: TOKENS.qualityLead
    });
    const controls = (response.json as { controls: Array<{ state: string | null }> }).controls;
    assert.ok(controls.length >= 1);
    for (const control of controls) {
      if (control.state === null) continue;
      assert.ok(CONTROL_STATES.includes(control.state as (typeof CONTROL_STATES)[number]));
    }
  } finally {
    await api.close();
  }
});
