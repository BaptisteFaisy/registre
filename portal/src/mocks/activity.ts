/**
 * Mock activity: the validation queue, the reminders already sent, the frozen
 * audit pack and the audit trail (EF-VAL-01, EF-REL-01, EF-DOS-01, EF-ADM-02).
 */

import type {
  AuditAction,
  AuditEvent,
  KnownGap,
  Pack,
  PackIndexEntry,
  Reminder,
  ValidationItem
} from '../api/types.ts';
import type { MockDb } from './dataset.ts';
import { hexDigest } from './deterministic.ts';
import { NO_EVIDENCE_ANSWER } from '../api/types.ts';
import { noteLabel } from '../lib/notes.ts';

/** Attachment of a given evidence to a given control, if any. */
function attachmentIdFor(db: MockDb, evidenceId: string, controlId: string): string | undefined {
  return db.attachments.find(
    (item) => item.evidenceId === evidenceId && item.controlId === controlId
  )?.id;
}

/** The four items waiting in the validation queue (EF-VAL-01). */
export function buildValidations(db: MockDb): ValidationItem[] {
  const misfiled = attachmentIdFor(db, 'ev-032', 'INC-05');
  const review = attachmentIdFor(db, 'ev-012', 'INC-04');
  const partial = attachmentIdFor(db, 'ev-022', 'BCP-03');
  const items: ValidationItem[] = [
    {
      id: 'va-004',
      kind: 'UNREADABLE_EVIDENCE',
      evidenceId: 'ev-034',
      controlId: 'INC-02',
      reason: 'The screenshot is unreadable and carries no author: the date must be confirmed by hand.',
      createdAt: '2026-11-04T08:41:00.000Z',
      status: 'PENDING'
    },
    {
      id: 'va-003',
      kind: 'SUFFICIENCY',
      evidenceId: 'ev-022',
      controlId: 'BCP-03',
      reason: 'The rehearsal minute does not state the measured recovery time.',
      createdAt: '2026-11-03T09:12:00.000Z',
      status: 'PENDING'
    },
    {
      id: 'va-002',
      kind: 'ATTACHMENT',
      evidenceId: 'ev-012',
      controlId: 'INC-04',
      reason: 'Confidence 74 % is below the review threshold of 85 %: confirm the target control.',
      createdAt: '2026-10-02T07:31:00.000Z',
      status: 'PENDING'
    },
    {
      id: 'va-001',
      kind: 'ATTACHMENT',
      evidenceId: 'ev-032',
      controlId: 'INC-05',
      reason: 'The emergency change register was filed with the incident exports: it probably supports CHG-03 instead.',
      createdAt: '2026-10-01T07:22:00.000Z',
      status: 'PENDING'
    }
  ];
  if (misfiled) items[3] = { ...items[3]!, attachmentId: misfiled };
  if (review) items[2] = { ...items[2]!, attachmentId: review };
  if (partial) items[1] = { ...items[1]!, attachmentId: partial };
  return [...items, ...DECIDED_ITEMS];
}

/** Items already decided, so the trail of authors and reasons is visible. */
const DECIDED_ITEMS: ValidationItem[] = [
  {
    id: 'va-000',
    kind: 'ATTACHMENT',
    evidenceId: 'ev-018',
    controlId: 'CHG-05',
    reason: 'Confidence 71 % is below the review threshold: confirm the target control.',
    createdAt: '2026-10-06T07:15:00.000Z',
    status: 'DECIDED',
    decision: 'CORRECT',
    decidedBy: 'Amina Diallo',
    decidedAt: '2026-10-08T09:10:00.000Z',
    note: 'Quote verified in the release notes; the missing test report is requested from the change manager.'
  },
  {
    id: 'va-005',
    kind: 'UNREADABLE_EVIDENCE',
    evidenceId: 'ev-017',
    controlId: 'CHG-04',
    reason: 'The scanned baseline carries a print date that differs from the file date.',
    createdAt: '2026-10-28T08:00:00.000Z',
    status: 'DECIDED',
    decision: 'ACCEPT',
    decidedBy: 'Amina Diallo',
    decidedAt: '2026-10-29T10:45:00.000Z',
    note: 'The date was confirmed against the change calendar; the baseline stays attached with the "date to confirm" flag.'
  }
];

