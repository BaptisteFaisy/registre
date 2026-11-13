/**
 * The processing chain, step by step — spec 11.4 (the sequence diagram of one
 * evidence) and chapter 9.
 *
 * `fingerprint → duplicate check → read → candidates → attach → sufficiency →
 * states` is the chain of the specification. Each step is a function of this
 * module, so the deployed Step Functions state machine and the monolithic
 * entry point (`ingestEvidence`) run the *same* code: one implementation per
 * behaviour, never two (CONTRACTS.md §2.2).
 *
 * A step takes the payload of the chain and returns the payload extended with
 * what it produced. The payload is what travels from one task to the next.
 */

import type { EvidenceProvenance } from '../domain/verification.ts';
import type {
  Attachment,
  CollectorKind,
  ControlStatus,
  Evidence,
  EvidenceId,
  Sufficiency,
  TextPage
} from '../domain/types.ts';
import type { ControlCandidate, Services } from '../ports/index.ts';
import { sha256Bytes } from '../support/hash.ts';
import { evidenceId as makeEvidenceId } from '../support/ids.ts';
import { record } from '../audit/log.ts';
import { proposeAttachments, retrieveCandidates } from './attach.ts';
import { assessAttachments } from './sufficiency.ts';
import { recomputeFrameworks } from './states.ts';
import { retentionDays, vaultKey } from './vault.ts';

/** What travels from one step of the chain to the next — spec 11.4. */
export interface PipelinePayload {
  /** Bytes of the document; absent when the step only reads what is stored. */
  bytes?: Uint8Array;
  /** Where the document comes from; kept as the provenance of the location. */
  uri: string;
  contentType: string;
  kind: CollectorKind;
  fileName?: string;
  fileDate?: string | null;
  suggestedControlId?: string | null;
  /** Machine attestation and the state it reports (axis 3a). */
  provenance?: EvidenceProvenance;
  attestedState?: string | null;
  /** Fingerprint, set by the fingerprint step — EF-COL-05. */
  sha256?: string;
  /** Id of the evidence, set by the fingerprint step. */
  evidenceId?: EvidenceId;
  /** True when the bytes were already known — R8. */
  duplicate?: boolean;
  /** Where the bytes were stored in the vault, set by the fingerprint step. */
  storedUri?: string;
  /** The evidence, set by the read step. */
  evidence?: Evidence;
  /** Candidate controls, set by the candidates step — EF-RAT-01. */
  candidates?: ControlCandidate[];
  /** Attachments, set by the attach step — EF-RAT-01..05. */
  attachments?: Attachment[];
  /** Sufficiencies, set by the sufficiency step — EF-SUF-01/02. */
  sufficiencies?: Sufficiency[];
  /** States, set by the states step — EF-FRA-02. */
  statuses?: ControlStatus[];
}

/** What the fingerprint step produced — EF-COL-05, R8. */
export interface FingerprintResult {
  sha256: string;
  evidenceId: EvidenceId;
  duplicate: boolean;
  /** The evidence that already carried these bytes, when it was a duplicate. */
  duplicateOf: EvidenceId | null;
  /** Where the bytes were stored, when they were new. */
  storedUri?: string;
}

/**
 * Fingerprints the bytes and looks for a duplicate — EF-COL-05 (R8).
 * A duplicate costs no model token: the second location is recorded on the
 * evidence that already exists, and the chain stops there.
 */
export async function fingerprintStep(services: Services, payload: PipelinePayload, actor: string): Promise<FingerprintResult> {
  const bytes = payload.bytes ?? new Uint8Array();
  const sha256 = sha256Bytes(bytes);
  const existing = await services.state.findEvidenceByHash(sha256);
  if (existing) {
    await recordDuplicate(services, existing, payload, actor);
    return { sha256, evidenceId: existing.id, duplicate: true, duplicateOf: existing.id };
  }
  const id = makeEvidenceId(sha256);
  const stored = await services.evidenceStore.put({
    key: vaultKey(id, payload.fileName, payload.contentType),
    bytes,
    contentType: payload.contentType,
    retainDays: retentionDays(services)
  });
  return { sha256, evidenceId: id, duplicate: false, duplicateOf: null, storedUri: stored.uri };
}

/** Second deposit of the same bytes: one more location on the same evidence — R8. */
async function recordDuplicate(
  services: Services,
  existing: Evidence,
  payload: PipelinePayload,
  actor: string
): Promise<void> {
  const evidence: Evidence = {
    ...existing,
    revision: existing.revision + 1,
    locations: [
      ...existing.locations,
      { kind: payload.kind, uri: payload.uri, collectedAt: services.clock.now(), duplicate: true }
    ]
  };
  await services.state.putEvidence(evidence);
  await record(services, actor, 'EVIDENCE_DUPLICATE', 'evidence', evidence.id, {
    sha256: evidence.sha256,
    uri: payload.uri,
    kind: payload.kind,
    revision: evidence.revision,
    locations: evidence.locations.length
  });
}

