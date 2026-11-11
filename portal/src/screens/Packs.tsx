/* Audit pack: assemble, read the index by control, list the known gaps
   (EF-DOS-01, EF-DOS-02, EF-DOS-03). */

import type { Pack } from '../api/types.ts';
import { usePrincipal } from '../state/app.tsx';
import { EmptyState, ErrorState, Notice } from '../components/Card.tsx';
import { Button } from '../components/Form.tsx';
import { Spinner } from '../components/Primitives.tsx';
import { PageHeader } from '../components/Page.tsx';
import { can } from '../lib/access.ts';
import { IndexCard } from './packs/IndexCard.tsx';
import { ArchiveCard, GapsCard, PackListCard } from './packs/SideCards.tsx';
import { usePacks } from './packs/usePacks.ts';

export function PacksScreen() {
  const principal = usePrincipal();
  const state = usePacks();

  return (
    <div className="stack">
      <PageHeader
        title="Audit pack"
        subtitle="One frozen archive per framework: an index by control, the evidence with its dates and fingerprint, and the list of known gaps."
        actions={
          can(principal.role, 'packs') ? (
            <Button
              variant="primary"
              onClick={state.assemble}
              disabled={state.busy || !state.frameworkId}
            >
              {state.busy ? 'Assembling…' : 'Assemble a new pack'}
            </Button>
          ) : null
        }
      />
      {state.error ? <Notice>{state.error}</Notice> : null}
      {state.packs.error ? (
        <ErrorState message={state.packs.error} onRetry={state.packs.reload} />
      ) : null}
      {state.packs.loading ? <Spinner label="Loading the packs…" /> : null}
      {state.selected ? (
        <PackContent
          selected={state.selected}
          packs={state.list}
          onSelect={state.select}
        />
      ) : (
        !state.packs.loading && <EmptyState>No pack assembled yet.</EmptyState>
      )}
    </div>
  );
}

/** Two columns: the readable index, then the archive, gaps and pack list. */
function PackContent({
  selected,
  packs,
  onSelect
}: {
  selected: Pack;
  packs: readonly Pack[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="page-grid">
      <IndexCard pack={selected} />
      <div className="stack">
        <ArchiveCard pack={selected} />
        <GapsCard pack={selected} />
        <PackListCard packs={packs} selectedId={selected.id} onSelect={onSelect} />
      </div>
    </div>
  );
}
