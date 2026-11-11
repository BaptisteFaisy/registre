/* Integrity, locations, reading flags and history of one evidence. */

import type { Evidence, EvidenceLocation } from '../../api/types.ts';
import { Card, CardBody, CardHeader, Notice } from '../../components/Card.tsx';
import { Badge, Tag } from '../../components/Primitives.tsx';
import { formatBytes, formatDateTime, formatUsd, shortHash } from '../../lib/format.ts';
import { shortContentType } from '../../lib/titles.ts';

export function IntegrityCard({ evidence }: { evidence: Evidence }) {
  return (
    <Card>
      <CardHeader
        title="Integrity"
        subtitle="Fingerprint computed on entry, verified on export"
      />
      <CardBody>
        <div className="label">SHA-256</div>
        <div className="hash">{evidence.sha256}</div>
        <div className="row-between small faint" style={{ marginTop: 8 }}>
          <span>Short form {shortHash(evidence.sha256)}</span>
          <span>
            {formatBytes(evidence.sizeBytes)} · {shortContentType(evidence.contentType)}
          </span>
        </div>
        {evidence.cost ? (
          <div className="loc" style={{ marginTop: 8 }}>
            <span className="faint">Read cost</span>
            <span>
              {formatUsd(evidence.cost.usd)} · {evidence.cost.source}
            </span>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function LocationsCard({ evidence }: { evidence: Evidence }) {
  return (
    <Card>
      <CardHeader
        title="Locations"
        subtitle={`${evidence.locations.length} stored object(s), duplicates flagged`}
      />
      <CardBody tight>
        {evidence.locations.map((location) => (
          <LocationRow key={location.uri} location={location} />
        ))}
      </CardBody>
    </Card>
  );
}

function LocationRow({ location }: { location: EvidenceLocation }) {
  return (
    <div className="loc" style={{ padding: '8px 16px' }}>
      <span style={{ minWidth: 0 }}>
        <span
          className="mono"
          style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {location.uri}
        </span>
        <span className="cell-sub">
          {location.kind} · {formatDateTime(location.collectedAt)}
        </span>
      </span>
      {location.duplicate ? <Badge label="Duplicate" color="var(--warn)" /> : <Tag>Primary</Tag>}
    </div>
  );
}

export function FlagsCard({ evidence }: { evidence: Evidence }) {
  const flags = evidence.flags;
  return (
    <Card>
      <CardHeader title="Reading flags" subtitle="Warnings that force a human review" />
      <CardBody>
        <div className="flag-list">
          <Flag on={flags.unreadable} label="Unreadable document" />
          <Flag on={flags.missingDate} label="Date missing" />
          <Flag on={flags.missingAuthor} label="Author missing" />
          <Flag on={flags.dateToConfirm} label="Date to confirm" />
          <Flag on={evidence.fields.personalData} label="Personal data" />
        </div>
      </CardBody>
    </Card>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={on ? 'badge' : 'badge badge-soft flag-off'} style={on ? { color: 'var(--warn)', background: 'rgba(210,153,34,0.14)' } : undefined}>
      {on ? <span className="badge-dot" style={{ background: 'var(--warn)' }} /> : null}
      {label}
    </span>
  );
}

export function HistoryCard({ evidence }: { evidence: Evidence }) {
  return (
    <Card>
      <CardHeader title="History" subtitle="What happened to this document" />
      <CardBody>
        <div className="loc">
          <span className="faint">Collected</span>
          <span>{formatDateTime(evidence.ingestedAt)}</span>
        </div>
        <div className="loc">
          <span className="faint">Read</span>
          <span>{evidence.reader}</span>
        </div>
        <div className="loc">
          <span className="faint">Revision</span>
          <span>{evidence.revision}</span>
        </div>
        {evidence.locations.some((location) => location.duplicate) ? (
          <Notice>
            The same content was stored twice under two names. The register keeps one evidence with
            two locations and increments its revision.
          </Notice>
        ) : null}
      </CardBody>
    </Card>
  );
}
