/* Left column of a control detail: attached evidence and expected elements. */

import type { Control, ControlWithRelations, Evidence, Sufficiency } from '../../api/types.ts';
import { Card, CardBody, CardHeader, Notice } from '../../components/Card.tsx';
import { formatDate } from '../../lib/format.ts';
import { sufficiencyLabel } from '../../lib/states.ts';
import { AttachmentCard } from './AttachmentCard.tsx';

export function EvidenceColumn({ data }: { data: ControlWithRelations }) {
  return (
    <div className="stack">
      <Card>
        <CardHeader
          title="Attached evidence"
          subtitle={`${data.attachments.length} attachment(s) — every one carries a quoted passage`}
        />
        <CardBody>
          {data.attachments.length === 0 ? (
            <Notice>No evidence is attached to this control yet.</Notice>
          ) : (
            data.attachments.map((attachment) => (
              <AttachmentCard
                key={attachment.id}
                attachment={attachment}
                evidence={evidenceOf(data, attachment.evidenceId)}
                sufficiency={sufficiencyOf(data, attachment.id)}
              />
            ))
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Expected evidence"
          subtitle="What a document must contain to support this control"
        />
        <CardBody>
          <ExpectedElements control={data.control} sufficiency={bestSufficiency(data)} />
        </CardBody>
      </Card>
    </div>
  );
}

function evidenceOf(data: ControlWithRelations, evidenceId: string): Evidence | undefined {
  return data.evidence.find((item) => item.id === evidenceId);
}

function sufficiencyOf(data: ControlWithRelations, attachmentId: string): Sufficiency | null {
  return data.sufficiencies.find((item) => item.attachmentId === attachmentId) ?? null;
}

/** Sufficiency of the best applied attachment, used for the element checklist. */
function bestSufficiency(data: ControlWithRelations): Sufficiency | null {
  const applied = data.attachments.find((item) => item.status === 'APPLIED');
  if (!applied) return data.sufficiencies[0] ?? null;
  return data.sufficiencies.find((item) => item.attachmentId === applied.id) ?? null;
}

function ExpectedElements({
  control,
  sufficiency
}: {
  control: Control;
  sufficiency: Sufficiency | null;
}) {
  const byExpected = new Map(
    (sufficiency?.elements ?? []).map((element) => [element.expected, element])
  );
  return (
    <div>
      {control.expectedEvidence.map((expected) => {
        const present = byExpected.get(expected)?.present ?? false;
        return (
          <div className="element" key={expected}>
            <span className={present ? 'element-mark yes' : 'element-mark no'}>
              {present ? '✓' : '✕'}
            </span>
            <span>
              <span className={present ? '' : 'warn-text'}>{expected}</span>
              {!present ? (
                <span className="cell-sub" style={{ display: 'block' }}>
                  missing from the attached evidence
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
      <p className="faint small" style={{ marginTop: 8 }}>
        {sufficiency
          ? `Assessed on ${formatDate(sufficiency.computedAt)} — ${sufficiencyLabel(sufficiency.class)}.`
          : 'No sufficiency assessment yet.'}
      </p>
    </div>
  );
}
