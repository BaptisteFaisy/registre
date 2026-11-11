/* Data loading of the reminders screen (EF-REL-01/02). */

import { useMemo, useState } from 'react';
import type { ControlState, ControlStatus, Reminder } from '../../api/types.ts';
import { useApp } from '../../state/app.tsx';
import { useApiData, useFramework, useReadiness } from '../../state/useData.ts';
import { describeError } from '../../lib/hooks.ts';

/** States that deserve a reminder from the owner. */
export const DUE_STATES: readonly ControlState[] = [
  'EXPIRED',
  'TO_RENEW',
  'TO_VERIFY',
  'NO_EVIDENCE'
];

export interface RemindersState {
  sent: Reminder[];
  due: ControlStatus[];
  titleOf: Map<string, string>;
  loading: boolean;
  error: string | null;
  busyId: string | null;
  send: (controlId: string) => Promise<void>;
  reload: () => void;
}

/** Loads sent and due reminders, and sends one on demand. */
export function useReminders(): RemindersState {
  const { api } = useApp();
  const framework = useFramework();
  const frameworkId = framework.data?.id ?? null;
  const readiness = useReadiness(frameworkId);
  const reminders = useApiData((client) => client.listReminders());
  const controls = useApiData(
    (client) => (frameworkId ? client.listControls(frameworkId) : Promise.resolve([])),
    [frameworkId]
  );
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const titleOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const control of controls.data ?? []) map.set(control.id, control.title);
    return map;
  }, [controls.data]);

  const sent = reminders.data ?? [];
  const reminded = new Set(sent.map((reminder) => reminder.controlId));
  const due = (readiness.data?.statuses ?? [])
    .filter((status) => DUE_STATES.includes(status.state) && !reminded.has(status.controlId))
    .sort((a, b) => DUE_STATES.indexOf(a.state) - DUE_STATES.indexOf(b.state));

  const send = async (controlId: string): Promise<void> => {
    setBusyId(controlId);
    setError(null);
    try {
      await api.sendReminder(controlId);
      reminders.reload();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusyId(null);
    }
  };

  return {
    sent,
    due,
    titleOf,
    loading: reminders.loading || readiness.loading,
    error: error ?? reminders.error ?? readiness.error,
    busyId,
    send,
    reload: reminders.reload
  };
}
