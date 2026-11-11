/**
 * Guards of the `ai` module that run without any AWS call: PII masking,
 * access-level filtering, the anchoring contract, and the "never load the SDK"
 * promise the offline demo depends on (ENF-CONF-02, EF-QR-03, ENF-IA-02).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { PII_TOKENS, containsPii, redactPii } from '../../src/ai/pii.ts';
import { citedSpans, isLiterallyAnchored, unsupportedSpans } from '../../src/ai/anchoring.ts';
import { accessFilter, controlFromMetadata, knowledgeBaseIds, metaList, metaString } from '../../src/ai/bedrock/knowledgeBase.ts';
import { inferAccessLevel, normaliseEvidenceType, splitPages, buildPeriod } from '../../src/ai/reading.ts';
import type { Passage } from '../../src/domain/types.ts';

function passage(overrides: Partial<Passage> = {}): Passage {
  return {
    evidenceId: 'ev-1',
    title: 'Restoration report',
    documentDate: '2026-10-14',
    page: 2,
    text: 'Restoration of the customer database on 14 October 2026 took 42 minutes.',
    score: 0.8,
    accessLevel: 'INTERNAL',
    ...overrides
  };
}

test('PII masking replaces e-mail, phone, IBAN and card numbers', () => {
  const outcome = redactPii(
    'Mail jean.dupont@msp.demo, tel +33 6 12 34 56 78, IBAN FR76 3000 6000 0112 3456 7890 189, carte 4111 1111 1111 1111.'
  );
  assert.equal(outcome.redacted, true);
  assert.ok(outcome.text.includes(PII_TOKENS.email));
  assert.ok(outcome.text.includes(PII_TOKENS.phone));
  assert.ok(outcome.text.includes(PII_TOKENS.iban));
  assert.ok(outcome.text.includes(PII_TOKENS.card));
  assert.equal(outcome.hits, 4);
  assert.equal(containsPii(outcome.text), false);
});

test('PII masking leaves dates, versions and counts alone', () => {
  const text = 'Version 3.1 reviewed on 2026-10-14, 42 minutes, 12 tickets, page 3.';
  const outcome = redactPii(text);
  assert.equal(outcome.redacted, false);
  assert.equal(outcome.text, text);
});

test('PII masking is idempotent', () => {
  const once = redactPii('Contact jean.dupont@msp.demo now').text;
  const twice = redactPii(once).text;
  assert.equal(once, twice);
});

test('citedSpans extracts quoted spans, then falls back to sentences', () => {
  assert.deepEqual(citedSpans('As stated: "the restore took 42 minutes"'), ['the restore took 42 minutes']);
  const long = 'The restoration took 42 minutes according to the report of the operations team.';
  assert.deepEqual(citedSpans(long), [long]);
  assert.deepEqual(citedSpans('Short.'), []);
});

test('anchoring accepts provenance and rejects an invented quote', () => {
  const answer = 'According to "Restoration report": "took 42 minutes".';
  assert.equal(isLiterallyAnchored(answer, [passage()]), true);
  assert.deepEqual(unsupportedSpans(answer, [passage()]), []);

  const invented = 'According to "Restoration report": "the restore was audited by an external firm".';
  assert.equal(isLiterallyAnchored(invented, [passage()]), false);
  assert.equal(unsupportedSpans(invented, [passage()]).length, 1);
});

test('anchoring rejects everything when no passage was retrieved', () => {
  assert.equal(isLiterallyAnchored('According to "Restoration report": "took 42 minutes".', []), false);
});

test('the knowledge-base access filter restricts the levels in the request', () => {
  assert.deepEqual(accessFilter(['PUBLIC', 'INTERNAL']), {
    in: { key: 'accessLevel', value: ['PUBLIC', 'INTERNAL'] }
  });
});

test('a control is rebuilt from knowledge-base metadata', () => {
  const control = controlFromMetadata({
    controlId: 'CONT-03',
    frameworkId: 'demo-msp',
    title: 'Backups are tested',
    requirement: 'A restore is performed every quarter.',
    expectedEvidence: 'Test date|Recovery time|Signatory',
    periodicity: 'P3M',
    owner: 'ops',
    mandatory: 'true'
  });
  assert.equal(control?.id, 'CONT-03');
  assert.deepEqual(control?.expectedEvidence, ['Test date', 'Recovery time', 'Signatory']);
  assert.equal(control?.periodicity, 'P3M');
  assert.equal(control?.mandatory, true);
  assert.equal(controlFromMetadata({}), null);
});

test('metadata helpers tolerate scalars, lists and absence', () => {
  assert.equal(metaString({ a: 'x' }, 'a'), 'x');
  assert.equal(metaString({ a: 3 }, 'a'), '3');
  assert.equal(metaString({ a: ['x'] }, 'a'), 'x');
  assert.equal(metaString({}, 'a'), null);
  assert.deepEqual(metaList({ a: ['x', 'y'] }, 'a'), ['x', 'y']);
  assert.deepEqual(metaList({ a: 'x|y' }, 'a'), ['x', 'y']);
  assert.deepEqual(metaList({}, 'a'), []);
});

test('knowledge-base ids come from the environment and may be empty', () => {
  assert.deepEqual(knowledgeBaseIds({}), { frameworks: '', evidence: '' });
  assert.deepEqual(knowledgeBaseIds({ REGISTRE_KB_FRAMEWORKS_ID: 'a', REGISTRE_KB_EVIDENCE_ID: 'b' }), {
    frameworks: 'a',
    evidence: 'b'
  });
});

test('the access level is restricted as soon as there is personal data or a client', () => {
  assert.equal(inferAccessLevel({ personalData: true, client: null }), 'RESTRICTED');
  assert.equal(inferAccessLevel({ personalData: false, client: 'Acme Corp' }), 'RESTRICTED');
  assert.equal(inferAccessLevel({ personalData: false, client: null }), 'INTERNAL');
});

test('the evidence type is normalised into the closed list', () => {
  assert.equal(normaliseEvidenceType('Policy'), 'POLICY');
  assert.equal(normaliseEvidenceType('compte rendu'), 'MINUTES');
  assert.equal(normaliseEvidenceType('EXPORT'), 'EXPORT');
  assert.equal(normaliseEvidenceType('unknown thing'), null);
  assert.equal(normaliseEvidenceType(null), null);
});

test('pages are split on form feed and a period never ends before it starts', () => {
  const pages = splitPages('page one\fpage two');
  assert.deepEqual(
    pages.map((page) => page.page),
    [1, 2]
  );
  assert.equal(splitPages('single').length, 1);
  assert.deepEqual(buildPeriod('2026-12-31', '2026-01-01'), { start: '2026-12-31', end: '2026-12-31' });
  assert.deepEqual(buildPeriod(null, null), { start: null, end: null });
});
