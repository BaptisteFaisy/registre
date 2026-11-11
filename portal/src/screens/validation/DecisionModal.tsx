/* Modal that records a decision with its mandatory reason (EF-VAL-02). */

import { useState } from 'react';
import type { ValidationDecision } from '../../api/types.ts';
import { Button, Modal, TextArea } from '../../components/Form.tsx';
import { VALIDATION_KIND_LABEL } from '../../lib/states.ts';
import { describeError } from '../../lib/hooks.ts';
import type { PendingChoice } from '../Validation.tsx';
import { DECISION_LABEL } from './QueueRow.tsx';

export function DecisionModal({
  choice,
  onClose,
  onSubmit
}: {
  choice: PendingChoice;
  onClose: () => void;
  onSubmit: (decision: ValidationDecision, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const label = DECISION_LABEL[choice.decision];

  const submit = async (): Promise<void> => {
    setBusy(true);
    setLocalError(null);
    try {
      await onSubmit(choice.decision, note);
    } catch (cause) {
      setLocalError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${label} — ${VALIDATION_KIND_LABEL[choice.item.kind]}`}
      onClose={onClose}
      actions={<ModalActions label={label} busy={busy} note={note} onClose={onClose} onSubmit={submit} decision={choice.decision} />}
    >
      <ReasonField reason={choice.item.reason} note={note} onChange={setNote} error={localError} />
    </Modal>
  );
}

function ModalActions({
  label,
  busy,
  note,
  decision,
  onClose,
  onSubmit
}: {
  label: string;
  busy: boolean;
  note: string;
  decision: ValidationDecision;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button
        variant={decision === 'REJECT' ? 'danger' : 'primary'}
        onClick={onSubmit}
        disabled={busy || note.trim().length < 3}
      >
        {busy ? 'Recording…' : `Record ${label.toLowerCase()}`}
      </Button>
    </>
  );
}

function ReasonField({
  reason,
  note,
  onChange,
  error
}: {
  reason: string;
  note: string;
  onChange: (value: string) => void;
  error: string | null;
}) {
  return (
    <>
      <p className="small muted">{reason}</p>
      <label className="field">
        <span className="label">Reason (required)</span>
        <TextArea
          ariaLabel="Decision reason"
          value={note}
          onChange={onChange}
          placeholder="What you checked, and why you decided this."
        />
      </label>
      {error ? <p className="error-text small">{error}</p> : null}
      <p className="faint small">
        The reason, your name and the date are kept in the audit log (EF-VAL-02).
      </p>
    </>
  );
}
