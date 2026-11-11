/**
 * Knowledge-base adapters — EF-RAT-01 (candidate controls) and EF-QR-01/03
 * (evidence search filtered by the reader's clearance).
 *
 * Two managed knowledge bases are used, as in spec 11.3:
 *  - "frameworks": one chunk per control, metadata = the control fields;
 *  - "evidence": one chunk per page of evidence, metadata = evidenceId,
 *    accessLevel, documentDate, title.
 *
 * Only `Retrieve` is called, never `RetrieveAndGenerate`: generation belongs to
 * `composer.ts`, which returns citations as structured data (Annex C of the
 * spec, ENF-IA-02) and lets the guardrail check the draft before the user sees
 * it. Calling `RetrieveAndGenerate` would generate a free-text answer here and
 * duplicate that path, with citations that would have to be parsed back.
 *
 * Access control (EF-QR-03) is enforced TWICE: a metadata filter on
 * `accessLevel` in the request, then a second check in code on the returned
 * chunks, because a stale index must never leak a restricted passage.
 *
 * API choice: both bases are queried with `Retrieve`, and the answer is written
 * by `composer.ts` with `Converse`. `RetrieveAndGenerate` would fuse retrieval
 * and generation in one call, which would (a) duplicate the answering path,
 * (b) return a free-text answer whose citations must be parsed back, while the
 * spec requires citations as data (Annex C of chapter 13.4, ENF-IA-02) and a
 * guardrail pass between the draft and the user. The managed generate path is
 * therefore not used; flagged as a point to confirm with the Bedrock team.
 */

