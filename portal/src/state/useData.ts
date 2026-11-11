/* Data hooks shared by the screens: the demo tenant holds one framework. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Control, Framework, ReadinessOverview } from '../api/types.ts';
import type { RegistreApi } from '../api/client.ts';
import { useApp } from './app.tsx';
import { describeError } from '../lib/hooks.ts';

export interface Loadable<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Generic loader bound to the API client of the current mode. */
export function useApiData<T>(
  load: (api: RegistreApi) => Promise<T>,
  deps: readonly unknown[] = []
): Loadable<T> {
  const { api, principal } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  const signedIn = principal?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load(api)
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
  }, [api, signedIn, tick, ...deps]);

  return { data, error, loading, reload };
}

/** The framework of the demo tenant (the portal imports its own in production). */
export function useFramework(): Loadable<Framework | null> {
  const state = useApiData((api) => api.listFrameworks());
  const framework = state.data?.[0] ?? null;
  return { ...state, data: framework };
}

/** Readiness overview of the tenant's framework (EF-FRA-03). */
export function useReadiness(frameworkId: string | null): Loadable<ReadinessOverview> {
  return useApiData(
    (api) =>
      frameworkId
        ? api.getReadiness(frameworkId)
        : Promise.reject(new Error('No framework imported.')),
    [frameworkId]
  );
}

/** Controls of the framework, indexed by identifier for list joins. */
export function useControlIndex(frameworkId: string | null): Map<string, Control> {
  const state = useApiData(
    (api) => (frameworkId ? api.listControls(frameworkId) : Promise.resolve([])),
    [frameworkId]
  );
  return useMemo(() => new Map((state.data ?? []).map((item) => [item.id, item])), [state.data]);
}
