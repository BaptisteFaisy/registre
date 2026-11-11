/**
 * Shared plumbing of the Lambda adapters — no handler lives here.
 *
 * Three responsibilities:
 *  1. the `Services` factory: built once per container by `src/bootstrap.ts`,
 *     injectable in tests through `setLambdaServices`;
 *  2. reading the Step Functions event (`event.payload ?? event`) into a
 *     `PipelinePayload`, and writing the JSON-safe payload of the next task;
 *  3. one response shape for every adapter, so no exception ever escapes a
 *     handler: success carries `statusCode: 200` and the step output at the
 *     top level (a Step Functions `Choice` reads `$.duplicate` there), failure
 *     carries the status of `RegistreError` and the body `{ error: {...} }`,
 *     exactly what the HTTP API emits (`src/api/errors.ts`).
 */

import { createServices } from '../bootstrap.ts';
import type { Services } from '../ports/index.ts';
import type { PipelinePayload } from '../pipeline/index.ts';
import type { CollectorKind } from '../domain/types.ts';
import { describeError, errorBody } from '../api/errors.ts';
import type { ErrorDescription } from '../api/errors.ts';
import { decodeBase64, encodeBase64 } from '../api/http.ts';
import { badRequest } from '../support/errors.ts';

/** JSON content type of every response body. */
export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** The slice of the Lambda context the adapters use. */
export interface LambdaContext {
  getRemainingTimeInMillis(): number;
  awsRequestId?: string;
  functionName?: string;
}

/** The one response shape of every adapter. */
export interface LambdaResponse {
  /** True when the step ran. */
  ok: boolean;
  statusCode: number;
  headers: Record<string, string>;
  /** JSON body: the step output on success, `{ error: {...} }` on failure. */
  body: string;
  /** What the next task of the chain receives. */
  payload: Record<string, unknown>;
  /** Failure only: the normalised error body. */
  error?: { code: string; message: string; detail: Record<string, unknown> };
  /** Step output fields, spread so the state machine can read them directly. */
  [field: string]: unknown;
}

/** What one adapter produces: the step output and the payload of the next task. */
export interface StepOutcome {
  output: Record<string, unknown>;
  payload: Record<string, unknown>;
}

/** Signature of a wrapped adapter body. */
export type StepBody = (
  payload: Record<string, unknown>,
  context: LambdaContext | undefined
) => Promise<StepOutcome>;

/** What every adapter of this module exports as `handler`. */
export type LambdaHandler = (event: unknown, context?: LambdaContext) => Promise<LambdaResponse>;

/** Kinds a document can come from, as the domain defines them. */
export const COLLECTOR_KINDS: readonly CollectorKind[] = ['S3', 'MANUAL', 'ITSM', 'AWS_REPORT'];

/** Payload fields a task may carry on to the next one. */
const CHAIN_FIELDS = [
  'fileName',
  'fileDate',
  'suggestedControlId',
  'sha256',
  'evidenceId',
  'duplicate',
  'storedUri',
  'evidence',
  'candidates',
  'attachments',
  'sufficiencies',
  'statuses'
] as const;

/* ------------------------------------------------------------- services */

let injected: Services | null = null;
let cached: Promise<Services> | null = null;

/** Test seam: replaces the module-level bundle; `null` restores the bootstrap. */
export function setLambdaServices(services: Services | null): void {
  injected = services;
  cached = null;
}

/** Builds (once) and returns the bundle every adapter runs against. */
export async function lambdaServices(): Promise<Services> {
  if (injected !== null) return injected;
  cached ??= createServices().then((bootstrapped) => bootstrapped.services);
  return cached;
}

/* --------------------------------------------------------------- events */

/** True for a plain object: what a payload may be. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reads the payload of the chain: `event.payload` when present, else the event
 * itself. Anything that is not an object is a 400, never a thrown TypeError.
 */
export function readPayload(event: unknown): Record<string, unknown> {
  if (!isRecord(event)) throw badRequest('the event is not an object', { received: typeof event });
  const source = event.payload === undefined ? event : event.payload;
  if (!isRecord(source)) throw badRequest('the event carries no payload object', { received: typeof source });
  return source;
}

