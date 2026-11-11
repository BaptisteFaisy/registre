/**
 * Prompt versioning — every proposal returned by the mock reasoner carries
 * the version of the prompt family that produced it (bonus axis, spec 13.5).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProposedAttachment } from '../../src/ports/index.ts';
import { ScriptedReasoner, createScriptedReasoner } from '../../src/ai/mock/scriptedReasoner.ts';
import {
  ANSWER_PROMPT_VERSION,
  ATTACHMENT_PROMPT_VERSION,
  PROMPT_VERSIONS,
  READING_PROMPT_VERSION,
  SUFFICIENCY_PROMPT_VERSION,
  stampAttachmentVersion
} from '../../src/ai/versioning.ts';
import { makeControl } from '../fixtures/builders.ts';
import { storedEvidence } from '../pipeline/fakeServices.ts';

const POLICY_TEXT = 'Information security policy version 3.1, reviewed on 1 August 2026 and approved by C. Bernard.';

const POLICY = makeControl({ id: 'CONT-01', mandatory: false });

const SCRIPTED: ProposedAttachment = {
  controlId: 'CONT-01',
  supports: true,
  confidence: 0.9,
  quote: 'reviewed on 1 August 2026',
  page: 1,
  reason: 'scripted answer'
};

function request() {
  const evidence = storedEvidence({ id: 'ev-v1', textPages: [{ page: 1, text: POLICY_TEXT }] });
  return { evidence, candidates: [{ control: POLICY, score: 1, matchedOn: 'test' }] };
}

test('every prompt family has its own exported version, grouped in PROMPT_VERSIONS', () => {
  assert.equal(PROMPT_VERSIONS.READING, READING_PROMPT_VERSION);
  assert.equal(PROMPT_VERSIONS.ATTACHMENT, ATTACHMENT_PROMPT_VERSION);
  assert.equal(PROMPT_VERSIONS.SUFFICIENCY, SUFFICIENCY_PROMPT_VERSION);
  assert.equal(PROMPT_VERSIONS.ANSWER, ANSWER_PROMPT_VERSION);
  const values = Object.values(PROMPT_VERSIONS);
  assert.equal(new Set(values).size, values.length, 'each family has a distinct version');
});

test('scripted proposals are stamped with the attachment prompt version', async () => {
  const reasoner = new ScriptedReasoner({
    attachments: new Map([['ev-v1', [SCRIPTED]]])
  });
  const proposals = await reasoner.proposeAttachments(request());
  assert.equal(proposals.length, 1);
  for (const proposal of proposals) {
    assert.equal(proposal.promptVersion, ATTACHMENT_PROMPT_VERSION);
  }
  assert.equal(proposals[0]?.quote, SCRIPTED.quote, 'stamping does not alter the answer');
});

test('heuristic proposals are stamped too', async () => {
  const reasoner = new ScriptedReasoner();
  const proposals = await reasoner.proposeAttachments(request());
  assert.ok(proposals.length > 0);
  for (const proposal of proposals) {
    assert.equal(proposal.promptVersion, ATTACHMENT_PROMPT_VERSION);
  }
});

test('the stamping helper clones the proposal instead of mutating it', () => {
  const stamped = stampAttachmentVersion(SCRIPTED);
  assert.equal(stamped.promptVersion, ATTACHMENT_PROMPT_VERSION);
  assert.notEqual(stamped, SCRIPTED);
  assert.equal((SCRIPTED as Partial<ProposedAttachment> & { promptVersion?: string }).promptVersion, undefined);
});
