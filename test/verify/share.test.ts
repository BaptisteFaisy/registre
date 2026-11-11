/**
 * Auditor share grants (axis 1) — bounded in time, scoped, revocable, watermarked,
 * and counted on every use. A grant never widens a right.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TTL_HOURS,
  MIN_TTL_HOURS,
  SHARE_TOKEN_PREFIX,
  createShare,
  isShareCredential,
  listShares,
  resolveShare,
  revokeShare,
  stripPrefix,
  watermarked,
  watermarkOf
} from '../../src/pipeline/share.ts';
import { isShareActive } from '../../src/domain/verification.ts';
import { FixedClock } from '../../src/support/clock.ts';
import { makeControl } from '../fixtures/builders.ts';
import { fakeServices, seed } from '../pipeline/fakeServices.ts';

const FRAMEWORK = { id: 'demo-msp' };

async function ready() {
  const services = fakeServices();
  await seed(services, [makeControl({ id: 'CONT-01' })], FRAMEWORK);
  return services;
}

test('a grant carries a token, a watermark and an expiry', async () => {
  const services = await ready();
  const share = await createShare(services, {
    frameworkId: 'demo-msp',
    scope: 'FRAMEWORK',
    ttlHours: 24,
    by: 'quality.lead',
    watermarkLabel: 'Audit firm'
  });
  assert.ok(share.token.length >= 32);
  assert.equal(share.scope, 'FRAMEWORK');
  assert.equal(share.useCount, 0);
  assert.match(share.watermark, /^AUDITOR Audit firm · expires \d{4}-\d{2}-\d{2}$/);
  assert.equal(isShareActive(share, services.clock.now()), true);
});

test('the lifetime is bounded on both sides', async () => {
  const services = await ready();
  await assert.rejects(
    () => createShare(services, { frameworkId: 'demo-msp', scope: 'FRAMEWORK', ttlHours: 0, by: 'q' }),
    /ttlHours must be between/
  );
  await assert.rejects(
    () =>
      createShare(services, {
        frameworkId: 'demo-msp',
        scope: 'FRAMEWORK',
        ttlHours: MAX_TTL_HOURS + 1,
        by: 'q'
      }),
    /ttlHours must be between/
  );
  assert.equal(MIN_TTL_HOURS, 1);
  assert.equal(MAX_TTL_HOURS, 168);
});

test('a pack scope needs a pack that exists', async () => {
  const services = await ready();
  await assert.rejects(
    () => createShare(services, { frameworkId: 'demo-msp', scope: 'PACK', by: 'q' }),
    /requires a packId/
  );
  await assert.rejects(
    () => createShare(services, { frameworkId: 'demo-msp', scope: 'PACK', packId: 'pk-nope', by: 'q' }),
    /does not exist/
  );
});

test('an unknown framework is refused', async () => {
  const services = await ready();
  await assert.rejects(
    () => createShare(services, { frameworkId: 'nope', scope: 'FRAMEWORK', ttlHours: 2, by: 'q' }),
    /does not exist/
  );
});

test('resolving counts the use and stamps the instant', async () => {
  const services = await ready();
  const share = await createShare(services, { frameworkId: 'demo-msp', scope: 'FRAMEWORK', ttlHours: 5, by: 'q' });
  const first = await resolveShare(services, share.token);
  assert.equal(first?.useCount, 1);
  assert.equal(first?.lastUsedAt, services.clock.now());
  const second = await resolveShare(services, `${SHARE_TOKEN_PREFIX}${share.token}`);
  assert.equal(second?.useCount, 2);
  assert.equal(services.events('SHARE_USED').length, 2);
});

test('an expired grant resolves to nothing', async () => {
  const services = await ready();
  const share = await createShare(services, { frameworkId: 'demo-msp', scope: 'FRAMEWORK', ttlHours: 1, by: 'q' });
  asClock(services.clock).advanceDays(1);
  asClock(services.clock).set(new Date(new Date(services.clock.now()).getTime() + 60_000).toISOString());
  assert.equal(await resolveShare(services, share.token), null);
});

test('a revoked grant resolves to nothing, and revoking twice is a no-op', async () => {
  const services = await ready();
  const share = await createShare(services, { frameworkId: 'demo-msp', scope: 'FRAMEWORK', ttlHours: 24, by: 'q' });
  const revoked = await revokeShare(services, share.token, 'admin');
  assert.ok(revoked.revokedAt !== null);
  assert.equal(revoked.revokedBy, 'admin');
  assert.equal(await resolveShare(services, share.token), null);
  const again = await revokeShare(services, share.token, 'admin');
  assert.equal(again.revokedAt, revoked.revokedAt);
  assert.equal(services.events('SHARE_REVOKED').length, 1);
});

test('revoking an unknown token is a 404, not a silent success', async () => {
  const services = await ready();
  await assert.rejects(() => revokeShare(services, 'nope', 'admin'), /unknown share token/);
});

test('listing keeps the newest first and can hide revoked ones', async () => {
  const services = await ready();
  await createShare(services, { frameworkId: 'demo-msp', scope: 'FRAMEWORK', ttlHours: 2, by: 'q' });
  const second = await createShare(services, {
    frameworkId: 'demo-msp',
    scope: 'FRAMEWORK',
    ttlHours: 3,
    by: 'q'
  });
  await revokeShare(services, second.token, 'admin');
  assert.equal((await listShares(services)).length, 2);
  const active = await listShares(services, { activeOnly: true });
  assert.equal(active.length, 1);
  assert.notEqual(active[0]?.token, second.token);
});

test('the watermark is stamped in front of an excerpt', () => {
  const share = { watermark: 'AUDITOR Firm · expires 2026-12-01' } as never;
  assert.equal(watermarked(share, 'excerpt'), '[AUDITOR Firm · expires 2026-12-01] excerpt');
});

test('credential detection and prefix handling', () => {
  assert.equal(isShareCredential('share:abc'), true);
  assert.equal(isShareCredential('abc'), false);
  assert.equal(stripPrefix('share:abc'), 'abc');
  assert.equal(stripPrefix('abc'), 'abc');
  assert.equal(watermarkOf('', '2026-12-01T00:00:00.000Z'), 'AUDITOR external auditor · expires 2026-12-01');
});


/** The fake bundle always carries a frozen clock; the port only promises `now`. */
function asClock(clock: { now(): string }): FixedClock {
  return clock as FixedClock;
}
