/* "Send a reminder" action, available to the roles allowed to notify owners. */

import { useState } from 'react';
import type { ControlState } from '../../api/types.ts';
import { Button } from '../../components/Form.tsx';
import { can } from '../../lib/access.ts';
import { useApp, usePrincipal } from '../../state/app.tsx';

export function ReminderAction({ controlId, state }: { controlId: string; state: ControlState }) {
  const { api } = useApp();
  const principal = usePrincipal();
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!can(principal.role, 'reminders')) return null;

  const send = async (): Promise<void> => {
    setError(null);
    setSent(null);
    try {
      const reminder = await api.sendReminder(controlId);
      setSent(`Reminder sent to ${reminder.recipient}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reminder failed.');
    }
  };

  return (
    <div className="row">
      {sent ? <span className="small faint">{sent}</span> : null}
      {error ? <span className="small error-text">{error}</span> : null}
      <Button onClick={send} disabled={state === 'COVERED'}>
        Send reminder
      </Button>
    </div>
  );
}
