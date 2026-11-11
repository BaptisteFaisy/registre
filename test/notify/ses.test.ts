/**
 * SES notifier — the production `Notifier` (chapter 11.2: reminders by e-mail).
 * The transport is injected: no e-mail leaves the machine during the tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SES_CONFIG_SET_ENV,
  SES_FROM_ENV,
  SesNotifier,
  sesOptionsFromEnv
} from '../../src/notify/ses.ts';
import type { EmailTransport, OutgoingEmail } from '../../src/notify/ses.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { RegistreError } from '../../src/support/errors.ts';
import type { NotificationMessage } from '../../src/ports/index.ts';
import { TEST_NOW } from '../fixtures/builders.ts';

const clock = new FixedClock(TEST_NOW);

const message: NotificationMessage = {
  to: 'ops.owner@msp.demo',
  subject: 'Evidence to renew: CONT-03',
  body: 'Please provide the restore test report.',
  kind: 'REMINDER',
  controlId: 'CONT-03'
};

/** Transport that records what it was asked to send. */
function recorder(failWith?: Error): { transport: EmailTransport; sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    transport: {
      async send(email) {
        if (failWith !== undefined) throw failWith;
        sent.push(email);
        return { messageId: `ses-${sent.length}` };
      }
    }
  };
}

test('send: hands the message to the transport with the verified sender', async () => {
  const { transport, sent } = recorder();
  const notifier = new SesNotifier({ from: 'noreply@msp.demo', clock, transport });

  const receipt = await notifier.send(message);

  assert.deepEqual(receipt, { id: 'ses-1', sentAt: TEST_NOW });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    from: 'noreply@msp.demo',
    to: 'ops.owner@msp.demo',
    subject: 'Evidence to renew: CONT-03',
    body: 'Please provide the restore test report.'
  });
});

test('send: the configuration set is forwarded when configured (ENF-OBS-01)', async () => {
  const { transport, sent } = recorder();
  const notifier = new SesNotifier({
    from: 'noreply@msp.demo',
    clock,
    transport,
    configurationSetName: 'registre-reminders'
  });
  await notifier.send(message);
  assert.equal(sent[0]?.configurationSetName, 'registre-reminders');
});

test('sent: keeps the notifications accepted by SES, oldest first', async () => {
  const { transport } = recorder();
  const notifier = new SesNotifier({ from: 'noreply@msp.demo', clock, transport });
  await notifier.send(message);
  await notifier.send({ ...message, kind: 'WEEKLY_DIGEST', to: 'quality@msp.demo' });

  assert.deepEqual(
    notifier.sent().map((item) => item.to),
    ['ops.owner@msp.demo', 'quality@msp.demo']
  );
});

test('sent: a rejected message is not recorded', async () => {
  const { transport } = recorder(new Error('MessageRejected'));
  const notifier = new SesNotifier({ from: 'noreply@msp.demo', clock, transport });

  await assert.rejects(notifier.send(message));
  assert.deepEqual(notifier.sent(), []);
});

test('send: a transport failure surfaces as UPSTREAM, never as a bare error', async () => {
  const { transport } = recorder(new Error('throttled by SES'));
  const notifier = new SesNotifier({ from: 'noreply@msp.demo', clock, transport });

  await assert.rejects(notifier.send(message), (error: unknown) => {
    assert.ok(error instanceof RegistreError);
    assert.equal(error.code, 'UPSTREAM');
    assert.equal(error.detail.to, 'ops.owner@msp.demo');
    assert.match(String(error.detail.error), /throttled/);
    return true;
  });
});

test('construction: an empty sender identity is a configuration error', () => {
  assert.throws(() => new SesNotifier({ from: '  ' }), (error: unknown) => {
    assert.ok(error instanceof RegistreError);
    assert.equal(error.code, 'CONFIG');
    return true;
  });
});

test('configuration: the sender and the configuration set come from the environment', () => {
  const options = sesOptionsFromEnv({
    [SES_FROM_ENV]: 'noreply@msp.demo',
    [SES_CONFIG_SET_ENV]: 'registre-reminders',
    REGISTRE_REGION: 'eu-west-3'
  });
  assert.deepEqual(options, {
    from: 'noreply@msp.demo',
    region: 'eu-west-3',
    configurationSetName: 'registre-reminders'
  });
});

test('configuration: a missing sender is a CONFIG error, caught at startup', () => {
  assert.throws(() => sesOptionsFromEnv({}), (error: unknown) => {
    assert.ok(error instanceof RegistreError);
    assert.equal(error.code, 'CONFIG');
    return true;
  });
});

test('the notifier exposes the id the bootstrap expects', () => {
  const { transport } = recorder();
  assert.equal(new SesNotifier({ from: 'noreply@msp.demo', transport }).id, 'ses-notifier');
});
