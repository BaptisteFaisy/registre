/**
 * Drift detection on machine attestations (axis 3a).
 *
 * A collector produces a dated statement about a real state — last night's
 * backups, this month's access review. Two things matter and both are computed
 * by code (ENF-IA-04):
 *
 *   - the statement CHANGED (`STATE_CHANGED`), or came back to a known value
 *     after a change (`RECOVERED`), or names a failure (`THRESHOLD_CROSSED`);
 *   - the expected run DID NOT ARRIVE within its cadence plus grace
 *     (`MISSING_RUN`).
 *
 * A drift moves the control the same day instead of at the next audit, and the
 * owner is told what changed, not just that something did.
 */

import type { Control, Evidence } from '../domain/types.ts';
import type { DriftEvent, DriftKind, RefreshPolicy } from '../domain/quality.ts';
import { DEFAULT_REFRESH_POLICY, cadencePeriodicity, driftId } from '../domain/quality.ts';
import { provenanceOf } from '../domain/verification.ts';
import type { Services } from '../ports/index.ts';
import { addDuration, daysBetween, isBefore } from '../support/iso8601.ts';
import { notFound } from '../support/errors.ts';
import { record } from '../audit/log.ts';

/** Words that make an attested state read as a failure. */
const FAILURE_WORDS = ['failed', 'failure', 'fail', 'error', 'ko', 'not ok', 'missing', 'unsuccessful'];

export interface ObserveInput {
  controlId: string;
  evidenceId: string;
  attestedState: string;
  actor: string;
  policy?: RefreshPolicy;
}

export interface DriftSummary {
  frameworkId: string;
  computedAt: string;
  counts: Record<DriftKind, number>;
  unacknowledged: number;
  recent: DriftEvent[];
}

/** True when an attested state reads as a failure. */
export function isFailureState(state: string | null | undefined): boolean {
  if (state === null || state === undefined) return false;
  const lower = ` ${state.toLowerCase()} `;
  return FAILURE_WORDS.some((word) => lower.includes(` ${word} `) || lower.includes(`${word}:`));
}

/** Attestations of one control, newest first. */
export async function attestationsOf(services: Services, controlId: string): Promise<Evidence[]> {
  const attachments = await services.state.listAttachments({ controlId, status: 'APPLIED' });
  const found: Evidence[] = [];
  for (const attachment of attachments) {
    const evidence = await services.state.getEvidence(attachment.evidenceId);
    if (evidence === null) continue;
    if (provenanceOf(evidence.provenance) !== 'MACHINE_ATTESTATION') continue;
    found.push(evidence);
  }
  return found.sort((left, right) => right.ingestedAt.localeCompare(left.ingestedAt));
}

/** Compares one new attestation with the previous ones and records any drift. */
export async function observeAttestation(services: Services, input: ObserveInput): Promise<DriftEvent[]> {
  const control = await services.state.getControl(input.controlId);
  if (control === null) throw notFound(`control ${input.controlId} does not exist`);
  const history = (await attestationsOf(services, input.controlId)).filter(
    (evidence) => evidence.id !== input.evidenceId
  );
  const kinds = classify(input.attestedState, history.map((item) => item.attestedState ?? null));
  const events: DriftEvent[] = [];
  for (const kind of kinds) {
    const event = await persist(
      services,
      control,
      kind,
      input.evidenceId,
      history[0]?.attestedState ?? null,
      input.attestedState,
      input.actor
    );
    if (event !== null) events.push(event);
  }
  return events;
}

/** Which drift kinds one observation warrants, in reporting order. */
export function classify(current: string, previous: readonly (string | null)[]): DriftKind[] {
  const out: DriftKind[] = [];
  if (isFailureState(current)) out.push('THRESHOLD_CROSSED');
  const last = previous[0] ?? null;
  if (last !== null && last !== current) {
    const before = previous[1] ?? null;
    out.push(before !== null && before === current ? 'RECOVERED' : 'STATE_CHANGED');
  }
  return out;
}

