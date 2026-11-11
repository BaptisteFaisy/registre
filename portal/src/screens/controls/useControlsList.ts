/* Loading and filtering of the control list (EF-FRA-03). */

import { useMemo, useState } from 'react';
import type { Control, ControlStatus } from '../../api/types.ts';
import { useApiData, useFramework, useReadiness } from '../../state/useData.ts';
import type { Loadable } from '../../state/useData.ts';
import { useControlFilters } from '../../state/useControlFilters.ts';
import type { ControlFilters } from '../../state/useControlFilters.ts';

export interface ControlsListState {
  list: Control[];
  rows: Control[];
  statuses: readonly ControlStatus[];
  statusById: Map<string, ControlStatus>;
  filters: ControlFilters;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Loads the framework controls, their states and the active filters. */
export function useControlsList(): ControlsListState {
  const framework = useFramework();
  const readiness = useReadiness(framework.data?.id ?? null);
  const controls = useApiData(
    (api) => (framework.data ? api.listControls(framework.data.id) : Promise.resolve([])),
    [framework.data?.id]
  );

  const list = controls.data ?? [];
  const statuses = readiness.data?.statuses ?? [];
  const statusById = useMemo(
    () => new Map(statuses.map((item) => [item.controlId, item])),
    [statuses]
  );
  const filters = useControlFilters(list);
  const rows = filters.apply(list, (id) => statusById.get(id)?.state);

  return {
    list,
    rows,
    statuses,
    statusById,
    filters,
    loading: controls.loading,
    error: controls.error ?? readiness.error,
    reload: () => {
      controls.reload();
      readiness.reload();
    }
  };
}

/** Reload helper exposed for the upload flow. */
export type ControlsReload = Loadable<Control[]>['reload'];

/** Local state of the deposit modal, kept out of the screen body. */
export function useUploadModal(): {
  open: boolean;
  openModal: () => void;
  close: () => void;
} {
  const [open, setOpen] = useState(false);
  return { open, openModal: () => setOpen(true), close: () => setOpen(false) };
}
