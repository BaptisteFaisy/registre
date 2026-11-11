/**
 * Deterministic mocks: scripted reader, in-memory retrievers, guardrail,
 * composer and scripted reasoner (EF-LEC-01..04, EF-RAT-01, EF-QR-01/02/03).
 * No network, no AWS SDK, no clock.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAi } from '../../src/ai/mock/index.ts';
import { ScriptedReader, fieldsFromCsv } from '../../src/ai/mock/scriptedReader.ts';
import { MemoryControlRetriever, MemoryEvidenceRetriever } from '../../src/ai/mock/mockRetrievers.ts';
import { MockGuardrail } from '../../src/ai/mock/mockGuardrail.ts';
import { MockComposer } from '../../src/ai/mock/mockComposer.ts';
import { ScriptedReasoner, heuristicProposals } from '../../src/ai/mock/scriptedReasoner.ts';
import { isProposedAttachment } from '../../src/ai/schemas.ts';
import { NO_EVIDENCE_ANSWER } from '../../src/domain/types.ts';
import type { Passage, SufficiencyElement } from '../../src/domain/types.ts';
import type { ProposedAttachment } from '../../src/ports/index.ts';
import { makeControl, makeEvidence, makeFields, makePages } from '../fixtures/builders.ts';

const POLICY = [
  '---',
  'Title: Information security policy',
  'Type: Policy',
  'Date: 2026-08-01',
  'Period: 2026-01-01..2026-12-31',
  'Version: 3.1',
  'Author: A. Dupont',
  'Approved by: C. Bernard',
  'Approval date: 2026-08-05',
  'Personal data: no',
  '---',
  'The information security policy is reviewed once a year by the steering committee.',
  '\f',
  'Signatures and version history appear on this second page.'
].join('\n');

function readInput(text: string, contentType = 'text/markdown') {
  const bytes = new TextEncoder().encode(text);
  return {
    evidenceId: 'ev-1',
    contentType,
    sizeBytes: bytes.length,
    uri: 'file:///tmp/evidence.md',
    bytes
  };
}

function passages(): Passage[] {
  return [
    {
      evidenceId: 'ev-1',
      title: 'Restoration report',
      documentDate: '2026-10-14',
      page: 2,
      text: 'Restoration of the customer database on 14 October 2026 took 42 minutes and matched the source data.',
      score: 0.81,
      accessLevel: 'INTERNAL'
    },
    {
      evidenceId: 'ev-2',
      title: 'Backup policy',
      documentDate: '2026-07-01',
      page: 1,
      text: 'Backups are encrypted with KMS keys and tested every quarter.',
      score: 0.44,
      accessLevel: 'INTERNAL'
    }
  ];
}

test('scripted reader extracts the Annex B fields from a header block', async () => {
  const result = await new ScriptedReader().read(readInput(POLICY));
  assert.equal(result.fields.type, 'POLICY');
  assert.equal(result.fields.title, 'Information security policy');
  assert.equal(result.fields.documentDate, '2026-08-01');
  assert.deepEqual(result.fields.period, { start: '2026-01-01', end: '2026-12-31' });
  assert.equal(result.fields.version, '3.1');
  assert.equal(result.fields.author, 'A. Dupont');
  assert.equal(result.fields.approver, 'C. Bernard');
  assert.equal(result.fields.approvalDate, '2026-08-05');
  assert.equal(result.fields.personalData, false);
  assert.equal(result.accessLevel, 'INTERNAL');
  assert.equal(result.textPages.length, 2, 'form feed splits pages');
  assert.equal(result.flags.unreadable, false);
  assert.equal(result.flags.missingDate, false);
});

test('personal data or a named customer forces a restricted access level', async () => {
  const text = POLICY.replace('Personal data: no', 'Personal data: yes').replace('Version: 3.1', 'Client: Acme Corp');
  const result = await new ScriptedReader().read(readInput(text));
  assert.equal(result.fields.personalData, true);
  assert.equal(result.fields.client, 'Acme Corp');
  assert.equal(result.accessLevel, 'RESTRICTED');
});

test('a document with no date is flagged, and a diverging file date is to confirm', async () => {
  const noDate = POLICY.replace('Date: 2026-08-01\n', '');
  const result = await new ScriptedReader().read(readInput(noDate));
  assert.equal(result.fields.documentDate, null);
  assert.equal(result.flags.missingDate, true);

  const divergent = await new ScriptedReader().read({ ...readInput(POLICY), fileDate: '2026-09-01' });
  assert.equal(divergent.flags.dateToConfirm, true);
});

test('an unreadable document is flagged instead of crashing', async () => {
  const result = await new ScriptedReader().read(readInput('x'));
  assert.equal(result.flags.unreadable, true);
});

test('a CSV export derives its period from the row dates', () => {
  const csv = ['date;ticket;subject', '2026-01-04;T-1;incident', '2026-03-28;T-2;incident', '2026-02-11;T-3;change'].join('\n');
  const fields = fieldsFromCsv(csv);
  assert.equal(fields.type, 'EXPORT');
  assert.deepEqual(fields.period, { start: '2026-01-04', end: '2026-03-28' });
  assert.equal(fields.documentDate, '2026-03-28');
});

test('the control retriever ranks the matching control first', async () => {
  const policy = makeControl({ id: 'CONT-01', title: 'Information security policy reviewed annually' });
  const backup = makeControl({
    id: 'CONT-02',
    title: 'Backups are tested by a real restore',
    requirement: 'A backup restore is performed and recorded every quarter.',
    expectedEvidence: ['Test date', 'Recovery time']
  });
  const retriever = new MemoryControlRetriever([policy, backup]);
  const candidates = await retriever.candidates({
    type: 'POLICY',
    title: 'Information security policy',
    summary: 'Annual review of the information security policy',
    text: 'The policy is reviewed once a year.'
  });
  assert.equal(candidates[0]?.control.id, 'CONT-01');
  assert.ok((candidates[0]?.score ?? 0) > 0);
  assert.equal(candidates[0]?.matchedOn, 'token similarity');
});

test('the evidence retriever never returns a passage above the clearance', async () => {
  const restricted = makeEvidence({
    id: 'ev-restricted',
    accessLevel: 'RESTRICTED',
    fields: makeFields({ title: 'Restoration report' }),
    textPages: makePages('Restoration of the customer database on 14 October 2026 took 42 minutes.')
  });
  const internal = makeEvidence({
    id: 'ev-internal',
    accessLevel: 'INTERNAL',
    fields: makeFields({ title: 'Restoration procedure' }),
    textPages: makePages('The restoration procedure is documented and reviewed.')
  });
  const retriever = new MemoryEvidenceRetriever([restricted, internal]);

  const asInternal = await retriever.search({ query: 'restoration of the customer database', allowedLevels: ['PUBLIC', 'INTERNAL'] });
  assert.equal(asInternal.length, 1);
  assert.equal(asInternal[0]?.evidenceId, 'ev-internal');
  assert.equal(asInternal[0]?.accessLevel, 'INTERNAL');

  const asQualityLead = await retriever.search({
    query: 'restoration of the customer database',
    allowedLevels: ['PUBLIC', 'INTERNAL', 'RESTRICTED']
  });
  assert.equal(asQualityLead[0]?.evidenceId, 'ev-restricted');
  assert.ok(asQualityLead.every((passage) => passage.accessLevel !== 'PUBLIC'));
});

test('the mock guardrail accepts a literal citation and rejects an invented one', async () => {
  const guardrail = new MockGuardrail();
  const quoted = 'According to "Restoration report", page 2, dated 2026-10-14: "took 42 minutes and matched the source data"';
  const accepted = await guardrail.verifyAnchoring({ answer: quoted, passages: passages() });
  assert.equal(accepted.anchored, true);
  assert.deepEqual(accepted.unsupported, []);

  const invented = 'According to the report: "the restore was audited by an external firm in December"';
  const rejected = await guardrail.verifyAnchoring({ answer: invented, passages: passages() });
  assert.equal(rejected.anchored, false);
  assert.equal(rejected.unsupported.length, 1);

  const noPassage = await guardrail.verifyAnchoring({ answer: quoted, passages: [] });
  assert.equal(noPassage.anchored, false);
});

test('the mock guardrail masks personal data deterministically', async () => {
  const outcome = await new MockGuardrail().redact('Contact: jean.dupont@msp.demo, +33 6 12 34 56 78, le 14 octobre 2026');
  assert.equal(outcome.redacted, true);
  assert.ok(outcome.text.includes('[EMAIL]'));
  assert.ok(outcome.text.includes('[PHONE]'));
  assert.ok(outcome.text.includes('14 octobre 2026'), 'a date is not personal data');
  assert.equal(outcome.hits, 2);
});

test('the mock composer cites document, page and date', async () => {
  const draft = await new MockComposer().compose({ question: 'How long did the restore take?', passages: passages() });
  assert.equal(draft.citations.length, 1);
  assert.equal(draft.citations[0]?.evidenceId, 'ev-1');
  assert.equal(draft.citations[0]?.page, 2);
  assert.ok(draft.text.includes('Restoration report'));
  assert.ok(draft.text.includes('2026-10-14'));
  assert.ok(draft.text.includes(draft.citations[0]!.quote));
});

test('the mock composer answers the no-evidence sentence without passages', async () => {
  const draft = await new MockComposer().compose({ question: 'Any question', passages: [] });
  assert.equal(draft.text, NO_EVIDENCE_ANSWER);
  assert.deepEqual(draft.citations, []);
});

test('scripted proposals are returned as-is and conform to Annex C', async () => {
  const scripted: ProposedAttachment[] = [
    {
      controlId: 'CONT-01',
      supports: true,
      confidence: 0.92,
      quote: 'reviewed once a year by the steering committee',
      page: 1,
      reason: 'The policy states the annual review the control requires.'
    }
  ];
  const reasoner = new ScriptedReasoner({ attachments: new Map([['ev-1', scripted]]) });
  const proposals = await reasoner.proposeAttachments({
    evidence: { id: 'ev-1', fields: makeFields(), textPages: makePages(POLICY), accessLevel: 'INTERNAL' },
    candidates: [{ control: makeControl(), score: 0.9, matchedOn: 'title' }]
  });
  assert.deepEqual(proposals, scripted);
  for (const proposal of proposals) assert.equal(isProposedAttachment(proposal), true);
});

test('the heuristic fallback quotes a real sentence and covers every expected item', async () => {
  const control = makeControl({
    title: 'Information security policy reviewed annually',
    requirement: 'The information security policy is reviewed and approved at least once a year.',
    expectedEvidence: ['Policy title', 'Review date']
  });
  const evidence = {
    id: 'ev-1',
    fields: makeFields(),
    textPages: makePages('The information security policy is reviewed once a year by the steering committee.')
  };
  const proposals = heuristicProposals(evidence, [{ control }]);
  assert.equal(proposals.length, 1);
  assert.equal(isProposedAttachment(proposals[0]), true);
  assert.ok(proposals[0]!.quote.includes('information security policy'));

  const reasoner = new ScriptedReasoner();
  const elements = await reasoner.assessSufficiency({ evidence, control });
  assert.deepEqual(
    elements.map((element: SufficiencyElement) => element.expected),
    control.expectedEvidence
  );
  assert.equal(elements.length, 2);
});

test('createMockAi wires six services with the mock provider', () => {
  const services = createMockAi({ controls: [makeControl()] });
  assert.equal(services.provider, 'mock');
  assert.equal(services.reader.id, 'mock-scripted-reader');
  assert.equal(services.reasoner.id, 'mock-scripted-reasoner');
  assert.equal(services.composer.id, 'mock-composer');
  assert.equal(services.guardrail.id, 'mock-guardrail');
  assert.equal(services.costs.report().count, 0);
});
