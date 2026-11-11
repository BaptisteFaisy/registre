/**
 * State recomputation — EF-FRA-02 (chapter 12.3 matrix and 12.4 prudence rules),
 * EF-FRA-03 (readiness per framework) and EF-FRA-04 (history, for the trend).
 *
 * Everything numeric comes from `src/domain/states.ts` and
 * `src/domain/readiness.ts`: this module only loads the data, calls the engine,
 * persists the result and journals it (ENF-IA-04).
 */

import type {
  Attachment,
  Control,
  ControlStatus,
  Evidence,
  EvidenceId,
  FrameworkId,
  ReadinessSnapshot,
  ReadinessTrendPoint,
  Sufficiency
} from '../domain/types.ts';
import type { Services } from '../ports/index.ts';
import { evaluateControl } from '../domain/states.ts';
import { computeReadiness, computeTrendPoint } from '../domain/readiness.ts';
import { record } from '../audit/log.ts';

/** Actor recorded for a recomputation nobody triggered by hand — EF-ADM-02. */
export const PIPELINE_ACTOR = 'pipeline';

/** States, readiness and trend of one framework — EF-FRA-02..04. */
export interface FrameworkStates {
  statuses: ControlStatus[];
  readiness: ReadinessSnapshot;
  trend: ReadinessTrendPoint;
}

/** Everything the state engine reads about one control — EF-FRA-02. */
interface ControlContext {
  attachments: Attachment[];
  evidences: Map<string, Evidence>;
  sufficiencies: Map<string, Sufficiency>;
}

/** Loads the attachments, evidences and sufficiencies of one control — EF-FRA-02. */
async function contextOf(services: Services, control: Control): Promise<ControlContext> {
  const attachments = await services.state.listAttachments({ controlId: control.id });
  const evidences = new Map<string, Evidence>();
  const sufficiencies = new Map<string, Sufficiency>();
  for (const attachment of attachments) {
    if (!evidences.has(attachment.evidenceId)) {
      const evidence = await services.state.getEvidence(attachment.evidenceId);
      if (evidence) evidences.set(evidence.id, evidence);
    }
    const sufficiency = await services.state.getSufficiencyForAttachment(attachment.id);
    if (sufficiency) sufficiencies.set(attachment.id, sufficiency);
  }
  return { attachments, evidences, sufficiencies };
}

/**
 * Evaluates one control, applying the "first human validation per evidence
 * type" rule of chapter 12.4 — EF-FRA-02, EF-SUF-03.
 *
 * Two passes: the first one with the rule disabled finds the best evidence and
 * therefore the evidence type to look up; the second one applies the real
 * verdict. The ranking logic stays in the domain engine, never duplicated here.
 */
async function evaluateOne(
  services: Services,
  control: Control,
  now: string,
  leadDays: number
): Promise<ControlStatus> {
  const context = await contextOf(services, control);
  const draft = evaluateControl({ control, ...context, isTypeValidated: true, now, leadDays });
  const type = evidenceTypeOf(draft.bestEvidenceId, context.evidences);
  const validated = type !== null && (await services.state.isTypeValidated(control.id, type));
  if (validated) return draft;
  return evaluateControl({ control, ...context, isTypeValidated: false, now, leadDays });
}

/** Evidence type of the best evidence, `null` when unknown — EF-SUF-03. */
function evidenceTypeOf(bestEvidenceId: EvidenceId | null, evidences: Map<string, Evidence>): string | null {
  if (bestEvidenceId === null) return null;
  return evidences.get(bestEvidenceId)?.fields.type ?? null;
}

/**
 * Recomputes every control of one framework, persists the states, appends a
 * readiness point and journals the run — EF-FRA-02/03/04 (R5, R6).
 */
export async function recomputeFramework(
  services: Services,
  frameworkId: FrameworkId
): Promise<FrameworkStates> {
  const controls = await services.state.listControls(frameworkId);
  const now = services.clock.now();
  const leadDays = services.settings.reminderLeadDays;
  const statuses: ControlStatus[] = [];
  for (const control of controls) {
    const status = await evaluateOne(services, control, now, leadDays);
    await services.state.putStatus(status);
    statuses.push(status);
  }
  const readiness = computeReadiness(frameworkId, statuses, now);
  const trend = computeTrendPoint(frameworkId, statuses, now);
  await appendTrendIfChanged(services, trend);
  await record(services, PIPELINE_ACTOR, 'STATE_RECOMPUTED', 'framework', frameworkId, {
    controls: statuses.length,
    counts: readiness.counts
  });
  return { statuses, readiness, trend };
}

/**
 * Appends a readiness point only when something moved, so reading the state ten
 * times in a row does not fake a ten-step history — EF-FRA-04.
 */
async function appendTrendIfChanged(services: Services, point: ReadinessTrendPoint): Promise<void> {
  const history = await services.state.listTrend(point.frameworkId, 1);
  const last = history[history.length - 1];
  if (last && last.at === point.at && sameCounts(last, point)) return;
  await services.state.appendTrend(point);
}

/** True when two readiness points carry the same counts — EF-FRA-04. */
function sameCounts(left: ReadinessTrendPoint, right: ReadinessTrendPoint): boolean {
  return (Object.keys(right.counts) as Array<keyof typeof right.counts>).every(
    (state) => left.counts[state] === right.counts[state]
  );
}

/** Recomputes several frameworks, returning every state — EF-FRA-02. */
export async function recomputeFrameworks(
  services: Services,
  frameworkIds: readonly FrameworkId[]
): Promise<ControlStatus[]> {
  const statuses: ControlStatus[] = [];
  for (const frameworkId of [...new Set(frameworkIds)]) {
    const result = await recomputeFramework(services, frameworkId);
    statuses.push(...result.statuses);
  }
  return statuses;
}

/**
 * Recomputes the frameworks an evidence is attached to, after an ingestion or a
 * decision — EF-FRA-02 (spec 11.4: "l'état des contrôles concernés est recalculé").
 */
export async function recomputeAfterIngest(
  services: Services,
  evidenceId: EvidenceId
): Promise<ControlStatus[]> {
  const attachments = await services.state.listAttachments({ evidenceId });
  return recomputeFrameworks(
    services,
    attachments.map((attachment) => attachment.frameworkId)
  );
}
