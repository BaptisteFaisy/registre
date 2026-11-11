/**
 * Tests of the demonstration module: the generator (from the catalogue) and the
 * offline end-to-end run (spec chapter 18 and the acceptance list R1-R14).
 *
 * The run is executed once and shared: ingesting 60 documents twice would only
 * slow the suite down without testing anything new.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE, SEEDED_SITUATIONS, validateCatalogue } from '../../eval/catalogue.ts';
import {
  checkDemoData,
  planDemoData,
  writeDemoData,
  EVIDENCE_DIR,
  FRAMEWORK_PATH
} from '../../tools/demo/generate.ts';
import { renderEvidence } from '../../tools/demo/lib/document.ts';
import { runDemo, writeArtifacts, type DemoResult } from '../../tools/demo/main.ts';
import { buildFacts, buildReport } from '../../tools/demo/report.ts';
import { NO_EVIDENCE_ANSWER } from '../../src/domain/types.ts';
import { findViolations } from '../../src/domain/vocabulary.ts';

const planned = planDemoData();

test('catalogue: the demonstration set validates with no problem', () => {
  assert.deepEqual(validateCatalogue(), []);
});

test('generator: plans the framework, the readme and the 60 documents', () => {
  assert.equal(planned.length, EVIDENCE.length + 2);
  assert.ok(planned.some((file) => file.path.endsWith(FRAMEWORK_PATH)));
  const evidenceFiles = planned.filter((file) => file.path.includes(`${EVIDENCE_DIR}/`));
  assert.equal(evidenceFiles.length, EVIDENCE.length);
});

test('generator: writes every document and a second check passes (R1, R2)', () => {
  writeDemoData();
  const check = checkDemoData();
  assert.deepEqual(check.mismatches, []);
  assert.equal(check.ok, true);
});

test('generator: the written bytes are identical on a second run', () => {
  const before = planned.map((file) => file.sha256);
  writeDemoData();
  assert.deepEqual(planDemoData().map((file) => file.sha256), before);
});

test('renderer: a duplicate renders exactly the bytes of its source (R8)', () => {
  const duplicate = EVIDENCE.find((item) => item.duplicateOf !== null);
  assert.ok(duplicate?.duplicateOf, 'the seeded duplicate must exist');
  const original = EVIDENCE.find((item) => item.id === duplicate.duplicateOf);
  assert.ok(original, 'the duplicated document must exist');
  assert.equal(renderEvidence(duplicate), renderEvidence(original));
});

test('renderer: an unsigned procedure carries no signature block (R7)', () => {
  const unsigned = EVIDENCE.find((item) => item.seededSituation === 'UNSIGNED_PROCEDURE');
  assert.ok(unsigned, 'the unsigned procedure seed must exist');
  assert.equal(unsigned.approver, null);
  assert.doesNotMatch(renderEvidence(unsigned), /^Approved by:/m);
});

test('renderer: an expected gap never appears as an element line (R7)', () => {
  const gapped = EVIDENCE.find((item) => item.missingElements.length > 0);
  assert.ok(gapped, 'at least one document must seed a sufficiency gap');
  const rendered = renderEvidence(gapped);
  for (const gap of gapped.missingElements) {
    assert.ok(
      !rendered.includes(`- ${gap.expected}:`),
      `the missing element "${gap.expected}" must not be rendered`
    );
  }
});

test('renderer: an unreadable document has no extractable body (EF-LEC-04)', () => {
  const unreadable = EVIDENCE.find((item) => item.unreadable);
  assert.ok(unreadable, 'the unreadable seed must exist');
  assert.match(renderEvidence(unreadable), /illegible/);
});

/* ------------------------------------------------------- end-to-end run */

let result: DemoResult;

test('demo: the offline run completes and writes its artefacts', async (t) => {
  result = await runDemo();
  const facts = buildFacts({
    now: '2026-11-11T09:00:00.000Z',
    frameworkPath: FRAMEWORK_PATH,
    readiness: result.readiness,
    statuses: result.statuses,
    ingested: result.ingested,
    duplicates: result.duplicates,
    attachments: result.attachments,
    decisions: result.decisions,
    validationQueue: result.validationQueue,
    reminders: result.reminders,
    answered: result.answered,
    refused: result.refused,
    pack: result.pack,
    totalCostUsd: result.totalCostUsd,
    costPerEvidenceUsd: result.costPerEvidenceUsd
  });
  const report = buildReport(facts);
  assert.ok(report.length > 500);
  assert.equal(findViolations(report).length, 0, 'the report must never qualify a control');
  await writeArtifacts(result);
  t.diagnostic(`states: ${JSON.stringify(result.readiness.counts)}`);
});

test('demo: 30 controls imported and 60 documents ingested (R1, R2, R3)', () => {
  assert.equal(result.readiness.total, 30);
  assert.equal(result.ingested, 60);
  assert.ok(result.attachments > 0, 'the catalogue expectations must produce attachments');
});

test('demo: the seeded duplicate is detected once, with two locations (R8)', () => {
  assert.equal(result.duplicates, 1);
});

test('demo: the stale security policy leaves its control expired (R5)', () => {
  const situation = SEEDED_SITUATIONS.find((item) => item.kind === 'STALE_SECURITY_POLICY');
  assert.ok(situation?.controlId, 'the stale policy seed must name a control');
  const status = result.statuses.find((item) => item.controlId === situation.controlId);
  assert.equal(status?.state, 'EXPIRED');
});

test('demo: a question with evidence is answered with citations (R11)', () => {
  assert.equal(result.answered.noEvidence, false);
  assert.ok(result.answered.citations.length > 0);
  for (const citation of result.answered.citations) {
    assert.ok(citation.quote.length > 0, 'every citation quotes a real passage');
  }
});

test('demo: a question without evidence is refused, never invented (R12)', () => {
  assert.equal(result.refused.noEvidence, true);
  assert.equal(result.refused.text, NO_EVIDENCE_ANSWER);
  assert.equal(result.refused.citations.length, 0);
});

test('demo: the audit pack is assembled with verified checksums (R14)', () => {
  assert.equal(result.pack.checksumsVerified, true);
  assert.ok(result.pack.index.length > 0);
  assert.ok(result.pack.archive.sha256.length === 64);
});

test('demo: readiness counts sum to the number of controls', () => {
  const { counts, total } = result.readiness;
  const sum = counts.COVERED + counts.TO_RENEW + counts.TO_VERIFY + counts.EXPIRED + counts.NO_EVIDENCE;
  assert.equal(sum, total);
});

test('demo: the run is deterministic (same readiness on a second run)', async () => {
  const again = await runDemo();
  assert.deepEqual(again.readiness.counts, result.readiness.counts);
  assert.equal(again.pack.id, result.pack.id);
});
