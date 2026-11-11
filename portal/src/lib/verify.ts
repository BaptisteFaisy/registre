/**
 * Pure display logic of the verification and sharing screen (axis 1).
 * No DOM, no React: unit-testable with `node --test`.
 */

import type { ShareGrant, ShareInput, VerificationResult } from '../api/types.ts';
import { formatDate } from './format.ts';

/** The three verdicts a verifier reads, in display order. */
export type VerdictKey = 'checksums' | 'chain' | 'signature';

export type VerdictValue = 'OK' | 'FAILED' | 'NOT_CONFIGURED';

export interface VerdictRow {
  key: VerdictKey;
  label: string;
  value: VerdictValue;
  description: string;
}

export const VERDICT_META: Record<VerdictValue, { label: string; color: string }> = {
  OK: { label: 'Passed', color: '#3fb950' },
  FAILED: { label: 'Failed', color: '#f85149' },
  NOT_CONFIGURED: { label: 'Not configured', color: '#8b949e' }
};

function booleanVerdict(ok: boolean): VerdictValue {
  return ok ? 'OK' : 'FAILED';
}

/** The three verdict rows of a verification result, always in the same order. */
export function verdictRows(result: VerificationResult): VerdictRow[] {
  const signature: VerdictValue =
    result.signatureOk === null ? 'NOT_CONFIGURED' : booleanVerdict(result.signatureOk);
  return [
    {
      key: 'checksums',
      label: 'Evidence fingerprints',
      value: booleanVerdict(result.checksumsOk),
      description: result.checksumsOk
        ? 'Every fingerprint in the archive matches the manifest.'
        : 'At least one fingerprint differs from the manifest: the archive was altered.'
    },
    {
      key: 'chain',
      label: 'Audit hash chain',
      value: booleanVerdict(result.chainOk),
      description: result.chainOk
        ? 'The hash chain covering the events of this pack is intact.'
        : 'The audit hash chain is broken: events were removed or rewritten.'
    },
    {
      key: 'signature',
      label: 'Manifest signature',
      value: signature,
      description: signatureDescription(result, signature)
    }
  ];
}

function signatureDescription(result: VerificationResult, value: VerdictValue): string {
  if (value === 'NOT_CONFIGURED') {
    return 'This deployment has no signing key: the manifest carries no signature.';
  }
  const who = `${result.algorithm}${result.signerKeyId ? ` · key ${result.signerKeyId}` : ''}`;
  return value === 'OK'
    ? `The root hash is signed and the signature verifies (${who}).`
    : `The signature does not verify (${who}): the manifest was edited after signing.`;
}

export type OverallVerdict = 'INTACT' | 'ALTERED' | 'UNSIGNED';

export const OVERALL_META: Record<OverallVerdict, { label: string; color: string }> = {
  INTACT: { label: 'Intact and signed', color: '#3fb950' },
  ALTERED: { label: 'Altered — do not trust', color: '#f85149' },
  UNSIGNED: { label: 'Intact, not signed', color: '#d29922' }
};

/** One-word verdict of the whole verification. */
export function overallVerdict(result: VerificationResult): OverallVerdict {
  if (!result.checksumsOk || !result.chainOk || result.signatureOk === false) return 'ALTERED';
  if (result.signatureOk === null) return 'UNSIGNED';
  return 'INTACT';
}

/* ------------------------------------------------------------------ shares */

export type ShareState = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export const SHARE_STATE_META: Record<ShareState, { label: string; color: string }> = {
  ACTIVE: { label: 'Active', color: '#3fb950' },
  EXPIRED: { label: 'Expired', color: '#8b949e' },
  REVOKED: { label: 'Revoked', color: '#f85149' }
};

/** State of a grant at `now`: revocation wins, then expiry (API `isShareActive`). */
export function shareState(share: ShareGrant, now: string): ShareState {
  if (share.revokedAt !== null) return 'REVOKED';
  return share.expiresAt > now ? 'ACTIVE' : 'EXPIRED';
}

/** Lifetime bounds the API accepts for a share, in hours. */
export const SHARE_TTL_MIN_HOURS = 1;
export const SHARE_TTL_MAX_HOURS = 168;

/** Quick choices offered by the share form. */
export const SHARE_TTL_CHOICES: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 4, label: '4 h' },
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' }
];

/** Validates the share form; returns a readable failure or the API input. */
export function parseShareInput(
  ttl: string,
  label: string
): { input: ShareInput } | { error: string } {
  const ttlHours = Number(ttl);
  if (
    !Number.isInteger(ttlHours) ||
    ttlHours < SHARE_TTL_MIN_HOURS ||
    ttlHours > SHARE_TTL_MAX_HOURS
  ) {
    return {
      error: `The lifetime must be a whole number of hours, ${SHARE_TTL_MIN_HOURS} to ${SHARE_TTL_MAX_HOURS}.`
    };
  }
  const trimmed = label.trim();
  if (trimmed.length < 2) {
    return { error: 'Name the recipient: the label is stamped on every excerpt.' };
  }
  return { input: { ttlHours, watermarkLabel: trimmed } };
}

/** `expiresAt = createdAt + ttlHours`, as the API computes it. */
export function expiryFromTtl(createdAt: string, ttlHours: number): string {
  return new Date(new Date(createdAt).getTime() + ttlHours * 3_600_000).toISOString();
}

/** Watermark of a grant, built exactly like the API builds it. */
export function watermarkOf(label: string, expiresAt: string): string {
  return `AUDITOR ${label} · expires ${formatDate(expiresAt)}`;
}

/** Shortens a share token for display, keeping a recognisable head. */
export function shortToken(token: string): string {
  return token.length <= 16 ? token : `${token.slice(0, 12)}…`;
}
