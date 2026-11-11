/**
 * Verification and auditor sharing routes (axis 1).
 *
 * `POST /v1/packs/{id}/verify` is the internal check; `POST /v1/shares/{token}/verify`
 * is the **public** one an external auditor calls with a link: it answers with
 * hashes, counts and verdicts only, never with evidence content (ENF-CONF-03).
 * Shares are created with a bounded lifetime and can be revoked at once.
 */

import type { Role } from '../../domain/types.ts';
import { json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import { requireRole } from '../access.ts';
import { optionalString, queryValue } from '../validate.ts';
import { createShare, listShares as listShareGrants, revokeShare } from '../../pipeline/share.ts';
import { verifyByToken, verifyPack } from '../../pipeline/verify.ts';
import { verificationView, shareView } from '../viewsExt.ts';
import { bodyObject, requirePack } from './shared.ts';

/** Roles allowed to verify a pack and to manage shares. */
const MANAGE_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN'];

/** Roles allowed to verify a pack they can read. */
const VERIFY_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN', 'INTERNAL_AUDITOR'];

/** `POST /v1/packs/{id}/verify` — verify one frozen pack. */
async function verify(context: ApiContext): Promise<ApiResponse> {
  const packId = context.params.id ?? '';
  await requireRole(context.services, context.principal, VERIFY_ROLES, 'pack', packId);
  await requirePack(context.services, packId);
  return json(200, verificationView(await verifyPack(context.services, packId)));
}

/** `POST /v1/shares/{token}/verify` — public verification through a share link. */
async function verifyByShare(context: ApiContext): Promise<ApiResponse> {
  const token = context.params.token ?? '';
  return json(200, verificationView(await verifyByToken(context.services, token)));
}

/** `POST /v1/shares` — open a bounded, watermarked access for an auditor. */
async function openShare(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, MANAGE_ROLES, 'share', 'new');
  const body = bodyObject(context);
  const packId = optionalString(body, 'packId');
  const pack = packId === undefined ? null : await requirePack(context.services, packId);
  const share = await createShare(context.services, {
    frameworkId: pack?.frameworkId ?? (optionalString(body, 'frameworkId') ?? ''),
    scope: packId === undefined ? 'FRAMEWORK' : 'PACK',
    packId: packId ?? null,
    ttlHours: numberOf(body, 'ttlHours'),
    watermarkLabel: optionalString(body, 'watermarkLabel') ?? '',
    by: context.principal.id
  });
  return json(201, shareView(share));
}

/** `GET /v1/shares` — every grant of the account, newest first. */
async function listGrants(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, MANAGE_ROLES, 'share', 'list');
  const packId = queryValue(context.query, 'packId');
  const shares = await listShareGrants(context.services, packId === undefined ? {} : { packId });
  return json(200, shares.map((share) => shareView(share, { hideToken: true })));
}

/** `POST /v1/shares/{token}/revoke` — cut an auditor's access at once. */
async function revoke(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, MANAGE_ROLES, 'share', context.params.token ?? '');
  const share = await revokeShare(context.services, context.params.token ?? '', context.principal.id);
  return json(200, shareView(share, { hideToken: true }));
}

/** Reads a positive number from a JSON body, or `undefined` when absent. */
function numberOf(body: Record<string, unknown>, field: string): number | undefined {
  const raw = body[field];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
  return undefined;
}

/** The verification and sharing routes. */
export const verifyRoutes: readonly RouteDefinition[] = [
  {
    method: 'POST',
    path: '/v1/packs/:id/verify',
    handler: verify,
    meta: {
      operationId: 'verifyPack',
      summary: 'Verify one frozen audit pack',
      tag: 'verification',
      requirement: 'EF-DOS-03, ENF-INT-01',
      roles: VERIFY_ROLES,
      responseSchema: 'VerificationResult',
      errors: [401, 403, 404],
      notes: 'Returns hashes, counts and verdicts only — never evidence content.'
    }
  },
  {
    method: 'POST',
    path: '/v1/shares/:token/verify',
    handler: verifyByShare,
    meta: {
      operationId: 'verifyByShareToken',
      summary: 'Public verification of a pack through a share link',
      tag: 'verification',
      requirement: 'EF-DOS-03',
      roles: 'public',
      responseSchema: 'VerificationResult',
      errors: [404],
      notes: 'No credential needed: the token is the credential, and the answer carries no content.'
    }
  },
  {
    method: 'POST',
    path: '/v1/shares',
    handler: openShare,
    meta: {
      operationId: 'createShare',
      summary: 'Open a bounded, watermarked read access for an external auditor',
      tag: 'verification',
      requirement: 'ENF-CONF-01',
      roles: MANAGE_ROLES,
      requestSchema: 'ShareInput',
      responseSchema: 'ShareGrant',
      successStatus: 201,
      errors: [400, 401, 403, 404]
    }
  },
  {
    method: 'GET',
    path: '/v1/shares',
    handler: listGrants,
    meta: {
      operationId: 'listShares',
      summary: 'List the share grants, tokens truncated',
      tag: 'verification',
      roles: MANAGE_ROLES,
      query: [{ name: 'packId', description: 'Keep only the grants of this pack', schema: 'string' }],
      responseSchema: 'ShareGrantArray',
      errors: [401, 403]
    }
  },
  {
    method: 'POST',
    path: '/v1/shares/:token/revoke',
    handler: revoke,
    meta: {
      operationId: 'revokeShare',
      summary: 'Revoke a share grant immediately',
      tag: 'verification',
      roles: MANAGE_ROLES,
      responseSchema: 'ShareGrant',
      errors: [401, 403, 404]
    }
  }
];
