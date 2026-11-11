/* Mappings: one evidence serves every framework (axis 2). */

import { useState } from 'react';
import type { ControlMapping, MappingDecision } from '../api/types.ts';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Notice } from '../components/Card.tsx';
import { Button, Field, Select } from '../components/Form.tsx';
import { Spinner } from '../components/Primitives.tsx';
import { PageHeader } from '../components/Page.tsx';
import { MAPPING_FILTERS } from '../lib/mappings.ts';
import type { MappingStatusFilter } from '../lib/mappings.ts';
import { MappingCard } from './mappings/MappingCard.tsx';
import { MappingDecisionModal } from './mappings/MappingDecisionModal.tsx';
import { ReuseBanner } from './mappings/ReuseBanner.tsx';
import { useMappingsScreen } from './mappings/useMappingsScreen.ts';
import type { MappingsScreenState } from './mappings/useMappingsScreen.ts';

interface PendingDecision {
  mapping: ControlMapping;
  decision: MappingDecision;
}

export function MappingsScreen() {
  const state = useMappingsScreen();
  const [pending, setPending] = useState<PendingDecision | null>(null);

  return (
    <div className="stack">
      <PageHeader
        title="Cross-framework mappings"
        subtitle="A validated equivalence proposes an accepted attachment on the other framework — it never applies it. Every decision keeps its author, date and reason."
        actions={
          <Button onClick={state.propose} disabled={state.busy || !state.targetFrameworkId}>
            {state.busy ? 'Working…' : 'Run the proposer'}
          </Button>
        }
      />
      {state.reuse.data ? <ReuseBanner reuse={state.reuse.data} /> : null}
      {state.error ? <Notice>{state.error}</Notice> : null}
      <MappingsList state={state} onChoose={setPending} />
      {pending ? (
        <MappingDecisionModal
          mapping={pending.mapping}
          decision={pending.decision}
          busy={state.busy}
          onClose={() => setPending(null)}
          onSubmit={async (note) => {
            await state.decide(pending.mapping.id, pending.decision, note);
            setPending(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** The filtered list of correspondences, one card each. */
function MappingsList({
  state,
  onChoose
}: {
  state: MappingsScreenState;
  onChoose: (pending: PendingDecision) => void;
}) {
  const mappings = state.mappings.data ?? [];
  return (
    <Card>
      <CardHeader
        title={`${mappings.length} correspondence(s)`}
        subtitle="Two quotes, one confidence, one human decision"
        action={
          <StatusFilter value={state.statusFilter} onChange={state.setStatusFilter} />
        }
      />
      <CardBody tight>
        {state.mappings.error ? (
          <ErrorState message={state.mappings.error} onRetry={state.mappings.reload} />
        ) : null}
        {state.mappings.loading && mappings.length === 0 ? (
          <div style={{ padding: 16 }}>
            <Spinner label="Loading the correspondences…" />
          </div>
        ) : mappings.length === 0 ? (
          <EmptyState>No correspondence for this filter.</EmptyState>
        ) : (
          <div className="stack" style={{ padding: 16 }}>
            {mappings.map((mapping) => (
              <MappingCard
                key={mapping.id}
                mapping={mapping}
                busy={state.busy}
                onDecide={(decision) => onChoose({ mapping, decision })}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Status filter of the list, also usable standalone. */
function StatusFilter({
  value,
  onChange
}: {
  value: MappingStatusFilter;
  onChange: (value: MappingStatusFilter) => void;
}) {
  return (
    <Field label="Status">
      <Select ariaLabel="Filter by status" value={value} options={MAPPING_FILTERS} onChange={onChange} />
    </Field>
  );
}
