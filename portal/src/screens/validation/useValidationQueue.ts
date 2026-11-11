/* Data loading and decisions of the validation queue (EF-VAL-01/02). */

import { useMemo, useState } from 'react';
import type { ValidationDecision, ValidationItem } from '../../api/types.ts';
import { useApp } from '../../state/app.tsx';
import { useApiData } from '../../state/useData.ts';
import { describeError } from '../../lib/hooks.ts';
import { useEvidenceTitles } from './useEvidenceTitles.ts';

export interface ValidationState {
  pending: ValidationItem[];
  decided: ValidationItem[];
  titles: Map<string, string>;
  loading: boolean;
  error: string | null;
  reload: () => void;
  decide: (item: ValidationItem, decision: ValidationDecision, note: string) => Promise<void>;
}

/** Loads the queue and records decisions with their mandatory reason. */
export function useValidationQueue(): ValidationState {
  const { api } = useApp();
  const pending = useApiData((client) => client.listValidations('PENDING'));
  const decided = useApiData((client) => client.listValidations('DECIDED'));
  const [error, setError] = useState<string | null>(null);

  const items = useMemo(() => pending.data ?? [], [pending.data]);
  const titles = useEvidenceTitles([...items, ...(decided.data ?? [])]);

  const decide = async (
    item: ValidationItem,
    decision: ValidationDecision,
    note: string
  ): Promise<void> => {
    setError(null);
    try {
      await api.decideValidation(item.id, decision, note);
      pending.reload();
      decided.reload();
    } catch (cause) {
      setError(describeError(cause));
      throw cause;
    }
  };

  return {
    pending: items,
    decided: decided.data ?? [],
    titles,
    loading: pending.loading,
    error: error ?? pending.error,
    reload: pending.reload,
    decide
  };
}
