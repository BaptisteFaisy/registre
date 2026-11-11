/**
 * Freshness — EF-FRA-01 (spec 12.2).
 *
 * "À jour : date de la preuve plus périodicité du contrôle postérieure à
 *  aujourd'hui, de plus de 30 jours. À renouveler : péremption dans moins de
 *  30 jours. Périmée : date de péremption dépassée."
 * For a document covering a period, the reference date is the period end.
 */

import type { Evidence, EvidenceFreshness } from './types.ts';
import { addDuration, daysBetween } from '../support/iso8601.ts';

/** Renewal window in days: an evidence expiring inside it is TO_RENEW (EF-FRA-01). */
export const RENEWAL_LEAD_DAYS = 30;

/** The part of an evidence freshness needs. */
export type FreshnessInput = Pick<Evidence, 'fields' | 'flags'>;

/** Freshness verdict for one evidence against one periodicity. */
export interface FreshnessVerdict {
  freshness: EvidenceFreshness;
  expiresAt: string | null;
}

/**
 * Resolves the reference date of an evidence: end of the covered period,
 * else document date, else approval date — EF-FRA-01.
 */
export function referenceDate(evidence: FreshnessInput): string | null {
  if (evidence.flags.unreadable) return null;
  const periodEnd = evidence.fields.period.end;
  if (periodEnd) return periodEnd;
  return evidence.fields.documentDate ?? evidence.fields.approvalDate ?? null;
}

/** Expiry date = reference date + control periodicity (ISO-8601 duration) — EF-FRA-01. */
export function computeExpiryDate(evidence: FreshnessInput, periodicity: string): string | null {
  const reference = referenceDate(evidence);
  if (!reference) return null;
  try {
    return addDuration(reference, periodicity);
  } catch {
    return null;
  }
}

/** Whole days left before expiry (negative once expired) — EF-FRA-01. */
export function daysUntilExpiry(expiresAt: string, now: string): number {
  return daysBetween(now, expiresAt);
}

/**
 * Freshness of one evidence at `now`: FRESH, TO_RENEW (within the lead time),
 * EXPIRED, or UNDETERMINED when no readable date could be extracted — EF-FRA-01.
 */
export function computeFreshness(
  evidence: FreshnessInput,
  periodicity: string,
  now: string,
  leadDays = RENEWAL_LEAD_DAYS
): FreshnessVerdict {
  const expiresAt = computeExpiryDate(evidence, periodicity);
  if (!expiresAt) return { freshness: 'UNDETERMINED', expiresAt: null };
  const daysLeft = daysUntilExpiry(expiresAt, now);
  if (daysLeft < 0) return { freshness: 'EXPIRED', expiresAt };
  if (daysLeft <= leadDays) return { freshness: 'TO_RENEW', expiresAt };
  return { freshness: 'FRESH', expiresAt };
}
