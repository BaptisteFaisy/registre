/**
 * Reminders and the weekly digest — EF-REL-01 ("relancer le propriétaire 30
 * jours avant la péremption, en disant quelle preuve fournir"), EF-REL-02
 * ("relancer pour un contrôle sans preuve") and EF-REL-03 (weekly point for the
 * quality lead, chapter 8.3).
 *
 * The wording is not written here: `src/notify/reminderText.ts` and
 * `src/notify/digest.ts` own it, and `services.notifier` owns the transport.
 * This module decides *who* is reminded, *why*, and *once per control per day*
 * (the id is derived from control, reason and day, so a second run is a no-op).
 */

import type {
  Control,
  ControlStatus,
  FrameworkId,
  ReadinessSnapshot,
  ReadinessTrendPoint,
  Reminder,
  ReminderReason,
  Sufficiency
} from '../domain/types.ts';
import type { NotificationMessage, Services } from '../ports/index.ts';
import { reminderId } from '../support/ids.ts';
import { notFound } from '../support/errors.ts';
import { daysUntilExpiry } from '../domain/freshness.ts';
import { shareOf } from '../domain/readiness.ts';
import { reminderMessage, weeklyDigest as composeDigest } from '../notify/index.ts';
import { record } from '../audit/log.ts';
import { recomputeFramework } from './states.ts';

/** Digest recipient until the principal directory is wired at bootstrap — EF-REL-03. */
export const DEFAULT_DIGEST_RECIPIENT = 'quality.lead@msp.demo';

/** A control can raise at most these reasons; order fixes the daily id order — EF-REL-01/02. */
const REASONS: readonly ReminderReason[] = ['EXPIRING_SOON', 'NO_EVIDENCE', 'MISSING_ELEMENTS'] as const;

/** Outcome of one reminder run, with what was skipped as a duplicate — EF-REL-01. */
interface ReminderRun {
  created: Reminder[];
  skipped: number;
}

/**
 * Sends the reminders one framework needs today — EF-REL-01/02 (acceptance R6).
 * `frameworkId` omitted means every imported framework.
 */
export async function runReminders(services: Services, frameworkId?: FrameworkId): Promise<Reminder[]> {
  const frameworks = await targetFrameworks(services, frameworkId);
  const created: Reminder[] = [];
  for (const framework of frameworks) {
    const run = await remindFramework(services, framework);
    created.push(...run.created);
  }
  return created;
}

/** Frameworks to remind about: one when asked, all imported otherwise — EF-REL-02. */
async function targetFrameworks(services: Services, frameworkId?: FrameworkId): Promise<Array<{ id: FrameworkId; name: string }>> {
  if (frameworkId !== undefined) {
    const framework = await services.state.getFramework(frameworkId);
    return framework ? [{ id: framework.id, name: framework.name }] : [];
  }
  const frameworks = await services.state.listFrameworks();
  return frameworks.map((framework) => ({ id: framework.id, name: framework.name }));
}

/** Walks the controls of one framework and sends what is due — EF-REL-01/02. */
async function remindFramework(
  services: Services,
  framework: { id: FrameworkId; name: string }
): Promise<ReminderRun> {
  const { statuses } = await recomputeFramework(services, framework.id);
  const controls = new Map((await services.state.listControls(framework.id)).map((control) => [control.id, control]));
  const run: ReminderRun = { created: [], skipped: 0 };
  for (const status of statuses) {
    const control = controls.get(status.controlId);
    if (!control) continue;
    for (const reason of REASONS) {
      if (!isDue(services, status, reason)) continue;
      const reminder = await send(services, control, status, reason, framework.name);
      if (reminder) run.created.push(reminder);
      else run.skipped += 1;
    }
  }
  return run;
}

/** True when this control deserves this reminder today — EF-REL-01/02/03. */
function isDue(services: Services, status: ControlStatus, reason: ReminderReason): boolean {
  if (reason === 'NO_EVIDENCE') return status.state === 'NO_EVIDENCE';
  if (reason === 'EXPIRING_SOON') return expiresSoon(services, status);
  return status.sufficiencyClass === 'PARTIAL';
}

/** True when the best evidence expires inside the reminder lead time — EF-REL-01. */
function expiresSoon(services: Services, status: ControlStatus): boolean {
  if (status.expiresAt === null) return false;
  if (status.state !== 'TO_RENEW' && status.state !== 'TO_VERIFY') return false;
  const left = daysUntilExpiry(status.expiresAt, services.clock.now());
  return left >= 0 && left <= services.settings.reminderLeadDays;
}

