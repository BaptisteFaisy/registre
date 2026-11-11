/**
 * Offline mock of the extension endpoints (CONTRACTS-EXT axes 1–3 + bonus).
 * Same discipline as `client.ts`: identical interface, access control applied,
 * every write journalled through the hash-chained audit trail.
 */

import type {
  ControlMapping,
  Draft,
  DriftEvent,
  MappingDecision,
  MappingFilter,
  Pack,
  Principal,
  QualityReport,
  ReuseMetric,
  ShareGrant,
  ShareInput,
  VerificationResult
} from '../api/types.ts';
import { ApiError } from '../api/client.ts';
import type { PrincipalProvider } from './client.ts';
import { delay, requirePrincipal } from './client.ts';
import { appendAuditEvent } from './activity.ts';
import { DEMO_FRAMEWORK_ID } from './framework.ts';
import { store } from './store.ts';
import { sortMappings } from '../lib/mappings.ts';
import { sortDrifts } from '../lib/drifts.ts';
import {
  SHARE_TTL_MAX_HOURS,
  SHARE_TTL_MIN_HOURS,
  expiryFromTtl,
  watermarkOf
} from '../lib/verify.ts';
import { buildDraft, buildReuse, verificationOf } from './extensions.ts';
import { hexDigest } from './deterministic.ts';
import { NOW } from './evidence.ts';

function nowIso(): string {
  return NOW;
}

function findPack(packId: string): Pack {
  const pack = store().packs.find((item) => item.id === packId);
  if (!pack) throw new ApiError(404, 'NOT_FOUND', `No pack ${packId}.`);
  return pack;
}

function findShare(token: string): ShareGrant {
  const share = store().shares.find((item) => item.token === token);
  if (!share) throw new ApiError(404, 'NOT_FOUND', 'Unknown share token.');
  return share;
}

/** Mock implementation of the thirteen extension methods. */
export class MockExtensionsApi {
  private readonly principalOf: PrincipalProvider;

  constructor(principalOf: PrincipalProvider) {
    this.principalOf = principalOf;
  }

