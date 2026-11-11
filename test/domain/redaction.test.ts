/**
 * Local redaction tests — ENF-CONF-02 (offline fallback when Guardrails is absent).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { containsPersonalData, MASKS, redactAll, redactText } from '../../src/domain/redaction.ts';

test('an e-mail address is replaced by a stable mask', () => {
  const result = redactText('Contact: marie.dupont@example.fr for the review.');
  assert.equal(result.text, `Contact: ${MASKS.EMAIL} for the review.`);
  assert.equal(result.redacted, true);
  assert.equal(result.hits, 1);
  assert.equal(result.counts.EMAIL, 1);
});

test('French and international phone numbers are masked', () => {
  const local = redactText('Call 01 23 45 67 89 or 06.12.34.56.78 today.');
  assert.equal(local.counts.PHONE, 2);
  assert.ok(!local.text.includes('01 23'));
  const international = redactText('Reach the auditor at +33 1 23 45 67 89 or +44 20 7946 0958.');
  assert.equal(international.counts.PHONE, 2);
  assert.equal(international.text.includes('7946'), false);
});

test('a French national identifier (NIR) is masked and not taken for a card', () => {
  const result = redactText('Social security number: 1 85 05 78 024 057 42.');
  assert.equal(result.counts.NIR, 1);
  assert.equal(result.counts.CARD, 0);
  assert.equal(result.text.includes('024'), false);
  assert.ok(result.text.includes(MASKS.NIR));
});

test('an IBAN is masked', () => {
  const result = redactText('Bank account FR76 3000 6000 0112 3456 7890 189 for the invoice.');
  assert.equal(result.counts.IBAN, 1);
  assert.equal(result.text.includes('3000'), false);
});

test('card numbers are masked, including Amex formatting', () => {
  const visa = redactText('Card 4111 1111 1111 1111 charged.');
  assert.equal(visa.counts.CARD, 1);
  assert.ok(visa.text.includes(MASKS.CARD));
  const amex = redactText('Card 3782 822463 10005 charged.');
  assert.equal(amex.counts.CARD, 1);
});

test('a text without personal data is returned untouched', () => {
  const text = 'The backup restoration test succeeded on 14 October 2026.';
  const result = redactText(text);
  assert.equal(result.text, text);
  assert.equal(result.redacted, false);
  assert.equal(result.hits, 0);
  assert.equal(containsPersonalData(text), false);
});

test('masking is deterministic and never re-masks its own output', () => {
  const text = 'Send to jean@msp.demo, phone 06 11 22 33 44, IBAN FR76 3000 6000 0112 3456 7890 189.';
  const first = redactText(text);
  const second = redactText(text);
  assert.deepEqual(first, second);
  assert.equal(first.hits, 3);
  const again = redactText(first.text);
  assert.equal(again.hits, 0);
  assert.equal(again.text, first.text);
  assert.equal(containsPersonalData(text), true);
});

test('several texts can be redacted at once', () => {
  const result = redactAll(['Write to paul@msp.demo', 'no personal data here']);
  assert.equal(result.hits, 1);
  assert.equal(result.texts[0], `Write to ${MASKS.EMAIL}`);
  assert.equal(result.texts[1], 'no personal data here');
});