/** Stores one drift, journals it and asks for a reminder. Returns null if known. */
async function persist(
  services: Services,
  control: Control,
  kind: DriftKind,
  evidenceId: string,
  previous: string | null,
  current: string | null,
  actor: string
): Promise<DriftEvent | null> {
  const now = services.clock.now();
  const id = driftId(control.id, kind, now.slice(0, 10));
  if ((await services.extensions.listDrifts({ controlId: control.id })).some((item) => item.id === id)) {
    return null;
  }
  const detail = describe(kind, previous, current);
  const event: DriftEvent = {
    id,
    controlId: control.id,
    frameworkId: control.frameworkId,
    evidenceId,
    detectedAt: now,
    kind,
    previous,
    current,
    detail,
    reminderId: null,
    acknowledgedAt: null,
    acknowledgedBy: null
  };
  await services.extensions.putDrift(event);
  await record(services, actor, 'DRIFT_DETECTED', 'drift', id, {
    controlId: control.id,
    kind,
    previous,
    current
  });
  await services.notifier.send({
    to: control.owner,
    subject: `Drift on ${control.id}: ${kind.replace(/_/g, ' ').toLowerCase()}`,
    body: `${detail}\nControl: ${control.title}\nFramework: ${control.frameworkId}`,
    kind: 'REMINDER',
    controlId: control.id
  });
  return event;
}

/** One human-readable line per drift kind. */
export function describe(kind: DriftKind, previous: string | null, current: string | null): string {
  switch (kind) {
    case 'STATE_CHANGED':
      return `The attested state changed from "${previous ?? 'unknown'}" to "${current ?? 'unknown'}".`;
    case 'RECOVERED':
      return `The attested state is back to "${current ?? 'unknown'}" after a change.`;
    case 'THRESHOLD_CROSSED':
      return `The attested state reports a failure: "${current ?? 'unknown'}".`;
    case 'MISSING_RUN':
      return `No attestation arrived within the expected cadence (last: ${previous ?? 'never'}).`;
    default:
      return 'Unrecognised drift.';
  }
}

/** Controls whose latest attestation is older than cadence plus grace. */
export async function missingRuns(
  services: Services,
  frameworkId: string,
  policy: RefreshPolicy = DEFAULT_REFRESH_POLICY
): Promise<DriftEvent[]> {
  const now = services.clock.now();
  const controls = await services.state.listControls(frameworkId);
  const out: DriftEvent[] = [];
  for (const control of controls) {
    const history = await attestationsOf(services, control.id);
    if (history.length === 0) continue;
    const due = addDuration(history[0]!.ingestedAt, cadencePeriodicity(policy));
    const deadline = addDuration(due, `PT${policy.graceHours}H`);
    // Still inside cadence plus grace: nothing to report yet.
    if (isBefore(now, deadline)) continue;
    const id = driftId(control.id, 'MISSING_RUN', now.slice(0, 10));
    const known = (await services.extensions.listDrifts({ controlId: control.id })).some((item) => item.id === id);
    if (known) continue;
    const event: DriftEvent = {
      id,
      controlId: control.id,
      frameworkId,
      evidenceId: history[0]!.id,
      detectedAt: now,
      kind: 'MISSING_RUN',
      previous: history[0]!.attestedState ?? null,
      current: null,
      detail: describe('MISSING_RUN', history[0]!.ingestedAt.slice(0, 10), null),
      reminderId: null,
      acknowledgedAt: null,
      acknowledgedBy: null
    };
    await services.extensions.putDrift(event);
    await record(services, 'drift-watch', 'DRIFT_DETECTED', 'drift', id, { controlId: control.id, kind: 'MISSING_RUN' });
    out.push(event);
  }
  return out;
}

/** Marks a drift as seen; keeps author and instant. */
export async function acknowledgeDrift(services: Services, id: string, by: string): Promise<DriftEvent | null> {
  const at = services.clock.now();
  const updated = await services.extensions.acknowledgeDrift(id, by, at);
  if (updated === null) return null;
  await record(services, by, 'DRIFT_ACKNOWLEDGED', 'drift', id, { controlId: updated.controlId });
  return updated;
}

/** Counts and the most recent drifts of one framework. */
export async function driftSummary(services: Services, frameworkId: string, limit = 10): Promise<DriftSummary> {
  const all = await services.extensions.listDrifts({ frameworkId, limit: 500 });
  const counts: Record<DriftKind, number> = {
    STATE_CHANGED: 0,
    MISSING_RUN: 0,
    THRESHOLD_CROSSED: 0,
    RECOVERED: 0
  };
  for (const event of all) counts[event.kind] += 1;
  return {
    frameworkId,
    computedAt: services.clock.now(),
    counts,
    unacknowledged: all.filter((event) => event.acknowledgedAt === null).length,
    recent: all.slice(0, limit)
  };
}

/** Days since an attestation was collected, for the dashboard. */
export function ageInDays(evidence: Evidence, now: string): number {
  return Math.max(0, daysBetween(evidence.ingestedAt, now));
}
