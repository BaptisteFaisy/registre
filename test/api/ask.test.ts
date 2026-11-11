/**
 * Question answering — EF-QR-01/02/03 (acceptance R11, R12, R13).
 *
 * A question with a matching evidence comes back cited (document, page, date);
 * a question with no support comes back `noEvidence: true`; a RESTRICTED
 * evidence is never cited to a principal without that clearance.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTestServices } from './fakeServices.ts';
import { depositPolicy, depositRestricted, policyCatalogEntry } from './fixtures.ts';
import { TOKENS, startTestApi } from './harness.ts';

/** Response shape of `POST /v1/ask`. */
interface AskBody {
  question: string;
  text: string;
  citations: Array<{ evidenceId: string; title: string | null; page: number | null; documentDate: string | null }>;
  noEvidence: boolean;
  redacted: boolean;
  passagesUsed: number;
}

test('EF-QR-01 (R11): a question with an evidence comes back with its citation', async () => {
  const services = makeTestServices({ catalog: { evidences: [policyCatalogEntry()] } });
  const api = await startTestApi({ services });
  try {
    await depositPolicy(api);
    const response = await api.request('POST', '/v1/ask', {
      token: TOKENS.auditor,
      body: { question: 'When was the information security policy reviewed?' }
    });
    assert.equal(response.status, 200);
    const body = response.json as AskBody;
    assert.equal(body.noEvidence, false);
    assert.ok(body.citations.length >= 1);
    const citation = body.citations[0];
    assert.ok(citation);
    assert.match(citation.evidenceId, /^ev-/);
    assert.equal(citation.documentDate, '2026-08-01');
    assert.ok(body.text.includes('1 August 2026'), 'the answer quotes the document');
  } finally {
    await api.close();
  }
});

test('EF-QR-02 (R12): a question without support answers noEvidence', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    const response = await api.request('POST', '/v1/ask', {
      token: TOKENS.auditor,
      body: { question: 'How many suppliers were audited in 2019?' }
    });
    assert.equal(response.status, 200);
    const body = response.json as AskBody;
    assert.equal(body.noEvidence, true);
    assert.deepEqual(body.citations, []);
    assert.equal(body.text, 'No evidence answers this question.');
  } finally {
    await api.close();
  }
});

test('EF-QR-03 (R13): a restricted evidence is never cited below its clearance', async () => {
  const services = makeTestServices();
  const api = await startTestApi({ services });
  try {
    const deposit = await depositRestricted(api);
    const evidenceId = (deposit.json as { evidenceId: string }).evidenceId;
    const asAuditor = await api.request('POST', '/v1/ask', {
      token: TOKENS.auditor,
      body: { question: 'Who attended the security training?' }
    });
    assert.equal(asAuditor.status, 200);
    const auditorBody = asAuditor.json as AskBody;
    assert.ok(
      !auditorBody.citations.some((citation) => citation.evidenceId === evidenceId),
      'the restricted evidence id must not appear in the auditor answer'
    );
    assert.ok(!asAuditor.text.includes('alice@msp.demo'), 'no personal data leaks in the answer');
  } finally {
    await api.close();
  }
});

test('POST /v1/ask is 400 for an empty or too short question', async () => {
  const api = await startTestApi();
  try {
    const empty = await api.request('POST', '/v1/ask', { token: TOKENS.auditor, body: { question: '  ' } });
    assert.equal(empty.status, 400);
    const missing = await api.request('POST', '/v1/ask', { token: TOKENS.auditor, body: {} });
    assert.equal(missing.status, 400);
  } finally {
    await api.close();
  }
});

test('POST /v1/ask checks the framework scope when one is given', async () => {
  const api = await startTestApi();
  try {
    const unknown = await api.request('POST', '/v1/ask', {
      token: TOKENS.auditor,
      body: { question: 'When was the policy reviewed?', frameworkId: 'no-such-framework' }
    });
    assert.equal(unknown.status, 404);
  } finally {
    await api.close();
  }
});
