/**
 * Framework import and version diff tests — EF-REF-01, EF-REF-02, EF-REF-05.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffVersions,
  isControlChanged,
  isDiffEmpty,
  normaliseControl,
  normaliseFrameworkImport
} from '../../src/domain/frameworks.ts';
import type { Control } from '../../src/domain/types.ts';
import { RegistreError } from '../../src/support/errors.ts';
import { makeControl, makeControlInput, makeFrameworkImport, TEST_NOW } from '../fixtures/builders.ts';

const CODE = 'BAD_REQUEST';

test('a valid import is normalised into a framework and its controls', () => {
  const input = makeFrameworkImport([makeControlInput({ id: 'CONT-01' }), makeControlInput({ id: 'CONT-02' })], {
    confidentiality: 'RESTRICTED',
    source: 'partner central'
  });
  const imported = normaliseFrameworkImport(input, TEST_NOW);
  assert.equal(imported.framework.id, 'demo-msp');
  assert.equal(imported.framework.importedAt, TEST_NOW);
  assert.equal(imported.framework.confidentiality, 'RESTRICTED');
  assert.equal(imported.framework.source, 'partner central');
  assert.equal(imported.controls.length, 2);
  assert.equal(imported.controls[0]!.frameworkId, 'demo-msp');
});

test('the confidentiality defaults to internal and mandatory to false', () => {
  const imported = normaliseFrameworkImport(makeFrameworkImport([makeControlInput({ mandatory: undefined })]), TEST_NOW);
  assert.equal(imported.framework.confidentiality, 'INTERNAL');
  assert.equal(imported.controls[0]!.mandatory, false);
});

test('expected evidence entries are trimmed and blank ones dropped', () => {
  const control = normaliseControl(makeControlInput({ expectedEvidence: ['  Review date  ', '   ', 'Approver'] }), 'demo-msp');
  assert.deepEqual(control.expectedEvidence, ['Review date', 'Approver']);
});

test('duplicate control ids are rejected', () => {
  const input = makeFrameworkImport([makeControlInput({ id: 'CONT-01' }), makeControlInput({ id: 'CONT-01' })]);
  assert.throws(
    () => normaliseFrameworkImport(input, TEST_NOW),
    (error: unknown) => error instanceof RegistreError && error.code === CODE && /duplicate/.test(error.message)
  );
});

test('an invalid periodicity is rejected with a precise message', () => {
  assert.throws(
    () => normaliseControl(makeControlInput({ periodicity: 'every quarter' }), 'demo-msp'),
    (error: unknown) => error instanceof RegistreError && error.code === CODE && /ISO-8601 duration/.test(error.message)
  );
});

test('a control without expected evidence or owner is rejected', () => {
  assert.throws(
    () => normaliseControl(makeControlInput({ expectedEvidence: [] }), 'demo-msp'),
    (error: unknown) => error instanceof RegistreError && /no expected evidence/.test(error.message)
  );
  assert.throws(
    () => normaliseControl(makeControlInput({ owner: '  ' }), 'demo-msp'),
    (error: unknown) => error instanceof RegistreError && /owner/.test(error.message)
  );
});

test('a framework without name or version is rejected', () => {
  assert.throws(
    () => normaliseFrameworkImport(makeFrameworkImport([makeControlInput()], { name: '' }), TEST_NOW),
    (error: unknown) => error instanceof RegistreError && /framework.name/.test(error.message)
  );
});

test('a version diff reports added, changed and removed controls', () => {
  const previous = [makeControl({ id: 'C1' }), makeControl({ id: 'C2' }), makeControl({ id: 'C3' })];
  const next = [makeControl({ id: 'C1' }), makeControl({ id: 'C2', title: 'Renamed control' }), makeControl({ id: 'C4' })];
  const diff = diffVersions(previous, next);
  assert.deepEqual(diff.added, ['C4']);
  assert.deepEqual(diff.changed, ['C2']);
  assert.deepEqual(diff.removed, ['C3']);
  assert.equal(isDiffEmpty(diff), false);
});

test('every documented field change makes a control changed', () => {
  const base = makeControl({ id: 'C1' });
  const variants: Array<Partial<Control>> = [
    { title: 'Other title' },
    { requirement: 'Other requirement' },
    { expectedEvidence: ['Review date'] },
    { periodicity: 'P3M' },
    { owner: 'other.owner' },
    { mandatory: false }
  ];
  for (const variant of variants) {
    assert.equal(isControlChanged(base, makeControl({ id: 'C1', ...variant })), true);
  }
  assert.equal(isControlChanged(base, makeControl({ id: 'C1' })), false);
});

test('an unchanged framework yields an empty diff', () => {
  const controls = [makeControl({ id: 'C1' }), makeControl({ id: 'C2' })];
  assert.equal(isDiffEmpty(diffVersions(controls, controls)), true);
});
