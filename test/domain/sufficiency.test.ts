/**
 * Sufficiency tests — EF-SUF-01, EF-SUF-02, recette R7.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSufficiency,
  computeSufficiencyClass,
  isElementSupported,
  LOW_CONFIDENCE,
  missingElements
} from '../../src/domain/sufficiency.ts';
import type { SufficiencyElement } from '../../src/domain/types.ts';
import { makeAttachment, makeElements, TEST_NOW } from '../fixtures/builders.ts';

const element = (expected: string, present: boolean, quote: string | null = present ? `"${expected}"` : null): SufficiencyElement => ({
  expected,
  present,
  quote
});

test('all expected elements present gives a complete verdict', () => {
  const verdict = computeSufficiencyClass([element('Test date', true), element('Signatory', true)]);
  assert.equal(verdict.class, 'COMPLETE');
  assert.deepEqual(verdict.missing, []);
});

test('R7 — a report without recovery time is partial and lists the missing element', () => {
  const elements = makeElements([true, true, false, true], ['Test date', 'Restored system', 'Recovery time', 'Signatory']);
  const verdict = computeSufficiencyClass(elements);
  assert.equal(verdict.class, 'PARTIAL');
  assert.deepEqual(verdict.missing, ['Recovery time']);
});

test('an element declared present without a quote counts as missing', () => {
  const verdict = computeSufficiencyClass([element('Test date', true), element('Signatory', true, null)]);
  assert.equal(verdict.class, 'PARTIAL');
  assert.deepEqual(verdict.missing, ['Signatory']);
  assert.equal(isElementSupported(element('Signatory', true, '  ')), false);
});

test('empty expectations cannot be complete: they go to verify', () => {
  const verdict = computeSufficiencyClass([]);
  assert.equal(verdict.class, 'TO_VERIFY');
  assert.deepEqual(verdict.missing, []);
});

test('low confidence goes to verify even when every element is present', () => {
  const elements = [element('Test date', true), element('Signatory', true)];
  const low = computeSufficiencyClass(elements, LOW_CONFIDENCE - 0.01);
  assert.equal(low.class, 'TO_VERIFY');
  assert.deepEqual(low.missing, []);
  assert.equal(computeSufficiencyClass(elements, LOW_CONFIDENCE).class, 'COMPLETE');
});

test('missing elements are listed in the order of the expectations', () => {
  const elements = [element('A', false), element('B', true), element('C', false)];
  assert.deepEqual(missingElements(elements), ['A', 'C']);
});

test('buildSufficiency derives id, class and missing from the elements', () => {
  const attachment = makeAttachment({ id: 'at-42' });
  const sufficiency = buildSufficiency({
    attachment,
    elements: [element('Test date', true), element('Recovery time', false)],
    now: TEST_NOW
  });
  assert.match(sufficiency.id, /^sf-[0-9a-f]{12}$/);
  assert.equal(sufficiency.attachmentId, 'at-42');
  assert.equal(sufficiency.evidenceId, attachment.evidenceId);
  assert.equal(sufficiency.controlId, attachment.controlId);
  assert.equal(sufficiency.class, 'PARTIAL');
  assert.deepEqual(sufficiency.missing, ['Recovery time']);
  assert.equal(sufficiency.computedAt, TEST_NOW);
});

test('buildSufficiency keeps the verdict to verify on a low-confidence reading', () => {
  const sufficiency = buildSufficiency({
    attachment: makeAttachment(),
    elements: [element('Test date', true)],
    confidence: 0.2,
    now: TEST_NOW
  });
  assert.equal(sufficiency.class, 'TO_VERIFY');
});
