/**
 * Framework import — EF-REF-01 ("importer un référentiel depuis un fichier"),
 * EF-REF-02 (several versions), EF-REF-05 (added / changed / removed) and
 * acceptance R1 (the framework lands with all its controls).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { importFramework } from '../../src/pipeline/import.ts';
import { makeControlInput, makeFrameworkImport } from '../fixtures/builders.ts';
import { fakeServices } from './fakeServices.ts';

test('R1: the import stores the framework and every control', async () => {
  const services = fakeServices();
  const input = makeFrameworkImport([makeControlInput({ id: 'CONT-01' }), makeControlInput({ id: 'CONT-02' })]);

  const result = await importFramework(services, input, 'quality.lead');

  assert.equal(result.framework.id, 'demo-msp');
  assert.equal(result.framework.importedAt, '2026-11-11T12:00:00.000Z');
  assert.equal(result.controls.length, 2);
  assert.equal(result.diff, null, 'a first import has nothing to compare with');
  assert.equal((await services.state.listControls('demo-msp')).length, 2);
  assert.equal(services.events('FRAMEWORK_IMPORTED')[0]?.detail.controls, 2);
});

test('the import recomputes the states, so the initial picture exists (8.1 step 4)', async () => {
  const services = fakeServices();
  await importFramework(services, makeFrameworkImport([makeControlInput({ id: 'CONT-01' })]), 'quality.lead');

  const statuses = await services.state.listStatuses('demo-msp');
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0]?.state, 'NO_EVIDENCE');
});

test('a new version reports the controls added, changed and removed (EF-REF-05)', async () => {
  const services = fakeServices();
  await importFramework(
    services,
    makeFrameworkImport([
      makeControlInput({ id: 'CONT-01', title: 'Policy reviewed annually' }),
      makeControlInput({ id: 'CONT-02', title: 'Access review quarterly' })
    ]),
    'quality.lead'
  );

  const next = await importFramework(
    services,
    makeFrameworkImport(
      [
        makeControlInput({ id: 'CONT-01', title: 'Policy reviewed every six months' }),
        makeControlInput({ id: 'CONT-03', title: 'Backup restore tested' })
      ],
      { version: '2.0' }
    ),
    'quality.lead'
  );

  assert.deepEqual(next.diff, { added: ['CONT-03'], changed: ['CONT-01'], removed: ['CONT-02'] });
  assert.equal(next.framework.version, '2.0');
  assert.equal(services.events('FRAMEWORK_IMPORTED')[1]?.detail.added, 1);
});

test('importing the same version twice is a conflict', async () => {
  const services = fakeServices();
  const input = makeFrameworkImport([makeControlInput({ id: 'CONT-01' })]);
  await importFramework(services, input, 'quality.lead');
  await assert.rejects(() => importFramework(services, input, 'quality.lead'), { code: 'CONFLICT' });
});

test('an invalid import is refused before anything is stored', async () => {
  const services = fakeServices();
  const input = makeFrameworkImport([makeControlInput({ id: 'CONT-01', periodicity: 'not-a-duration' })]);
  await assert.rejects(() => importFramework(services, input, 'quality.lead'), { code: 'BAD_REQUEST' });
  assert.deepEqual(await services.state.listFrameworks(), []);
});

test('two different frameworks coexist (EF-REF-02)', async () => {
  const services = fakeServices();
  await importFramework(services, makeFrameworkImport([makeControlInput({ id: 'CONT-01' })]), 'quality.lead');
  await importFramework(
    services,
    makeFrameworkImport([makeControlInput({ id: 'ISO-01' })], { id: 'iso-27001', name: 'ISO 27001' }),
    'quality.lead'
  );

  const frameworks = await services.state.listFrameworks();
  assert.deepEqual(frameworks.map((framework) => framework.id), ['demo-msp', 'iso-27001']);
});
