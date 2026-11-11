/**
 * Settings route — EF-ADM-01 (beyond the sixteen endpoints of chapter 15).
 *
 * `GET /v1/settings` exposes the tunables of the tool; `PUT /v1/settings`
 * validates them, refuses wording that would describe a control with the
 * forbidden vocabulary (ENF-IA-01), stores them and appends `SETTINGS_UPDATED`
 * to the audit log (EF-ADM-02).
 */

import type { Role, Settings } from '../../domain/types.ts';
import { badRequest } from '../../support/errors.ts';
import { assertForbiddenWordsAbsent } from '../../domain/vocabulary.ts';
import { parseDuration } from '../../support/iso8601.ts';
import { json } from '../http.ts';
import type { ApiResponse } from '../http.ts';
import type { ApiContext, RouteDefinition } from '../types.ts';
import { requireRole } from '../access.ts';
import { settingsView } from '../views.ts';
import { bodyObject } from './shared.ts';

/** Roles allowed to read or write the settings (EF-ADM-01). */
const SETTINGS_ROLES: readonly Role[] = ['QUALITY_LEAD', 'ADMIN'];

/** Service tiers of the nightly batch (spec 17). */
const SERVICE_TIERS = ['FLEX', 'STANDARD'] as const;

/** Bounds of each numeric setting, so a typo cannot disable a control. */
const BOUNDS = {
  confidenceThreshold: { min: 0, max: 1 },
  reminderLeadDays: { min: 0, max: 365 },
  retentionMonths: { min: 1, max: 120 }
} as const;

/** Reads a bounded number from the payload, or keeps the current value. */
function numberSetting(
  body: Record<string, unknown>,
  current: Settings,
  field: keyof typeof BOUNDS
): number {
  const value = body[field];
  if (value === undefined) return current[field];
  const bounds = BOUNDS[field];
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw badRequest(`"${field}" must be a number`, { field });
  }
  if (value < bounds.min || value > bounds.max) {
    throw badRequest(`"${field}" must be between ${bounds.min} and ${bounds.max}`, {
      field,
      min: bounds.min,
      max: bounds.max
    });
  }
  return value;
}

/** Reads a text setting, refusing the forbidden wording (ENF-IA-01). */
function textSetting(
  body: Record<string, unknown>,
  current: string,
  field: keyof Settings
): string {
  const value = body[field];
  if (value === undefined) return current;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`"${field}" must be a non-empty string`, { field });
  }
  assertForbiddenWordsAbsent(value, `settings.${String(field)}`);
  return value.trim();
}

/** Builds the next settings from the payload, keeping absent fields as they are. */
function nextSettings(body: Record<string, unknown>, current: Settings): Settings {
  const defaultPeriodicity = textSetting(body, current.defaultPeriodicity, 'defaultPeriodicity');
  parseDuration(defaultPeriodicity);
  const tier = body.nightlyServiceTier;
  if (tier !== undefined && !SERVICE_TIERS.includes(tier as 'FLEX' | 'STANDARD')) {
    throw badRequest(`"nightlyServiceTier" must be one of: ${SERVICE_TIERS.join(', ')}`, {
      field: 'nightlyServiceTier'
    });
  }
  const guardrailId = body.guardrailId;
  if (guardrailId !== undefined && guardrailId !== null && typeof guardrailId !== 'string') {
    throw badRequest('"guardrailId" must be a string or null', { field: 'guardrailId' });
  }
  return {
    confidenceThreshold: numberSetting(body, current, 'confidenceThreshold'),
    reminderLeadDays: numberSetting(body, current, 'reminderLeadDays'),
    retentionMonths: numberSetting(body, current, 'retentionMonths'),
    defaultPeriodicity,
    region: textSetting(body, current.region, 'region'),
    readerModel: textSetting(body, current.readerModel, 'readerModel'),
    reasoningModel: textSetting(body, current.reasoningModel, 'reasoningModel'),
    answerModel: textSetting(body, current.answerModel, 'answerModel'),
    nightlyServiceTier: (tier as 'FLEX' | 'STANDARD' | undefined) ?? current.nightlyServiceTier,
    guardrailId: guardrailId === undefined ? current.guardrailId : (guardrailId as string | null)
  };
}

/** `GET /v1/settings` — the current settings. */
async function readSettings(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, SETTINGS_ROLES, 'settings', 'current');
  return json(200, settingsView(await context.services.state.getSettings()));
}

/** `PUT /v1/settings` — validate, store and audit the new settings. */
async function writeSettings(context: ApiContext): Promise<ApiResponse> {
  await requireRole(context.services, context.principal, SETTINGS_ROLES, 'settings', 'current');
  const current = await context.services.state.getSettings();
  const next = nextSettings(bodyObject(context), current);
  await context.services.state.putSettings(next);
  // The pipeline reads `services.settings`; keep the injected bundle in step
  // with the store so a change applies without a restart.
  Object.assign(context.services.settings, next);
  await context.services.audit.append({
    actor: context.principal.id,
    action: 'SETTINGS_UPDATED',
    objectType: 'settings',
    objectId: 'current',
    detail: { changed: changedFields(current, next) }
  });
  return json(200, settingsView(next));
}

/** Names of the settings whose value changed. */
function changedFields(previous: Settings, next: Settings): string[] {
  const keys = Object.keys(next) as Array<keyof Settings>;
  return keys.filter((key) => previous[key] !== next[key]);
}

/** The two settings routes, in table order. */
export const settingsRoutes: readonly RouteDefinition[] = [
  {
    method: 'GET',
    path: '/v1/settings',
    handler: readSettings,
    meta: {
      operationId: 'getSettings',
      summary: 'Read the tool settings',
      tag: 'settings',
      requirement: 'EF-ADM-01',
      roles: SETTINGS_ROLES,
      responseSchema: 'Settings',
      errors: [401, 403]
    }
  },
  {
    method: 'PUT',
    path: '/v1/settings',
    handler: writeSettings,
    meta: {
      operationId: 'updateSettings',
      summary: 'Update the tool settings',
      tag: 'settings',
      requirement: 'EF-ADM-01',
      roles: SETTINGS_ROLES,
      requestSchema: 'SettingsPatch',
      responseSchema: 'Settings',
      errors: [400, 401, 403],
      notes: 'The change is appended to the audit log as SETTINGS_UPDATED.'
    }
  }
];
