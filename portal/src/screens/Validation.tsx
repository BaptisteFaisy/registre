/* Validation queue: uncertain attachments, partial sufficiency, unreadable
   evidence — accept, reject or correct with a mandatory reason (EF-VAL-01/02). */

import { useState } from 'react';
import type { ValidationDecision, ValidationItem } from '../api/types.ts';
import { Card, CardBody, CardHeader, EmptyState, ErrorState } from '../components/Card.tsx';
import { Spinner } from '../components/Primitives.tsx';
import { PageHeader } from '../components/Page.tsx';
import { DecisionModal } from './validation/DecisionModal.tsx';
import { QueueRow, DecidedRow } from './validation/QueueRow.tsx';
import { useValidationQueue } from './validation/useValidationQueue.ts';

export interface PendingChoice {
  item: ValidationItem;
  decision: ValidationDecision;
}

export function ValidationScreen() {
  const state = useValidationQueue();
  const [choice, setChoice] = useState<PendingChoice | null>(null);

  return (
    <div className="stack">
      <PageHeader
        title="Validation queue"
        subtitle="Nothing is applied without a human when the machine is unsure. Every decision keeps its author, its date and its reason."
      />
      {state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
      <QueueCard state={state} onChoose={setChoice} />
      <DecidedCard state={state} />
      {choice ? (
        <DecisionModal
          choice={choice}
          onClose={() => setChoice(null)}
          onSubmit={async (decision, note) => {
            await state.decide(choice.item, decision, note);
            setChoice(null);
          }}
        />
      ) : null}
    </div>
  );
}

function QueueCard({
  state,
  onChoose
}: {
  state: ReturnType<typeof useValidationQueue>;
  onChoose: (choice: PendingChoice) => void;
}) {
  return (
    <Card>
      <CardHeader
        title={`${state.pending.length} item(s) waiting`}
        subtitle="Uncertain attachments, partial sufficiency, unreadable evidence"
      />
      <CardBody tight>
        {state.loading ? (
          <div style={{ padding: 16 }}>
            <Spinner label="Loading the queue…" />
          </div>
        ) : state.pending.length === 0 ? (
          <EmptyState>Nothing to review: the queue is empty.</EmptyState>
        ) : (
          state.pending.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              title={state.titles.get(item.evidenceId ?? '') ?? item.evidenceId ?? ''}
              onDecide={(decision) => onChoose({ item, decision })}
            />
          ))
        )}
      </CardBody>
    </Card>
  );
}

function DecidedCard({ state }: { state: ReturnType<typeof useValidationQueue> }) {
  return (
    <Card>
      <CardHeader title="Recent decisions" subtitle="Who decided what, when, and why" />
      <CardBody tight>
        {state.decided.length === 0 ? (
          <EmptyState>No decision recorded yet.</EmptyState>
        ) : (
          state.decided.map((item) => <DecidedRow key={item.id} item={item} />)
        )}
      </CardBody>
    </Card>
  );
}
