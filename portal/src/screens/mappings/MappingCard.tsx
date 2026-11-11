/* One correspondence: two controls, two quotes, one human decision. */

import type { ControlMapping, MappingDecision } from '../../api/types.ts';
import { Card, CardBody } from '../../components/Card.tsx';
import { Quote } from '../../components/Page.tsx';
import { Badge, Meter, Tag } from '../../components/Primitives.tsx';
import { Button } from '../../components/Form.tsx';
import { formatDate } from '../../lib/format.ts';
import {
  confidenceColor,
  directionLabel,
  mappingConfidenceLabel,
  mappingStatusMeta
} from '../../lib/mappings.ts';

interface MappingCardProps {
  mapping: ControlMapping;
  busy: boolean;
  onDecide: (decision: MappingDecision) => void;
}

export function MappingCard({ mapping, busy, onDecide }: MappingCardProps) {
  return (
    <Card>
      <CardBody>
        <MappingHead mapping={mapping} />
        <div className="mapping-grid">
          <MappingSide
            heading="Source"
            frameworkId={mapping.sourceFrameworkId}
            controlId={mapping.sourceControlId}
            quote={mapping.sourceQuote}
          />
          <MappingSide
            heading="Target"
            frameworkId={mapping.targetFrameworkId}
            controlId={mapping.targetControlId}
            quote={mapping.targetQuote}
          />
        </div>
        <p className="faint small mapping-reason">
          {mapping.reason} — proposed by {mapping.proposedBy} on {formatDate(mapping.proposedAt)}.
        </p>
        <MappingFooter mapping={mapping} busy={busy} onDecide={onDecide} />
      </CardBody>
    </Card>
  );
}

/** Status, confidence and the citation-verification mark. */
function MappingHead({ mapping }: { mapping: ControlMapping }) {
  const meta = mappingStatusMeta(mapping.status);
  return (
    <div className="row-between mapping-head">
      <span className="row">
        <Badge label={meta.label} color={meta.color} />
        <Meter value={mapping.confidence} color={confidenceColor(mapping.confidence)} />
        <span className="small">{mappingConfidenceLabel(mapping.confidence)} confidence</span>
        <Tag title="Direction">{directionLabel(mapping.direction)}</Tag>
        {mapping.citationVerified ? (
          <Tag title="Both quotes were found in the control texts by code">quotes verified</Tag>
        ) : (
          <Tag title="At least one quote was not found in the control texts">
            quote NOT verified
          </Tag>
        )}
      </span>
      <span className="mono faint small">{mapping.id.slice(0, 40)}</span>
    </div>
  );
}

function MappingSide({
  heading,
  frameworkId,
  controlId,
  quote
}: {
  heading: string;
  frameworkId: string;
  controlId: string;
  quote: string;
}) {
  return (
    <div className="mapping-side">
      <div className="label">
        {heading} — <span className="mono">{controlId}</span>{' '}
        <span className="faint small">({frameworkId})</span>
      </div>
      <Quote text={quote} />
    </div>
  );
}

/** Pending: the two decision buttons. Decided: the author, date and reason. */
function MappingFooter({ mapping, busy, onDecide }: MappingCardProps) {
  if (mapping.status !== 'PROPOSED') {
    return (
      <p className="small faint">
        {mapping.status === 'VALIDATED' ? 'Validated' : 'Rejected'} by {mapping.validatedBy ?? '—'}{' '}
        on {formatDate(mapping.validatedAt ?? null)}
        {mapping.note ? ` — “${mapping.note}”` : ''}
      </p>
    );
  }
  return (
    <div className="row">
      <Button variant="primary" size="sm" disabled={busy} onClick={() => onDecide('VALIDATE')}>
        Validate
      </Button>
      <Button variant="danger" size="sm" disabled={busy} onClick={() => onDecide('REJECT')}>
        Reject
      </Button>
      <span className="faint small">
        A mapping is never applied by the model: your decision makes the equivalence.
      </span>
    </div>
  );
}
