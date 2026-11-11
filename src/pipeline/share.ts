/**
 * Auditor share grants — bounded, revocable, watermarked read access.
 *
 * Before this, handing a pack to an external auditor meant sending an archive by
 * e-mail: unbounded in time, untraceable, and impossible to withdraw. A share
 * grant replaces that with a token that:
 *   - expires (1 to 168 hours, refused outside that range);
 *   - is scoped to one pack or one framework, never wider (ENF-CONF-01);
 *   - is revocable at once, and every use is counted and journalled;
 *   - stamps a watermark on every excerpt served through it.
 *
 * A grant never widens a right: the routes that accept it serve less than an
 * internal session would, never more.
 */

import { randomBytes } from 'node:crypto';
import type { Services } from '../ports/index.ts';
import type { ShareGrant, ShareScope } from '../domain/verification.ts';
import { isShareActive } from '../domain/verification.ts';
import { badRequest, notFound } from '../support/errors.ts';
import { addDuration } from '../support/iso8601.ts';
import { record } from '../audit/log.ts';

/** Shortest accepted lifetime of a grant, in hours. */
export const MIN_TTL_HOURS = 1;

/** Longest accepted lifetime of a grant, in hours (one week). */
export const MAX_TTL_HOURS = 168;

/** Length of the random part of a token, in bytes. */
const TOKEN_BYTES = 32;

/** Prefix that tells the API this bearer token is a share grant. */
export const SHARE_TOKEN_PREFIX = 'share:';

export interface CreateShareInput {
  frameworkId: string;
  scope: ShareScope;
  /** Required when the scope is one pack. */
  packId?: string | null;
  ttlHours?: number;
  by: string;
  /** Short label of the recipient, used in the watermark (never a secret). */
  watermarkLabel?: string;
}

/** Generates an opaque, unguessable token. */
export function newShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** Watermark stamped on every excerpt served through a grant. */
export function watermarkOf(label: string, expiresAt: string): string {
  const who = label.trim().length === 0 ? 'external auditor' : label.trim();
  return `AUDITOR ${who} · expires ${expiresAt.slice(0, 10)}`;
}

/** Creates one grant; refuses a pack scope without a pack, and a silly TTL. */
export async function createShare(services: Services, input: CreateShareInput): Promise<ShareGrant> {
  const ttl = input.ttlHours ?? 72;
  if (!Number.isFinite(ttl) || ttl < MIN_TTL_HOURS || ttl > MAX_TTL_HOURS) {
    throw badRequest(`ttlHours must be between ${MIN_TTL_HOURS} and ${MAX_TTL_HOURS}`, { ttlHours: ttl });
  }
  if (input.scope === 'PACK' && (input.packId === undefined || input.packId === null)) {
    throw badRequest('a PACK scope requires a packId', { scope: input.scope });
  }
  if (input.scope === 'PACK' && input.packId) {
    const pack = await services.state.getPack(input.packId);
    if (pack === null) throw notFound(`pack ${input.packId} does not exist`);
  }
  const framework = await services.state.getFramework(input.frameworkId);
  if (framework === null) throw notFound(`framework ${input.frameworkId} does not exist`);

  const createdAt = services.clock.now();
  const expiresAt = addDuration(createdAt, `PT${Math.round(ttl)}H`);
  const share: ShareGrant = {
    token: newShareToken(),
    packId: input.scope === 'PACK' ? (input.packId ?? null) : null,
    frameworkId: input.frameworkId,
    scope: input.scope,
    createdBy: input.by,
    createdAt,
    expiresAt,
    revokedAt: null,
    revokedBy: null,
    watermark: watermarkOf(input.watermarkLabel ?? '', expiresAt),
    useCount: 0,
    lastUsedAt: null
  };
  await services.extensions.putShare(share);
  await record(services, input.by, 'SHARE_CREATED', 'share', share.token.slice(0, 8), {
    frameworkId: share.frameworkId,
    packId: share.packId,
    scope: share.scope,
    expiresAt
  });
  return share;
}

/** Revokes a grant immediately; revoking twice is a no-op, not an error. */
export async function revokeShare(services: Services, token: string, by: string): Promise<ShareGrant> {
  const share = await services.extensions.getShare(stripPrefix(token));
  if (share === null) throw notFound('unknown share token');
  if (share.revokedAt !== null) return share;
  const revoked: ShareGrant = { ...share, revokedAt: services.clock.now(), revokedBy: by };
  await services.extensions.putShare(revoked);
  await record(services, by, 'SHARE_REVOKED', 'share', share.token.slice(0, 8), {
    frameworkId: share.frameworkId,
    packId: share.packId
  });
  return revoked;
}

/**
 * Resolves a token to a usable grant, or `null` when it is unknown, revoked or
 * expired. A successful resolution counts as one use.
 */
export async function resolveShare(
  services: Services,
  token: string,
  now = services.clock.now()
): Promise<ShareGrant | null> {
  const share = await services.extensions.getShare(stripPrefix(token));
  if (share === null || !isShareActive(share, now)) return null;
  await services.extensions.touchShare(share.token, now);
  await record(services, `share:${share.token.slice(0, 8)}`, 'SHARE_USED', 'share', share.token.slice(0, 8), {
    frameworkId: share.frameworkId,
    packId: share.packId,
    use: share.useCount + 1
  });
  return { ...share, useCount: share.useCount + 1, lastUsedAt: now };
}

/** Lists grants, newest first; `activeOnly` drops expired and revoked ones. */
export async function listShares(
  services: Services,
  filter: { packId?: string; frameworkId?: string; activeOnly?: boolean } = {}
): Promise<ShareGrant[]> {
  return services.extensions.listShares({
    ...(filter.packId === undefined ? {} : { packId: filter.packId }),
    ...(filter.frameworkId === undefined ? {} : { frameworkId: filter.frameworkId }),
    ...(filter.activeOnly === undefined ? {} : { active: filter.activeOnly }),
    now: services.clock.now()
  });
}

/** Stamps the watermark in front of an excerpt served through a grant. */
export function watermarked(share: ShareGrant, text: string): string {
  return `[${share.watermark}] ${text}`;
}

/** Accepts both `share:<token>` and a bare token. */
export function stripPrefix(token: string): string {
  return token.startsWith(SHARE_TOKEN_PREFIX) ? token.slice(SHARE_TOKEN_PREFIX.length) : token;
}

/** True when a bearer credential is a share token rather than a session. */
export function isShareCredential(token: string): boolean {
  return token.startsWith(SHARE_TOKEN_PREFIX);
}
