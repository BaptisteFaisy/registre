/* Deposit form: manual upload of one document (EF-COL-02, EF-LEC-01). */

import { useState } from 'react';
import type { AccessLevel, Control } from '../api/types.ts';
import { Button, Modal } from '../components/Form.tsx';
import { describeError } from '../lib/hooks.ts';
import { useApp } from '../state/app.tsx';
import { AccessField, ControlField, FileField } from './UploadFields.tsx';

export interface UploadResult {
  evidenceId: string;
}

interface DepositForm {
  file: File | null;
  controlId: string;
  access: AccessLevel;
  busy: boolean;
  error: string | null;
  setFile: (file: File | null) => void;
  setControlId: (value: string) => void;
  setAccess: (value: AccessLevel) => void;
  submit: () => Promise<void>;
}

/** State and submission of the deposit form. */
function useDeposit(onDone: (result: UploadResult) => void): DepositForm {
  const { api } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [controlId, setControlId] = useState('BCP-02');
  const [access, setAccess] = useState<AccessLevel>('INTERNAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const evidence = await api.uploadEvidence({
        fileName: file.name,
        contentType: file.type || 'application/pdf',
        sizeBytes: file.size,
        suggestedControlId: controlId,
        accessLevel: access
      });
      onDone({ evidenceId: evidence.id });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return { file, controlId, access, busy, error, setFile, setControlId, setAccess, submit };
}

export function UploadModal({
  controls,
  onClose,
  onDone
}: {
  controls: readonly Control[];
  onClose: () => void;
  onDone: (result: UploadResult) => void;
}) {
  const form = useDeposit(onDone);
  return (
    <Modal
      title="Deposit evidence"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={form.submit} disabled={form.busy || !form.file}>
            {form.busy ? 'Reading the document…' : 'Deposit and read'}
          </Button>
        </>
      }
    >
      <p className="small muted">
        The document is read by Bedrock Data Automation, attached to the controls it supports with a
        quoted passage, and assessed element by element. Anything uncertain goes to the validation
        queue.
      </p>
      <FileField file={form.file} onChange={form.setFile} />
      <ControlField controls={controls} value={form.controlId} onChange={form.setControlId} />
      <AccessField value={form.access} onChange={form.setAccess} />
      {form.error ? <p className="error-text small">{form.error}</p> : null}
    </Modal>
  );
}
