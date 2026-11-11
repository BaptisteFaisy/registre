/**
 * Mutable in-memory store of the offline mock. One instance per page load:
 * decisions taken in the portal persist until the tab is reloaded.
 */

import type {
  AuditEvent,
  ControlMapping,
  DriftEvent,
  Pack,
  QualityReport,
  Reminder,
  ShareGrant,
  ValidationItem
} from '../api/types.ts';
import { buildAuditEvents, buildPack, buildReminders, buildValidations } from './activity.ts';
import { createDb } from './dataset.ts';
import type { MockDb } from './dataset.ts';
import {
  TAMPERED_PACK_FROZEN_AT,
  TAMPERED_PACK_ID,
  buildDrifts,
  buildMappings,
  buildQuality,
  buildShares
} from './extensions.ts';
import { DEFAULT_SETTINGS_MOCK } from './settings.ts';

export interface MockStore {
  db: MockDb;
  validations: ValidationItem[];
  reminders: Reminder[];
  packs: Pack[];
  audit: AuditEvent[];
  shares: ShareGrant[];
  mappings: ControlMapping[];
  drifts: DriftEvent[];
  quality: QualityReport;
}

/** Builds a fresh store seeded with the demonstration situations. */
export function createStore(): MockStore {
  const db = createDb();
  return {
    db,
    validations: buildValidations(db),
    reminders: buildReminders(db),
    // pk-001 verifies clean; pk-002 is the seeded archive altered after freeze.
    packs: [buildPack(db), buildPack(db, TAMPERED_PACK_ID, TAMPERED_PACK_FROZEN_AT)],
    audit: buildAuditEvents(),
    shares: buildShares(),
    mappings: buildMappings(),
    drifts: buildDrifts(),
    quality: buildQuality(DEFAULT_SETTINGS_MOCK.confidenceThreshold)
  };
}

let singleton: MockStore | null = null;

/** The store used by the mock client (created on first use). */
export function store(): MockStore {
  singleton ??= createStore();
  return singleton;
}
