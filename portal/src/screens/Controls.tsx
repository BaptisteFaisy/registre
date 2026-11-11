/* Control list, filterable by state, domain and owner (EF-FRA-03). */

import type { Control, ControlStatus } from '../api/types.ts';
import { Card, CardBody, CardHeader, ErrorState } from '../components/Card.tsx';
import { DataTable } from '../components/DataTable.tsx';
import { Button } from '../components/Form.tsx';
import { Spinner } from '../components/Primitives.tsx';
import { PageHeader } from '../components/Page.tsx';
import { UploadModal } from '../components/UploadModal.tsx';
import { can } from '../lib/access.ts';
import { navigate } from '../lib/router.ts';
import { usePrincipal } from '../state/app.tsx';
import type { ControlFilters } from '../state/useControlFilters.ts';
import { controlColumns } from './controls/columns.tsx';
import { FilterToolbar, StateCounts } from './controls/FilterToolbar.tsx';
import { useControlsList, useUploadModal } from './controls/useControlsList.ts';

export function ControlsScreen() {
  const principal = usePrincipal();
  const state = useControlsList();
  const modal = useUploadModal();

  return (
    <div className="stack">
      <PageHeader
        title="Controls"
        subtitle="Every requirement of the framework with the state of its evidence. Open a control to read the quoted passages."
        actions={
          can(principal.role, 'upload') ? (
            <Button variant="primary" onClick={modal.openModal}>
              Deposit evidence
            </Button>
          ) : null
        }
      />
      {state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
      <ListCard
        rows={state.rows}
        total={state.list.length}
        statusById={state.statusById}
        filters={state.filters}
        statuses={state.statuses}
        loading={state.loading}
      />
      {modal.open ? (
        <UploadModal
          controls={state.list}
          onClose={modal.close}
          onDone={(result) => {
            modal.close();
            state.reload();
            navigate(`/evidence/${result.evidenceId}`);
          }}
        />
      ) : null}
    </div>
  );
}

interface ListCardProps {
  rows: readonly Control[];
  total: number;
  statusById: Map<string, ControlStatus>;
  filters: ControlFilters;
  statuses: readonly ControlStatus[];
  loading: boolean;
}

function ListCard({ rows, total, statusById, filters, statuses, loading }: ListCardProps) {
  return (
    <Card>
      <CardHeader
        title={`${rows.length} of ${total} controls`}
        subtitle="Filters apply to the whole framework"
        action={<StateCounts statuses={statuses} />}
      />
      <FilterToolbar filters={filters} />
      <CardBody tight>
        {loading ? (
          <div style={{ padding: 16 }}>
            <Spinner label="Loading controls…" />
          </div>
        ) : (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            onRowClick={(row) => navigate(`/controls/${row.id}`)}
            empty="No control matches these filters."
            columns={controlColumns(statusById)}
          />
        )}
      </CardBody>
    </Card>
  );
}
