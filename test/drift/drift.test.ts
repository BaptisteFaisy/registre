/**
 * Drift on machine attestations (axis 3a) — the control moves the day the state
 * changes, not at the next audit.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acknowledgeDrift,
  attestationsOf,
  classify,
  describe,
  driftSummary,
  isFailureState,
  missingRuns,
  observeAttestation
} from '../../src/pipeline/drift.ts';
import { DEFAULT_REFRESH_POLICY, cadencePeriodicity } from '../../src/domain/quality.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { makeControl } from '../fixtures/builders.ts';
import { fakeServices, pendingAttachment, seed, storedEvidence } from '../pipeline/fakeServices.ts';

const BACKUPS = makeControl({ id: 'CONT-19', title: 'Backup jobs complete and are monitored', periodicity: 'P1M' });

/** Stores one machine attestation, applied to the control. */
async function attestation(
  services: Awaited<ReturnType<typeof fakeServices>>,
  id: string,
  state: string,
  ingestedAt: string
) {
  await services.state.putEvidence(
    storedEvidence({
      id,
      sha256: id.padEnd(64, '0'),
      provenance: 'MACHINE_ATTESTATION',
      attestedState: state,
      ingestedAt
    })
  );
  await services.state.putAttachment(
    pendingAttachment({ id: `at-${id}`, status: 'APPLIED', controlId: BACKUPS.id, evidenceId: id })
  );
}

async function ready() {
  const services = fakeServices({ now: '2026-11-11T09:00:00.000Z' });
  await seed(services, [BACKUPS]);
  return services;
}

test('a first observation is not a drift', async () => {
  const services = await ready();
  await attestation(services, 'ev-1', 'all 12 backup jobs succeeded', services.clock.now());
  const events = await observeAttestation(services, {
    controlId: BACKUPS.id,
    evidenceId: 'ev-1',
    attestedState: 'all 12 backup jobs succeeded',
    actor: 'collector'
  });
  assert.deepEqual(events, []);
});

test('a changed state raises STATE_CHANGED and tells the owner', async () => {
  const services = await ready();
  await attestation(services, 'ev-1', 'all 12 backup jobs succeeded', '2026-11-10T03:00:00.000Z');
  await attestation(services, 'ev-2', '11 succeeded, db-1 window shortened', services.clock.now());
  const events = await observeAttestation(services, {
    controlId: BACKUPS.id,
    evidenceId: 'ev-2',
    attestedState: '11 succeeded, db-1 window shortened',
    actor: 'collector'
  });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'STATE_CHANGED');
  assert.equal(events[0]?.previous, 'all 12 backup jobs succeeded');
  assert.equal(events[0]?.current, '11 succeeded, db-1 window shortened');
  assert.equal(services.sent().length, 1, 'the owner is told what changed');
  assert.equal(services.events('DRIFT_DETECTED').length, 1);
});

test('a failure is also reported as a threshold crossing', async () => {
  const services = await ready();
  await attestation(services, 'ev-1', 'all backup jobs succeeded', '2026-11-10T03:00:00.000Z');
  await attestation(services, 'ev-2', 'backup job failed on db-1', services.clock.now());
  const kinds = (
    await observeAttestation(services, {
      controlId: BACKUPS.id,
      evidenceId: 'ev-2',
      attestedState: 'backup job failed on db-1',
      actor: 'collector'
    })
  ).map((event) => event.kind);
  assert.ok(kinds.includes('THRESHOLD_CROSSED'));
  assert.ok(kinds.includes('STATE_CHANGED'));
});

test('coming back to a known value is a recovery, not a new change', async () => {
  const services = await ready();
  await attestation(services, 'ev-1', 'state A', '2026-11-08T03:00:00.000Z');
  await attestation(services, 'ev-2', 'state B', '2026-11-09T03:00:00.000Z');
  await attestation(services, 'ev-3', 'state A', services.clock.now());
  const kinds = (
    await observeAttestation(services, {
      controlId: BACKUPS.id,
      evidenceId: 'ev-3',
      attestedState: 'state A',
      actor: 'collector'
    })
  ).map((event) => event.kind);
  assert.deepEqual(kinds, ['RECOVERED']);
});

