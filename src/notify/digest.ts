/**
 * Weekly digest for the quality lead — EF-REL-03: "weekly point to the quality
 * and compliance lead" (chapter 8.3: what changed, what is missing, what waits
 * for their validation).
 *
 * Everything numeric comes from `ReadinessSnapshot`, computed by the engine
 * (ENF-IA-04); this module only formats. Wording follows the vocabulary guard:
 * the digest reports states and gaps, it never judges a control.
 */

import type {
  Control,
  ControlId,
  ControlState,
  ControlStatus,
  Framework,
  ReadinessSnapshot,
  Reminder,
  ValidationItem
} from '../domain/types.ts';
import { CONTROL_STATES } from '../domain/types.ts';
import type { NotificationMessage } from '../ports/index.ts';

export interface WeeklyDigestInput {
  recipient: string;
  framework: Pick<Framework, 'id' | 'name' | 'version'>;
  /** Current readiness, computed by the state engine. */
  snapshot: ReadinessSnapshot;
  /** Previous readiness point, to show what changed. */
  previous?: ReadinessSnapshot | null;
  statuses: readonly ControlStatus[];
  controls: readonly Control[];
  /** Validation queue: what waits for the quality lead (EF-VAL-01). */
  validations: readonly ValidationItem[];
  reminders?: readonly Reminder[];
  now: string;
  /** Maximum number of controls listed per section. */
  maxItems?: number;
}

/** States ordered from the most urgent to the least, for the gap section. */
const ATTENTION_ORDER: readonly ControlState[] = [
  'NO_EVIDENCE',
  'EXPIRED',
  'TO_RENEW',
  'TO_VERIFY',
  'COVERED'
] as const;

/** Subject of the weekly digest. */
export function digestSubject(input: WeeklyDigestInput): string {
  return `Weekly readiness digest — ${input.framework.name} (${input.now.slice(0, 10)})`;
}

/** One `STATE: n (x %)` line per state of the snapshot. */
export function readinessLines(snapshot: ReadinessSnapshot): string[] {
  return CONTROL_STATES.map(
    (state) => `  - ${state}: ${snapshot.counts[state]} (${share(snapshot.shares[state])})`
  );
}

/** Difference per state against the previous point, most significant first. */
export function changeLines(current: ReadinessSnapshot, previous: ReadinessSnapshot | null | undefined): string[] {
  if (previous === null || previous === undefined) return ['  - no earlier point to compare with'];
  const lines: string[] = [];
  for (const state of CONTROL_STATES) {
    const delta = current.counts[state] - previous.counts[state];
    if (delta !== 0) lines.push(`  - ${state}: ${delta > 0 ? '+' : ''}${delta}`);
  }
  return lines.length > 0 ? lines : ['  - no change since the last point'];
}

/** Controls that are not covered, most urgent state first (EF-FRA-03). */
export function gapLines(input: WeeklyDigestInput): string[] {
  const limit = input.maxItems ?? 10;
  const byId = new Map<ControlId, Control>(input.controls.map((control) => [control.id, control]));
  const ranked = [...input.statuses]
    .filter((status) => status.state !== 'COVERED')
    .sort(
      (a, b) =>
        ATTENTION_ORDER.indexOf(a.state) - ATTENTION_ORDER.indexOf(b.state) ||
        a.controlId.localeCompare(b.controlId)
    );
  const lines = ranked.slice(0, limit).map((status) => {
    const control = byId.get(status.controlId);
    const owner = control === undefined ? 'owner unknown' : control.owner;
    const expiry = status.expiresAt === null ? 'no expiry date' : `expires ${status.expiresAt.slice(0, 10)}`;
    return `  - [${status.state}] ${status.controlId} — ${control?.title ?? 'untitled'} (${owner}, ${expiry})`;
  });
  if (ranked.length > limit) lines.push(`  - … and ${ranked.length - limit} more control(s)`);
  return lines.length > 0 ? lines : ['  - every control has a current evidence'];
}

/** Pending validation items, grouped by kind (EF-VAL-01). */
export function validationLines(input: WeeklyDigestInput): string[] {
  const limit = input.maxItems ?? 10;
  const pending = input.validations.filter((item) => item.status === 'PENDING');
  if (pending.length === 0) return ['  - nothing waiting'];
  const counts = new Map<string, number>();
  for (const item of pending) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const lines = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([kind, count]) => `  - ${kind}: ${count}`);
  for (const item of pending.slice(0, limit)) {
    const target = item.controlId ?? item.evidenceId ?? item.attachmentId ?? item.id;
    lines.push(`    · ${item.kind} on ${target} — ${item.reason}`);
  }
  return lines;
}

/** Full plain-text body of the weekly digest. */
export function digestBody(input: WeeklyDigestInput): string {
  const lines: string[] = [];
  lines.push(`Framework: ${input.framework.name} (${input.framework.id}, version ${input.framework.version})`);
  lines.push(`Controls: ${input.snapshot.total}`);
  lines.push('');
  lines.push('Readiness:');
  lines.push(...readinessLines(input.snapshot));
  lines.push('');
  lines.push('What changed since the last point:');
  lines.push(...changeLines(input.snapshot, input.previous));
  lines.push('');
  lines.push('What is missing:');
  lines.push(...gapLines(input));
  lines.push('');
  lines.push('Waiting for your validation:');
  lines.push(...validationLines(input));
  const sent = input.reminders?.length ?? 0;
  if (sent > 0) {
    lines.push('');
    lines.push(`Reminders sent this week: ${sent}`);
  }
  lines.push('');
  lines.push(`Generated on ${input.now} by Registre.`);
  return `${lines.join('\n')}\n`;
}

/** Ready-to-send weekly digest for the notifier port (EF-REL-03). */
export function weeklyDigest(input: WeeklyDigestInput): NotificationMessage {
  return {
    to: input.recipient,
    subject: digestSubject(input),
    body: digestBody(input),
    kind: 'WEEKLY_DIGEST'
  };
}

/** `0.4286` → `42.9 %`, keeping one decimal so the share reads like a report. */
function share(value: number): string {
  return `${(Math.round(value * 1000) / 10).toFixed(1)} %`;
}
