/* Modal that records a mapping decision with its mandatory reason. */

import { useState } from 'react';
import type { ControlMapping, MappingDecision } from '../../api/types.ts';
import { Button, Modal, TextArea } from '../../components/Form.tsx';

const DECISION_LABEL: Record<MappingDecision, string> = {
  VALIDATE: 'Validate',
  REJECT: 'Reject'
};

export function MappingDecisionModal({
  mapping,
  decision,
  busy,
  onClose,
  onSubmit
}: {
  mapping: ControlMapping;
  decision: MappingDecision;
  busy: boolean;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState('');
  const label = DECISION_LABEL[decision];

  return (
    <Modal
      title={`${label} the mapping ${mapping.sourceControlId} ↔ ${mapping.targetControlId}`}
      onClose={onClose}
      actions={
        <ModalActions
          label={label}
          decision={decision}
          busy={busy}
          note={note}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      }
    >
      <div className="field">
        <span className="label">Reason (mandatory, kept in the audit trail)</span>
        <TextArea
          value={note}
          onChange={setNote}
          ariaLabel="Decision reason"
          placeholder={
            decision === 'VALIDATE'
              ? 'Why these two controls are equivalent…'
              : 'Why these two controls are not equivalent…'
          }
        />
      </div>
    </Modal>
  );
}

function ModalActions({
  label,
  decision,
  busy,
  note,
  onClose,
  onSubmit
}: {
  label: string;
  decision: MappingDecision;
  busy: boolean;
  note: string;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  return (
    <>
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button
        variant={decision === 'REJECT' ? 'danger' : 'primary'}
        disabled={busy || note.trim().length < 3}
        onClick={() => onSubmit(note)}
      >
        {busy ? 'Recording…' : `Record ${label.toLowerCase()}`}
      </Button>
    </>
  );
}
