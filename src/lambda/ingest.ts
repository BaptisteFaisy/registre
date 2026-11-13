/**
 * `ingest` handler — the monolithic chain entry point (EF-COL-05, spec 11.4).
 *
 * The EventBridge trigger hands it one new object: base64 bytes (or a byte
 * array) plus the provenance of the document and its source kind. `ingestEvidence`
 * runs fingerprint → dedupe → read → attach → sufficiency → states, so the
 * adapter only translates the event and reports what happened.
 *
 * A duplicate is a result, never a failure (R8): the state machine branches on
 * `duplicate` and spends no model token.
 *
 * Deployed, the S3 rule hands it only `bucket` and `key`: the object is already
 * in the vault (the API or a collector put it there). The adapter then only
 * fingerprints it and hands the rest of the chain the vault location — the
 * next tasks read, attach, assess and index it one step each, and no document
 * bytes travel through Step Functions (its payload limit is 256 KB).
 */

import { ingestEvidence } from '../pipeline/index.ts';
import type { IngestInput, IngestResult, PipelinePayload } from '../pipeline/index.ts';
import { badRequest } from '../support/errors.ts';
import { sha256Bytes } from '../support/hash.ts';
import { evidenceId as makeEvidenceId } from '../support/ids.ts';
import { mimeTypeOf } from '../support/documents/extract.ts';
import { decodeKey, fileNameOf } from '../api/lambdaS3.ts';
import type { Services } from '../ports/index.ts';
import {
  actorOf,
  bytesOf,
  chainPayload,
  defineHandler,
  kindOf,
  lambdaServices,
  optionalString,
  uriOf,
  type StepOutcome
} from './shared.ts';

/** The document the event carries: bytes, provenance, content type, kind. */
function ingestInputOf(raw: Record<string, unknown>): IngestInput {
  const bytes = bytesOf(raw);
  if (bytes === null) throw badRequest('the event carries no document bytes ("bytesBase64" or "bytes")');
  const fileName = optionalString(raw, 'fileName');
  return {
    bytes,
    uri: uriOf(raw),
    contentType: optionalString(raw, 'contentType') ?? 'application/octet-stream',
    kind: kindOf(raw, 'S3'),
    ...(fileName === undefined ? {} : { fileName }),
    fileDate: optionalString(raw, 'fileDate') ?? null,
    suggestedControlId: optionalString(raw, 'suggestedControlId') ?? null
  };
}

/** The payload the next task of the chain receives. */
function payloadOf(input: IngestInput, result: IngestResult): PipelinePayload {
  const evidence = result.evidence;
  return {
    bytes: input.bytes,
    uri: input.uri,
    contentType: input.contentType,
    kind: input.kind,
    ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
    fileDate: input.fileDate ?? null,
    suggestedControlId: input.suggestedControlId ?? null,
    sha256: evidence.sha256,
    evidenceId: evidence.id,
    duplicate: result.duplicateOf !== null,
    storedUri: evidence.locations[0]?.uri ?? input.uri,
    evidence,
    attachments: result.attachments,
    sufficiencies: result.sufficiencies,
    statuses: result.statuses
  };
}

/**
 * The vault object of an S3 event, fingerprinted in place — EF-COL-05, R8.
 * `null` when the event carries the document itself (direct invocation).
 */
export async function fromVaultObject(services: Services, raw: Record<string, unknown>): Promise<StepOutcome | null> {
  const bucket = optionalString(raw, 'bucket');
  const key = optionalString(raw, 'key');
  if (bucket === undefined || key === undefined || bytesOf(raw) !== null) return null;
  const objectKey = decodeKey(key);
  const uri = `s3://${bucket}/${objectKey}`;
  const sha256 = sha256Bytes(await services.evidenceStore.get(uri));
  const existing = await services.state.findEvidenceByHash(sha256);
  const fileName = fileNameOf(objectKey);
  const evidenceId = existing?.id ?? makeEvidenceId(sha256);
  const payload: PipelinePayload = {
    uri,
    storedUri: uri,
    contentType: mimeTypeOf(fileName),
    kind: kindOf(raw, 'MANUAL'),
    fileName,
    fileDate: null,
    suggestedControlId: null,
    sha256,
    evidenceId,
    duplicate: existing !== null
  };
  return { output: { evidenceId, sha256, duplicate: existing !== null }, payload: chainPayload(payload) };
}

export const handler = defineHandler(async (raw) => {
  const services = await lambdaServices();
  const fromVault = await fromVaultObject(services, raw);
  if (fromVault !== null) return fromVault;
  const input = ingestInputOf(raw);
  const result = await ingestEvidence(services, input, actorOf(raw, 'lambda-ingest'));
  const outcome: StepOutcome = {
    output: {
      evidenceId: result.evidence.id,
      sha256: result.evidence.sha256,
      duplicate: result.duplicateOf !== null,
      attachments: result.attachments.length,
      sufficiencies: result.sufficiencies.length,
      validationItems: result.validationItems.length
    },
    payload: chainPayload(payloadOf(input, result))
  };
  return outcome;
});
