/* Data loading of the packs screen (EF-DOS-01/02/03). */

import { useEffect, useState } from 'react';
import type { Pack } from '../../api/types.ts';
import { useApp } from '../../state/app.tsx';
import { useApiData, useFramework } from '../../state/useData.ts';
import type { Loadable } from '../../state/useData.ts';
import { describeError } from '../../lib/hooks.ts';

export interface PacksState {
  frameworkId: string | null;
  packs: Loadable<Pack[]>;
  list: Pack[];
  selected: Pack | null;
  select: (id: string) => void;
  assemble: () => Promise<void>;
  busy: boolean;
  error: string | null;
}

/** Loads the packs of the framework and handles the assembly action. */
export function usePacks(): PacksState {
  const { api } = useApp();
  const framework = useFramework();
  const frameworkId = framework.data?.id ?? null;
  const packs = useApiData(
    (client) => (frameworkId ? client.listPacks(frameworkId) : Promise.resolve([])),
    [frameworkId]
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = packs.data ?? [];
  useEffect(() => {
    if (!selectedId && list[0]) setSelectedId(list[0].id);
  }, [list, selectedId]);

  const assemble = async (): Promise<void> => {
    if (!frameworkId) return;
    setBusy(true);
    setError(null);
    try {
      const pack = await api.createPack(frameworkId);
      packs.reload();
      setSelectedId(pack.id);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  const selected = list.find((pack) => pack.id === selectedId) ?? list[0] ?? null;
  return {
    frameworkId,
    packs,
    list,
    selected,
    select: setSelectedId,
    assemble,
    busy,
    error
  };
}
