/**
 * A stub `PipelineApi` for the HTTP-layer tests.
 *
 * The router, the authentication and the serialisation are what these tests
 * exercise: the pipeline itself has its own suite (`test/pipeline/**`). The stub
 * returns deterministic values and records its calls, so a test can assert both
 * the response and the call that produced it.
 */

import type {
  Answer,
  ControlStatus,
  Evidence,
  Pack,
  Reminder,
  ValidationItem
} from '../../src/domain/types.ts';
import type { ImportResult, NotificationMessage, Services } from '../../src/ports/index.ts';
import type {
  DecisionOutcome,
  DecisionRequest,
  FrameworkRecompute,
  IngestOutcome,
  IngestRequest,
  PipelineApi
} from '../../src/api/pipeline.ts';
import { makeEvidence, makeStatus, makeSufficiency, makeValidation } from '../fixtures/builders.ts';

/** One recorded call, so a test can assert what reached the pipeline. */
export interface PipelineCall {
  name: string;
  args: unknown[];
}

/** The stub, plus its call log. */
export interface StubPipeline extends PipelineApi {
  calls: PipelineCall[];
  /** Evidence the stub returns for a deposit. */
  evidence: Evidence;
  /** Statuses the stub returns from a recomputation. */
  statuses: ControlStatus[];
}

/** The instant every stubbed value carries. */
const NOW = '2026-11-11T12:00:00.000Z';

/** Counts of the two control states of the stubbed framework. */
const STUB_COUNTS = { COVERED: 1, TO_RENEW: 0, TO_VERIFY: 0, EXPIRED: 0, NO_EVIDENCE: 1 };

/** A recorder that keeps every call the routes make. */
export interface Recorder {
  calls: PipelineCall[];
  record<T>(name: string, args: unknown[], value: T): T;
}

/** Builds a recorder. */
function recorder(): Recorder {
  const calls: PipelineCall[] = [];
  return {
    calls,
    record<T>(name: string, args: unknown[], value: T): T {
      calls.push({ name, args });
      return value;
    }
  };
}

/** The stubbed ingestion. */
function ingestOf(log: Recorder, evidence: Evidence) {
  return async (_services: Services, request: IngestRequest): Promise<IngestOutcome> =>
    log.record('ingestEvidence', [request], { evidence, duplicate: false });
}

/** The stubbed framework import. */
function importOf(log: Recorder) {
  return async (_services: Services, input: Parameters<PipelineApi['importFramework']>[1]): Promise<ImportResult> =>
    log.record('importFramework', [input], {
      framework: {
        id: input.framework.id,
        name: input.framework.name,
        version: input.framework.version,
        importedAt: NOW,
        confidentiality: input.framework.confidentiality ?? 'INTERNAL'
      },
      controls: input.controls.map((control) => ({
        ...control,
        frameworkId: input.framework.id,
        mandatory: control.mandatory ?? false
      })),
      diff: null
    });
}

/** The stubbed recomputation, with its readiness and its trend point. */
function recomputeOf(log: Recorder, statuses: ControlStatus[]) {
  return async (): Promise<FrameworkRecompute> =>
    log.record('recomputeFramework', [], {
      statuses,
      readiness: {
        frameworkId: 'demo-msp',
        computedAt: NOW,
        total: statuses.length,
        counts: STUB_COUNTS,
        shares: { COVERED: 0.5, TO_RENEW: 0, TO_VERIFY: 0, EXPIRED: 0, NO_EVIDENCE: 0.5 }
      },
      trend: [{ frameworkId: 'demo-msp', at: NOW, counts: STUB_COUNTS }]
    });
}

/** The stubbed validation queue. */
function queueOf(log: Recorder) {
  return async (): Promise<ValidationItem[]> =>
    log.record('listValidationQueue', [], [makeValidation({ id: 'va-1', status: 'PENDING' })]);
}

/** The stubbed decision, which keeps the author, the date and the note. */
function decideOf(log: Recorder, statuses: ControlStatus[]) {
  return async (
    _services: Services,
    itemId: string,
    request: DecisionRequest
  ): Promise<DecisionOutcome> =>
    log.record('decideValidation', [itemId, request], {
      item: {
        ...makeValidation({ id: itemId }),
        status: 'DECIDED',
        decision: request.decision,
        decidedBy: request.by,
        decidedAt: NOW,
        note: request.note
      },
      statuses
    });
}

/** The stubbed answer, cited on its single passage. */
function askOf(log: Recorder) {
  return async (
    _services: Services,
    _principal: unknown,
    question: string
  ): Promise<Answer> =>
    log.record('askQuestion', [question], {
      question,
      text: 'The policy was reviewed on 1 August 2026.',
      citations: [
        {
          evidenceId: 'ev-stub-1',
          title: 'Information security policy',
          page: 1,
          documentDate: '2026-08-01',
          quote: 'reviewed on 1 August 2026'
        }
      ],
      noEvidence: false,
      redacted: false,
      passagesUsed: 1
    });
}

/** The stubbed pack, with one index entry and one known gap. */
function packOf(log: Recorder) {
  return async (_services: Services, frameworkId: string): Promise<Pack> =>
    log.record('assemblePack', [frameworkId], {
      id: 'pk-1',
      frameworkId,
      frozenAt: NOW,
      index: [
        {
          controlId: 'CONT-01',
          controlTitle: 'Information security policy reviewed annually',
          state: 'COVERED',
          evidence: [
            {
              evidenceId: 'ev-stub-1',
              title: 'Information security policy',
              documentDate: '2026-08-01',
              sha256: 'a'.repeat(64),
              sufficiencyClass: makeSufficiency().class,
              quote: 'reviewed on 1 August 2026',
              page: 1
            }
          ]
        }
      ],
      knownGaps: [{ controlId: 'CONT-03', state: 'NO_EVIDENCE', detail: 'No restore test recorded this quarter' }],
      archive: { uri: 'memory://packs/pk-1/pack.zip#v1', sha256: 'b'.repeat(64), sizeBytes: 4 },
      checksumsVerified: true
    });
}

/** The stubbed reminders: none. */
function remindersOf(log: Recorder) {
  return async (): Promise<Reminder[]> => log.record('runReminders', [], []);
}

/** The stubbed weekly digest. */
function digestOf(log: Recorder) {
  return async (_services: Services, frameworkId: string): Promise<NotificationMessage> =>
    log.record('weeklyDigest', [frameworkId], {
      to: 'quality.lead@msp.demo',
      subject: 'Weekly readiness',
      body: 'Two controls need attention.',
      kind: 'WEEKLY_DIGEST'
    });
}

/** Builds a stub pipeline; every method is overridable through `overrides`. */
export function makeStubPipeline(overrides: Partial<PipelineApi> = {}): StubPipeline {
  const record = recorder();
  const evidence = makeEvidence({ id: 'ev-stub-1', accessLevel: 'INTERNAL' });
  const statuses: ControlStatus[] = [
    makeStatus({ controlId: 'CONT-01' }),
    makeStatus({ controlId: 'CONT-03', state: 'NO_EVIDENCE' })
  ];
  const stub: StubPipeline = {
    calls: record.calls,
    evidence,
    statuses,
    ingestEvidence: ingestOf(record, evidence),
    importFramework: importOf(record),
    recomputeFramework: recomputeOf(record, statuses),
    listValidationQueue: queueOf(record),
    decideValidation: decideOf(record, statuses),
    askQuestion: askOf(record),
    assemblePack: packOf(record),
    runReminders: remindersOf(record),
    weeklyDigest: digestOf(record)
  };
  return Object.assign(stub, overrides) as StubPipeline;
}
