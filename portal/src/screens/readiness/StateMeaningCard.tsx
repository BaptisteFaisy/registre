/* Explanation of the five evidence states, with their live counts. */

import type { ReadinessSnapshot } from '../../api/types.ts';
import { Card, CardBody, CardHeader } from '../../components/Card.tsx';
import { formatPercent } from '../../lib/format.ts';
import { STATE_ORDER, stateColor, stateMeta } from '../../lib/states.ts';

/** Why each state exists, so a reader never over-reads the dashboard. */
export function StateMeaningCard({ snapshot }: { snapshot: ReadinessSnapshot }) {
  return (
    <Card>
      <CardHeader
        title="What each state means"
        subtitle="The register states what evidence exists, never that a control is satisfactory"
      />
      <CardBody tight>
        {STATE_ORDER.map((state) => {
          const meta = stateMeta(state);
          return (
            <div className="state-row" key={state}>
              <span className="state-row-head">
                <span className="dot" style={{ background: stateColor(state) }} />
                <strong>{meta.label}</strong>
                <span className="faint small">
                  {snapshot.counts[state]} · {formatPercent(snapshot.shares[state], 0)}
                </span>
              </span>
              <span className="state-row-text">{meta.description}</span>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}
