/**
 * ISO-8601 date and duration helpers. Pure functions, no I/O, no libraries.
 *
 * The spec (chapter 12) requires every date and every expiry to be computed
 * by code: this module is the only place where calendar arithmetic happens.
 */

import { badRequest } from './errors.ts';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DURATION =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export interface Duration {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** True when `value` looks like an ISO-8601 date or date-time. */
export function isIsoDate(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false;
  return DATE_ONLY.test(value) || DATE_TIME.test(value);
}

/** Parses an ISO-8601 date or date-time; throws `BAD_REQUEST` otherwise. */
export function parseDate(value: string): Date {
  if (!isIsoDate(value)) throw badRequest(`invalid date, ISO-8601 expected: ${value}`);
  const asDateTime = DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value;
  const date = new Date(asDateTime);
  if (Number.isNaN(date.getTime())) throw badRequest(`unreadable date: ${value}`);
  return date;
}

/** Normalises any accepted input to a UTC `YYYY-MM-DD` string. */
export function toDateOnly(value: string): string {
  return parseDate(value).toISOString().slice(0, 10);
}

/** ISO-8601 UTC timestamp. */
export function toTimestamp(value: string | Date): string {
  const date = typeof value === 'string' ? parseDate(value) : value;
  return date.toISOString();
}

/** Parses an ISO-8601 duration such as `P3M`, `P1Y`, `P30D`, `PT12H`. */
export function parseDuration(value: string): Duration {
  const match = DURATION.exec(value.trim().toUpperCase());
  if (!match) throw badRequest(`invalid ISO-8601 duration: ${value}`);
  const [, years, months, weeks, days, hours, minutes, seconds] = match;
  const duration: Duration = {
    years: Number(years ?? 0),
    months: Number(months ?? 0),
    weeks: Number(weeks ?? 0),
    days: Number(days ?? 0),
    hours: Number(hours ?? 0),
    minutes: Number(minutes ?? 0),
    seconds: Number(seconds ?? 0)
  };
  if (isZeroDuration(duration)) throw badRequest(`empty duration: ${value}`);
  return duration;
}

export function isZeroDuration(duration: Duration): boolean {
  return Object.values(duration).every((value) => value === 0);
}

/**
 * Adds a duration to a date, calendar first (years then months, clamped to the
 * last day of the target month), then weeks/days/time.
 */
export function addDuration(value: string, durationValue: string): string {
  const duration = parseDuration(durationValue);
  const base = parseDate(value);
  const dayOfMonth = base.getUTCDate();
  const shifted = new Date(
    Date.UTC(
      base.getUTCFullYear() + duration.years,
      base.getUTCMonth() + duration.months,
      1,
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds()
    )
  );
  const lastDay = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)
  ).getUTCDate();
  shifted.setUTCDate(Math.min(dayOfMonth, lastDay));
  shifted.setUTCDate(shifted.getUTCDate() + duration.weeks * 7 + duration.days);
  shifted.setUTCHours(
    shifted.getUTCHours() + duration.hours,
    shifted.getUTCMinutes() + duration.minutes,
    shifted.getUTCSeconds() + Math.floor(duration.seconds)
  );
  return shifted.toISOString();
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const a = parseDate(from).getTime();
  const b = parseDate(to).getTime();
  return Math.floor((b - a) / 86_400_000);
}

export function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

/** True when `a` is strictly earlier than `b`. */
export function isBefore(a: string, b: string): boolean {
  return parseDate(a).getTime() < parseDate(b).getTime();
}

/** True when `candidate` falls inside `[start, end]` (inclusive, null = open). */
export function isWithin(candidate: string, start: string | null, end: string | null): boolean {
  if (start !== null && isBefore(candidate, start)) return false;
  if (end !== null && isBefore(end, candidate)) return false;
  return true;
}

/** Latest of two nullable ISO dates. */
export function latest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return isBefore(a, b) ? b : a;
}

/** Earliest of two nullable ISO dates. */
export function earliest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return isBefore(a, b) ? a : b;
}
