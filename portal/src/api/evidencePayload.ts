/**
 * The JSON envelope the API expects for a manual deposit (docs/API.md §5).
 *
 * `POST /v1/evidence` reads `{filename, contentType, contentBase64, ...}`: the
 * document itself travels as base64, the optional fields are omitted when the
 * portal does not know them, so the API keeps its own defaults.
 */

import type { EvidenceUploadInput } from './types.ts';
import { bytesToBase64 } from '../lib/base64.ts';

/** Request body of `POST /v1/evidence`, exactly as the contract describes it. */
export interface EvidencePayload {
  filename: string;
  contentType: string;
  contentBase64: string;
  sizeBytes?: number;
  fileDate?: string;
  controlId?: string;
  accessLevel?: string;
}

/** Builds the deposit envelope from the portal upload input. */
export function buildEvidencePayload(input: EvidenceUploadInput): EvidencePayload {
  const payload: EvidencePayload = {
    filename: input.fileName,
    contentType: input.contentType,
    contentBase64: bytesToBase64(input.bytes),
    sizeBytes: input.bytes.length
  };
  if (input.fileDate) payload.fileDate = input.fileDate;
  if (input.suggestedControlId) payload.controlId = input.suggestedControlId;
  if (input.accessLevel) payload.accessLevel = input.accessLevel;
  return payload;
}