test('the same drift is not recorded twice on the same day', async () => {
  const services = await ready();
  await attestation(services, 'ev-1', 'state A', '2026-11-10T03:00:00.000Z');
  await attestation(services, 'ev-2', 'state B', services.clock.now());
  const input = {
    controlId: BACKUPS.id,
    evidenceId: 'ev-2',
    attestedState: 'state B',
    actor: 'collector'
  };
  assert.equal((await observeAttestation(services, input)).length, 1);
  assert.equal((await observeAttestation(services, input)).length, 0);
  assert.equal((await services.extensions.listDrifts({})).length, 1);
});

test('an overdue attestation raises MISSING_RUN once the grace is past', async () => {
  const services = await ready();
  // Collected one hour before "now": comfortably inside cadence plus grace.
  await attestation(services, 'ev-1', 'all backup jobs succeeded', '2026-11-11T08:00:00.000Z');
  assert.deepEqual(await missingRuns(services, 'demo-msp'), [], 'still inside cadence plus grace');
  asClock(services.clock).advanceDays(3);
  const events = await missingRuns(services, 'demo-msp');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'MISSING_RUN');
  assert.equal((await missingRuns(services, 'demo-msp')).length, 0, 'not reported twice the same day');
});

test('acknowledging keeps the author and the instant', async () => {
  const services = await ready();
  await attestation(services, 'ev-1', 'state A', '2026-11-10T03:00:00.000Z');
  await attestation(services, 'ev-2', 'state B', services.clock.now());
  const [event] = await observeAttestation(services, {
    controlId: BACKUPS.id,
    evidenceId: 'ev-2',
    attestedState: 'state B',
    actor: 'collector'
  });
  const done = await acknowledgeDrift(services, event!.id, 'camille.roy');
  assert.equal(done?.acknowledgedBy, 'camille.roy');
  assert.equal(done?.acknowledgedAt, services.clock.now());
  assert.equal(await acknowledgeDrift(services, 'dr-nope', 'x'), null);
});

test('the summary counts by kind and separates the unacknowledged', async () => {
  const services = await ready();
  await attestation(services, 'ev-1', 'state A', '2026-11-10T03:00:00.000Z');
  await attestation(services, 'ev-2', 'state B', services.clock.now());
  await observeAttestation(services, {
    controlId: BACKUPS.id,
    evidenceId: 'ev-2',
    attestedState: 'state B',
    actor: 'collector'
  });
  const summary = await driftSummary(services, 'demo-msp');
  assert.equal(summary.counts.STATE_CHANGED, 1);
  assert.equal(summary.unacknowledged, 1);
  assert.equal(summary.recent.length, 1);
});

test('only machine attestations are watched', async () => {
  const services = await ready();
  await services.state.putEvidence(storedEvidence({ id: 'ev-human', sha256: 'c'.repeat(64) }));
  await services.state.putAttachment(
    pendingAttachment({ id: 'at-human', status: 'APPLIED', controlId: BACKUPS.id, evidenceId: 'ev-human' })
  );
  assert.deepEqual(await attestationsOf(services, BACKUPS.id), []);
});

test('failure wording and the cadence duration are explicit', () => {
  assert.equal(isFailureState('backup job failed on db-1'), true);
  assert.equal(isFailureState('all jobs succeeded'), false);
  assert.equal(isFailureState(null), false);
  assert.deepEqual(classify('same', ['same']), []);
  assert.deepEqual(classify('new', ['old', 'new']), ['RECOVERED']);
  assert.deepEqual(classify('new', ['old', 'older']), ['STATE_CHANGED']);
  assert.equal(cadencePeriodicity(DEFAULT_REFRESH_POLICY), 'PT24H');
  assert.match(describe('MISSING_RUN', '2026-11-01', null), /cadence/);
});


/** The fake bundle always carries a frozen clock; the port only promises `now`. */
function asClock(clock: { now(): string }): FixedClock {
  return clock as FixedClock;
}
