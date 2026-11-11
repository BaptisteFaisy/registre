/**
 * Verification and sharing entities — "a third party can check without trusting us".
 *
 * An audit pack is only as good as the trust a reviewer puts in it. These types
 * make the pack self-describing and publicly checkable:
 *   - `PackManifest` is the canonical, content-free description of a pack
 *     (which control, which evidence, which fingerprint);
 *   - `PackSignature` signs the manifest's root hash, so the pack cannot be
 *     altered after it is frozen without the signature failing;
 *   - `VerificationResult` is what a public verifier returns: hashes, counts and
 *     verdicts, never a single byte of evidence (ENF-CONF-03);
 *   - `ShareGrant` is a time-boxed, revocable, watermarked read access for an
 *     external auditor, instead of e-mailing an archive.
 *
 * All timestamps are ISO-8601, all hashes lowercase hex SHA-256.
 */

import type { ControlState, FrameworkId, PackId, SufficiencyClass } from './types.ts';

/** How the manifest was signed. `NONE` means signing was not configured. */
export type SignatureAlgorithm = 'KMS-ECDSA-P256' | 'ED25519-LOCAL' | 'NONE';

/** Where a document comes from: written by a human, or produced by a collector. */
export type EvidenceProvenance = 'HUMAN_DOCUMENT' | 'MACHINE_ATTESTATION';

/** One evidence line of the manifest: identity and fingerprint only. */
export interface ManifestEvidence {
  evidenceId: string;
  sha256: string;
  documentDate: string | null;
  sufficiencyClass: SufficiencyClass | null;
  provenance: EvidenceProvenance;
}

/** One control line of the manifest. */
export interface ManifestControl {
  controlId: string;
  state: ControlState;
  evidence: ManifestEvidence[];
}

/** Canonical, content-free description of a frozen pack. */
export interface PackManifest {
  packId: PackId;
  frameworkId: FrameworkId;
  frameworkVersion: string;
  frozenAt: string;
  controlCount: number;
  evidenceCount: number;
  knownGapCount: number;
  controls: ManifestControl[];
  /** SHA-256 of the canonical JSON of everything above this field. */
  rootHash: string;
}

/** Signature of a manifest's root hash. */
export interface PackSignature {
  algorithm: SignatureAlgorithm;
  /** KMS key id, or the local key fingerprint. */
  keyId: string;
  signedAt: string;
  /** Base64 signature bytes. */
  signature: string;
  /** The root hash that was signed, repeated so a verifier needs no lookup. */
  rootHash: string;
}

/** Result of a verification, safe to publish: no evidence content, ever. */
export interface VerificationResult {
  packId: PackId;
  frameworkId: FrameworkId;
  verifiedAt: string;
  frozenAt: string;
  rootHash: string;
  controlCount: number;
  evidenceCount: number;
  knownGapCount: number;
  /** Every evidence fingerprint in the archive matches the manifest. */
  checksumsOk: boolean;
  /** The audit hash chain covering the pack's events is intact. */
  chainOk: boolean;
  /** `null` when the deployment has no signing key configured. */
  signatureOk: boolean | null;
  signerKeyId: string | null;
  algorithm: SignatureAlgorithm;
}

/** What a share grant gives access to. */
export type ShareScope = 'PACK' | 'FRAMEWORK';

/** A time-boxed, revocable read access for an external auditor. */
export interface ShareGrant {
  /** Opaque token, presented as `Authorization: Bearer share:<token>`. */
  token: string;
  packId: PackId | null;
  frameworkId: FrameworkId;
  scope: ShareScope;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  /** Stamped on every excerpt served through this grant. */
  watermark: string;
  useCount: number;
  lastUsedAt: string | null;
}

/** True when the grant can still be used at `now`. */
export function isShareActive(share: ShareGrant, now: string): boolean {
  return share.revokedAt === null && share.expiresAt > now;
}

/** True when this evidence was produced by a collector rather than written. */
export function provenanceOf(provenance: EvidenceProvenance | undefined): EvidenceProvenance {
  return provenance ?? 'HUMAN_DOCUMENT';
}
