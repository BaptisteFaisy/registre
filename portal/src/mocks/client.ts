/**
 * Offline mock implementation of the API client (`VITE_USE_MOCKS=1`).
 *
 * It implements exactly the same `RegistreApi` interface as the HTTP client,
 * so every screen runs without a backend — which is how the demonstration is
 * recorded. Access control is applied here too (EF-QR-03, ENF-CONF-01).
 */

import type {
  Answer,
  AuditEvent,
  Control,
  ControlWithRelations,
  Evidence,
  Framework,
  FrameworkImport,
  Pack,
  Principal,
  ReadinessOverview,
  Reminder,
  Settings,
  ValidationDecision,
  ValidationItem
} from '../api/types.ts';
import { ApiError } from '../api/client.ts';
import type { RegistreApi } from '../api/client.ts';
import { answerQuestion, allowedLevels } from './ask.ts';
import { appendAuditEvent, buildPack } from './activity.ts';
import { recomputeStatuses } from './dataset.ts';
import {
  buildTrend,
  computeByDomain,
  computeCosts,
  computeSnapshot
} from './engine.ts';
import { store } from './store.ts';
import type { MockStore } from './store.ts';
import { simulateUpload } from './upload.ts';

/** Current identity, injected by the session layer. */
export type PrincipalProvider = () => Principal | null;

const LATENCY_MS = 90;

function delay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, LATENCY_MS);
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Reads the principal or fails like the real API would (401). */
function requirePrincipal(provider: PrincipalProvider): Principal {
  const principal = provider();
  if (!principal) throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue.');
  return principal;
}

/** Drops evidence the principal may not read, and its relations. */
function visibleRelations(db: MockStore['db'], clearance: Principal['clearance'], controlId: string) {
  const levels = new Set(allowedLevels(clearance));
  const evidence = db.evidence.filter(
    (item) =>
      levels.has(item.accessLevel) &&
      db.attachments.some((attachment) => attachment.evidenceId === item.id && attachment.controlId === controlId)
  );
  const ids = new Set(evidence.map((item) => item.id));
  const attachments = db.attachments.filter(
    (item) => item.controlId === controlId && ids.has(item.evidenceId)
  );
  const attachmentIds = new Set(attachments.map((item) => item.id));
  return {
    evidence,
    attachments,
    sufficiencies: db.sufficiencies.filter((item) => attachmentIds.has(item.attachmentId))
  };
}

/** Mock client: the same 16 endpoints, served from memory. */
export class MockRegistreApi implements RegistreApi {
  private readonly principalOf: PrincipalProvider;

  constructor(principalOf: PrincipalProvider) {
    this.principalOf = principalOf;
  }

  async listFrameworks(): Promise<Framework[]> {
    await delay();
    return [store().db.framework];
  }

  async importFramework(_payload: FrameworkImport): Promise<Framework> {
    await delay();
    throw new ApiError(
      501,
      'NOT_IMPLEMENTED',
      'Framework import is disabled in the offline demo: the mock ships one framework.'
    );
  }

  async listControls(frameworkId: string): Promise<Control[]> {
    await delay();
    return store().db.controls.filter((item) => item.frameworkId === frameworkId);
  }

  async getReadiness(frameworkId: string): Promise<ReadinessOverview> {
    await delay();
    const db = store().db;
    const snapshot = computeSnapshot(frameworkId, db.statuses, db.now);
    return {
      framework: db.framework,
      snapshot,
      trend: buildTrend(snapshot, db.now),
      statuses: [...db.statuses],
      byDomain: computeByDomain(db.controls, db.statuses),
      costs: computeCosts(db.evidence)
    };
  }

