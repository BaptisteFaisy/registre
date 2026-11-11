/**
 * Bounded collection run — EF-COL-05 ("compute the fingerprint of every file;
 * discard duplicates; keep the versions"), R8 ("one single record, two noted
 * locations") and ENF-OBS-01 ("supervise every collection, alarm on failures").
 *
 * One run:
 *  1. calls each collector in turn, with a wall-clock budget per collector;
 *  2. fingerprints every produced file (the collector already did it once);
 *  3. detects duplicates against the store and against the files of this run —
 *     a duplicate is NOT dropped: it is returned with the id of the record that
 *     already holds the content and with both locations, so the pipeline can
 *     append the second location to the existing evidence;
 *  4. journals every collection and every duplicate (ENF-INT-02, EF-ADM-02);
 *  5. returns counters per collector and overall, for the supervision dashboard.
 */

import type { AuditAction, CollectorKind } from '../domain/types.ts';
import type { AuditSink, Clock } from '../ports/index.ts';
import { SystemClock } from '../support/clock.ts';
import { upstream } from '../support/errors.ts';
import type { CollectedFile, Collector, CollectorCursor } from './types.ts';

/** Default wall-clock budget of one collector (CI and batch budget). */
export const DEFAULT_COLLECTOR_TIMEOUT_MS = 30_000;

/** Outcome of one collected file: new, or the second copy of a known content. */
export interface CollectedOutcome {
  file: CollectedFile;
  /** Evidence id (or vault key) already holding this fingerprint, `null` if new. */
  duplicateOf: string | null;
  /** Location of the first copy seen in this run, so both are noted (R8). */
  firstUri: string | null;
}

/** Supervision record of one collector (ENF-OBS-01). */
export interface CollectorRun {
  collectorId: string;
  kind: CollectorKind;
  ok: boolean;
  collected: number;
  duplicates: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error?: string;
}

/** Supervision record of the whole run. */
export interface CollectorRunReport {
  startedAt: string;
  finishedAt: string;
  runs: CollectorRun[];
  files: CollectedOutcome[];
  succeeded: number;
  failed: number;
  collected: number;
  duplicates: number;
}

export interface RunCollectorsOptions {
  collectors: readonly Collector[];
  cursor?: CollectorCursor;
  clock?: Clock;
  /** Journal of the run; every collection and every duplicate is appended. */
  audit?: AuditSink;
  /** Fingerprint already stored → id of the evidence holding it (R8). */
  lookup?: (sha256: string) => Promise<string | null>;
  /** Budget per collector; a slower collector is reported as failed. */
  timeoutMs?: number;
  /** Actor recorded in the journal. */
  actor?: string;
  /** Called for every produced file, in order (pipeline hand-off). */
  onFile?: (outcome: CollectedOutcome) => Promise<void>;
}

/** Runs the collectors in order and returns files plus supervision counters. */
export async function runCollectors(options: RunCollectorsOptions): Promise<CollectorRunReport> {
  const clock = options.clock ?? new SystemClock();
  const startedAt = clock.now();
  const seen = new Map<string, { id: string; uri: string }>();
  const runs: CollectorRun[] = [];
  const files: CollectedOutcome[] = [];

  for (const collector of options.collectors) {
    const run = await runOne(collector, options, clock, seen, files);
    runs.push(run);
  }

  const finishedAt = clock.now();
  return {
    startedAt,
    finishedAt,
    runs,
    files,
    succeeded: runs.filter((run) => run.ok).length,
    failed: runs.filter((run) => !run.ok).length,
    collected: files.length,
    duplicates: files.filter((file) => file.duplicateOf !== null).length
  };
}

