/* Reminders sent to control owners, and the ones still due (EF-REL-01/02). */

import { Card, CardBody, CardHeader, EmptyState, ErrorState } from '../components/Card.tsx';
import { Spinner } from '../components/Primitives.tsx';
import { PageHeader } from '../components/Page.tsx';
import { SentList, DueList } from './reminders/ReminderLists.tsx';
import { useReminders } from './reminders/useReminders.ts';

export function RemindersScreen() {
  const state = useReminders();
  return (
    <div className="stack">
      <PageHeader
        title="Reminders"
        subtitle="A reminder names the control owner and the evidence still missing. It is never a generic nudge."
      />
      {state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
      {state.loading ? <Spinner label="Loading the reminders…" /> : null}
      <div className="page-grid">
        <Card>
          <CardHeader
            title={`${state.sent.length} reminder(s) sent`}
            subtitle="Kept in the audit trail"
          />
          <CardBody>
            {state.sent.length === 0 ? (
              <EmptyState>No reminder sent yet.</EmptyState>
            ) : (
              <SentList reminders={state.sent} titleOf={state.titleOf} />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title={`${state.due.length} reminder(s) due`}
            subtitle="Controls that are not covered and have no reminder yet"
          />
          <CardBody>
            {state.due.length === 0 ? (
              <EmptyState>Every uncovered control already has a reminder.</EmptyState>
            ) : (
              <DueList
                statuses={state.due}
                titleOf={state.titleOf}
                busyId={state.busyId}
                onSend={state.send}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
