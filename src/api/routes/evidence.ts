/**
 * Evidence routes — chapter 15, EF-COL-02/05, EF-LEC-03/04, ENF-CONF-01/02.
 *
 * `POST /v1/evidence` accepts two shapes, as docs/API.md §5 describes:
 *  - a JSON envelope `{filename, contentType, contentBase64, frameworkId?,
 *    controlId?}`;
 *  - the raw document as the body, with the file's own `Content-Type` and the
 *    name in `?filename=` or `X-File-Name`.
 * A duplicate content returns 200 with `duplicate: true` and the existing id
 * (R8); a new content returns 201.
 *
 * `GET /v1/evidence/{id}` returns the metadata, with excerpts masked when the
 * access level is above the caller's clearance (ENF-CONF-01, EF-QR-03).
 */

import type { Role } from '../../domain/types.ts';
import { badRequest } from '../../support/errors.ts';
import { json, decodeBase64, headerOf } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import type { IngestRequest } from '../pipeline.ts';
import { assertEvidenceReadable, requireRole } from '../access.ts';
import { optionalString, queryValue, requiredString } from '../validate.ts';
import { evidenceView, mayReadExcerpt } from '../views.ts';
import { bodyObject, requireControlOwnership, requireEvidence } from './shared.ts';

/** Roles that may deposit an evidence (docs/API.md §5). */
const DEPOSIT_ROLES: readonly Role[] = ['QUALITY_LEAD', 'CONTROL_OWNER', 'ADMIN'];

/** Roles that may read one evidence, subject to clearance. */
const READ_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN', 'EXECUTIVE', 'INTERNAL_AUDITOR', 'CONTROL_OWNER'];

/** Logical origin of a manual deposit, used as the evidence location URI. */
const MANUAL_URI_PREFIX = 'manual://';

/** Content type assumed when the caller sends bytes without declaring one. */
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/** Name kept when the caller sends bytes without naming the file. */
const DEFAULT_FILE_NAME = 'deposit.bin';

/** True when the request body is the JSON envelope rather than the document. */
function isJsonEnvelope(context: ApiContext): boolean {
  const contentType = headerOf(context.request, 'content-type') ?? '';
  return contentType.toLowerCase().includes('application/json');
}

/** Builds the ingestion request from the JSON envelope of docs/API.md §5. */
function fromEnvelope(context: ApiContext): IngestRequest {
  const body = bodyObject(context);
  const contentBase64 = requiredString(body, 'contentBase64');
  return {
    bytes: decodeBase64(contentBase64),
    contentType: optionalString(body, 'contentType') ?? DEFAULT_CONTENT_TYPE,
    fileName: optionalString(body, 'filename') ?? DEFAULT_FILE_NAME,
    uri: `${MANUAL_URI_PREFIX}${optionalString(body, 'filename') ?? DEFAULT_FILE_NAME}`,
    kind: 'MANUAL',
    fileDate: optionalString(body, 'fileDate'),
    suggestedControlId: optionalString(body, 'controlId')
  };
}

/** Builds the ingestion request from a raw binary body (file's own content type). */
function fromBinary(context: ApiContext): IngestRequest {
  if (context.request.body.byteLength === 0) {
    throw badRequest('the request body is empty: send the document, or a JSON envelope with contentBase64');
  }
  const fileName =
    queryValue(context.query, 'filename') ?? headerOf(context.request, 'x-file-name') ?? DEFAULT_FILE_NAME;
  return {
    bytes: context.request.body,
    contentType: headerOf(context.request, 'content-type') ?? DEFAULT_CONTENT_TYPE,
    fileName,
    uri: `${MANUAL_URI_PREFIX}${fileName}`,
    kind: 'MANUAL',
    fileDate: queryValue(context.query, 'fileDate'),
    suggestedControlId: queryValue(context.query, 'controlId')
  };
}

/** `POST /v1/evidence` — manual deposit, 201 when new, 200 when duplicate. */
async function depositEvidence(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, DEPOSIT_ROLES, 'evidence', 'new');
  const request = isJsonEnvelope(context) ? fromEnvelope(context) : fromBinary(context);
  if (request.suggestedControlId !== undefined) {
    await requireControlOwnership(context.services, context.principal, request.suggestedControlId);
  }
  const result = await context.pipeline.ingestEvidence(context.services, request, context.principal);
  const { evidence, duplicate } = result;
  return json(duplicate ? 200 : 201, {
    evidenceId: evidence.id,
    sha256: evidence.sha256,
    revision: evidence.revision,
    duplicate,
    accessLevel: evidence.accessLevel,
    contentType: evidence.contentType,
    sizeBytes: evidence.sizeBytes,
    ingestedAt: evidence.ingestedAt,
    flags: evidence.flags,
    locations: evidence.locations
  });
}

/** `GET /v1/evidence/{id}` — detail, `?include=text` adds masked excerpts. */
async function readEvidence(context: ApiContext): Promise<ApiResponse> {
  const evidence = await requireEvidence(context.services, context.params.id ?? '');
  await assertEvidenceReadable(context.services, context.principal, evidence, await supportedControls(context, evidence.id));
  const includeText = queryValue(context.query, 'include') === 'text';
  const masked = !mayReadExcerpt(context.principal, evidence.accessLevel);
  return json(200, { ...evidenceView(evidence, context.principal, { includeText }), excerptsMasked: masked });
}

/** Controls this evidence supports, used by the control-owner access rule. */
async function supportedControls(context: ApiContext, evidenceId: string): Promise<string[]> {
  const attachments = await context.services.state.listAttachments({ evidenceId });
  return [...new Set(attachments.map((attachment) => attachment.controlId))];
}

/** The two evidence routes, in table order. */
export const evidenceRoutes: readonly RouteDefinition[] = [
  {
    method: 'POST',
    path: '/v1/evidence',
    handler: depositEvidence,
    meta: {
      operationId: 'depositEvidence',
      summary: 'Deposit one evidence manually',
      tag: 'evidence',
      requirement: 'EF-COL-02',
      roles: DEPOSIT_ROLES,
      query: [
        { name: 'filename', description: 'File name when the body is the raw document', schema: 'string' },
        { name: 'controlId', description: 'Suggested control for a raw deposit', schema: 'string' },
        { name: 'fileDate', description: 'File date (YYYY-MM-DD) when the body is raw', schema: 'string' }
      ],
      requestSchema: 'EvidenceDeposit',
      responseSchema: 'EvidenceDepositResult',
      successStatus: 201,
      errors: [400, 401, 403, 413, 422],
      notes:
        '201 for a new content, 200 with duplicate=true when the fingerprint is already stored (R8). ' +
        'Either a JSON envelope with contentBase64, or the raw document with its own Content-Type.'
    }
  },
  {
    method: 'GET',
    path: '/v1/evidence/:id',
    handler: readEvidence,
    meta: {
      operationId: 'getEvidence',
      summary: 'Evidence detail, with excerpts masked above the caller clearance',
      tag: 'evidence',
      requirement: 'EF-LEC-03',
      roles: READ_ROLES,
      query: [
        {
          name: 'include',
          description: 'Set to "text" to add the masked page excerpts',
          schema: 'string',
          values: ['text']
        }
      ],
      responseSchema: 'Evidence',
      errors: [401, 403, 404]
    }
  }
];
