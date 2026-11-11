/**
 * Formatting helpers shared by every screen: dates, percentages, money,
 * fingerprints. Pure functions only, so they can be unit tested with
 * `node --test` without a bundler.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC'
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC'
});

/** Formats an ISO date as "12 Mar 2026"; returns a dash for empty values. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_FORMAT.format(date);
}

/** Formats an ISO date-time as "12 Mar 2026, 09:15" (UTC). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_TIME_FORMAT.format(date);
}

/** Human distance from `now`, e.g. "in 18 days" or "42 days ago". */
export function formatRelative(iso: string | null | undefined, now: string): string {
  if (!iso) return '—';
  const target = new Date(iso).getTime();
  const reference = new Date(now).getTime();
  if (Number.isNaN(target) || Number.isNaN(reference)) return '—';
  const days = Math.round((target - reference) / DAY_MS);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

/** Days between two ISO dates, rounded down (negative when past). */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.floor((to - from) / DAY_MS);
}

/** Formats a 0..1 share as a percentage, e.g. 0.425 -> "42.5 %". */
export function formatPercent(share: number, digits = 1): string {
  if (!Number.isFinite(share)) return '—';
  return `${(share * 100).toFixed(digits)} %`;
}

/** Formats a count with a thin space separator, e.g. 1234 -> "1 234". */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value);
}

/** Formats a confidence (0..1) as a percentage with no decimals. */
export function formatConfidence(confidence: number): string {
  if (!Number.isFinite(confidence)) return '—';
  return `${Math.round(confidence * 100)} %`;
}

/** Formats a USD amount with two decimals, e.g. 0.1234 -> "$0.12". */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  return `$${amount.toFixed(2)}`;
}

/** Shortens a SHA-256 fingerprint to the first 12 hex characters. */
export function shortHash(sha256: string | null | undefined): string {
  if (!sha256) return '—';
  return sha256.slice(0, 12);
}

/** Formats a byte count with a human unit, e.g. 2048 -> "2.0 kB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit] ?? 'B'}`;
}

/** Turns an ISO-8601 duration ("P3M", "P1Y", "P30D") into readable text. */
export function formatPeriodicity(periodicity: string): string {
  const match = /^P(\d+)([DWMY])$/.exec(periodicity.trim());
  if (!match) return periodicity;
  const amount = Number(match[1]);
  const unit = match[2] ?? '';
  const names: Record<string, string> = { D: 'day', W: 'week', M: 'month', Y: 'year' };
  const name = names[unit] ?? unit;
  return `every ${amount} ${name}${amount > 1 ? 's' : ''}`;
}

/** Splits a camel-ish identifier into readable words, e.g. "TO_RENEW" -> "To renew". */
export function humanizeToken(token: string): string {
  const lower = token.replace(/[_-]+/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
