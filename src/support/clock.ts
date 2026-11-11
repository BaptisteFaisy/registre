/**
 * Clocks. Injected everywhere so freshness, expiry and reminders are
 * reproducible in tests, in the demo and in the evaluation datasets.
 */

import type { Clock } from '../ports/index.ts';
import { isIsoDate, toTimestamp } from './iso8601.ts';
import { configError } from './errors.ts';

/** Real wall clock (production). */
export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

/** Frozen clock (tests, demo, evaluation). Can be advanced explicitly. */
export class FixedClock implements Clock {
  private current: string;

  constructor(now: string) {
    if (!isIsoDate(now)) throw configError(`FixedClock: invalid instant: ${now}`);
    this.current = toTimestamp(now);
  }

  now(): string {
    return this.current;
  }

  /** Today as `YYYY-MM-DD` (UTC). */
  today(): string {
    return this.current.slice(0, 10);
  }

  set(now: string): void {
    if (!isIsoDate(now)) throw configError(`FixedClock: invalid instant: ${now}`);
    this.current = toTimestamp(now);
  }

  advanceDays(days: number): void {
    const date = new Date(this.current);
    date.setUTCDate(date.getUTCDate() + days);
    this.current = date.toISOString();
  }
}

/** Reads a clock from the environment: `REGISTRE_NOW` freezes time when set. */
export function clockFromEnv(env: NodeJS.ProcessEnv = process.env): Clock {
  const fixed = env.REGISTRE_NOW;
  return fixed ? new FixedClock(fixed) : new SystemClock();
}
