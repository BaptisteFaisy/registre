/* "Prepare draft": generate the pre-filled document of a control (axis 3b). */

import { useState } from 'react';
import type { Draft } from '../../api/types.ts';
import { useApp, usePrincipal } from '../../state/app.tsx';
import { Button } from '../../components/Form.tsx';
import { can } from '../../lib/access.ts';
import { describeError } from '../../lib/hooks.ts';
import { DraftModal } from './DraftModal.tsx';

/** Button that asks the register for a draft and shows it in a modal. */
export function DraftAction({ controlId }: { controlId: string }) {
  const { api } = useApp();
  const principal = usePrincipal();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!can(principal.role, 'upload')) return null;

  const generate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setDraft(await api.generateDraft(controlId));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row">
        {error ? <span className="small error-text">{error}</span> : null}
        <Button onClick={generate} disabled={busy} title="Pre-filled from the partner's previous version">
          {busy ? 'Preparing…' : 'Prepare draft'}
        </Button>
      </div>
      {draft ? <DraftModal draft={draft} onClose={() => setDraft(null)} /> : null}
    </>
  );
}
