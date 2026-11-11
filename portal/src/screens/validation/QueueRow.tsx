/* One row of the validation queue, with the three decision buttons. */

import type { ValidationDecision, ValidationItem } from '../../api/types.ts';
import { Badge, Tag } from '../../components/Primitives.tsx';
import { Button } from '../../components/Form.tsx';
import { formatDate, formatDateTime } from '../../lib/format.ts';
import { VALIDATION_KIND_LABEL } from '../../lib/states.ts';
import { navigate } from '../../lib/router.ts';

export const DECISION_LABEL: Record<ValidationDecision, string> = {
  ACCEPT: 'Accept',
  REJECT: 'Reject',
  CORRECT: 'Correct'
};

export function QueueRow({
  item,
  title,
  onDecide
}: {
  item: ValidationItem;
  title: string;
  onDecide: (decision: ValidationDecision) => void;
}) {
  return (
    <div className="queue-item">
      <div>
        <div className="row">
          <Badge label={VALIDATION_KIND_LABEL[item.kind]} color="var(--alert)" />
          {item.controlId ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => navigate(`/controls/${item.controlId}`)}
            >
              {item.controlId}
            </button>
          ) : null}
          {item.evidenceId ? <Tag>{title || item.evidenceId}</Tag> : null}
        </div>
        <p className="queue-reason">{item.reason}</p>
        <p className="faint small">Proposed on {formatDateTime(item.createdAt)}</p>
      </div>
      <div className="queue-actions">
        <Button size="sm" variant="primary" onClick={() => onDecide('ACCEPT')}>
          Accept
        </Button>
        <Button size="sm" onClick={() => onDecide('CORRECT')}>
          Correct
        </Button>
        <Button size="sm" variant="danger" onClick={() => onDecide('REJECT')}>
          Reject
        </Button>
      </div>
    </div>
  );
}

export function DecidedRow({ item }: { item: ValidationItem }) {
  return (
    <div className="queue-item">
      <div>
        <div className="row">
          <Badge label={VALIDATION_KIND_LABEL[item.kind]} color="var(--text-faint)" soft />
          <Tag>{item.decision ? DECISION_LABEL[item.decision] : 'decided'}</Tag>
          {item.controlId ? <span className="mono faint small">{item.controlId}</span> : null}
        </div>
        <p className="queue-reason">{item.note ?? item.reason}</p>
        <p className="faint small">
          {item.decidedBy ?? 'unknown'} · {formatDate(item.decidedAt)}
        </p>
      </div>
    </div>
  );
}
