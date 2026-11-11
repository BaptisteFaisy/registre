/**
 * Offline end-to-end flow of the `ai` module: read a document, retrieve
 * candidate controls, propose attachments, assess sufficiency, answer a
 * question, then check the guardrail. Every output is validated against the
 * shapes of Annex C and Annex D (EF-LEC-01, EF-RAT-01/02, EF-SUF-01, EF-QR-01).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockAi } from '../../src/ai/mock/index.ts';
import { isProposedAttachment } from '../../src/ai/schemas.ts';
import { containsNormalized } from '../../src/support/normalize.ts';
import { NO_EVIDENCE_ANSWER } from '../../src/domain/types.ts';
import type { Evidence, SufficiencyElement } from '../../src/domain/types.ts';
import type { ProposedAttachment } from '../../src/ports/index.ts';
import { makeControl, makeEvidence } from '../fixtures/builders.ts';

const DOCUMENT = [
  '---',
  'Title: Quarterly backup restore test',
  'Type: Report',
  'Date: 2026-10-14',
  'Period: 2026-10-01..2026-10-31',
  'Version: 1.0',
  'Author: L. Moreau',
  'Approved by: C. Bernard',
  'Approval date: 2026-10-14',
  '---',
  'The backup restore test of the customer database ran on 14 October 2026 and took 42 minutes.',
  'The restored data matched the source data. Signed: C. Bernard.'
].join('\n');

const CONTROL = makeControl({
  id: 'CONT-03',
  title: 'Backups are tested by a real restore',
  requirement: 'A backup restore is performed and recorded every quarter, with the measured recovery time.',
  expectedEvidence: ['Test date', 'Recovery time', 'Signatory'],
  periodicity: 'P3M'
});

/** Fields of Annex C that the pipeline consumes. */
const ANNEX_C_KEYS = ['controlId', 'supports', 'confidence', 'quote', 'page', 'reason'];

/** Reads the sample document through the scripted reader. */
async function readSample() {
  const bytes = new TextEncoder().encode(DOCUMENT);
  return createMockAi({ controls: [CONTROL] }).reader.read({
    evidenceId: 'ev-1',
    contentType: 'text/markdown',
    sizeBytes: bytes.length,
    uri: 'file:///tmp/restore.md',
    bytes
  });
}

/** Checks that one Annex C proposal is well formed and quotes the document. */
function assertProposal(proposal: ProposedAttachment, text: string): void {
  assert.equal(isProposedAttachment(proposal), true);
  // The reasoner stamps the prompt version on top of the Annex C keys.
  assert.deepEqual(Object.keys(proposal).sort(), [...ANNEX_C_KEYS, 'promptVersion'].sort());
  assert.ok(proposal.confidence >= 0 && proposal.confidence <= 1);
  if (proposal.supports) assert.ok(containsNormalized(text, proposal.quote), 'the quote exists in the document');
}

/** Checks that one Annex D element is well formed and quotes the document. */
function assertElement(element: SufficiencyElement, text: string): void {
  assert.equal(typeof element.present, 'boolean');
  if (element.present) assert.ok(element.quote && containsNormalized(text, element.quote));
  else assert.equal(element.quote, null);
}

test('the scripted reader extracts the Annex B fields of a report', async () => {
  const read = await readSample();
  assert.equal(read.fields.type, 'REPORT');
  assert.equal(read.fields.documentDate, '2026-10-14');
  assert.deepEqual(read.fields.period, { start: '2026-10-01', end: '2026-10-31' });
  assert.equal(read.accessLevel, 'INTERNAL');
  assert.equal(read.flags.unreadable, false);
});

test('the offline pipeline produces Annex C and Annex D shapes', async () => {
  const ai = createMockAi({ controls: [CONTROL] });
  const read = await readSample();
  const evidence: Evidence = makeEvidence({
    id: 'ev-1',
    fields: read.fields,
    flags: read.flags,
    accessLevel: read.accessLevel,
    textPages: read.textPages
  });
  const text = evidence.textPages.map((page) => page.text).join('\n');

  const candidates = await ai.controlRetriever.candidates({
    type: read.fields.type,
    title: read.fields.title,
    summary: read.fields.summary,
    text
  });
  assert.equal(candidates[0]?.control.id, 'CONT-03');

  const proposals = await ai.reasoner.proposeAttachments({ evidence, candidates });
  assert.ok(proposals.length > 0);
  for (const proposal of proposals) assertProposal(proposal, text);

  const elements: SufficiencyElement[] = await ai.reasoner.assessSufficiency({ evidence, control: CONTROL });
  assert.deepEqual(
    elements.map((element) => element.expected),
    CONTROL.expectedEvidence
  );
  for (const element of elements) assertElement(element, text);
});

