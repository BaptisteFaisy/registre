/**
 * Audit pack routes — chapter 15, EF-DOS-01/02/03, ENF-INT-01.
 *
 * `POST /v1/frameworks/{id}/packs` freezes a pack (index per control, evidence,
 * dates, known gaps). `GET /v1/packs/{id}` returns the pack with a download
 * URL; `GET /v1/packs/{id}/archive` streams the archive itself, chunk by chunk,
 * and appends `PACK_DOWNLOADED` to the audit log (EF-ADM-02).
 */

import type { Role } from '../../domain/types.ts';
import { badRequest } from '../../support/errors.ts';
import { chunked, json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import { requireRole } from '../access.ts';
import { optionalString } from '../validate.ts';
import { packView } from '../views.ts';
import { bodyObject, requireFramework, requirePack } from './shared.ts';

/** Roles allowed to assemble a pack (EF-DOS-01). */
const ASSEMBLE_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN'];

/** Roles allowed to read and download a pack (docs/API.md §13). */
const READ_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN', 'INTERNAL_AUDITOR'];

/** Content type of the produced archive. */
const ARCHIVE_CONTENT_TYPE = 'application/zip';

/** `POST /v1/frameworks/{id}/packs` — assemble and freeze a pack. */
async function assemblePack(context: ApiContext): Promise<ApiResponse> {
  const frameworkId = context.params.id ?? '';
  await requireRole(context.services, context.principal, ASSEMBLE_ROLES, 'framework', frameworkId);
  await requireFramework(context.services, frameworkId);
  const body = bodyObject(context, true);
  const freezeAt = optionalString(body, 'freezeAt');
  if (freezeAt !== undefined && Number.isNaN(Date.parse(freezeAt))) {
    throw badRequest('"freezeAt" must be an ISO-8601 instant', { field: 'freezeAt', freezeAt });
  }
  const pack = await context.pipeline.assemblePack(context.services, frameworkId, context.principal);
  return json(201, packView(pack, downloadUrlOf(pack.id)));
}

/** Download path of one pack, relative to the API root. */
function downloadUrlOf(packId: string): string {
  return `/v1/packs/${packId}/archive`;
}

/** `GET /v1/packs/{id}` — pack detail plus its download URL. */
async function readPack(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, READ_ROLES, 'pack', context.params.id ?? '');
  const pack = await requirePack(context.services, context.params.id ?? '');
  return json(200, packView(pack, downloadUrlOf(pack.id)));
}

/** `GET /v1/packs/{id}/archive` — stream the archive and log the download. */
async function downloadPack(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, READ_ROLES, 'pack', context.params.id ?? '');
  const pack = await requirePack(context.services, context.params.id ?? '');
  const bytes = await context.services.evidenceStore.get(pack.archive.uri);
  await context.services.audit.append({
    actor: context.principal.id,
    action: 'PACK_DOWNLOADED',
    objectType: 'pack',
    objectId: pack.id,
    detail: { frameworkId: pack.frameworkId, sizeBytes: pack.archive.sizeBytes, sha256: pack.archive.sha256 }
  });
  return {
    status: 200,
    headers: {
      'content-type': ARCHIVE_CONTENT_TYPE,
      'content-disposition': `attachment; filename="registre-${pack.id}.zip"`,
      'content-length': String(bytes.byteLength),
      'x-checksum-sha256': pack.archive.sha256
    },
    stream: chunked(bytes)
  };
}

/** The three pack routes, in table order. */
export const packRoutes: readonly RouteDefinition[] = [
  {
    method: 'POST',
    path: '/v1/frameworks/:id/packs',
    handler: assemblePack,
    meta: {
      operationId: 'assemblePack',
      summary: 'Assemble and freeze the audit pack of a framework',
      tag: 'packs',
      requirement: 'EF-DOS-01',
      roles: ASSEMBLE_ROLES,
      requestSchema: 'PackRequest',
      responseSchema: 'Pack',
      successStatus: 201,
      errors: [400, 401, 403, 404, 502],
      notes: 'The pack carries the known gaps as well as the evidence; frozenAt pins it to one instant (EF-DOS-03).'
    }
  },
  {
    method: 'GET',
    path: '/v1/packs/:id',
    handler: readPack,
    meta: {
      operationId: 'getPack',
      summary: 'Read one audit pack and get its download URL',
      tag: 'packs',
      requirement: 'EF-DOS-02',
      roles: READ_ROLES,
      responseSchema: 'Pack',
      errors: [401, 403, 404]
    }
  },
  {
    method: 'GET',
    path: '/v1/packs/:id/archive',
    handler: downloadPack,
    meta: {
      operationId: 'downloadPackArchive',
      summary: 'Download the pack archive as a streamed zip',
      tag: 'packs',
      requirement: 'EF-DOS-02',
      roles: READ_ROLES,
      errors: [401, 403, 404, 502],
      notes: 'Every download is appended to the audit log as PACK_DOWNLOADED.'
    }
  }
];
