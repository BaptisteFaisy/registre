/* Data loading and actions of the Mappings screen (axis 2). */

import { useState } from 'react';
import type { ControlMapping, MappingDecision, ReuseMetric } from '../../api/types.ts';
import { useApp } from '../../state/app.tsx';
import { useApiData, useFramework } from '../../state/useData.ts';
import type { Loadable } from '../../state/useData.ts';
import { describeError, runAction } from '../../lib/hooks.ts';
import type { MappingStatusFilter } from '../../lib/mappings.ts';

export interface MappingsData {
  frameworkId: string | null;
  targetFrameworkId: string | null;
  statusFilter: MappingStatusFilter;
  setStatusFilter: (value: MappingStatusFilter) => void;
  mappings: Loadable<ControlMapping[]>;
  reuse: Loadable<ReuseMetric | null>;
}

/** Loads the mappings of the current filter and the reuse banner. */
function useMappingsData(): MappingsData {
  const framework = useFramework();
  const frameworkId = framework.data?.id ?? null;
  const [statusFilter, setStatusFilter] = useState<MappingStatusFilter>('ALL');
  const mappings = useApiData(
    (client) =>
      client.listMappings(statusFilter === 'ALL' ? undefined : { status: statusFilter }),
    [statusFilter]
  );
  // The reuse banner counts the decisions live: reload it with the list.
  const reuse = useApiData(
    (client) => (frameworkId ? client.getReuse(frameworkId) : Promise.resolve(null)),
    [frameworkId, mappings.data]
  );
  return {
    frameworkId,
    targetFrameworkId: (mappings.data ?? [])[0]?.targetFrameworkId ?? null,
    statusFilter,
    setStatusFilter,
    mappings,
    reuse
  };
}

export interface MappingsScreenState extends MappingsData {
  decide: (id: string, decision: MappingDecision, note: string) => Promise<void>;
  propose: () => Promise<void>;
  busy: boolean;
  error: string | null;
}

/** Adds the two write actions: decide one mapping, run the proposer. */
export function useMappingsScreen(): MappingsScreenState {
  const { api } = useApp();
  const data = useMappingsData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (id: string, decision: MappingDecision, note: string): Promise<void> => {
    setError(await runAction(
      () => api.decideMapping(id, decision, note),
      data.mappings.reload,
      setBusy
    ));
  };

  const propose = async (): Promise<void> => {
    const { frameworkId, targetFrameworkId } = data;
    if (!frameworkId || !targetFrameworkId) {
      setError('No target framework to propose mappings against.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const proposed = await api.proposeMappings({
        sourceFrameworkId: frameworkId,
        targetFrameworkId
      });
      setError(
        proposed.length === 0
          ? null
          : `The proposer returned ${proposed.length} pending correspondence(s) — a human must decide each of them.`
      );
      data.mappings.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return { ...data, decide, propose, busy, error };
}
