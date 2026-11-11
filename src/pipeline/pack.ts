/**
 * Audit pack — EF-DOS-01 ("assembler le dossier d'un référentiel : index par
 * contrôle, preuves, dates, écarts connus"), EF-DOS-02 ("exporter le dossier en
 * archive, avec un index lisible") and EF-DOS-03 (freeze the pack at an instant
 * so it can be reproduced).
 *
 * The archive is an index document plus a manifest of the fingerprints, both
 * written to the evidence vault under their own retention (ENF-INT-01). The
 * fingerprints are re-read and re-verified before the pack is handed back, so
 * `checksumsVerified` is a measurement, not a promise (chapter 16.3).
 */

import type {
  Control,
  ControlStatus,
  FrameworkId,
  KnownGap,
  Pack,
  PackId,
  PackIndexEntry
} from '../domain/types.ts';
import type { Services } from '../ports/index.ts';
import { notFound } from '../support/errors.ts';
import { canonicalJson, sha256Bytes } from '../support/hash.ts';
import { packId as makePackId } from '../support/ids.ts';
import { detectKnownGaps } from '../domain/readiness.ts';
import { record } from '../audit/log.ts';
import { recomputeFramework } from './states.ts';
import { retentionDays } from './vault.ts';

/** The frozen content of a pack, before it is written to the vault — EF-DOS-01. */
interface PackDocument {
  packId: PackId;
  frameworkId: FrameworkId;
  frozenAt: string;
  index: PackIndexEntry[];
  knownGaps: KnownGap[];
}

/** Fingerprints of everything the pack carries — EF-DOS-02, chapter 16.3. */
interface PackManifest {
  packId: PackId;
  frameworkId: FrameworkId;
  frozenAt: string;
  indexSha256: string;
  evidence: Array<{ evidenceId: string; sha256: string }>;
}

/**
 * Assembles the audit pack of one framework, frozen at the current instant —
 * EF-DOS-01/02/03 (acceptance R14).
 */
export async function assemblePack(services: Services, frameworkId: FrameworkId, actor: string): Promise<Pack> {
  const framework = await services.state.getFramework(frameworkId);
  if (!framework) throw notFound(`framework ${frameworkId} does not exist`);
  const { statuses } = await recomputeFramework(services, frameworkId);
  const controls = await services.state.listControls(frameworkId);
  const frozenAt = services.clock.now();
  const id = makePackId(frameworkId, frozenAt);
  const document: PackDocument = {
    packId: id,
    frameworkId,
    frozenAt,
    index: await buildIndex(services, controls, statuses),
    knownGaps: detectKnownGaps(statuses)
  };
  const written = await writeArchive(services, document);
  const pack: Pack = {
    id,
    frameworkId,
    frozenAt,
    index: document.index,
    knownGaps: document.knownGaps,
    archive: written.archive,
    checksumsVerified: written.verified
  };
  await services.state.putPack(pack);
  await record(services, actor, 'PACK_ASSEMBLED', 'pack', id, {
    frameworkId,
    controls: document.index.length,
    knownGaps: document.knownGaps.length,
    evidence: countEvidence(document.index),
    archive: written.archive.uri,
    checksumsVerified: written.verified
  });
  return pack;
}

/** One index entry per control, state included — EF-DOS-01. */
async function buildIndex(
  services: Services,
  controls: readonly Control[],
  statuses: readonly ControlStatus[]
): Promise<PackIndexEntry[]> {
  const byControl = new Map(statuses.map((status) => [status.controlId, status]));
  const index: PackIndexEntry[] = [];
  for (const control of controls) {
    index.push({
      controlId: control.id,
      controlTitle: control.title,
      state: byControl.get(control.id)?.state ?? 'NO_EVIDENCE',
      evidence: await evidenceEntries(services, control.id)
    });
  }
  return index;
}

/** Evidence retained for one control: applied, supporting, with its quote — EF-DOS-01. */
async function evidenceEntries(services: Services, controlId: string): Promise<PackIndexEntry['evidence']> {
  const attachments = await services.state.listAttachments({ controlId, status: 'APPLIED' });
  const entries: PackIndexEntry['evidence'] = [];
  for (const attachment of attachments.filter((item) => item.supports)) {
    const evidence = await services.state.getEvidence(attachment.evidenceId);
    if (!evidence) continue;
    const sufficiency = await services.state.getSufficiencyForAttachment(attachment.id);
    entries.push({
      evidenceId: evidence.id,
      title: evidence.fields.title,
      documentDate: evidence.fields.documentDate,
      sha256: evidence.sha256,
      sufficiencyClass: sufficiency?.class ?? null,
      quote: attachment.quote,
      page: attachment.quoteLocation.page
    });
  }
  return entries.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
}

/** Writes the index and its manifest, then verifies the fingerprint — EF-DOS-02. */
async function writeArchive(
  services: Services,
  document: PackDocument
): Promise<{ archive: Pack['archive']; verified: boolean }> {
  const bytes = new TextEncoder().encode(canonicalJson(document));
  const indexSha256 = sha256Bytes(bytes);
  const retainDays = retentionDays(services);
  const stored = await services.evidenceStore.put({
    key: `packs/${document.packId}/index.json`,
    bytes,
    contentType: 'application/json',
    retainDays
  });
  const manifest = buildManifest(document, indexSha256);
  await services.evidenceStore.put({
    key: `packs/${document.packId}/manifest.json`,
    bytes: new TextEncoder().encode(canonicalJson(manifest)),
    contentType: 'application/json',
    retainDays
  });
  const verified = await verifyArchive(services, stored.uri, stored.sha256);
  return { archive: { uri: stored.uri, sha256: stored.sha256, sizeBytes: stored.sizeBytes }, verified };
}

/** Fingerprints of the index and of every evidence it names — EF-DOS-02. */
function buildManifest(document: PackDocument, indexSha256: string): PackManifest {
  const seen = new Set<string>();
  const evidence: PackManifest['evidence'] = [];
  for (const entry of document.index) {
    for (const item of entry.evidence) {
      if (seen.has(item.evidenceId)) continue;
      seen.add(item.evidenceId);
      evidence.push({ evidenceId: item.evidenceId, sha256: item.sha256 });
    }
  }
  return {
    packId: document.packId,
    frameworkId: document.frameworkId,
    frozenAt: document.frozenAt,
    indexSha256,
    evidence: evidence.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId))
  };
}

/**
 * Re-reads an archive and compares its fingerprint with the recorded one —
 * chapter 16.3 ("empreinte calculée à l'entrée et vérifiée à l'export"), EF-DOS-02.
 * Exported so a download can re-verify a pack frozen months earlier.
 */
export async function verifyArchive(services: Services, uri: string, expected: string): Promise<boolean> {
  try {
    return sha256Bytes(await services.evidenceStore.get(uri)) === expected;
  } catch {
    return false;
  }
}

/** Number of distinct evidences carried by a pack index, for the journal — EF-ADM-02. */
function countEvidence(index: readonly PackIndexEntry[]): number {
  const ids = new Set<string>();
  for (const entry of index) for (const item of entry.evidence) ids.add(item.evidenceId);
  return ids.size;
}
