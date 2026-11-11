/**
 * `reminders` handler — the scheduled notification tasks (EF-REL-01..03).
 *
 * The schedule says what to do, through `action`:
 *   `reminders` (default) — remind the owners of what is due today;
 *   `digest`              — compose the weekly point for the quality lead;
 *   `all`                 — the reminders first, then the digest.
 *
 * The wording belongs to `src/notify`, the transport to `services.notifier`;
 * this adapter only decides which of them runs, and never invents a send.
 */

import { runReminders, weeklyDigest } from '../pipeline/index.ts';
import { badRequest } from '../support/errors.ts';
import { defineHandler, lambdaServices, optionalString, type StepOutcome } from './shared.ts';

/** Actions this handler accepts. */
const ACTIONS = ['reminders', 'digest', 'all'] as const;
type ReminderAction = (typeof ACTIONS)[number];

/** Reads the requested action; an unknown one is a 400, never a silent no-op. */
function actionOf(raw: Record<string, unknown>): ReminderAction {
  const action = optionalString(raw, 'action') ?? 'reminders';
  if (!(ACTIONS as readonly string[]).includes(action)) {
    throw badRequest(`"action" must be one of ${ACTIONS.join(', ')}`, { action });
  }
  return action as ReminderAction;
}

/** Sends the reminders due today — EF-REL-01/02. */
async function remind(raw: Record<string, unknown>): Promise<{ sent: number; reminders: unknown[] }> {
  const services = await lambdaServices();
  const created = await runReminders(services, optionalString(raw, 'frameworkId'));
  return { sent: created.length, reminders: created };
}

/** Composes the weekly digest of one framework — EF-REL-03. */
async function digest(raw: Record<string, unknown>): Promise<{ to: string; subject: string }> {
  const services = await lambdaServices();
  const frameworkId = optionalString(raw, 'frameworkId');
  if (frameworkId === undefined) throw badRequest('"frameworkId" is required for the weekly digest');
  const message = await weeklyDigest(services, frameworkId);
  return { to: message.to, subject: message.subject };
}

export const handler = defineHandler(async (raw) => {
  const action = actionOf(raw);
  const output: Record<string, unknown> = { action };
  if (action === 'reminders' || action === 'all') output.reminders = await remind(raw);
  if (action === 'digest' || action === 'all') output.digest = await digest(raw);
  const outcome: StepOutcome = {
    output,
    payload: { action, frameworkId: optionalString(raw, 'frameworkId') ?? null }
  };
  return outcome;
});