/** Reminders already sent to control owners (EF-REL-01, EF-REL-02). */
export function buildReminders(db: MockDb): Reminder[] {
  const bcp02 = db.controls.find((item) => item.id === 'BCP-02');
  const chg03 = db.controls.find((item) => item.id === 'CHG-03');
  const reminders: Reminder[] = [];
  if (bcp02) {
    reminders.push({
      id: 'rm-002',
      controlId: 'BCP-02',
      frameworkId: bcp02.frameworkId,
      recipient: bcp02.owner,
      reason: 'EXPIRING_SOON',
      missing: ['measured recovery time'],
      message:
        'The quarterly backup restore test has no issue for this quarter. Please provide the test report with the date, the restored system, the measured recovery time, the result and the signatory.',
      createdAt: '2026-11-02T06:00:00.000Z',
      expiresAt: '2026-05-10T00:00:00.000Z',
      status: 'SENT',
      channel: 'email'
    });
  }
  if (chg03) {
    reminders.push({
      id: 'rm-001',
      controlId: 'CHG-03',
      frameworkId: chg03.frameworkId,
      recipient: chg03.owner,
      reason: 'NO_EVIDENCE',
      missing: ['change identifiers', 'approval timestamps', 'post-implementation review', 'period covered'],
      message:
        'No evidence is applied to the emergency change register. Please export the register for the last quarter.',
      createdAt: '2026-10-28T06:00:00.000Z',
      expiresAt: null,
      status: 'ACKNOWLEDGED',
      channel: 'email'
    });
  }
  return reminders;
}

/** Index entry of one control inside the audit pack. */
function indexEntry(db: MockDb, controlId: string): PackIndexEntry {
  const control = db.controls.find((item) => item.id === controlId);
  const status = db.statuses.find((item) => item.controlId === controlId);
  const attachments = db.attachments.filter(
    (item) => item.controlId === controlId && item.status === 'APPLIED'
  );
  return {
    controlId,
    controlTitle: control?.title ?? controlId,
    state: status?.state ?? 'NO_EVIDENCE',
    evidence: attachments.map((attachment) => {
      const evidence = db.evidence.find((item) => item.id === attachment.evidenceId);
      const sufficiency = db.sufficiencies.find((item) => item.attachmentId === attachment.id);
      return {
        evidenceId: attachment.evidenceId,
        title: evidence?.fields.title ?? null,
        documentDate: evidence?.fields.documentDate ?? null,
        sha256: evidence?.sha256 ?? '',
        sufficiencyClass: sufficiency?.class ?? null,
        quote: attachment.quote,
        page: attachment.quoteLocation.page
      };
    })
  };
}

/** Known gaps listed in the pack so no reader over-reads the register. */
function knownGaps(db: MockDb): KnownGap[] {
  return db.statuses
    .filter((status) => status.state !== 'COVERED')
    .map((status) => {
      const control = db.controls.find((item) => item.id === status.controlId);
      return {
        controlId: status.controlId,
        state: status.state,
        detail: `${control?.title ?? status.controlId}: ${describeNotes(status.notes)}`
      };
    });
}

/** Human summary of the machine-readable state notes. */
export function describeNotes(notes: readonly string[]): string {
  if (notes.length === 0) return 'no note recorded.';
  return notes.map((note) => noteLabel(note).replace(/\.$/, '')).join(' ') + '.';
}

/** Assembles the frozen audit pack of the framework (EF-DOS-01, EF-DOS-02). */
export function buildPack(db: MockDb, id = 'pk-001', frozenAt = '2026-10-01T18:00:00.000Z'): Pack {
  const index = db.controls.map((control) => indexEntry(db, control.id));
  const archiveSha = hexDigest(`pack-${id}`);
  return {
    id,
    frameworkId: db.framework.id,
    frozenAt,
    index,
    knownGaps: knownGaps(db),
    archive: {
      uri: `s3://northwind-evidence-vault/packs/${id}.zip`,
      sha256: archiveSha,
      sizeBytes: 24_812_544
    },
    checksumsVerified: true
  };
}