/** Reads one optional string field, rejecting anything that is not text. */
export function optionalString(payload: Record<string, unknown>, field: string): string | undefined {
  const value = payload[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string`, { field });
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Provenance of the document: `uri`, or the object key of an S3 event. */
export function uriOf(payload: Record<string, unknown>): string {
  const uri = optionalString(payload, 'uri') ?? optionalString(payload, 'key');
  if (uri === undefined) throw badRequest('"uri" (or "key") is required: the provenance of the document');
  return uri;
}

/** Source kind of the event; `MANUAL` when the caller does not say. */
export function kindOf(payload: Record<string, unknown>, fallback: CollectorKind = 'MANUAL'): CollectorKind {
  const raw = optionalString(payload, 'kind') ?? optionalString(payload, 'sourceType');
  if (raw === undefined) return fallback;
  if (!(COLLECTOR_KINDS as readonly string[]).includes(raw)) {
    throw badRequest(`"kind" must be one of ${COLLECTOR_KINDS.join(', ')}`, { kind: raw });
  }
  return raw as CollectorKind;
}

/** Actor journalled by the step; the adapters are actors of their own name. */
export function actorOf(payload: Record<string, unknown>, fallback: string): string {
  return optionalString(payload, 'actor') ?? fallback;
}

/**
 * Document bytes of an event: base64 text (`bytesBase64`, `documentBase64`,
 * `bytes`, `document`) or a byte array. `null` when the event carries no
 * document; undecodable base64 is a 400.
 */
export function bytesOf(payload: Record<string, unknown>): Uint8Array | null {
  for (const field of ['bytesBase64', 'documentBase64', 'bytes', 'document']) {
    const value = payload[field];
    if (typeof value === 'string' && value.trim().length > 0) return decodeBase64(value, field);
    if (Array.isArray(value) && value.length > 0) return bytesFromArray(value, field);
  }
  return null;
}

/** Converts a numeric array to bytes, rejecting anything that is not a byte. */
function bytesFromArray(value: readonly unknown[], field: string): Uint8Array {
  const numbers = value.map((entry, index) => {
    const byte = typeof entry === 'number' ? entry : Number(entry);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw badRequest(`"${field}" must be an array of bytes`, { field, index });
    }
    return byte;
  });
  return new Uint8Array(numbers);
}

/** The chain payload of one task, validated against what the steps expect. */
export function pipelinePayloadOf(raw: Record<string, unknown>): PipelinePayload {
  const payload: Record<string, unknown> = {
    uri: uriOf(raw),
    contentType: optionalString(raw, 'contentType') ?? 'application/octet-stream',
    kind: kindOf(raw)
  };
  const bytes = bytesOf(raw);
  if (bytes !== null) payload.bytes = bytes;
  for (const field of CHAIN_FIELDS) {
    if (raw[field] !== undefined) payload[field] = raw[field];
  }
  return payload as unknown as PipelinePayload;
}

/**
 * JSON-safe payload for the next task: bytes travel as base64, so the payload
 * survives a Step Functions round-trip instead of turning into an index map.
 */
export function chainPayload(payload: PipelinePayload, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { bytes, ...rest } = payload;
  const base64 = bytes instanceof Uint8Array && bytes.byteLength > 0 ? encodeBase64(bytes) : undefined;
  return { ...rest, ...(base64 === undefined ? {} : { bytesBase64: base64 }), ...extra };
}

/* ------------------------------------------------------------- responses */

/** Maps any throwable to the one error response of the adapters. */
export function errorResponse(error: unknown): LambdaResponse {
  const description: ErrorDescription = describeError(error);
  const body = errorBody(description);
  return {
    ok: false,
    statusCode: description.status,
    headers: { 'content-type': JSON_CONTENT_TYPE },
    body: JSON.stringify(body),
    payload: {},
    error: body.error
  };
}

/** Builds the success response of one step. */
function successResponse(outcome: StepOutcome): LambdaResponse {
  return {
    ...outcome.output,
    ok: true,
    statusCode: 200,
    headers: { 'content-type': JSON_CONTENT_TYPE },
    body: JSON.stringify(outcome.output),
    payload: outcome.payload
  };
}

/**
 * Wraps an adapter body into a real `handler`: the payload is read once,
 * exceptions are normalised into a structured error, never rethrown.
 */
export function defineHandler(body: StepBody): LambdaHandler {
  return async (event, context) => {
    try {
      const outcome = await body(readPayload(event), context);
      return successResponse(outcome);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/* --------------------------------------------------------- chain adapters */

/** One step of the chain: what the adapter calls with the payload. */
export type StepRun = (
  services: Services,
  payload: PipelinePayload,
  actor: string
) => Promise<Record<string, unknown>>;

/**
 * Builds the handler of one chain step (`read`, `candidates`, `attach`,
 * `sufficiency`, `states`): read the payload, run the step, hand the extended
 * payload to the next task. One implementation for the five adapters.
 */
export function defineStepHandler(run: StepRun, label: string): LambdaHandler {
  return defineHandler(async (raw) => {
    const payload = pipelinePayloadOf(raw);
    const services = await lambdaServices();
    const produced = await run(services, payload, actorOf(raw, label));
    return { output: produced, payload: chainPayload(payload, produced) };
  });
}