  async uploadEvidence(input: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    suggestedControlId?: string;
    accessLevel?: string;
  }): Promise<Evidence> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    const evidence = simulateUpload(store(), principal, input);
    return evidence;
  }

  async getEvidence(evidenceId: string): Promise<Evidence> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    const db = store().db;
    const evidence = db.evidence.find((item) => item.id === evidenceId);
    if (!evidence) throw new ApiError(404, 'NOT_FOUND', `No evidence ${evidenceId}.`);
    if (!allowedLevels(principal.clearance).includes(evidence.accessLevel)) {
      appendAuditEvent(store().audit, {
        at: nowIso(),
        actor: principal.name,
        action: 'ACCESS_DENIED',
        objectType: 'evidence',
        objectId: evidenceId,
        detail: { accessLevel: evidence.accessLevel, role: principal.role }
      });
      throw new ApiError(403, 'FORBIDDEN', 'This evidence is restricted for your role.');
    }
    return evidence;
  }

  async getControl(controlId: string): Promise<ControlWithRelations> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    const db = store().db;
    const control = db.controls.find((item) => item.id === controlId);
    const status = db.statuses.find((item) => item.controlId === controlId);
    if (!control || !status) throw new ApiError(404, 'NOT_FOUND', `No control ${controlId}.`);
    const relations = visibleRelations(db, principal.clearance, controlId);
    return {
      control,
      status,
      attachments: relations.attachments,
      sufficiencies: relations.sufficiencies,
      evidence: relations.evidence
    };
  }

  async listControlEvidence(controlId: string): Promise<Evidence[]> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    return visibleRelations(store().db, principal.clearance, controlId).evidence;
  }

  async listValidations(status?: 'PENDING' | 'DECIDED'): Promise<ValidationItem[]> {
    await delay();
    const items = store().validations;
    const filtered = status ? items.filter((item) => item.status === status) : items;
    return [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async decideValidation(
    validationId: string,
    decision: ValidationDecision,
    note: string
  ): Promise<ValidationItem> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      throw new ApiError(400, 'BAD_REQUEST', 'A reason is required to record a decision (EF-VAL-02).');
    }
    const state = store();
    const item = state.validations.find((entry) => entry.id === validationId);
    if (!item) throw new ApiError(404, 'NOT_FOUND', `No validation ${validationId}.`);
    if (item.status === 'DECIDED') {
      throw new ApiError(409, 'CONFLICT', 'This item has already been decided.');
    }
    const at = nowIso();
    item.status = 'DECIDED';
    item.decision = decision;
    item.decidedBy = principal.name;
    item.decidedAt = at;
    item.note = trimmed;
    applyDecision(state, item, decision, at);
    recomputeStatuses(state.db);
    appendAuditEvent(state.audit, {
      at,
      actor: principal.name,
      action: 'VALIDATION_DECIDED',
      objectType: 'validation',
      objectId: item.id,
      detail: { decision, note: trimmed }
    });
    return item;
  }

  async ask(question: string): Promise<Answer> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    const state = store();
    const answer = answerQuestion(question, state.db.evidence, principal.clearance);
    appendAuditEvent(state.audit, {
      at: nowIso(),
      actor: principal.name,
      action: 'QUESTION_ASKED',
      objectType: 'question',
      objectId: `q-${state.audit.length + 1}`,
      detail: { answer: answer.noEvidence ? 'no-evidence' : 'grounded', passages: answer.passagesUsed }
    });
    return answer;
  }

  async createPack(frameworkId: string): Promise<Pack> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    const state = store();
    const id = `pk-${String(state.packs.length + 1).padStart(3, '0')}`;
    const pack = buildPack(state.db, id, nowIso());
    state.packs.push(pack);
    appendAuditEvent(state.audit, {
      at: pack.frozenAt,
      actor: principal.name,
      action: 'PACK_ASSEMBLED',
      objectType: 'pack',
      objectId: pack.id,
      detail: { frameworkId, controls: pack.index.length, knownGaps: pack.knownGaps.length }
    });
    return pack;
  }

  async getPack(packId: string): Promise<Pack> {
    await delay();
    const pack = store().packs.find((item) => item.id === packId);
    if (!pack) throw new ApiError(404, 'NOT_FOUND', `No pack ${packId}.`);
    return pack;
  }

  async listPacks(frameworkId?: string): Promise<Pack[]> {
    await delay();
    const packs = store().packs;
    const filtered = frameworkId
      ? packs.filter((item) => item.frameworkId === frameworkId)
      : packs;
    return [...filtered].sort((a, b) => b.frozenAt.localeCompare(a.frozenAt));
  }

  async listReminders(): Promise<Reminder[]> {
    await delay();
    return [...store().reminders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async sendReminder(controlId: string): Promise<Reminder> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    const state = store();
    const control = state.db.controls.find((item) => item.id === controlId);
    const status = state.db.statuses.find((item) => item.controlId === controlId);
    if (!control || !status) throw new ApiError(404, 'NOT_FOUND', `No control ${controlId}.`);
    const at = nowIso();
    const reminder: Reminder = {
      id: `rm-${String(state.reminders.length + 1).padStart(3, '0')}`,
      controlId,
      frameworkId: control.frameworkId,
      recipient: control.owner,
      reason: status.state === 'NO_EVIDENCE' ? 'NO_EVIDENCE' : 'EXPIRING_SOON',
      missing: control.expectedEvidence.slice(0, 2),
      message: `Please provide the evidence of ${control.id} (${control.title}): ${control.expectedEvidence.join(', ')}.`,
      createdAt: at,
      expiresAt: status.expiresAt,
      status: 'SENT',
      channel: 'email'
    };
    state.reminders.push(reminder);
    appendAuditEvent(state.audit, {
      at,
      actor: principal.name,
      action: 'REMINDER_SENT',
      objectType: 'control',
      objectId: controlId,
      detail: { recipient: control.owner, reason: reminder.reason }
    });
    return reminder;
  }

  async listAuditLog(filter?: { limit?: number; action?: string }): Promise<AuditEvent[]> {
    await delay();
    const events = store().audit;
    const filtered = filter?.action
      ? events.filter((item) => item.action === filter.action)
      : events;
    const sorted = [...filtered].sort((a, b) => b.seq - a.seq);
    return filter?.limit ? sorted.slice(0, filter.limit) : sorted;
  }

  async getSettings(): Promise<Settings> {
    await delay();
    return { ...store().db.settings };
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const principal = requirePrincipal(this.principalOf);
    await delay();
    const state = store();
    const next: Settings = { ...state.db.settings, ...patch };
    if (next.confidenceThreshold < 0.5 || next.confidenceThreshold > 1) {
      throw new ApiError(400, 'BAD_REQUEST', 'The confidence threshold must be between 0.5 and 1.');
    }
    if (next.reminderLeadDays < 1 || next.reminderLeadDays > 180) {
      throw new ApiError(400, 'BAD_REQUEST', 'The reminder lead time must be between 1 and 180 days.');
    }
    state.db.settings = next;
    recomputeStatuses(state.db);
    appendAuditEvent(state.audit, {
      at: nowIso(),
      actor: principal.name,
      action: 'SETTINGS_UPDATED',
      objectType: 'settings',
      objectId: 'tenant',
      detail: { ...patch }
    });
    return { ...next };
  }
}

/** Applies the side effect of a decision on the attachment it targets. */
function applyDecision(
  state: MockStore,
  item: ValidationItem,
  decision: ValidationDecision,
  at: string
): void {
  if (item.kind !== 'ATTACHMENT' || !item.attachmentId) return;
  const attachment = state.db.attachments.find((entry) => entry.id === item.attachmentId);
  if (!attachment) return;
  if (decision === 'ACCEPT') {
    attachment.status = 'APPLIED';
    attachment.decidedBy = item.decidedBy;
    attachment.decidedAt = at;
    attachment.decidedNote = item.note;
  }
  if (decision === 'REJECT') {
    attachment.status = 'REJECTED';
    attachment.rejectionReason = 'HUMAN_REJECTED';
    attachment.decidedBy = item.decidedBy;
    attachment.decidedAt = at;
    attachment.decidedNote = item.note;
  }
}