import type { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import type { RetrievalFilter } from '@aws-sdk/client-bedrock-agent-runtime';
import type { ControlCandidate, ControlRetriever, CostMeter, EvidenceRetriever } from '../../ports/index.ts';
import type { AccessLevel, Control, Passage, Settings } from '../../domain/types.ts';
import { upstream } from '../../support/errors.ts';
import { excerpt, normalizeText } from '../../support/normalize.ts';
import { createAgentRuntimeClient } from './client.ts';
import { recordCost, retrievalCost } from './costs.ts';

/** Default number of candidate controls returned (spec 13.2: about ten). */
export const DEFAULT_CANDIDATE_LIMIT = 10;

/** Default number of passages returned to the answer composer. */
export const DEFAULT_PASSAGE_LIMIT = 8;

/** Knowledge-base identifiers, read from the deployment environment. */
export interface KnowledgeBaseIds {
  frameworks: string;
  evidence: string;
}

/** Reads the two knowledge-base ids from the environment. */
export function knowledgeBaseIds(env: NodeJS.ProcessEnv): KnowledgeBaseIds {
  return {
    frameworks: env.REGISTRE_KB_FRAMEWORKS_ID ?? '',
    evidence: env.REGISTRE_KB_EVIDENCE_ID ?? ''
  };
}

/** Reads one metadata value as a string, or null. */
export function metaString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

/** Reads one metadata value as a string list (expected evidence items). */
export function metaList(metadata: Record<string, unknown> | undefined, key: string): string[] {
  const value = metadata?.[key];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  const single = metaString(metadata, key);
  return single ? single.split('|').map((item) => item.trim()).filter(Boolean) : [];
}

/** Rebuilds a `Control` from a knowledge-base chunk's metadata. */
export function controlFromMetadata(metadata: Record<string, unknown> | undefined): Control | null {
  const id = metaString(metadata, 'controlId');
  if (!id) return null;
  return {
    id,
    frameworkId: metaString(metadata, 'frameworkId') ?? 'unknown',
    domain: metaString(metadata, 'domain') ?? 'General',
    title: metaString(metadata, 'title') ?? id,
    requirement: metaString(metadata, 'requirement') ?? '',
    expectedEvidence: metaList(metadata, 'expectedEvidence'),
    periodicity: metaString(metadata, 'periodicity') ?? 'P1Y',
    owner: metaString(metadata, 'owner') ?? 'unassigned',
    mandatory: metaString(metadata, 'mandatory') === 'true'
  };
}

/** Metadata filter restricting retrieval to the levels a principal may read. */
export function accessFilter(allowedLevels: readonly AccessLevel[]): RetrievalFilter {
  return { in: { key: 'accessLevel', value: [...allowedLevels] } };
}

/** Combines the access filter with the optional framework filter (EF-QR-03). */
export function combineFilters(filter?: RetrievalFilter, frameworkId?: string): RetrievalFilter | undefined {
  if (!frameworkId) return filter;
  const byFramework: RetrievalFilter = { equals: { key: 'frameworkId', value: frameworkId } };
  return filter ? { andAll: [filter, byFramework] } : byFramework;
}

/** `ControlRetriever` on the frameworks knowledge base (EF-RAT-01). */
export class BedrockControlRetriever implements ControlRetriever {
  readonly id = 'bedrock-kb-frameworks';
  private readonly settings: Settings;
  private readonly kbId: string;
  private readonly meter: CostMeter | undefined;

  constructor(settings: Settings, kbId: string, meter?: CostMeter) {
    this.settings = settings;
    this.kbId = kbId;
    this.meter = meter;
  }

  async candidates(input: {
    type: string | null;
    title: string | null;
    summary: string | null;
    text: string;
    frameworkId?: string;
    limit?: number;
  }): Promise<ControlCandidate[]> {
    if (!this.kbId) throw upstream('frameworks knowledge base id is not configured (REGISTRE_KB_FRAMEWORKS_ID)');
    const client = await createAgentRuntimeClient(this.settings);
    const query = [input.type ?? '', input.title ?? '', input.summary ?? '', excerpt(input.text, 800)].filter(Boolean).join('\n');
    const results = await retrieve(client, {
      knowledgeBaseId: this.kbId,
      query,
      limit: input.limit ?? DEFAULT_CANDIDATE_LIMIT,
      frameworkId: input.frameworkId
    });
    const cost = recordCost(this.meter, retrievalCost(this.id));
    console.info(`[ai:bedrock] ${this.id}: ${results.length} candidate(s), $${cost.usd}`);
    return results.flatMap((result) => {
      const control = controlFromMetadata(result.metadata);
      if (!control) return [];
      const matchedOn = normalizeText(result.content ?? '').slice(0, 120);
      return [{ control, score: result.score ?? 0, matchedOn }];
    });
  }
}

/** `EvidenceRetriever` on the evidence knowledge base (EF-QR-01, EF-QR-03). */
export class BedrockEvidenceRetriever implements EvidenceRetriever {
  readonly id = 'bedrock-kb-evidence';
  private readonly settings: Settings;
  private readonly kbId: string;
  private readonly meter: CostMeter | undefined;

  constructor(settings: Settings, kbId: string, meter?: CostMeter) {
    this.settings = settings;
    this.kbId = kbId;
    this.meter = meter;
  }

  async search(input: {
    query: string;
    allowedLevels: readonly AccessLevel[];
    limit?: number;
    frameworkId?: string;
  }): Promise<Passage[]> {
    if (!this.kbId) throw upstream('evidence knowledge base id is not configured (REGISTRE_KB_EVIDENCE_ID)');
    const client = await createAgentRuntimeClient(this.settings);
    const results = await retrieve(client, {
      knowledgeBaseId: this.kbId,
      query: input.query,
      limit: input.limit ?? DEFAULT_PASSAGE_LIMIT,
      filter: accessFilter(input.allowedLevels),
      frameworkId: input.frameworkId
    });
    recordCost(this.meter, retrievalCost(this.id));
    const allowed = new Set(input.allowedLevels);
    return results.flatMap((result) => {
      const accessLevel = (metaString(result.metadata, 'accessLevel') ?? 'INTERNAL') as AccessLevel;
      if (!allowed.has(accessLevel)) return [];
      const evidenceId = metaString(result.metadata, 'evidenceId') ?? result.documentId ?? 'unknown';
      const page = Number(metaString(result.metadata, 'page') ?? '0');
      return [
        {
          evidenceId,
          title: metaString(result.metadata, 'title'),
          documentDate: metaString(result.metadata, 'documentDate'),
          page: Number.isFinite(page) && page > 0 ? page : null,
          text: result.content ?? '',
          score: result.score ?? 0,
          accessLevel
        }
      ];
    });
  }
}

interface RetrieveRequest {
  knowledgeBaseId: string;
  query: string;
  limit: number;
  filter?: RetrievalFilter;
  frameworkId?: string;
}

interface RetrieveHit {
  content: string | null;
  score: number | null;
  metadata?: Record<string, unknown>;
  documentId?: string;
}

/** Runs one `Retrieve` call and flattens the SDK response. */
async function retrieve(client: BedrockAgentRuntimeClient, request: RetrieveRequest): Promise<RetrieveHit[]> {
  const { RetrieveCommand } = await import('@aws-sdk/client-bedrock-agent-runtime');
  const filter = combineFilters(request.filter, request.frameworkId);
  try {
    const response = await client.send(
      new RetrieveCommand({
        knowledgeBaseId: request.knowledgeBaseId,
        retrievalQuery: { text: request.query.slice(0, 4000) },
        retrievalConfiguration: {
          // A MANAGED knowledge base rejects `vectorSearchConfiguration`
          // ("Incompatible configuration ... Use managedSearchConfiguration
          // instead", seen on a real Retrieve in eu-central-1). The inner fields
          // are identical, so only the wrapper name changes.
          managedSearchConfiguration: {
            numberOfResults: request.limit,
            ...(filter ? { filter } : {})
          }
        }
      })
    );
    return (response.retrievalResults ?? []).map((result) => ({
      content: result.content?.text ?? null,
      score: result.score ?? null,
      metadata: result.metadata as Record<string, unknown> | undefined,
      documentId: result.documentId
    }));
  } catch (error) {
    throw upstream(`Bedrock Retrieve failed: ${(error as Error).message}`, { knowledgeBaseId: request.knowledgeBaseId });
  }
}

/** Factory: `ControlRetriever` on the frameworks knowledge base (EF-RAT-01). */
export function createControlRetriever(settings: Settings, kbId: string, meter?: CostMeter): ControlRetriever {
  return new BedrockControlRetriever(settings, kbId, meter);
}

/** Factory: `EvidenceRetriever` on the evidence knowledge base (EF-QR-01, EF-QR-03). */
export function createEvidenceRetriever(settings: Settings, kbId: string, meter?: CostMeter): EvidenceRetriever {
  return new BedrockEvidenceRetriever(settings, kbId, meter);
}
