/**
 * The API's view of the pipeline module (`src/pipeline/index.ts`).
 *
 * The API never re-implements a pipeline rule: it validates the transport,
 * checks the role, calls one pipeline function, and serialises the result.
 * This file is the single adaptation point, which is why the routes can be
 * read without knowing the pipeline's own shapes:
 *  - the pipeline takes an actor *id* (it journals a string), the API holds a
 *    `Principal`: the id is derived here, once;
 *  - a duplicate deposit comes back as `duplicateOf`, the API exposes
 *    `duplicate: boolean` (R8);
 *  - the pipeline returns the readiness point it just recorded, the API
 *    exposes the history as a list (EF-FRA-04).
 */

import * as pipeline from '../pipeline/index.ts';
import type {
  Answer,
  CollectorKind,
  ControlStatus,
  Evidence,
  FrameworkId,
  FrameworkImport,
  Pack,
  Principal,
  ReadinessSnapshot,
  ReadinessTrendPoint,
  Reminder,
  ValidationDecision,
  ValidationItem
} from '../domain/types.ts';
import type { ImportResult, NotificationMessage, Services } from '../ports/index.ts';

/** Everything the caller hands to `ingestEvidence` (EF-COL-02, EF-COL-05). */
export interface IngestRequest {
  bytes: Uint8Array;
  contentType: string;
  /** Logical origin of the bytes, e.g. `manual://restore-test.pdf`. */
  uri: string;
  kind: CollectorKind;
  fileName?: string;
  fileDate?: string;
  suggestedControlId?: string;
}

/** Result of one ingestion; `duplicate` drives 200 vs 201 (R8). */
export interface IngestOutcome {
  evidence: Evidence;
  duplicate: boolean;
}

/** States, readiness and history of one framework (EF-FRA-02..04). */
export interface FrameworkRecompute {
  statuses: ControlStatus[];
  readiness: ReadinessSnapshot;
  trend: ReadinessTrendPoint[];
}

/** A decision handed to the pipeline, author and note included (EF-VAL-02). */
export interface DecisionRequest {
  decision: ValidationDecision;
  by: string;
  note?: string;
}

/** The decided item plus the recomputed states (EF-VAL-01/02). */
export interface DecisionOutcome {
  item: ValidationItem;
  statuses: ControlStatus[];
}

/** The pipeline surface the API calls — the eight functions of the contract. */
export interface PipelineApi {
  ingestEvidence(services: Services, request: IngestRequest, actor: Principal): Promise<IngestOutcome>;
  importFramework(services: Services, input: FrameworkImport, actor: Principal): Promise<ImportResult>;
  recomputeFramework(services: Services, frameworkId: FrameworkId): Promise<FrameworkRecompute>;
  listValidationQueue(services: Services): Promise<ValidationItem[]>;
  decideValidation(services: Services, itemId: string, request: DecisionRequest): Promise<DecisionOutcome>;
  askQuestion(services: Services, principal: Principal, question: string): Promise<Answer>;
  assemblePack(services: Services, frameworkId: FrameworkId, actor: Principal): Promise<Pack>;
  runReminders(services: Services, frameworkId?: FrameworkId): Promise<Reminder[]>;
  weeklyDigest(services: Services, frameworkId: FrameworkId): Promise<NotificationMessage>;
}

/** Drops the `undefined` fields the pipeline types as optional-but-strict. */
function ingestInput(request: IngestRequest): pipeline.IngestInput {
  return {
    bytes: request.bytes,
    contentType: request.contentType,
    uri: request.uri,
    kind: request.kind,
    ...(request.fileName === undefined ? {} : { fileName: request.fileName }),
    ...(request.fileDate === undefined ? {} : { fileDate: request.fileDate }),
    ...(request.suggestedControlId === undefined ? {} : { suggestedControlId: request.suggestedControlId })
  };
}

/**
 * The real pipeline, bound once. Every route goes through this object, so the
 * API cannot drift from `src/pipeline/index.ts` without a type error here.
 */
export const defaultPipeline: PipelineApi = {
  async ingestEvidence(services, request, actor) {
    const result = await pipeline.ingestEvidence(services, ingestInput(request), actor.id);
    return { evidence: result.evidence, duplicate: result.duplicateOf !== null };
  },
  importFramework: (services, input, actor) => pipeline.importFramework(services, input, actor.id),
  async recomputeFramework(services, frameworkId) {
    const result = await pipeline.recomputeFramework(services, frameworkId);
    const history = await services.state.listTrend(frameworkId);
    return {
      statuses: result.statuses,
      readiness: result.readiness,
      trend: history.length === 0 ? [result.trend] : history
    };
  },
  listValidationQueue: (services) => pipeline.listValidationQueue(services),
  decideValidation: (services, itemId, request) =>
    pipeline.decideValidation(services, itemId, {
      decision: request.decision,
      by: request.by,
      ...(request.note === undefined ? {} : { note: request.note })
    }),
  askQuestion: (services, principal, question) => pipeline.askQuestion(services, principal, question),
  assemblePack: (services, frameworkId, actor) => pipeline.assemblePack(services, frameworkId, actor.id),
  runReminders: (services, frameworkId) => pipeline.runReminders(services, frameworkId),
  weeklyDigest: (services, frameworkId) => pipeline.weeklyDigest(services, frameworkId)
};
