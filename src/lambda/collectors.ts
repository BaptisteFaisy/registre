/**
 * Shared runner of the three collector adapters — no handler lives here.
 *
 * One implementation for `collectS3`, `collectItsm` and `collectAwsReport`:
 * build the collector from the deployment environment, run it through
 * `runCollectors` (fingerprint, duplicates, journal — EF-COL-05, R8,
 * ENF-OBS-01) and report counters plus the provenance of every file. The bytes
 * stay out of the response: the pipeline reads them from the source, it does
 * not receive them through a state-machine payload.
 *
 * Tests inject a collector with `setLambdaCollector`: the real builders reach
 * S3 or an ITSM endpoint, so nothing offline may call them.
 */

import type { Collector, CollectorCursor, CollectedOutcome } from '../collectors/index.ts';
import { runCollectors } from '../collectors/index.ts';
import type { CollectorRunReport } from '../collectors/index.ts';
import type { Services } from '../ports/index.ts';
import { configError } from '../support/errors.ts';
import { actorOf, defineHandler, lambdaServices, optionalString } from './shared.ts';
import type { LambdaHandler, StepOutcome } from './shared.ts';

/** The three collectors the deployment schedules. */
export const COLLECTOR_KEYS = ['collectS3', 'collectItsm', 'collectAwsReport'] as const;
export type CollectorKey = (typeof COLLECTOR_KEYS)[number];

/** Builds one collector from the deployment environment. */
export type CollectorBuilder = (services: Services, env: NodeJS.ProcessEnv) => Promise<Collector> | Collector;

const injected = new Map<CollectorKey, Collector>();

/** Test seam: replaces the collector one adapter runs; `null` restores it. */
export function setLambdaCollector(key: CollectorKey, collector: Collector | null): void {
  if (collector === null) injected.delete(key);
  else injected.set(key, collector);
}

/** Forgets every injected collector (one process, several test cases). */
export function resetLambdaCollectors(): void {
  injected.clear();
}

/** One collected file, without its bytes: what a response may carry. */
export interface CollectedSummary {
  key: string;
  uri: string;
  kind: string;
  contentType: string;
  sha256: string;
  sizeBytes: number;
  collectedAt: string;
  duplicateOf: string | null;
}

/** One env value a collector cannot invent; a missing one is a `CONFIG` error. */
export function requiredEnv(env: NodeJS.ProcessEnv, names: readonly string[], what: string): string {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value.trim().length > 0) return value.trim();
  }
  throw configError(`${what} is not configured: set ${names.join(' or ')}`, { missing: names });
}

/** The collection window the scheduler may hand to the run. */
export function cursorOf(raw: Record<string, unknown>): CollectorCursor | undefined {
  const since = optionalString(raw, 'since');
  const until = optionalString(raw, 'until');
  const token = optionalString(raw, 'token');
  if (since === undefined && until === undefined && token === undefined) return undefined;
  return {
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
    ...(token === undefined ? {} : { token })
  };
}

/** Provenance of one collected file, as the journal and the report show it. */
function summaryOf(outcome: CollectedOutcome): CollectedSummary {
  const file = outcome.file;
  return {
    key: file.key,
    uri: file.uri,
    kind: file.kind,
    contentType: file.contentType,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
    collectedAt: file.collectedAt,
    duplicateOf: outcome.duplicateOf
  };
}

/** The response of one collector run: counters first, then the files. */
function collectorOutcome(collectorId: string, report: CollectorRunReport): StepOutcome {
  const files = report.files.map(summaryOf);
  const output = {
    collectorId,
    collected: report.collected,
    duplicates: report.duplicates,
    succeeded: report.succeeded,
    failed: report.failed,
    files
  };
  return { output, payload: { collectorId, files } };
}

/**
 * Builds the handler of one collector adapter. `build` runs only when no
 * collector was injected, so an offline run never touches S3 or an endpoint.
 */
export function defineCollectorHandler(key: CollectorKey, build: CollectorBuilder): LambdaHandler {
  return defineHandler(async (raw) => {
    const services = await lambdaServices();
    const collector = injected.get(key) ?? (await build(services, process.env));
    const cursor = cursorOf(raw);
    const report = await runCollectors({
      collectors: [collector],
      ...(cursor === undefined ? {} : { cursor }),
      clock: services.clock,
      audit: services.audit,
      lookup: async (sha256) => (await services.state.findEvidenceByHash(sha256))?.id ?? null,
      actor: actorOf(raw, `lambda-${key}`)
    });
    return collectorOutcome(collector.id, report);
  });
}