/** Collects from one collector, isolating its failure from the others. */
async function runOne(
  collector: Collector,
  options: RunCollectorsOptions,
  clock: Clock,
  seen: Map<string, { id: string; uri: string }>,
  files: CollectedOutcome[]
): Promise<CollectorRun> {
  const startedAt = clock.now();
  const budget = options.timeoutMs ?? DEFAULT_COLLECTOR_TIMEOUT_MS;
  try {
    const produced = await withTimeout(collector.collect(options.cursor), budget, collector.id);
    const outcomes: CollectedOutcome[] = [];
    for (const file of produced) {
      const outcome = await classify(file, seen, options.lookup);
      outcomes.push(outcome);
      files.push(outcome);
      await journal(options, collector, outcome, clock);
      if (options.onFile !== undefined) await options.onFile(outcome);
    }
    const finishedAt = clock.now();
    return {
      collectorId: collector.id,
      kind: collector.kind,
      ok: true,
      collected: outcomes.length,
      duplicates: outcomes.filter((outcome) => outcome.duplicateOf !== null).length,
      startedAt,
      finishedAt,
      durationMs: elapsed(startedAt, finishedAt)
    };
  } catch (error) {
    const finishedAt = clock.now();
    const message = error instanceof Error ? error.message : String(error);
    await journalFailure(options, collector, message, clock);
    return {
      collectorId: collector.id,
      kind: collector.kind,
      ok: false,
      collected: 0,
      duplicates: 0,
      startedAt,
      finishedAt,
      durationMs: elapsed(startedAt, finishedAt),
      error: message
    };
  }
}

/** Decides whether a file is new, or the second copy of a known content (R8). */
async function classify(
  file: CollectedFile,
  seen: Map<string, { id: string; uri: string }>,
  lookup: ((sha256: string) => Promise<string | null>) | undefined
): Promise<CollectedOutcome> {
  const known = seen.get(file.sha256);
  if (known !== undefined) return { file, duplicateOf: known.id, firstUri: known.uri };
  if (lookup !== undefined) {
    const stored = await lookup(file.sha256);
    if (stored !== null) return { file, duplicateOf: stored, firstUri: null };
  }
  seen.set(file.sha256, { id: file.key, uri: file.uri });
  return { file, duplicateOf: null, firstUri: null };
}

/** Journals one collected file, or its duplicate status (EF-ADM-02). */
async function journal(
  options: RunCollectorsOptions,
  collector: Collector,
  outcome: CollectedOutcome,
  clock: Clock
): Promise<void> {
  if (options.audit === undefined) return;
  const action: AuditAction = outcome.duplicateOf === null ? 'EVIDENCE_COLLECTED' : 'EVIDENCE_DUPLICATE';
  await options.audit.append({
    actor: options.actor ?? 'collector',
    action,
    objectType: 'evidence',
    objectId: outcome.duplicateOf ?? outcome.file.sha256,
    detail: {
      collectorId: collector.id,
      collectorKind: collector.kind,
      key: outcome.file.key,
      uri: outcome.file.uri,
      sha256: outcome.file.sha256,
      sizeBytes: outcome.file.sizeBytes,
      contentType: outcome.file.contentType,
      collectedAt: clock.now(),
      ...(outcome.firstUri === null ? {} : { firstUri: outcome.firstUri })
    }
  });
}

/** Journals a failed collection, so the alarm can fire (ENF-OBS-01). */
async function journalFailure(
  options: RunCollectorsOptions,
  collector: Collector,
  message: string,
  clock: Clock
): Promise<void> {
  if (options.audit === undefined) return;
  await options.audit.append({
    actor: options.actor ?? 'collector',
    action: 'EVIDENCE_COLLECTED',
    objectType: 'collector',
    objectId: collector.id,
    detail: {
      collectorKind: collector.kind,
      status: 'FAILED',
      error: message,
      at: clock.now()
    }
  });
}

/** Rejects when `work` has not settled within `ms`, without leaking the timer. */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  work.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(upstream(`collector ${label} exceeded its ${ms} ms budget`));
    }, ms);
    timer.unref();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/** Whole milliseconds between two ISO instants. */
function elapsed(from: string, to: string): number {
  return Math.max(0, new Date(to).getTime() - new Date(from).getTime());
}
