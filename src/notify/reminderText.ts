/**
 * Reminder text — EF-REL-01 ("remind the owner 30 days before expiry, saying
 * which evidence to provide") and EF-REL-02 ("remind for a control with no
 * evidence").
 *
 * The body always answers three questions for the owner: why they are being
 * written to, which evidence to provide, and what was missing from the last
 * document. Wording follows the vocabulary guard: the tool reports a state, it
 * never judges.
 */

import type { Control, ReminderReason } from '../domain/types.ts';
import type { NotificationMessage } from '../ports/index.ts';

export interface ReminderTextInput {
  control: Pick<Control, 'id' | 'title' | 'expectedEvidence' | 'periodicity'>;
  reason: ReminderReason;
  /** Email of the control owner. */
  recipient: string;
  /** Elements absent from the last document, echoed from `Sufficiency.missing`. */
  missing?: readonly string[];
  /** Expiry of the current evidence, for `EXPIRING_SOON`. */
  expiresAt?: string | null;
  /** Name of the framework, for the subject line. */
  frameworkName?: string;
  /** Evidence type expected (POLICY, REPORT…), when the reader knows it. */
  evidenceType?: string | null;
  /** Instant of the reminder, ISO-8601. */
  now?: string;
}

/** First line of the reminder, always naming the control. */
export function reminderSubject(input: ReminderTextInput): string {
  const prefix = input.reason === 'EXPIRING_SOON' ? 'Evidence to renew' : 'Evidence required';
  return `${prefix}: ${input.control.id} — ${input.control.title}`;
}

/** Why this owner is being written to, in one sentence. */
export function reasonSentence(input: ReminderTextInput): string {
  switch (input.reason) {
    case 'EXPIRING_SOON':
      return `The evidence covering this control expires on ${input.expiresAt ?? 'an unspecified date'}.`;
    case 'NO_EVIDENCE':
      return 'No evidence has been recorded for this control yet.';
    case 'MISSING_ELEMENTS':
      return 'The last document provided does not contain everything this control expects.';
    default:
      return 'This control needs an updated document.';
  }
}

/** What the owner must provide, taken from the control's expected evidence. */
export function evidenceToProvide(input: ReminderTextInput): string[] {
  const expected = input.control.expectedEvidence;
  if (expected.length > 0) return [...expected];
  return ['A document that supports this control for the current period'];
}

/** Full body of the reminder, in plain text. */
export function reminderBody(input: ReminderTextInput): string {
  const lines: string[] = [];
  lines.push(`Control: ${input.control.id} — ${input.control.title}`);
  if (input.frameworkName !== undefined) lines.push(`Framework: ${input.frameworkName}`);
  lines.push(`Renewal period: ${input.control.periodicity}`);
  lines.push('');
  lines.push(reasonSentence(input));
  lines.push('');
  lines.push(`Evidence to provide${input.evidenceType ? ` (${input.evidenceType})` : ''}:`);
  for (const element of evidenceToProvide(input)) lines.push(`  - ${element}`);
  const missing = input.missing ?? [];
  if (missing.length > 0) {
    lines.push('');
    lines.push('Still missing from the last document:');
    for (const element of missing) lines.push(`  - ${element}`);
  }
  lines.push('');
  lines.push('Please reply with the document attached, or upload it to the portal.');
  if (input.now !== undefined) lines.push(`Reminder issued on ${input.now}.`);
  return `${lines.join('\n')}\n`;
}

/** Ready-to-send notification for the notifier port (EF-REL-01/02). */
export function reminderMessage(input: ReminderTextInput): NotificationMessage {
  return {
    to: input.recipient,
    subject: reminderSubject(input),
    body: reminderBody(input),
    kind: 'REMINDER',
    controlId: input.control.id
  };
}
