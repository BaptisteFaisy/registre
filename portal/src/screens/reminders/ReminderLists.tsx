/* Reminder rows: what was sent, and what is still due. */

import type { ControlStatus, Reminder } from '../../api/types.ts';
import { Badge, Tag } from '../../components/Primitives.tsx';
import { Button } from '../../components/Form.tsx';
import { formatDate, formatDateTime } from '../../lib/format.ts';
import { stateColor, stateLabel } from '../../lib/states.ts';
import { navigate } from '../../lib/router.ts';

export const REASON_LABEL: Record<Reminder['reason'], string> = {
  EXPIRING_SOON: 'Evidence expiring',
  NO_EVIDENCE: 'No evidence',
  MISSING_ELEMENTS: 'Missing elements'
};

/** Reminders already sent to the owners. */
export function SentList({
  reminders,
  titleOf
}: {
  reminders: readonly Reminder[];
  titleOf: Map<string, string>;
}) {
  return (
    <>
      {reminders.map((reminder) => (
        <article className="reminder" key={reminder.id}>
          <div className="row-between">
            <span>
              <ControlLink controlId={reminder.controlId} title={titleOf.get(reminder.controlId)} />
              <span className="cell-sub">
                to {reminder.recipient} · {reminder.channel} · {formatDateTime(reminder.createdAt)}
              </span>
            </span>
            <div className="row">
              <Badge label={REASON_LABEL[reminder.reason]} color="var(--warn)" soft dot={false} />
              <Tag>{reminder.status}</Tag>
            </div>
          </div>
          <p className="reminder-msg">{reminder.message}</p>
          {reminder.missing.length > 0 ? (
            <p className="faint small" style={{ marginTop: 4 }}>
              Missing: {reminder.missing.join(', ')} · evidence expires{' '}
              {formatDate(reminder.expiresAt)}
            </p>
          ) : null}
        </article>
      ))}
    </>
  );
}

/** Controls that deserve a reminder and have none yet. */
export function DueList({
  statuses,
  titleOf,
  busyId,
  onSend
}: {
  statuses: readonly ControlStatus[];
  titleOf: Map<string, string>;
  busyId: string | null;
  onSend: (controlId: string) => void;
}) {
  return (
    <>
      {statuses.map((status) => (
        <article className="reminder" key={status.controlId}>
          <div className="row-between">
            <span>
              <ControlLink controlId={status.controlId} title={titleOf.get(status.controlId)} />
              <span className="cell-sub">
                expires {formatDate(status.expiresAt)} · {status.pendingProposals} proposal(s)
              </span>
            </span>
            <div className="row">
              <Badge label={stateLabel(status.state)} color={stateColor(status.state)} />
              <Button
                size="sm"
                onClick={() => onSend(status.controlId)}
                disabled={busyId === status.controlId}
              >
                {busyId === status.controlId ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        </article>
      ))}
    </>
  );
}

function ControlLink({ controlId, title }: { controlId: string; title?: string }) {
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost"
      onClick={() => navigate(`/controls/${controlId}`)}
    >
      {controlId} — {title ?? ''}
    </button>
  );
}
