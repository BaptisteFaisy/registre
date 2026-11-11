import test from 'node:test';
import assert from 'node:assert/strict';

import { looksPersonal, maskPersonalData } from './redact.ts';
import { noteLabel, NOTE_LABEL } from './notes.ts';
import { can, mayRead, hasHiddenEvidence, restrictedNotice } from './access.ts';
import type { Principal } from '../api/types.ts';

test('maskPersonalData hides names, e-mails and phone numbers', () => {
  const masked = maskPersonalData('Contact Amina Diallo at amina.diallo@northwind.example or 06 12 34 56 78.');
  assert.doesNotMatch(masked, /Amina Diallo/);
  assert.doesNotMatch(masked, /amina\.diallo@northwind\.example/);
  assert.match(masked, /\[masked\]/);
});

test('looksPersonal detects text that would be masked', () => {
  assert.equal(looksPersonal('Reviewed by Sofia Novak.'), true);
  assert.equal(looksPersonal('Reviewed by the security officer.'), false);
});

test('noteLabel translates known codes and keeps unknown ones', () => {
  assert.equal(noteLabel('document-not-signed'), NOTE_LABEL['document-not-signed']);
  assert.equal(noteLabel('custom-code'), 'custom-code');
});

test('the role matrix opens the right screens', () => {
  assert.equal(can('QUALITY_LEAD', 'validation'), true);
  assert.equal(can('EXECUTIVE', 'validation'), false);
  assert.equal(can('EXECUTIVE', 'readiness'), true);
  assert.equal(can('INTERNAL_AUDITOR', 'ask'), true);
  assert.equal(can('INTERNAL_AUDITOR', 'settings'), false);
  assert.equal(can('ADMIN', 'settings'), true);
  assert.equal(can('CONTROL_OWNER', 'packs'), false);
});

test('clearance gates restricted evidence', () => {
  assert.equal(mayRead(principal('EXECUTIVE', 'INTERNAL'), 'RESTRICTED'), false);
  assert.equal(mayRead(principal('EXECUTIVE', 'INTERNAL'), 'INTERNAL'), true);
  assert.equal(mayRead(principal('QUALITY_LEAD', 'RESTRICTED'), 'RESTRICTED'), true);
  assert.equal(hasHiddenEvidence(principal('EXECUTIVE', 'INTERNAL'), ['INTERNAL', 'RESTRICTED']), true);
});

test('the restricted notice names the role', () => {
  assert.match(restrictedNotice(principal('EXECUTIVE', 'INTERNAL')), /executive/i);
});

function principal(role: Principal['role'], clearance: Principal['clearance']): Principal {
  return { id: 'pr', name: 'Test', email: 'test@example.test', role, clearance, ownedControls: [] };
}
