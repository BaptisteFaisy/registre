/**
 * Small data-loading helpers shared by the screens. No dependency, no cache:
 * every screen loads what it needs from the API client.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-runs the loader. */
  reload: () => void;
}

/**
 * Loads data on mount and whenever `deps` change, keeping the last result
 * visible while a new load is running.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(describeError(cause));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, loading, reload };
}

/** Turns any thrown value into a readable sentence. */
export function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return 'Unexpected error.';
}

/**
 * Runs one write action against the API, reloads the viewers on success and
 * returns the failure as readable text (or `null` when it worked). Shared by
 * every screen action so no screen re-implements the busy/error dance.
 */
export async function runAction(
  action: () => Promise<unknown>,
  reload: () => void,
  setBusy: (busy: boolean) => void
): Promise<string | null> {
  setBusy(true);
  try {
    await action();
    reload();
    return null;
  } catch (cause) {
    return describeError(cause);
  } finally {
    setBusy(false);
  }
}

/** Debounces a value; used by the search inputs of the filterable lists. */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