/**
 * Sends one reminder, or returns null when today's was already sent — EF-REL-01.
 * The id is `reminderId(control, reason, day)`: one reminder per control, per
 * reason, per day (docs/API.md §15: a second one is a `CONFLICT`).
 */
async function send(
  services: Services,
  control: Control,
  status: ControlStatus,
  reason: ReminderReason,
  frameworkName: string
): Promise<Reminder | null> {
  const now = services.clock.now();
  const id = reminderId(control.id, reason, now.slice(0, 10));
  if (await services.state.getReminder(id)) return null;
  const missing = await missingFor(services, status);
  const message = reminderMessage({
    control,
    reason,
    recipient: control.owner,
    missing,
    expiresAt: status.expiresAt,
    frameworkName,
    evidenceType: await evidenceTypeOf(services, status),
    now
  });
  await services.notifier.send(message);
  const reminder = buildReminder(services, id, control, status, reason, missing, message, now);
  await services.state.putReminder(reminder);
  await record(services, 'pipeline', 'REMINDER_SENT', 'reminder', id, {
    controlId: control.id,
    reason,
    recipient: reminder.recipient,
    missing: missing.length
  });
  return reminder;
}

/** The persisted reminder, message and follow-up status included — EF-REL-01. */
function buildReminder(
  services: Services,
  id: string,
  control: Control,
  status: ControlStatus,
  reason: ReminderReason,
  missing: string[],
  message: NotificationMessage,
  now: string
): Reminder {
  return {
    id,
    controlId: control.id,
    frameworkId: control.frameworkId,
    recipient: control.owner,
    reason,
    missing,
    message: message.body,
    createdAt: now,
    expiresAt: status.expiresAt,
    status: 'SENT',
    channel: services.notifier.id
  };
}

/** What the owner must provide, echoed from the last sufficiency — EF-REL-01, R7. */
async function missingFor(services: Services, status: ControlStatus): Promise<string[]> {
  if (status.bestEvidenceId === null) return [];
  const sufficiencies = await services.state.listSufficiency({ controlId: status.controlId });
  const ofBest = sufficiencies.filter((item) => item.evidenceId === status.bestEvidenceId);
  return [...new Set(ofBest.flatMap((item: Sufficiency) => item.missing))];
}

/** Evidence type of the best evidence, for the reminder subject — EF-REL-01. */
async function evidenceTypeOf(services: Services, status: ControlStatus): Promise<string | null> {
  if (status.bestEvidenceId === null) return null;
  const evidence = await services.state.getEvidence(status.bestEvidenceId);
  return evidence?.fields.type ?? null;
}

/**
 * Composes the weekly point for the quality lead: readiness, what changed, what
 * is missing, what waits for validation — EF-REL-03 (chapter 8.3).
 */
export async function weeklyDigest(services: Services, frameworkId: FrameworkId): Promise<NotificationMessage> {
  const framework = await services.state.getFramework(frameworkId);
  if (!framework) throw notFound(`framework ${frameworkId} does not exist`);
  const { statuses, readiness } = await recomputeFramework(services, frameworkId);
  const history = await services.state.listTrend(frameworkId, 2);
  const previous = history.length > 1 ? history[history.length - 2] ?? null : null;
  return composeDigest({
    recipient: DEFAULT_DIGEST_RECIPIENT,
    framework,
    snapshot: readiness,
    previous: previous === null ? null : snapshotOf(previous),
    statuses,
    controls: await services.state.listControls(frameworkId),
    validations: await services.state.listValidations({ status: 'PENDING' }),
    reminders: await services.state.listReminders(),
    now: services.clock.now()
  });
}

/** Rebuilds a readiness snapshot from a stored history point — EF-FRA-03/04. */
function snapshotOf(point: ReadinessTrendPoint): ReadinessSnapshot {
  const total = Object.values(point.counts).reduce((sum, count) => sum + count, 0);
  const shares = { ...point.counts };
  for (const state of Object.keys(shares) as Array<keyof typeof shares>) {
    shares[state] = shareOf(point.counts[state], total);
  }
  return { frameworkId: point.frameworkId, computedAt: point.at, total, counts: point.counts, shares };
}