interface AuditRow {
  at: string;
  actor: string;
  action: AuditAction;
  objectType: string;
  objectId: string;
  detail: Record<string, unknown>;
}

const AUDIT_ROWS: AuditRow[] = [
  { at: '2026-01-08T10:00:00.000Z', actor: 'Amina Diallo', action: 'FRAMEWORK_IMPORTED', objectType: 'framework', objectId: 'fw-msp-demo', detail: { controls: 30, version: '2026.1' } },
  { at: '2026-02-10T06:15:00.000Z', actor: 'collector-s3', action: 'EVIDENCE_COLLECTED', objectType: 'evidence', objectId: 'ev-001', detail: { source: 's3', bytes: 412_000 } },
  { at: '2026-02-10T07:20:00.000Z', actor: 'pipeline', action: 'EVIDENCE_READ', objectType: 'evidence', objectId: 'ev-001', detail: { reader: 'bedrock-data-automation', fields: 11 } },
  { at: '2026-02-10T07:21:00.000Z', actor: 'pipeline', action: 'ATTACHMENT_APPLIED', objectType: 'attachment', objectId: 'at-001', detail: { controlId: 'GV-01', confidence: 0.93 } },
  { at: '2026-06-15T08:05:00.000Z', actor: 'Sofia Novak', action: 'EVIDENCE_COLLECTED', objectType: 'evidence', objectId: 'ev-025', detail: { source: 'manual' } },
  { at: '2026-06-15T14:41:00.000Z', actor: 'collector-s3', action: 'EVIDENCE_DUPLICATE', objectType: 'evidence', objectId: 'ev-033', detail: { duplicateOf: 'ev-025', revision: 2 } },
  { at: '2026-09-18T09:30:00.000Z', actor: 'pipeline', action: 'ATTACHMENT_PROPOSED', objectType: 'attachment', objectId: 'at-012', detail: { controlId: 'INC-04', confidence: 0.74 } },
  { at: '2026-09-30T07:22:00.000Z', actor: 'pipeline', action: 'ATTACHMENT_PROPOSED', objectType: 'attachment', objectId: 'at-032', detail: { controlId: 'INC-05', confidence: 0.58 } },
  { at: '2026-10-01T07:22:00.000Z', actor: 'pipeline', action: 'STATE_RECOMPUTED', objectType: 'framework', objectId: 'fw-msp-demo', detail: { controls: 30, changed: 4 } },
  { at: '2026-10-01T18:00:00.000Z', actor: 'Amina Diallo', action: 'PACK_ASSEMBLED', objectType: 'pack', objectId: 'pk-001', detail: { controls: 30, knownGaps: 12 } },
  { at: '2026-10-02T07:31:00.000Z', actor: 'pipeline', action: 'ATTACHMENT_PROPOSED', objectType: 'attachment', objectId: 'at-012', detail: { controlId: 'INC-04', confidence: 0.74, reason: 'below-threshold' } },
  { at: '2026-10-05T09:10:00.000Z', actor: 'Amina Diallo', action: 'VALIDATION_DECIDED', objectType: 'validation', objectId: 'va-000', detail: { decision: 'CORRECT', note: 'Retargeted to CHG-02.' } },
  { at: '2026-10-08T11:42:00.000Z', actor: 'Noah Bertrand', action: 'QUESTION_ASKED', objectType: 'question', objectId: 'q-0041', detail: { answer: 'grounded', passages: 4 } },
  { at: '2026-10-20T10:15:00.000Z', actor: 'Amina Diallo', action: 'PACK_DOWNLOADED', objectType: 'pack', objectId: 'pk-001', detail: { checksumsVerified: true } },
  { at: '2026-10-28T06:00:00.000Z', actor: 'reminder-job', action: 'REMINDER_SENT', objectType: 'control', objectId: 'CHG-03', detail: { recipient: 'Chloé Marchand', reason: 'NO_EVIDENCE' } },
  { at: '2026-10-30T15:02:00.000Z', actor: 'Noah Bertrand', action: 'ACCESS_DENIED', objectType: 'evidence', objectId: 'ev-011', detail: { accessLevel: 'RESTRICTED', role: 'INTERNAL_AUDITOR' } },
  { at: '2026-11-01T06:00:00.000Z', actor: 'reminder-job', action: 'REMINDER_SENT', objectType: 'control', objectId: 'BCP-02', detail: { recipient: 'Kwame Mensah', reason: 'EXPIRING_SOON' } },
  { at: '2026-11-02T06:15:00.000Z', actor: 'collector-s3', action: 'EVIDENCE_COLLECTED', objectType: 'evidence', objectId: 'ev-009', detail: { source: 'itsm-export', rows: 214 } },
  { at: '2026-11-03T09:12:00.000Z', actor: 'pipeline', action: 'ATTACHMENT_APPLIED', objectType: 'attachment', objectId: 'at-022', detail: { controlId: 'BCP-03', sufficiency: 'PARTIAL' } },
  { at: '2026-11-04T08:41:00.000Z', actor: 'pipeline', action: 'ATTACHMENT_REJECTED', objectType: 'attachment', objectId: 'at-034', detail: { reason: 'CITATION_NOT_FOUND' } },
  { at: '2026-11-05T07:00:00.000Z', actor: 'pipeline', action: 'STATE_RECOMPUTED', objectType: 'framework', objectId: 'fw-msp-demo', detail: { controls: 30, changed: 2 } },
  { at: '2026-11-06T16:20:00.000Z', actor: 'Inès Kaya', action: 'SETTINGS_UPDATED', objectType: 'settings', objectId: 'tenant', detail: { reminderLeadDays: 30 } },
  { at: '2026-11-09T08:30:00.000Z', actor: 'Noah Bertrand', action: 'QUESTION_ASKED', objectType: 'question', objectId: 'q-0058', detail: { answer: NO_EVIDENCE_ANSWER, passages: 0 } },
  { at: '2026-11-10T09:45:00.000Z', actor: 'Amina Diallo', action: 'VALIDATION_DECIDED', objectType: 'validation', objectId: 'va-005', detail: { decision: 'ACCEPT', note: 'Quote verified, attachment applied.' } }
];

