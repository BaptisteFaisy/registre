import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OVERALL_META,
  SHARE_STATE_META,
  SHARE_TTL_CHOICES,
  SHARE_TTL_MAX_HOURS,
  SHARE_TTL_MIN_HOURS,
  expiryFromTtl,
  overallVerdict,
  parseShareInput,
  shareState,
  shortToken,
  verdictRows,
  watermarkOf
} from './verify.ts';
import type { ShareGrant, VerificationResult } from '../api/types.ts';

function result(patch: Partial<VerificationResult> = {}): VerificationResult {
  return {
    packId: 'pk-001',
    frameworkId: 'fw-msp-demo',
    verifiedAt: '2026-11-11T09:30:00.000Z',
    frozenAt: '2026-10-01T18:00:00.000Z',
    rootHash: 'ab'.repeat(32),
    controlCount: 30,
    evidenceCount: 41,
    knownGapCount: 12,
    checksumsOk: true,
    chainOk: true,
    signatureOk: true,
    signerKeyId: 'local-key-01',
    algorithm: 'ED25519-LOCAL',
    ...patch
  };
}

function grant(patch: Partial<ShareGrant> = {}): ShareGrant {
  return {
    token: 'tok-abcdef1234567890',
    packId: 'pk-001',
    frameworkId: 'fw-msp-demo',
    scope: 'PACK',
    createdBy: 'Amina Diallo',
    createdAt: '2026-11-01T09:00:00.000Z',
    expiresAt: '2026-11-12T09:00:00.000Z',
    revokedAt: null,
    revokedBy: null,
    watermark: 'AUDITOR KPMG · expires 12 Nov 2026',
    useCount: 3,
    lastUsedAt: '2026-11-10T08:00:00.000Z',
    ...patch
  };
}

const NOW = '2026-11-11T09:00:00.000Z';

test('an intact signed pack yields three passing verdict rows, in order', () => {
  const rows = verdictRows(result());
  assert.deepEqual(
    rows.map((row) => row.key),
    ['checksums', 'chain', 'signature']
  );
  assert.ok(rows.every((row) => row.value === 'OK'));
  assert.ok(rows.every((row) => row.description.length > 20));
  assert.equal(overallVerdict(result()), 'INTACT');
  assert.equal(OVERALL_META.INTACT.label, 'Intact and signed');
});

test('an altered fingerprint fails the checksum row and the overall verdict', () => {
  const rows = verdictRows(result({ checksumsOk: false }));
  const checksums = rows.find((row) => row.key === 'checksums');
  assert.equal(checksums?.value, 'FAILED');
  assert.match(checksums?.description ?? '', /altered/i);
  assert.equal(overallVerdict(result({ checksumsOk: false })), 'ALTERED');
});

test('a broken chain or a bad signature also alter the overall verdict', () => {
  assert.equal(overallVerdict(result({ chainOk: false })), 'ALTERED');
  assert.equal(overallVerdict(result({ signatureOk: false })), 'ALTERED');
});

test('a deployment without a signing key says "not configured", never failed', () => {
  const rows = verdictRows(result({ signatureOk: null, algorithm: 'NONE', signerKeyId: null }));
  const signature = rows.find((row) => row.key === 'signature');
  assert.equal(signature?.value, 'NOT_CONFIGURED');
  assert.equal(overallVerdict(result({ signatureOk: null, algorithm: 'NONE' })), 'UNSIGNED');
});

test('the signature row names the algorithm and the key', () => {
  const rows = verdictRows(result());
  const signature = rows.find((row) => row.key === 'signature');
  assert.match(signature?.description ?? '', /ED25519-LOCAL/);
  assert.match(signature?.description ?? '', /local-key-01/);
});

test('share states: revocation wins, then expiry, against the API rule', () => {
  assert.equal(shareState(grant(), NOW), 'ACTIVE');
  assert.equal(shareState(grant({ expiresAt: '2026-11-10T09:00:00.000Z' }), NOW), 'EXPIRED');
  const revoked = grant({
    revokedAt: '2026-11-05T10:00:00.000Z',
    revokedBy: 'Amina Diallo',
    expiresAt: '2026-11-20T09:00:00.000Z'
  });
  assert.equal(shareState(revoked, NOW), 'REVOKED');
  assert.equal(SHARE_STATE_META.REVOKED.label, 'Revoked');
});

test('the share lifetime bounds match the API (1 h to one week)', () => {
  assert.equal(SHARE_TTL_MIN_HOURS, 1);
  assert.equal(SHARE_TTL_MAX_HOURS, 168);
  assert.ok(SHARE_TTL_CHOICES.every((choice) => choice.hours >= 1 && choice.hours <= 168));
});

test('the share form input is validated before it reaches the API', () => {
  assert.deepEqual(parseShareInput('24', 'KPMG audit'), {
    input: { ttlHours: 24, watermarkLabel: 'KPMG audit' }
  });
  assert.ok('error' in parseShareInput('0', 'KPMG audit'));
  assert.ok('error' in parseShareInput('169', 'KPMG audit'));
  assert.ok('error' in parseShareInput('2.5', 'KPMG audit'));
  assert.ok('error' in parseShareInput('abc', 'KPMG audit'));
  assert.ok('error' in parseShareInput('24', '  '));
  assert.deepEqual(parseShareInput('1', '  XY  '), {
    input: { ttlHours: 1, watermarkLabel: 'XY' }
  });
});

test('the watermark mirrors the API format', () => {
  assert.equal(
    watermarkOf('KPMG', '2026-11-12T09:00:00.000Z'),
    'AUDITOR KPMG · expires 12 Nov 2026'
  );
});

test('the expiry is the creation instant plus the lifetime', () => {
  assert.equal(
    expiryFromTtl('2026-11-01T09:00:00.000Z', 24),
    '2026-11-02T09:00:00.000Z'
  );
  assert.equal(
    expiryFromTtl('2026-11-01T09:00:00.000Z', 168),
    '2026-11-08T09:00:00.000Z'
  );
});

test('a long token is shortened, a short one is kept', () => {
  assert.equal(shortToken('abcdefgh'), 'abcdefgh');
  assert.equal(shortToken('0123456789abcdefghijkl'), '0123456789ab…');
});
