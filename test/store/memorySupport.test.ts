/**
 * In-memory cost meter and notifier (ENF-COUT-01, EF-REL-01/02/03).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCostMeter, MemoryNotifier } from '../../src/store/memorySupport.ts';
import { FixedClock } from '../../src/support/clock.ts';
import type { NotificationMessage } from '../../src/ports/index.ts';
import { TEST_NOW } from '../fixtures/builders.ts';

const clock = new FixedClock(TEST_NOW);

const reminder: NotificationMessage = {
  to: 'owner@msp.demo',
  subject: 'Evidence to renew: CONT-01',
  body: 'Please provide the renewed policy.',
  kind: 'REMINDER',
  controlId: 'CONT-01'
};

test('cost meter: an empty meter reports zero', () => {
  assert.deepEqual(new MemoryCostMeter().report(), { totalUsd: 0, bySource: {}, count: 0 });
});

test('cost meter: totals are aggregated per source (ENF-COUT-01)', () => {
  const meter = new MemoryCostMeter();
  meter.record({ usd: 0.01, tokensIn: 100, tokensOut: 20, source: 'bedrock-data-automation' });
  meter.record({ usd: 0.02, tokensIn: 300, tokensOut: 40, source: 'bedrock-data-automation' });
  meter.record({ usd: 0.5, tokensIn: 900, tokensOut: 90, source: 'bedrock-runtime' });

  const report = meter.report();
  assert.equal(report.count, 3);
  assert.equal(report.totalUsd, 0.53);
  assert.deepEqual(report.bySource, {
    'bedrock-data-automation': 0.03,
    'bedrock-runtime': 0.5
  });
});

test('cost meter: floating-point sums stay readable', () => {
  const meter = new MemoryCostMeter();
  for (let index = 0; index < 3; index += 1) {
    meter.record({ usd: 0.1, tokensIn: 1, tokensOut: 1, source: 'bedrock-runtime' });
  }
  assert.equal(meter.report().totalUsd, 0.3);
});

test('cost meter: the recorded records are kept for the cost report', () => {
  const meter = new MemoryCostMeter();
  meter.record({ usd: 0.25, tokensIn: 10, tokensOut: 5, source: 'bedrock-runtime' });
  assert.deepEqual(meter.all(), [{ usd: 0.25, tokensIn: 10, tokensOut: 5, source: 'bedrock-runtime' }]);
});

test('notifier: captures the message and stamps a deterministic id', async () => {
  const notifier = new MemoryNotifier({ clock });
  const receipt = await notifier.send(reminder);

  assert.deepEqual(receipt, { id: 'nt-1', sentAt: TEST_NOW });
  assert.deepEqual(notifier.sent(), [reminder]);
  assert.equal(notifier.sent().length, 1);
});

test('notifier: ids increase and messages keep their order', async () => {
  const notifier = new MemoryNotifier({ clock });
  const digest: NotificationMessage = { ...reminder, kind: 'WEEKLY_DIGEST', subject: 'Weekly digest' };
  await notifier.send(reminder);
  await notifier.send(digest);

  assert.deepEqual(
    notifier.sent().map((message) => message.kind),
    ['REMINDER', 'WEEKLY_DIGEST']
  );
  assert.equal((await notifier.send(digest)).id, 'nt-3');
});

test('notifier: sent() hands out copies, so a caller cannot rewrite the capture', async () => {
  const notifier = new MemoryNotifier({ clock });
  await notifier.send(reminder);
  const captured = notifier.sent();
  captured[0]!.subject = 'altered';

  assert.equal(notifier.sent()[0]?.subject, 'Evidence to renew: CONT-01');
});

test('notifier: clear() empties the capture for a new scenario', async () => {
  const notifier = new MemoryNotifier({ clock });
  await notifier.send(reminder);
  notifier.clear();
  assert.deepEqual(notifier.sent(), []);
});
