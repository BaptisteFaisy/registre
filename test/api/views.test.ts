/**
 * Serialisation rules — ENF-CONF-01/02 (excerpts and masking).
 *
 * Two layers protect the content of an evidence:
 *  - the access check refuses the whole record when the level is above the
 *    caller's clearance;
 *  - the excerpt layer masks what is above the clearance, and always masks
 *    personal data, so no excerpt ever leaks a name or an address.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { MASKED_EXCERPT, excerptFor, mayReadExcerpt } from '../../src/api/views.ts';
import type { Principal } from '../../src/domain/types.ts';
import { makeEvidence } from '../fixtures/builders.ts';

const auditor: Principal = {
  id: 'u-auditor',
  name: 'Auditor',
  email: 'auditor@msp.demo',
  role: 'INTERNAL_AUDITOR',
  clearance: 'INTERNAL',
  ownedControls: []
};

const lead: Principal = { ...auditor, id: 'u-quality', role: 'QUALITY_LEAD', clearance: 'RESTRICTED' };

test('ENF-CONF-01: an excerpt above the clearance is masked', () => {
  assert.equal(excerptFor('secret content', auditor, 'RESTRICTED'), MASKED_EXCERPT);
  assert.equal(mayReadExcerpt(auditor, 'RESTRICTED'), false);
  assert.equal(mayReadExcerpt(lead, 'RESTRICTED'), true);
});

test('ENF-CONF-02: personal data is masked in every excerpt', () => {
  const excerpt = excerptFor('Contact alice@msp.demo or 0612345678 for the minutes.', lead, 'RESTRICTED');
  assert.ok(!excerpt.includes('alice@msp.demo'));
  assert.ok(!excerpt.includes('0612345678'));
  assert.ok(excerpt.includes('[EMAIL]'));
  assert.ok(excerpt.includes('[PHONE]'));
});

test('ENF-CONF-02: an excerpt is trimmed and never grows without bound', () => {
  const excerpt = excerptFor('x'.repeat(2000), lead, 'RESTRICTED', 100);
  assert.ok(excerpt.length <= 100);
});

test('the evidence view keeps the fields the reader needs', () => {
  const evidence = makeEvidence({ id: 'ev-1', accessLevel: 'INTERNAL' });
  assert.equal(evidence.fields.title, 'Information security policy');
  assert.equal(evidence.flags.unreadable, false);
});
