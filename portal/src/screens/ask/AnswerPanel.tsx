/* Answer of the register, with its citations (EF-QR-01, EF-QR-02). */

import type { Answer } from '../../api/types.ts';
import { Card, CardBody, CardHeader } from '../../components/Card.tsx';
import { Badge, Tag } from '../../components/Primitives.tsx';
import { Quote } from '../../components/Page.tsx';
import { formatDate, formatUsd } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';

export function AnswerPanel({ answer }: { answer: Answer }) {
  return (
    <div className="stack">
      <div className={answer.noEvidence ? 'answer answer-noevidence' : 'answer'}>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <span className="label">Answer</span>
          <AnswerBadges answer={answer} />
        </div>
        <p className="answer-text">{answer.text}</p>
        {answer.noEvidence ? (
          <p className="faint small" style={{ marginTop: 8 }}>
            The register does not infer an answer from the absence of a document. Add the evidence or
            ask the control owner for it.
          </p>
        ) : null}
      </div>
      {answer.citations.length > 0 ? <Citations answer={answer} /> : null}
    </div>
  );
}

function AnswerBadges({ answer }: { answer: Answer }) {
  return (
    <div className="row">
      {answer.noEvidence ? (
        <Badge label="No evidence" color="var(--warn)" />
      ) : (
        <Badge label="Grounded in evidence" color="var(--ok)" />
      )}
      {answer.redacted ? <Tag>Personal data masked</Tag> : null}
      <Tag>{answer.passagesUsed} passage(s)</Tag>
      {answer.cost ? <Tag>{formatUsd(answer.cost.usd)}</Tag> : null}
    </div>
  );
}

function Citations({ answer }: { answer: Answer }) {
  return (
    <Card>
      <CardHeader
        title="Citations"
        subtitle="Each statement of the answer is anchored in one of these passages"
      />
      <CardBody>
        {answer.citations.map((citation, index) => (
          <div className="citation" key={`${citation.evidenceId}-${citation.page}-${index}`}>
            <div className="row-between">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => navigate(`/evidence/${citation.evidenceId}`)}
              >
                {citation.title ?? citation.evidenceId}
              </button>
              <span className="faint small">
                page {citation.page ?? '—'} · {formatDate(citation.documentDate)} ·{' '}
                {citation.evidenceId}
              </span>
            </div>
            <Quote text={citation.quote} />
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