test('the offline question-answering path cites a passage and stays anchored', async () => {
  const evidence = makeEvidence({
    id: 'ev-1',
    accessLevel: 'INTERNAL',
    textPages: [{ page: 1, text: 'The backup restore test of the customer database took 42 minutes on 14 October 2026.' }]
  });
  const ai = createMockAi({ evidences: [evidence] });

  const passages = await ai.evidenceRetriever.search({
    query: 'how long did the backup restore take?',
    allowedLevels: ['PUBLIC', 'INTERNAL']
  });
  assert.ok(passages.length > 0);

  const draft = await ai.composer.compose({ question: 'how long did the backup restore take?', passages });
  assert.ok(draft.citations.length > 0);
  const anchored = await ai.guardrail.verifyAnchoring({ answer: draft.text, passages });
  assert.equal(anchored.anchored, true);

  const invented = await ai.guardrail.verifyAnchoring({
    answer: 'According to the report: "the restore was witnessed by an external auditor in December"',
    passages
  });
  assert.equal(invented.anchored, false);
});

test('a restricted evidence is invisible to a reader without clearance (EF-QR-03)', async () => {
  const restricted = makeEvidence({
    id: 'ev-hr',
    accessLevel: 'RESTRICTED',
    textPages: [{ page: 1, text: 'The backup restore test of the payroll database took 12 minutes.' }]
  });
  const ai = createMockAi({ evidences: [restricted] });

  const denied = await ai.evidenceRetriever.search({ query: 'backup restore test', allowedLevels: ['PUBLIC', 'INTERNAL'] });
  assert.deepEqual(denied, []);
  const draft = await ai.composer.compose({ question: 'backup restore test', passages: denied });
  assert.equal(draft.text, NO_EVIDENCE_ANSWER);

  const granted = await ai.evidenceRetriever.search({
    query: 'backup restore test',
    allowedLevels: ['PUBLIC', 'INTERNAL', 'RESTRICTED']
  });
  assert.equal(granted.length, 1);
});

test('the cost meter records the reading cost of the offline flow', async () => {
  const ai = createMockAi();
  const bytes = new TextEncoder().encode(DOCUMENT);
  const read = await ai.reader.read({
    evidenceId: 'ev-1',
    contentType: 'text/markdown',
    sizeBytes: bytes.length,
    uri: 'file:///tmp/restore.md',
    bytes
  });
  assert.ok(read.cost);
  const report = ai.costs.report();
  assert.equal(report.count, 1, 'the reader billed the shared meter itself');
  assert.ok(report.totalUsd > 0);
  assert.equal(report.bySource[read.cost.source], read.cost.usd);
});

test('the scripted reader reads a local file URI, as the demo does', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'registre-ai-'));
  const path = join(dir, 'restore.md');
  writeFileSync(path, DOCUMENT, 'utf8');
  try {
    const read = await createMockAi().reader.read({
      evidenceId: 'ev-file',
      contentType: 'text/markdown',
      sizeBytes: DOCUMENT.length,
      uri: `file://${path}`,
      fileDate: '2026-10-15'
    });
    assert.equal(read.fields.title, 'Quarterly backup restore test');
    assert.equal(read.flags.dateToConfirm, true, 'file date differs from the document date');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the whole offline chain runs from one document to a cited answer', async () => {
  const read = await readSample();
  const evidence: Evidence = makeEvidence({
    id: 'ev-1',
    fields: read.fields,
    flags: read.flags,
    accessLevel: read.accessLevel,
    textPages: read.textPages
  });
  const ai = createMockAi({ controls: [CONTROL], evidences: [evidence] });
  const text = evidence.textPages.map((page) => page.text).join('\n');
  const candidates = await ai.controlRetriever.candidates({
    type: read.fields.type,
    title: read.fields.title,
    summary: read.fields.summary,
    text
  });
  const proposals = await ai.reasoner.proposeAttachments({ evidence, candidates });
  const supporting = proposals.filter((proposal) => proposal.supports);
  assert.ok(supporting.length > 0, 'the restore report supports the restore control');

  const passages = await ai.evidenceRetriever.search({
    query: 'how long did the restore take?',
    allowedLevels: ['PUBLIC', 'INTERNAL']
  });
  const draft = await ai.composer.compose({ question: 'how long did the restore take?', passages });
  const guarded = await ai.guardrail.verifyAnchoring({ answer: draft.text, passages });
  assert.equal(guarded.anchored, true);
  assert.equal(guarded.unsupported.length, 0);
  for (const citation of draft.citations) {
    assert.ok(text.includes(citation.quote), 'the cited sentence is in the document');
  }
});
