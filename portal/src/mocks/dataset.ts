/**
 * Assembles the offline mock database: framework, controls, evidence,
 * attachments, sufficiencies and control states (spec chapter 12 and 18.1).
 */

import type {
  Attachment,
  Control,
  ControlStatus,
  Evidence,
  Framework,
  Settings,
  Sufficiency
} from '../api/types.ts';
import { DEFAULT_SETTINGS_MOCK } from './settings.ts';
import { buildAttachment, buildSufficiency, computeStatus } from './engine.ts';
import { MOCK_EVIDENCE, NOW } from './evidence.ts';
import { buildSpecs } from './evidence.ts';
import type { EvidenceSpec } from './evidenceSpecs.ts';
import { buildControls, DEMO_FRAMEWORK_ID } from './framework.ts';

export interface MockDb {
  framework: Framework;
  controls: Control[];
  evidence: Evidence[];
  attachments: Attachment[];
  sufficiencies: Sufficiency[];
  statuses: ControlStatus[];
  settings: Settings;
  now: string;
}

/** The demo framework as imported by the partner (EF-REF-01). */
export const DEMO_FRAMEWORK: Framework = {
  id: DEMO_FRAMEWORK_ID,
  name: 'Northwind MSP service management framework',
  version: '2026.1',
  importedAt: '2026-01-08T10:00:00.000Z',
  confidentiality: 'INTERNAL',
  source: 'Imported from northwind-framework-2026.1.json'
};

interface BuildInput {
  specs: readonly EvidenceSpec[];
  evidence: readonly Evidence[];
  controls: readonly Control[];
  now: string;
  threshold: number;
}

/** Builds attachments and sufficiencies for every (evidence, control) pair. */
function buildRelations(input: BuildInput): {
  attachments: Attachment[];
  sufficiencies: Sufficiency[];
} {
  const attachments: Attachment[] = [];
  const sufficiencies: Sufficiency[] = [];
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const controlById = new Map(input.controls.map((item) => [item.id, item]));
  let index = 0;

  for (const spec of input.specs) {
    const evidence = evidenceById.get(spec.id);
    if (!evidence || spec.unattached) continue;
    for (const controlId of spec.controlIds) {
      const control = controlById.get(controlId);
      if (!control) continue;
      index += 1;
      const attachment = buildAttachment(
        spec,
        evidence,
        controlId,
        control.frameworkId,
        index,
        input.threshold
      );
      attachments.push(attachment);
      sufficiencies.push(
        buildSufficiency(attachment, control, evidence, spec, index, input.now)
      );
    }
  }
  return { attachments, sufficiencies };
}

/** Builds the status of every control from its attachments. */
function buildStatuses(
  controls: readonly Control[],
  attachments: readonly Attachment[],
  sufficiencies: readonly Sufficiency[],
  evidence: readonly Evidence[],
  now: string,
  leadDays: number
): ControlStatus[] {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  return controls.map((control) =>
    computeStatus({
      control,
      attachments: attachments.filter((item) => item.controlId === control.id),
      sufficiencies: sufficiencies.filter((item) => item.controlId === control.id),
      evidenceById,
      now,
      leadDays
    })
  );
}

/** Recomputes every control state after a change (EF-FRA-02). */
export function recomputeStatuses(db: MockDb): void {
  const evidenceById = new Map(db.evidence.map((item) => [item.id, item]));
  db.statuses = db.controls.map((control) =>
    computeStatus({
      control,
      attachments: db.attachments.filter((item) => item.controlId === control.id),
      sufficiencies: db.sufficiencies.filter((item) => item.controlId === control.id),
      evidenceById,
      now: db.now,
      leadDays: db.settings.reminderLeadDays
    })
  );
}

/** Creates the whole mock database, deterministic for a given day. */
export function createDb(now: string = NOW): MockDb {
  const settings = { ...DEFAULT_SETTINGS_MOCK };
  const controls = buildControls(DEMO_FRAMEWORK.id);
  const { attachments, sufficiencies } = buildRelations({
    specs: buildSpecs(),
    evidence: MOCK_EVIDENCE,
    controls,
    now,
    threshold: settings.confidenceThreshold
  });
  const statuses = buildStatuses(
    controls,
    attachments,
    sufficiencies,
    MOCK_EVIDENCE,
    now,
    settings.reminderLeadDays
  );
  return {
    framework: DEMO_FRAMEWORK,
    controls,
    evidence: MOCK_EVIDENCE,
    attachments,
    sufficiencies,
    statuses,
    settings,
    now
  };
}
