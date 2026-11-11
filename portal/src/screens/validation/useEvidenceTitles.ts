/* Loads the titles of the evidence referenced by the validation queue. */

import { useMemo } from 'react';
import type { ValidationItem } from '../../api/types.ts';
import { useApiData } from '../../state/useData.ts';

/** Map of evidence identifier to its document title. */
export function useEvidenceTitles(items: readonly ValidationItem[]): Map<string, string> {
  const key = useMemo(
    () =>
      Array.from(new Set(items.map((item) => item.evidenceId).filter(Boolean) as string[]))
        .sort()
        .join(','),
    [items]
  );

  const loaded = useApiData(
    async (api) => {
      const ids = key ? key.split(',') : [];
      const pairs = await Promise.all(
        ids.map(async (id) => {
          try {
            const evidence = await api.getEvidence(id);
            return [id, evidence.fields.title ?? id] as const;
          } catch {
            return [id, id] as const;
          }
        })
      );
      return new Map(pairs);
    },
    [key]
  );
  return loaded.data ?? new Map<string, string>();
}
