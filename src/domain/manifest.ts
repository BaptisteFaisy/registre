/**
 * Canonical pack manifest — the content-free description of a frozen audit pack.
 *
 * Why a manifest: an auditor should be able to check that a pack was not altered
 * after it was frozen, without being given the evidence itself. The manifest
 * carries identities, states and fingerprints only (ENF-CONF-03: no protected
 * framework text, no evidence content leaves the account).
 *
 * The root hash is computed over canonical JSON (sorted keys), so two runs on the
 * same pack produce the same hash — verification is reproducible offline with
 * `scripts/verify-pack.sh`.
 */

import type { Control, ControlStatus, Evidence, KnownGap, PackIndexEntry } from './types.ts';
import type { ManifestControl, ManifestEvidence, PackManifest } from './verification.ts';
import { provenanceOf } from './verification.ts';
import { sha256Json, sha256Text } from '../support/hash.ts';
import type { FrameworkId, PackId } from './types.ts';

/** Builds one manifest evidence line from a pack index entry and its evidence. */
export function manifestEvidence(
  entry: PackIndexEntry['evidence'][number],
  evidence: Evidence | null
): ManifestEvidence {
  return {
    evidenceId: entry.evidenceId,
    sha256: entry.sha256,
    documentDate: entry.documentDate,
    sufficiencyClass: entry.sufficiencyClass,
    provenance: provenanceOf(evidence?.provenance)
  };
}

/** Builds one manifest control line. */
export function manifestControl(
  entry: PackIndexEntry,
  status: ControlStatus | null,
  byId: ReadonlyMap<string, Evidence>
): ManifestControl {
  return {
    controlId: entry.controlId,
    state: status?.state ?? entry.state,
    evidence: entry.evidence.map((line) => manifestEvidence(line, byId.get(line.evidenceId) ?? null))
  };
}

/** Input of `buildManifest`; everything the pack already knows. */
export interface ManifestInput {
  packId: PackId;
  frameworkId: FrameworkId;
  frameworkVersion: string;
  frozenAt: string;
  index: readonly PackIndexEntry[];
  knownGaps: readonly KnownGap[];
  statuses: readonly ControlStatus[];
  evidenceById: ReadonlyMap<string, Evidence>;
}

/**
 * Builds the manifest and its root hash. The hash covers every field except
 * itself, over canonical JSON, so it is stable across runs and machines.
 */
export function buildManifest(input: ManifestInput): PackManifest {
  const statusOf = new Map(input.statuses.map((status) => [status.controlId, status]));
  const controls = input.index.map((entry) =>
    manifestControl(entry, statusOf.get(entry.controlId) ?? null, input.evidenceById)
  );
  const evidenceCount = controls.reduce((total, control) => total + control.evidence.length, 0);
  const unsigned = {
    packId: input.packId,
    frameworkId: input.frameworkId,
    frameworkVersion: input.frameworkVersion,
    frozenAt: input.frozenAt,
    controlCount: controls.length,
    evidenceCount,
    knownGapCount: input.knownGaps.length,
    controls
  };
  return { ...unsigned, rootHash: sha256Json(unsigned) };
}

/** Recomputes the root hash of a manifest, to check it was not tampered with. */
export function rootHashOf(manifest: PackManifest): string {
  const { rootHash: _ignored, ...unsigned } = manifest;
  void _ignored;
  return sha256Json(unsigned);
}

/** True when a manifest's root hash still matches its content. */
export function manifestIsSelfConsistent(manifest: PackManifest): boolean {
  return rootHashOf(manifest) === manifest.rootHash;
}

/** Every fingerprint a verifier needs, as `controlId/evidenceId=sha256` lines. */
export function manifestChecksumLines(manifest: PackManifest): string[] {
  const lines: string[] = [];
  for (const control of manifest.controls) {
    for (const evidence of control.evidence) {
      lines.push(`${control.controlId}/${evidence.evidenceId}=${evidence.sha256}`);
    }
  }
  return lines.sort();
}

/** Hash of the sorted checksum lines: one value a reviewer can compare. */
export function checksumsHash(manifest: PackManifest): string {
  return sha256Text(manifestChecksumLines(manifest).join('\n'));
}

/** Convenience: controls of a framework indexed by id. */
export function controlsById(controls: readonly Control[]): Map<string, Control> {
  return new Map(controls.map((control) => [control.id, control]));
}
