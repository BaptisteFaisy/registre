/* Archive details, known gaps and the list of frozen packs (EF-DOS-02/03). */

import type { Pack } from '../../api/types.ts';
import { Card, CardBody, CardHeader, EmptyState, KeyValue } from '../../components/Card.tsx';
import { Badge } from '../../components/Primitives.tsx';
import { Button } from '../../components/Form.tsx';
import { formatBytes, formatDateTime } from '../../lib/format.ts';
import { stateColor } from '../../lib/states.ts';
import { downloadPackIndex } from '../../lib/download.ts';
import { navigate } from '../../lib/router.ts';

export function ArchiveCard({ pack }: { pack: Pack }) {
  return (
    <Card>
      <CardHeader title="Archive" subtitle="Integrity checked at export" />
      <CardBody>
        <KeyValue
          items={[
            { label: 'Pack', value: <span className="mono">{pack.id}</span> },
            { label: 'Frozen at', value: formatDateTime(pack.frozenAt) },
            { label: 'Objects', value: `${pack.index.length} controls` },
            { label: 'Size', value: formatBytes(pack.archive.sizeBytes) },
            { label: 'Archive', value: <span className="mono small">{pack.archive.uri}</span> },
            { label: 'SHA-256', value: <span className="hash">{pack.archive.sha256}</span> },
            {
              label: 'Checksums',
              value: pack.checksumsVerified ? (
                <Badge label="Verified" color="var(--ok)" />
              ) : (
                <Badge label="Not verified" color="var(--bad)" />
              )
            }
          ]}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <Button onClick={() => downloadPackIndex(pack)}>Download index</Button>
          <Button variant="primary" onClick={() => navigate(`/verify/${pack.id}`)}>
            Verify
          </Button>
          <Button
            variant="ghost"
            onClick={() => window.open(pack.archive.uri, '_blank')}
            title="The archive is served by the API in production"
          >
            Open archive
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function GapsCard({ pack }: { pack: Pack }) {
  return (
    <Card>
      <CardHeader
        title="Known gaps"
        subtitle="Stated in the pack so no reader over-reads the register"
      />
      <CardBody tight>
        {pack.knownGaps.length === 0 ? (
          <EmptyState>No known gap at the freeze date.</EmptyState>
        ) : (
          pack.knownGaps.map((gap) => (
            <div className="gap-row" key={gap.controlId} style={{ padding: '8px 16px' }}>
              <span className="dot" style={{ background: stateColor(gap.state), marginTop: 6 }} />
              <span>
                <span className="mono faint">{gap.controlId}</span> {gap.detail}
              </span>
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}

export function PackListCard({
  packs,
  selectedId,
  onSelect
}: {
  packs: readonly Pack[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader title="All packs" subtitle="Frozen snapshots kept for reproduction" />
      <CardBody tight>
        {packs.map((pack) => (
          <div className="loc" key={pack.id} style={{ padding: '8px 16px' }}>
            <span>
              <span className="mono">{pack.id}</span>
              <span className="cell-sub">
                {formatDateTime(pack.frozenAt)} · {pack.knownGaps.length} gap(s)
              </span>
            </span>
            <Button
              size="sm"
              variant={pack.id === selectedId ? 'primary' : 'default'}
              onClick={() => onSelect(pack.id)}
            >
              {pack.id === selectedId ? 'Shown' : 'Show'}
            </Button>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
