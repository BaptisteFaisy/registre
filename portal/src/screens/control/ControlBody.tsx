/* Control detail body: header, state badges and the two columns. */

import type { ControlWithRelations } from '../../api/types.ts';
import { Badge, Tag } from '../../components/Primitives.tsx';
import { PageHeader } from '../../components/Page.tsx';
import { formatPeriodicity } from '../../lib/format.ts';
import { stateColor, stateLabel } from '../../lib/states.ts';
import { EvidenceColumn } from './EvidenceColumn.tsx';
import { StateColumn } from './StateColumn.tsx';
import { ReminderAction } from './ReminderAction.tsx';

export function ControlBody({ data }: { data: ControlWithRelations }) {
  const { control, status } = data;
  return (
    <>
      <PageHeader
        title={`${control.id} — ${control.title}`}
        subtitle={control.requirement}
        actions={<ReminderAction controlId={control.id} state={status.state} />}
      />
      <div className="detail-head" style={{ marginBottom: 16 }}>
        <Badge label={stateLabel(status.state)} color={stateColor(status.state)} />
        <Tag title="Periodicity">{formatPeriodicity(control.periodicity)}</Tag>
        <Tag title="Domain">{control.domain}</Tag>
        <Tag title="Owner">Owner: {control.owner}</Tag>
        {control.mandatory ? <Tag title="Mandatory control">Mandatory</Tag> : null}
      </div>
      <div className="page-grid">
        <EvidenceColumn data={data} />
        <StateColumn data={data} />
      </div>
    </>
  );
}
