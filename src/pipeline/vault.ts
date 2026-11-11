/**
 * Vault keys and retention — EF-COL-05 (one directory per evidence), ENF-INT-01
 * (nothing is deleted before the retention period) and ENF-DATA-01 (the
 * retention is the audit cycle plus one year, adjustable).
 */

import type { EvidenceId } from '../domain/types.ts';
import type { Services } from '../ports/index.ts';
import { addDuration, daysBetween } from '../support/iso8601.ts';

/** Vault retention in days, derived from `retentionMonths` — ENF-INT-01, ENF-DATA-01. */
export function retentionDays(services: Services): number {
  const months = services.settings.retentionMonths;
  if (!Number.isFinite(months) || months <= 0) return 0;
  const now = services.clock.now();
  return daysBetween(now, addDuration(now, `P${Math.trunc(months)}M`));
}

/** Vault key of an evidence: one directory per evidence, extension kept — EF-COL-05. */
export function vaultKey(evidenceId: EvidenceId, fileName: string | undefined, contentType: string): string {
  return `evidence/${evidenceId}/v1${extensionOf(fileName, contentType)}`;
}

/** File extension from the file name, else from the content type. */
function extensionOf(fileName: string | undefined, contentType: string): string {
  const fromName = fileName?.match(/\.[A-Za-z0-9]{1,8}$/)?.[0];
  if (fromName) return fromName.toLowerCase();
  const fromType = contentType.split('/')[1]?.split(';')[0]?.trim();
  return fromType && /^[A-Za-z0-9.+-]{1,12}$/.test(fromType) ? `.${fromType.toLowerCase()}` : '';
}
