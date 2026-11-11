/* Drift panel: what the machine attestations observed, and who acknowledged. */

import { useState } from 'react';
import type { DriftEvent } from '../../api/types.ts';
import { useApp, usePrincipal } from '../../state/app.tsx';
import { useApiData } from '../../state/useData.ts';
import type { Loadable } from '../../state/useData.ts';
import { Card, CardBody, CardHeader, EmptyState, ErrorState } from '../../components/Card.tsx';
import { Badge, Spinner } from '../../components/Primitives.tsx';
import { Button } from '../../components/Form.tsx';
import { can } from '../../lib/access.ts';
import { formatDate, formatRelative } from '../../lib/format.ts';
import { runAction } from '../../lib/hooks.ts';
import { driftMeta, driftTransition, latestDrifts, openDrifts } from '../../lib/drifts.ts';
import { navigate } from '../../lib/router.ts';

const PANEL_LIMIT = 3;

/** Counter of open drifts and the three latest events, with acknowledgement. */
export function DriftPanel({ frameworkId }: { frameworkId: string | null }) {
  const state = useApiData(
    (client) => (frameworkId ? client.listDrifts(frameworkId) : Promise.resolve([])),
    [frameworkId]
  );
  const events = state.data ?? [];
  return (
    <Card>
      <CardHeader
        title="Drifts observed by the collectors"
        subtitle="A machine attestation changed, or an expected run did not arrive: the control moves within the day, not at the next audit."
        action={<DriftPanelAction state={state} openCount={openDrifts(events).length} />}
      />
      <CardBody tight>
        <DriftList state={state} />
      </CardBody>
    </Card>
  );
}

function DriftPanelAction({
  state,
  openCount
}: {
  state: Loadable<DriftEvent[]>;
  openCount: number;
}) {
  return (
    <Button size="sm" onClick={state.reload} title="Reload the collector observations">
      {openCount} open · refresh
    </Button>
  );
}

/** The three latest drifts, with the acknowledgement action. */
function DriftList({ state }: { state: Loadable<DriftEvent[]> }) {
  const { api } = useApp();
  const principal = usePrincipal();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const events = state.data ?? [];
  const now = new Date().toISOString();
  const mayAck = can(principal.role, 'quality');

  const acknowledge = async (event: DriftEvent): Promise<void> => {
    setError(
      await runAction(
        () => api.ackDrift(event.id),
        state.reload,
        (busy) => setBusyId(busy ? event.id : null)
      )
    );
  };

  return (
    <>
      {state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
      {error ? <ErrorState message={error} /> : null}
      {state.loading && events.length === 0 ? <Spinner label="Loading the drifts…" /> : null}
      {events.length === 0 && !state.loading ? (
        <EmptyState>No drift detected: every collector reported on time.</EmptyState>
      ) : (
        latestDrifts(events, PANEL_LIMIT).map((event) => (
          <DriftRow
            key={event.id}
            event={event}
            now={now}
            busy={busyId === event.id}
            mayAck={mayAck}
            onAcknowledge={acknowledge}
          />
        ))
      )}
    </>
  );
}

function DriftRow({
  event,
  now,
  busy,
  mayAck,
  onAcknowledge
}: {
  event: DriftEvent;
  now: string;
  busy: boolean;
  mayAck: boolean;
  onAcknowledge: (event: DriftEvent) => Promise<void>;
}) {
  const meta = driftMeta(event.kind);
  return (
    <div className="queue-item">
      <div className="row" style={{ gap: 8 }}>
        <Badge label={meta.label} color={meta.color} />
        <button
          type="button"
          className="mono linkish"
          onClick={() => navigate(`/controls/${event.controlId}`)}
        >
          {event.controlId}
        </button>
        <span className="faint small" title={event.detectedAt}>
          {formatDate(event.detectedAt)} · {formatRelative(event.detectedAt, now)}
        </span>
      </div>
      <div className="queue-reason">
        {event.detail}
        <span className="cell-sub mono">{driftTransition(event.previous, event.current)}</span>
      </div>
      <DriftAck event={event} busy={busy} mayAck={mayAck} onAcknowledge={onAcknowledge} />
    </div>
  );
}

function DriftAck({
  event,
  busy,
  mayAck,
  onAcknowledge
}: {
  event: DriftEvent;
  busy: boolean;
  mayAck: boolean;
  onAcknowledge: (event: DriftEvent) => Promise<void>;
}) {
  if (event.acknowledgedAt) {
    return (
      <div className="queue-actions">
        <span className="faint small">
          Acknowledged by {event.acknowledgedBy} on {formatDate(event.acknowledgedAt)}
        </span>
      </div>
    );
  }
  return (
    <div className="queue-actions">
      {mayAck ? (
        <Button size="sm" disabled={busy} onClick={() => onAcknowledge(event)}>
          {busy ? 'Acknowledging…' : 'Acknowledge'}
        </Button>
      ) : (
        <span className="faint small">Waiting for an acknowledgement</span>
      )}
    </div>
  );
}
