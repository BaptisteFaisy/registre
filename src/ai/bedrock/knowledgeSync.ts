/**
 * Feeding the two knowledge bases — EF-RAT-01, EF-QR-01.
 *
 * A managed knowledge base indexes the objects its S3 data source points at,
 * and only when an ingestion job runs: nothing syncs on its own. Retrieval then
 * filters and rebuilds its results from each document's metadata
 * (`knowledgeBase.ts`: `controlId`, `frameworkId`, `accessLevel`, `page`…). So
 * a raw upload is not enough; each source document goes with a sidecar
 * `<key>.metadata.json` carrying exactly those attributes:
 *
 *  - one document per control, under `controls/<framework>/`, written when a
 *    framework is imported (control retrieval, EF-RAT-01);
 *  - one document per page of a read evidence, under the evidence prefix,
 *    written by the last pipeline step (cited answers, EF-QR-01).
 *
 * Then one ingestion job is started per data source. A job already running is
 * not an error: the data source is crawled whole each time, so the next job
 * picks the new documents up. Nothing here claims a document is indexed.
 */

import type { S3Client } from '@aws-sdk/client-s3';
import type { BedrockAgentClient } from '@aws-sdk/client-bedrock-agent';
import type { Control, Evidence } from '../../domain/types.ts';

/** One document of a knowledge-base source, with its metadata sidecar. */
export interface SourceDocument {
  key: string;
  text: string;
  metadata: Record<string, string>;
}

/** Path segment safe for an S3 key. */
function segment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '-');
}

/** Body of a metadata sidecar, in the format Bedrock knowledge bases read. */
export function metadataBody(metadata: Record<string, string>): string {
  return JSON.stringify({ metadataAttributes: metadata });
}

/** The source document of one control (EF-RAT-01). */
export function controlDocument(control: Control, prefix = 'controls/'): SourceDocument {
  const text = [
    `${control.id} — ${control.title}`,
    `Domain: ${control.domain}`,
    `Requirement: ${control.requirement}`,
    `Expected evidence: ${control.expectedEvidence.join('; ')}`,
    `Periodicity: ${control.periodicity}`
  ].join('\n');
  return {
    key: `${prefix}${segment(control.frameworkId)}/${segment(control.id)}.txt`,
    text,
    metadata: {
      controlId: control.id,
      frameworkId: control.frameworkId,
      domain: control.domain,
      title: control.title,
      requirement: control.requirement,
      expectedEvidence: control.expectedEvidence.join('|'),
      periodicity: control.periodicity,
      owner: control.owner,
      mandatory: String(control.mandatory)
    }
  };
}

/** The source documents of one read evidence, one per page (EF-QR-01). */
export function evidenceDocuments(evidence: Evidence, prefix = 'kb-evidence/'): SourceDocument[] {
  const base = `${prefix}${segment(evidence.id)}/r${evidence.revision}`;
  return evidence.textPages
    .filter((page) => page.text.trim().length > 0)
    .map((page) => ({
      key: `${base}-p${page.page}.txt`,
      text: page.text,
      metadata: {
        evidenceId: evidence.id,
        accessLevel: evidence.accessLevel,
        page: String(page.page),
        ...(evidence.fields.title ? { title: evidence.fields.title } : {}),
        ...(evidence.fields.documentDate ? { documentDate: evidence.fields.documentDate } : {})
      }
    }));
}

/** Writes each document and its sidecar. Checksummed: the vault bucket is under Object Lock. */
export async function putSourceDocuments(
  client: S3Client,
  bucket: string,
  documents: readonly SourceDocument[]
): Promise<number> {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  for (const document of documents) {
    const objects = [
      { Key: document.key, Body: document.text, ContentType: 'text/plain; charset=utf-8' },
      { Key: `${document.key}.metadata.json`, Body: metadataBody(document.metadata), ContentType: 'application/json' }
    ];
    for (const object of objects) {
      await client.send(new PutObjectCommand({ Bucket: bucket, ...object, ChecksumAlgorithm: 'SHA256' }));
    }
  }
  return documents.length;
}

/** Outcome of a sync request, per data source. */
export type SyncOutcome = 'started' | 'already-running';

/** Starts one ingestion job per data source of the knowledge base. */
export async function startIngestion(client: BedrockAgentClient, knowledgeBaseId: string): Promise<SyncOutcome[]> {
  const { ListDataSourcesCommand, StartIngestionJobCommand } = await import('@aws-sdk/client-bedrock-agent');
  const sources = await client.send(new ListDataSourcesCommand({ knowledgeBaseId }));
  const outcomes: SyncOutcome[] = [];
  for (const source of sources.dataSourceSummaries ?? []) {
    if (!source.dataSourceId) continue;
    try {
      await client.send(new StartIngestionJobCommand({ knowledgeBaseId, dataSourceId: source.dataSourceId }));
      outcomes.push('started');
    } catch (error) {
      if ((error as Error).name !== 'ConflictException') throw error;
      outcomes.push('already-running');
    }
  }
  return outcomes;
}

/** Where a knowledge base is fed from, read from the environment (config, not code). */
export interface KnowledgeTarget {
  knowledgeBaseId: string;
  bucket: string;
  prefix: string;
  region: string;
}

/** Writes the documents, then asks for a sync — the whole feed of one knowledge base. */
export async function feedKnowledgeBase(
  target: KnowledgeTarget,
  documents: readonly SourceDocument[]
): Promise<{ written: number; sync: SyncOutcome[] }> {
  const { S3Client } = await import('@aws-sdk/client-s3');
  const { BedrockAgentClient } = await import('@aws-sdk/client-bedrock-agent');
  const written = await putSourceDocuments(new S3Client({ region: target.region }), target.bucket, documents);
  const sync = written > 0 ? await startIngestion(new BedrockAgentClient({ region: target.region }), target.knowledgeBaseId) : [];
  return { written, sync };
}

/** The frameworks knowledge base target, or null when the deployment names none. */
export function frameworksTarget(env: NodeJS.ProcessEnv): KnowledgeTarget | null {
  return targetOf(env, env.REGISTRE_KB_FRAMEWORKS_ID, env.REGISTRE_FRAMEWORKS_BUCKET, 'controls/');
}

/** The evidence knowledge base target, or null when the deployment names none. */
export function evidenceTarget(env: NodeJS.ProcessEnv): KnowledgeTarget | null {
  return targetOf(env, env.REGISTRE_KB_EVIDENCE_ID, env.REGISTRE_VAULT_BUCKET, env.REGISTRE_KB_EVIDENCE_PREFIX ?? '');
}

function targetOf(
  env: NodeJS.ProcessEnv,
  knowledgeBaseId: string | undefined,
  bucket: string | undefined,
  prefix: string
): KnowledgeTarget | null {
  const region = env.REGISTRE_REGION ?? env.AWS_REGION ?? '';
  if (!knowledgeBaseId || !bucket || !prefix || !region) return null;
  return { knowledgeBaseId, bucket, prefix, region };
}
