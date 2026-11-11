/**
 * Freshness tests — EF-FRA-01 (spec 12.2), recette R5.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeExpiryDate,
  computeFreshness,
  daysUntilExpiry,
  referenceDate,
  RENEWAL_LEAD_DAYS
} from '../../src/domain/freshness.ts';
import { makeEvidence, makeFields, makeFlags, TEST_NOW, TEST_TODAY } from '../fixtures/builders.ts';

test('the reference date is the end of the covered period when there is one', () => {
  const evidence = makeEvidence({ fields: makeFields({ documentDate: '2026-01-10', period: { start: '2025-10-01', end: '2025-12-31' } }) });
  assert.equal(referenceDate(evidence), '2025-12-31');
});

test('without a period the reference date is the document date, then the approval date', () => {
  assert.equal(referenceDate(makeEvidence({ fields: makeFields({ documentDate: '2026-08-01' }) })), '2026-08-01');
  const noDocumentDate = makeEvidence({ fields: makeFields({ documentDate: null, approvalDate: '2026-08-05' }) });
  assert.equal(referenceDate(noDocumentDate), '2026-08-05');
  assert.equal(referenceDate(makeEvidence({ fields: makeFields({ documentDate: null, approvalDate: null }) })), null);
});

test('an unreadable evidence has no reference date', () => {
  const evidence = makeEvidence({ flags: makeFlags({ unreadable: true }) });
  assert.equal(referenceDate(evidence), null);
  assert.equal(computeExpiryDate(evidence, 'P1Y'), null);
});

test('the expiry date is the reference date plus the control periodicity', () => {
  const evidence = makeEvidence({ fields: makeFields({ documentDate: '2026-08-01' }) });
  assert.equal(computeExpiryDate(evidence, 'P1Y'), '2027-08-01T00:00:00.000Z');
  assert.equal(computeExpiryDate(evidence, 'P3M'), '2026-11-01T00:00:00.000Z');
});

test('an invalid periodicity leaves the expiry undetermined instead of throwing', () => {
  const evidence = makeEvidence({ fields: makeFields({ documentDate: '2026-08-01' }) });
  assert.equal(computeExpiryDate(evidence, 'every year'), null);
  assert.equal(computeFreshness(evidence, 'every year', TEST_NOW).freshness, 'UNDETERMINED');
});

test('a fresh evidence expires more than 30 days ahead', () => {
  const evidence = makeEvidence({ fields: makeFields({ documentDate: '2026-10-01' }) });
  const verdict = computeFreshness(evidence, 'P3M', TEST_NOW);
  assert.equal(verdict.freshness, 'FRESH');
  assert.equal(verdict.expiresAt, '2027-01-01T00:00:00.000Z');
  assert.ok(daysUntilExpiry(verdict.expiresAt, TEST_NOW) > RENEWAL_LEAD_DAYS);
});

test('the renewal window is inclusive of exactly 30 days', () => {
  const evidence = makeEvidence({ fields: makeFields({ documentDate: '2025-12-11' }) });
  const today = TEST_TODAY;
  const verdict = computeFreshness(evidence, 'P1Y', today);
  assert.equal(daysUntilExpiry(verdict.expiresAt!, today), RENEWAL_LEAD_DAYS);
  assert.equal(verdict.freshness, 'TO_RENEW');
  assert.equal(computeFreshness(evidence, 'P1Y', '2026-11-10').freshness, 'FRESH');
});

test('R5 — a policy dated 18 months ago with an annual periodicity is expired', () => {
  const evidence = makeEvidence({ fields: makeFields({ documentDate: '2025-05-11', period: { start: null, end: null } }) });
  const verdict = computeFreshness(evidence, 'P1Y', TEST_NOW);
  assert.equal(verdict.freshness, 'EXPIRED');
  assert.ok(daysUntilExpiry(verdict.expiresAt!, TEST_NOW) < 0);
});

test('an evidence with no readable date is undetermined, never fresh', () => {
  const evidence = makeEvidence({ fields: makeFields({ documentDate: null, approvalDate: null }) });
  const verdict = computeFreshness(evidence, 'P1Y', TEST_NOW);
  assert.equal(verdict.freshness, 'UNDETERMINED');
  assert.equal(verdict.expiresAt, null);
});

test('the lead time can be shortened for a different reminder policy', () => {
  const evidence = makeEvidence({ fields: makeFields({ documentDate: '2025-12-11' }) });
  assert.equal(computeFreshness(evidence, 'P1Y', TEST_NOW, 10).freshness, 'FRESH');
});