/** Hash-chained audit trail of the demo tenant (EF-ADM-02, ENF-INT-02). */
export function buildAuditEvents(): AuditEvent[] {
  let previous = hexDigest('audit-genesis', 16);
  return AUDIT_ROWS.map((row, index) => {
    const hash = hexDigest(`${previous}-${row.action}-${row.objectId}`, 16);
    const event: AuditEvent = {
      seq: index + 1,
      id: `au-${String(index + 1).padStart(4, '0')}`,
      at: row.at,
      actor: row.actor,
      action: row.action,
      objectType: row.objectType,
      objectId: row.objectId,
      detail: row.detail,
      prevHash: previous,
      hash
    };
    previous = hash;
    return event;
  });
}

/** Builds one more audit event, appended to the chain. */
export function appendAuditEvent(
  events: AuditEvent[],
  row: Omit<AuditRow, 'at'> & { at: string }
): AuditEvent {
  const previous = events[events.length - 1]?.hash ?? hexDigest('audit-genesis', 16);
  const event: AuditEvent = {
    seq: events.length + 1,
    id: `au-${String(events.length + 1).padStart(4, '0')}`,
    at: row.at,
    actor: row.actor,
    action: row.action,
    objectType: row.objectType,
    objectId: row.objectId,
    detail: row.detail,
    prevHash: previous,
    hash: hexDigest(`${previous}-${row.action}-${row.objectId}`, 16)
  };
  events.push(event);
  return event;
}
