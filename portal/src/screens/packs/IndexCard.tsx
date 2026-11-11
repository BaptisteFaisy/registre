/* Readable index of the pack, one block per control (EF-DOS-01). */

import type { Pack } from '../../api/types.ts';
import { Card, CardBody, CardHeader } from '../../components/Card.tsx';
import { Badge, Tag } from '../../components/Primitives.tsx';
import { Button } from '../../components/Form.tsx';
import { formatDate, formatDateTime, shortHash } from '../../lib/format.ts';
import { stateColor, stateLabel } from '../../lib/states.ts';
import { downloadPackIndex } from '../../lib/download.ts';

export function IndexCard({ pack }: { pack: Pack }) {
  return (
    <Card>
      <CardHeader
        title={`Index of ${pack.id}`}
        subtitle={`${pack.index.length} controls, frozen on ${formatDateTime(pack.frozenAt)}`}
        action={
          <Button size="sm" onClick={() => downloadPackIndex(pack)}>
            Download index
          </Button>
        }
      />
      <CardBody tight>
        {pack.index.map((entry) => (
          <div
            key={entry.controlId}
            style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}
          >
            <div className="row-between">
              <span>
                <span className="mono faint">{entry.controlId}</span>{' '}
                <strong>{entry.controlTitle}</strong>
              </span>
              <Badge label={stateLabel(entry.state)} color={stateColor(entry.state)} />
            </div>
            <PackEvidence entry={entry} />
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function PackEvidence({ entry }: { entry: Pack['index'][number] }) {
  if (entry.evidence.length === 0) {
    return (
      <p className="faint small" style={{ marginTop: 4 }}>
        No evidence in this pack.
      </p>
    );
  }
  return (
    <>
      {entry.evidence.map((evidence) => (
        <div className="pack-entry" key={`${entry.controlId}-${evidence.evidenceId}`}>
          <span>
            <span className="cell-title">{evidence.title ?? evidence.evidenceId}</span>
            <span className="cell-sub">
              {formatDate(evidence.documentDate)} · page {evidence.page ?? '—'} ·{' '}
              {shortHash(evidence.sha256)}
            </span>
          </span>
          <Tag>{evidence.sufficiencyClass ?? '—'}</Tag>
        </div>
      ))}
    </>
  );
}
