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
 */

import { ingestEvidence } from '../pipeline/index.ts';
import type { IngestInput, IngestResult, PipelinePayload } from '../pipeline/index.ts';
import { badRequest } from '../support/errors.ts';
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

export const handler = defineHandler(async (raw) => {
  const input = ingestInputOf(raw);
  const services = await lambdaServices();
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
