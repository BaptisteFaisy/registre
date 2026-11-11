/**
 * Mutable in-memory store of the offline mock. One instance per page load:
 * decisions taken in the portal persist until the tab is reloaded.
 */

import type { AuditEvent, Pack, Reminder, ValidationItem } from '../api/types.ts';
import { buildAuditEvents, buildPack, buildReminders, buildValidations } from './activity.ts';
import { createDb } from './dataset.ts';
import type { MockDb } from './dataset.ts';

export interface MockStore {
  db: MockDb;
  validations: ValidationItem[];
  reminders: Reminder[];
  packs: Pack[];
  audit: AuditEvent[];
}

/** Builds a fresh store seeded with the demonstration situations. */
export function createStore(): MockStore {
  const db = createDb();
  return {
    db,
    validations: buildValidations(db),
    reminders: buildReminders(db),
    packs: [buildPack(db)],
    audit: buildAuditEvents()
  };
}

let singleton: MockStore | null = null;

/** The store used by the mock client (created on first use). */
export function store(): MockStore {
  singleton ??= createStore();
  return singleton;
}