/** Reads the document and stores the evidence — EF-LEC-01..04 (spec 11.4). */
export async function readStep(
  services: Services,
  payload: PipelinePayload,
  actor: string
): Promise<{ evidence: Evidence }> {
  const id = payload.evidenceId ?? makeEvidenceId(payload.sha256 ?? sha256Bytes(payload.bytes ?? new Uint8Array()));
  const meteredBefore = services.costs.report().count;
  const read = await services.reader.read({
    evidenceId: id,
    contentType: payload.contentType,
    sizeBytes: payload.bytes?.byteLength ?? 0,
    // The reader gets the vault copy: on AWS, Data Automation can only read an
    // S3 object, and a manual deposit's own URI (`manual://…`) is not one.
    uri: payload.storedUri ?? payload.uri,
    ...(payload.bytes === undefined ? {} : { bytes: payload.bytes }),
    fileDate: payload.fileDate ?? null,
    suggestedControlId: payload.suggestedControlId ?? null
  });
  const evidence = assemble(services, id, payload, read);
  await services.state.putEvidence(evidence);
  await journal(services, actor, evidence, read.cost, services.costs.report().count > meteredBefore);
  return { evidence };
}

/** Assembles the evidence from what the reader returned — EF-LEC-01..04. */
function assemble(
  services: Services,
  id: EvidenceId,
  payload: PipelinePayload,
  read: { fields: Evidence['fields']; flags: Evidence['flags']; accessLevel: Evidence['accessLevel']; textPages: TextPage[]; cost?: Evidence['cost'] }
): Evidence {
  return {
    id,
    sha256: payload.sha256 ?? sha256Bytes(payload.bytes ?? new Uint8Array()),
    revision: 1,
    fields: read.fields,
    flags: read.flags,
    accessLevel: read.fields.personalData ? 'RESTRICTED' : read.accessLevel,
    locations: [{ kind: payload.kind, uri: payload.storedUri ?? payload.uri, collectedAt: services.clock.now() }],
    textPages: read.textPages,
    sizeBytes: payload.bytes?.byteLength ?? 0,
    contentType: payload.contentType,
    ingestedAt: services.clock.now(),
    reader: services.reader.id,
    ...(payload.provenance === undefined ? {} : { provenance: payload.provenance }),
    ...(payload.attestedState === undefined || payload.attestedState === null
      ? {}
      : { attestedState: payload.attestedState }),
    ...(read.cost === undefined ? {} : { cost: read.cost })
  };
}

/** Two journal events: the deposit, then the reading with its cost — EF-ADM-02. */
async function journal(
  services: Services,
  actor: string,
  evidence: Evidence,
  cost: Evidence['cost'],
  meteredByAdapter: boolean
): Promise<void> {
  await record(services, actor, 'EVIDENCE_COLLECTED', 'evidence', evidence.id, {
    sha256: evidence.sha256,
    contentType: evidence.contentType,
    sizeBytes: evidence.sizeBytes,
    kind: evidence.locations[0]?.kind ?? 'MANUAL',
    retainDays: retentionDays(services)
  });
  await record(services, actor, 'EVIDENCE_READ', 'evidence', evidence.id, {
    reader: evidence.reader,
    accessLevel: evidence.accessLevel,
    flags: evidence.flags,
    pages: evidence.textPages.length,
    ...(cost === undefined ? {} : { costUsd: cost.usd, costSource: cost.source })
  });
  // The reading is metered once: adapters that hold the cost meter (the mock and
  // the Bedrock readers) already recorded it, and recording it a second time here
  // doubled every displayed cost (ENF-COUT-01). An adapter without a meter still
  // gets its cost recorded, so the requirement holds for every wiring.
  if (cost !== undefined && !meteredByAdapter) services.costs.record(cost);
}

/** Retrieves the candidate controls of one evidence — EF-RAT-01 (spec 13.2 step 1). */
export async function candidatesStep(
  services: Services,
  payload: PipelinePayload
): Promise<{ candidates: ControlCandidate[] }> {
  if (!payload.evidence) return { candidates: [] };
  const candidates = await retrieveCandidates(
    services,
    payload.evidence,
    undefined,
    payload.suggestedControlId ?? null
  );
  return { candidates };
}

/** Proposes and verifies the attachments of one evidence — EF-RAT-01..05. */
export async function attachStep(
  services: Services,
  payload: PipelinePayload,
  actor: string
): Promise<{ attachments: Attachment[] }> {
  if (!payload.evidence) return { attachments: [] };
  const { attachments } = await proposeAttachments(services, payload.evidence, actor, {
    suggestedControlId: payload.suggestedControlId ?? null,
    ...(payload.candidates === undefined ? {} : { candidates: payload.candidates })
  });
  return { attachments };
}

/** Assesses the sufficiency of every attachment — EF-SUF-01/02. */
export async function sufficiencyStep(
  services: Services,
  payload: PipelinePayload
): Promise<{ sufficiencies: Sufficiency[] }> {
  if (!payload.evidence) return { sufficiencies: [] };
  const { sufficiencies } = await assessAttachments(services, payload.evidence, payload.attachments ?? []);
  return { sufficiencies };
}

/** Recomputes the states of the frameworks the evidence touches — EF-FRA-02. */
export async function statesStep(
  services: Services,
  payload: PipelinePayload
): Promise<{ statuses: ControlStatus[] }> {
  const frameworks = [...new Set((payload.attachments ?? []).map((attachment) => attachment.frameworkId))];
  return { statuses: await recomputeFrameworks(services, frameworks) };
}
