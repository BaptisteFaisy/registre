/* Settings: confidence threshold, reminder lead time, default periodicity
   and the technical parameters of the tenant (EF-ADM-01). */

import { useEffect, useState } from 'react';
import type { Settings } from '../api/types.ts';
import { useApp } from '../state/app.tsx';
import { useApiData } from '../state/useData.ts';
import { ErrorState, Notice } from '../components/Card.tsx';
import { Button } from '../components/Form.tsx';
import { Spinner } from '../components/Primitives.tsx';
import { PageHeader } from '../components/Page.tsx';
import { describeError } from '../lib/hooks.ts';
import { EngineCard, PlatformCard } from './settings/SettingCards.tsx';

export function SettingsScreen() {
  const state = useSettingsDraft();
  return (
    <div className="stack">
      <PageHeader
        title="Settings"
        subtitle="These values drive the engine: the attachment threshold, the renewal lead time and the default periodicity of a control."
        actions={
          <Button variant="primary" onClick={state.save} disabled={state.busy || !state.draft}>
            {state.busy ? 'Saving…' : 'Save settings'}
          </Button>
        }
      />
      {state.loadError ? <ErrorState message={state.loadError} onRetry={state.reload} /> : null}
      {state.loading && !state.draft ? <Spinner label="Loading settings…" /> : null}
      {state.status ? <Notice tone="info">{state.status}</Notice> : null}
      {state.error ? <Notice>{state.error}</Notice> : null}
      {state.draft ? (
        <>
          <EngineCard draft={state.draft} onPatch={state.patch} />
          <PlatformCard draft={state.draft} onPatch={state.patch} />
        </>
      ) : null}
    </div>
  );
}

interface DraftState {
  draft: Settings | null;
  loading: boolean;
  loadError: string | null;
  status: string | null;
  error: string | null;
  busy: boolean;
  patch: (part: Partial<Settings>) => void;
  save: () => Promise<void>;
  reload: () => void;
}

/** Keeps an editable copy of the settings and saves it back to the API. */
function useSettingsDraft(): DraftState {
  const { api } = useApp();
  const loaded = useApiData((client) => client.getSettings());
  const [draft, setDraft] = useState<Settings | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded.data) setDraft({ ...loaded.data });
  }, [loaded.data]);

  const patch = (part: Partial<Settings>): void => {
    setDraft((current) => (current ? { ...current, ...part } : current));
    setStatus(null);
  };

  const save = async (): Promise<void> => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const saved = await api.updateSettings(draft);
      setDraft({ ...saved });
      setStatus('Settings saved and control states recomputed.');
      loaded.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return {
    draft,
    loading: loaded.loading,
    loadError: loaded.error,
    status,
    error,
    busy,
    patch,
    save,
    reload: loaded.reload
  };
}