  async verifyPack(packId: string): Promise<VerificationResult> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    const pack = findPack(packId);
    const result = verificationOf(pack, nowIso());
    this.journal(principal, 'PACK_VERIFIED', 'pack', packId, {
      checksumsOk: result.checksumsOk,
      chainOk: result.chainOk,
      signatureOk: result.signatureOk
    });
    return result;
  }

  async verifyByToken(token: string): Promise<VerificationResult> {
    await delay();
    const state = store();
    const share = findShare(token);
    if (share.revokedAt !== null || share.expiresAt <= nowIso()) {
      throw new ApiError(
        404,
        'NOT_FOUND',
        'This share link is no longer usable: it was revoked or has expired.'
      );
    }
    share.useCount += 1;
    share.lastUsedAt = nowIso();
    const pack =
      (share.packId ? state.packs.find((item) => item.id === share.packId) : state.packs[0]) ??
      state.packs[0];
    if (!pack) throw new ApiError(404, 'NOT_FOUND', 'No pack to verify.');
    return verificationOf(pack, nowIso());
  }

  async createShare(packId: string, input: ShareInput): Promise<ShareGrant> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    findPack(packId);
    const ttl = input.ttlHours;
    if (!Number.isInteger(ttl) || ttl < SHARE_TTL_MIN_HOURS || ttl > SHARE_TTL_MAX_HOURS) {
      throw new ApiError(
        400,
        'BAD_REQUEST',
        `The share lifetime must be a whole number of hours between ${SHARE_TTL_MIN_HOURS} and ${SHARE_TTL_MAX_HOURS}.`
      );
    }
    const label = input.watermarkLabel.trim();
    if (label.length < 2) {
      throw new ApiError(400, 'BAD_REQUEST', 'A label naming the recipient is required.');
    }
    const grant = this.buildGrant(packId, label, ttl, principal);
    store().shares.unshift(grant);
    this.journal(principal, 'SHARE_CREATED', 'share', grant.token.slice(0, 12), {
      packId,
      ttlHours: ttl,
      expiresAt: grant.expiresAt
    });
    return grant;
  }

  private buildGrant(packId: string, label: string, ttl: number, principal: Principal): ShareGrant {
    const pack = findPack(packId);
    const createdAt = nowIso();
    const expiresAt = expiryFromTtl(createdAt, ttl);
    return {
      token: hexDigest(`share-${label}-${createdAt}-${store().shares.length}`, 43),
      packId: pack.id,
      frameworkId: pack.frameworkId,
      scope: 'PACK',
      createdBy: principal.name,
      createdAt,
      expiresAt,
      revokedAt: null,
      revokedBy: null,
      watermark: watermarkOf(label, expiresAt),
      useCount: 0,
      lastUsedAt: null
    };
  }

  async listShares(): Promise<ShareGrant[]> {
    requirePrincipal(this.principalOf);
    await delay();
    return [...store().shares].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async revokeShare(token: string): Promise<ShareGrant> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    const share = findShare(token);
    if (share.revokedAt !== null) {
      throw new ApiError(409, 'CONFLICT', 'This share was already revoked.');
    }
    share.revokedAt = nowIso();
    share.revokedBy = principal.name;
    this.journal(principal, 'SHARE_REVOKED', 'share', token.slice(0, 12), {
      packId: share.packId,
      useCount: share.useCount
    });
    return share;
  }

  async listMappings(filter?: MappingFilter): Promise<ControlMapping[]> {
    requirePrincipal(this.principalOf);
    await delay();
    const matches = store().mappings.filter(
      (item) =>
        (!filter?.status || item.status === filter.status) &&
        (!filter?.sourceFrameworkId || item.sourceFrameworkId === filter.sourceFrameworkId) &&
        (!filter?.targetFrameworkId || item.targetFrameworkId === filter.targetFrameworkId)
    );
    return sortMappings(matches);
  }

  async proposeMappings(input: {
    sourceFrameworkId: string;
    targetFrameworkId: string;
  }): Promise<ControlMapping[]> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    if (input.sourceFrameworkId === input.targetFrameworkId) {
      throw new ApiError(400, 'BAD_REQUEST', 'Source and target frameworks must differ.');
    }
    const proposed = store().mappings.filter(
      (item) =>
        item.status === 'PROPOSED' &&
        item.sourceFrameworkId === input.sourceFrameworkId &&
        item.targetFrameworkId === input.targetFrameworkId
    );
    this.journal(principal, 'MAPPING_PROPOSED', 'framework', input.sourceFrameworkId, {
      target: input.targetFrameworkId,
      proposed: proposed.length
    });
    return sortMappings(proposed);
  }

  async decideMapping(id: string, decision: MappingDecision, note?: string): Promise<ControlMapping> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    const trimmed = (note ?? '').trim();
    if (trimmed.length < 3) {
      throw new ApiError(400, 'BAD_REQUEST', 'A reason is required to decide a mapping.');
    }
    const mapping = store().mappings.find((item) => item.id === id);
    if (!mapping) throw new ApiError(404, 'NOT_FOUND', `No mapping ${id}.`);
    if (mapping.status !== 'PROPOSED') {
      throw new ApiError(409, 'CONFLICT', 'This mapping has already been decided.');
    }
    mapping.status = decision === 'VALIDATE' ? 'VALIDATED' : 'REJECTED';
    mapping.validatedBy = principal.name;
    mapping.validatedAt = nowIso();
    mapping.note = trimmed;
    this.journal(principal, 'MAPPING_DECIDED', 'mapping', mapping.id, {
      decision,
      note: trimmed
    });
    return mapping;
  }

  async getReuse(frameworkId: string): Promise<ReuseMetric> {
    requirePrincipal(this.principalOf);
    await delay();
    if (frameworkId !== DEMO_FRAMEWORK_ID) {
      throw new ApiError(404, 'NOT_FOUND', `No reuse metric for ${frameworkId}.`);
    }
    return buildReuse(store().mappings, nowIso());
  }

  async listDrifts(frameworkId?: string): Promise<DriftEvent[]> {
    requirePrincipal(this.principalOf);
    await delay();
    const matches = store().drifts.filter(
      (item) => !frameworkId || item.frameworkId === frameworkId
    );
    return sortDrifts(matches);
  }

  async ackDrift(id: string): Promise<DriftEvent> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    const drift = store().drifts.find((item) => item.id === id);
    if (!drift) throw new ApiError(404, 'NOT_FOUND', `No drift ${id}.`);
    if (drift.acknowledgedAt !== null) {
      throw new ApiError(409, 'CONFLICT', 'This drift was already acknowledged.');
    }
    drift.acknowledgedAt = nowIso();
    drift.acknowledgedBy = principal.name;
    this.journal(principal, 'DRIFT_ACKNOWLEDGED', 'drift', drift.id, {
      controlId: drift.controlId,
      kind: drift.kind
    });
    return drift;
  }

  async generateDraft(controlId: string): Promise<Draft> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    const draft = buildDraft(store().db, controlId, nowIso());
    if (!draft) throw new ApiError(404, 'NOT_FOUND', `No control ${controlId}.`);
    this.journal(principal, 'DRAFT_GENERATED', 'control', controlId, {
      sections: draft.sections.length,
      toComplete: draft.missing.length
    });
    return draft;
  }

  async getQuality(): Promise<QualityReport> {
    requirePrincipal(this.principalOf);
    await delay();
    return store().quality;
  }

  private journal(
    principal: Principal,
    action: Parameters<typeof appendAuditEvent>[1]['action'],
    objectType: string,
    objectId: string,
    detail: Record<string, unknown>
  ): void {
    appendAuditEvent(store().audit, {
      at: nowIso(),
      actor: principal.name,
      action,
      objectType,
      objectId,
      detail
    });
  }
}
