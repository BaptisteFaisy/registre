/**
 * AWS Lambda handler — S3 trigger (EF-COL-01).
 *
 * An object dropped in the evidence bucket is ingested through the same
 * pipeline as a manual deposit, with `kind: 'S3'`. The collector acts as a
 * system principal, so the audit log names it explicitly instead of borrowing
 * a human identity.
 *
 * Failures are collected per record and re-thrown as one error, so Lambda
 * reports the invocation as failed and S3 can retry — a partially ingested
 * batch is never reported as a success.
 */

import type { Principal } from '../domain/types.ts';
import type { Services } from '../ports/index.ts';
import type { IngestOutcome, IngestRequest } from './pipeline.ts';
import { defaultPipeline } from './pipeline.ts';
import { servicesSingleton } from './services.ts';

/** The system principal recorded for a collector-driven ingestion. */
export const COLLECTOR_PRINCIPAL: Principal = {
  id: 'system:s3-collector',
  name: 'S3 collector',
  email: 'collector@system.local',
  role: 'ADMIN',
  clearance: 'RESTRICTED',
  ownedControls: []
};

/** One record of an S3 notification event. */
export interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string; size?: number; eTag?: string };
  };
}

/** The S3 notification event Lambda receives. */
export interface S3Event {
  Records: S3EventRecord[];
}

/** Outcome of one record, so a partial failure stays visible. */
export interface S3RecordOutcome {
  uri: string;
  evidenceId: string | null;
  duplicate: boolean;
  error: string | null;
}

/** Content type guessed from the key's extension (the vault stores bytes only). */
export function contentTypeOf(key: string): string {
  const extension = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  switch (extension) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'csv':
      return 'text/csv';
    case 'txt':
      return 'text/plain';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

/** S3 keys arrive URL-encoded; the vault expects the decoded key. */
export function decodeKey(key: string): string {
  return decodeURIComponent(key.replace(/\+/g, ' '));
}

/** File name of an S3 key (its last segment). */
export function fileNameOf(key: string): string {
  const segments = key.split('/');
  return segments[segments.length - 1] ?? key;
}

/** Builds the ingestion request of one S3 object. */
export function ingestRequestOf(record: S3EventRecord): IngestRequest {
  const key = decodeKey(record.s3.object.key);
  return {
    bytes: new Uint8Array(0),
    contentType: contentTypeOf(key),
    uri: `s3://${record.s3.bucket.name}/${key}`,
    kind: 'S3',
    fileName: fileNameOf(key)
  };
}

/** Ingests one record, reading the object through the evidence store. */
export async function ingestRecord(services: Services, record: S3EventRecord): Promise<S3RecordOutcome> {
  const request = ingestRequestOf(record);
  try {
    const bytes = await services.evidenceStore.get(request.uri);
    const outcome: IngestOutcome = await defaultPipeline.ingestEvidence(
      services,
      { ...request, bytes },
      COLLECTOR_PRINCIPAL
    );
    return { uri: request.uri, evidenceId: outcome.evidence.id, duplicate: outcome.duplicate, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[api] s3 ingestion failed for ${request.uri}: ${message}`);
    return { uri: request.uri, evidenceId: null, duplicate: false, error: message };
  }
}

/** Lambda entry point: ingest every object of the notification. */
export async function handler(event: S3Event): Promise<{ ingested: number; failed: number; results: S3RecordOutcome[] }> {
  const { services } = await servicesSingleton();
  const results: S3RecordOutcome[] = [];
  for (const record of event.Records ?? []) results.push(await ingestRecord(services, record));
  const failed = results.filter((result) => result.error !== null);
  if (failed.length > 0) {
    throw new Error(`s3 ingestion: ${failed.length}/${results.length} record(s) failed: ${failed[0]?.error ?? ''}`);
  }
  return { ingested: results.length, failed: 0, results };
}
