/**
 * Pack verification — a third party checks a frozen audit pack without trusting
 * us, and without ever receiving its content.
 *
 * Four independent checks, each answering a different question:
 *   1. `checksumsOk` — the archive bytes still hash to what was recorded, the
 *      manifest's root hash still matches its content, and every evidence
 *      fingerprint in the manifest still matches the stored evidence;
 *   2. `signatureOk` — the manifest was signed by the configured key (`null`
 *      when the deployment has no signing key, which is never reported as a
 *      pass);
 *   3. `chainOk` — the append-only audit chain covering the pack is intact;
 *   4. counts and the freeze instant, so a reviewer can compare with what they
 *      were told out of band.
 *
 * A negative verdict is a RESULT, not an exception: the whole point is that an
 * auditor can see "this pack was altered". Only an unknown pack throws.
 *
 * Nothing in `VerificationResult` carries content: no title, no quote, no name
 * (ENF-CONF-03).
 */

import type { Pack, PackId } from '../domain/types.ts';
import type { VerificationResult } from '../domain/verification.ts';
import { manifestChecksumLines, manifestIsSelfConsistent, rootHashOf } from '../domain/manifest.ts';
import type { Services } from '../ports/index.ts';
import { notFound } from '../support/errors.ts';
import { canonicalJson, sha256Bytes } from '../support/hash.ts';
import { record } from '../audit/log.ts';
import { resolveShare } from './share.ts';

/** Verifies one stored pack and records the verdict. */
export async function verifyPack(services: Services, packId: PackId): Promise<VerificationResult> {
  const pack = await services.state.getPack(packId);
  if (pack === null) throw notFound(`pack ${packId} does not exist`);
  const result = await checkPack(services, pack);
  await services.extensions.recordVerification(result);
  await record(services, 'verifier', 'PACK_VERIFIED', 'pack', packId, {
    checksumsOk: result.checksumsOk,
    chainOk: result.chainOk,
    signatureOk: result.signatureOk,
    rootHash: result.rootHash
  });
  return result;
}

/**
 * Verifies the pack a share grant points at. A `FRAMEWORK` scope grant cannot
 * verify a pack: the token names no pack, and inventing one would widen it.
 */
export async function verifyByToken(services: Services, token: string): Promise<VerificationResult> {
  const share = await resolveShare(services, token);
  if (share === null) throw notFound('unknown, expired or revoked share token');
  if (share.packId === null) throw notFound('this share grant is not bound to a pack');
  return verifyPack(services, share.packId);
}

/** Runs the four checks; the single place where a verdict is computed. */
export async function checkPack(services: Services, pack: Pack): Promise<VerificationResult> {
  const archiveOk = await archiveMatches(services, pack);
  const manifestOk = manifestIsSelfConsistent(pack.manifest) && rootHashOf(pack.manifest) === pack.manifest.rootHash;
  const evidenceOk = await evidenceFingerprintsMatch(services, pack);
  const chain = await services.audit.verifyChain();
  return {
    packId: pack.id,
    frameworkId: pack.frameworkId,
    verifiedAt: services.clock.now(),
    frozenAt: pack.frozenAt,
    rootHash: pack.manifest.rootHash,
    controlCount: pack.manifest.controlCount,
    evidenceCount: pack.manifest.evidenceCount,
    knownGapCount: pack.manifest.knownGapCount,
    checksumsOk: archiveOk && manifestOk && evidenceOk && pack.checksumsVerified,
    chainOk: chain.ok,
    signatureOk: await signatureVerdict(services, pack),
    signerKeyId: pack.signature?.keyId ?? null,
    algorithm: pack.signature?.algorithm ?? 'NONE'
  };
}

/** The archive bytes still hash to the recorded fingerprint. */
async function archiveMatches(services: Services, pack: Pack): Promise<boolean> {
  try {
    const bytes = await services.evidenceStore.get(pack.archive.uri);
    return sha256Bytes(bytes) === pack.archive.sha256;
  } catch {
    return false;
  }
}

/** Every fingerprint in the manifest still matches the stored evidence. */
async function evidenceFingerprintsMatch(services: Services, pack: Pack): Promise<boolean> {
  const expected = new Map(
    manifestChecksumLines(pack.manifest).map((line) => {
      const [left, hash] = line.split('=');
      return [left ?? '', hash ?? ''];
    })
  );
  for (const control of pack.manifest.controls) {
    for (const line of control.evidence) {
      const stored = await services.state.getEvidence(line.evidenceId);
      if (stored === null) return false;
      if (stored.sha256 !== line.sha256) return false;
      if (expected.get(`${control.controlId}/${line.evidenceId}`) !== line.sha256) return false;
    }
  }
  return true;
}

/** `true`, `false`, or `null` when the pack carries no signature at all. */
async function signatureVerdict(services: Services, pack: Pack): Promise<boolean | null> {
  if (pack.signature === null) return null;
  const payload = new TextEncoder().encode(canonicalJson(pack.manifest));
  try {
    return await services.signer.verify({
      payload,
      signature: pack.signature.signature,
      keyId: pack.signature.keyId,
      algorithm: pack.signature.algorithm
    });
  } catch {
    return false;
  }
}

/** One-line human verdict, for the portal and the verification script output. */
export function verdictLine(result: VerificationResult): string {
  const parts = [
    `checksums ${result.checksumsOk ? 'ok' : 'FAILED'}`,
    `audit chain ${result.chainOk ? 'ok' : 'BROKEN'}`,
    result.signatureOk === null
      ? 'signature absent'
      : `signature ${result.signatureOk ? 'ok' : 'FAILED'}`
  ];
  return `pack ${result.packId} frozen ${result.frozenAt}: ${parts.join(', ')}`;
}
