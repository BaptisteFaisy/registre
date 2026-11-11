/* One attachment: the quoted passage, the confidence and the missing elements. */

import type { Attachment, Evidence, Sufficiency } from '../../api/types.ts';
import { Badge, Meter } from '../../components/Primitives.tsx';
import { Quote } from '../../components/Page.tsx';
import { formatConfidence, formatDate } from '../../lib/format.ts';
import {
  ATTACHMENT_STATUS_COLOR,
  ATTACHMENT_STATUS_LABEL,
  stateColor,
  sufficiencyColor,
  sufficiencyLabel
} from '../../lib/states.ts';
import { navigate } from '../../lib/router.ts';

export function AttachmentCard({
  attachment,
  evidence,
  sufficiency
}: {
  attachment: Attachment;
  evidence: Evidence | undefined;
  sufficiency: Sufficiency | null;
}) {
  return (
    <article className="attach-card">
      <AttachmentHead attachment={attachment} evidence={evidence} sufficiency={sufficiency} />
      <Quote
        text={attachment.quote}
        meta={`page ${attachment.quoteLocation.page ?? '—'} · ${
          attachment.citationVerified
            ? 'quote verified in the document'
            : 'quote not found — attachment rejected'
        }`}
      />
      <AttachmentFoot attachment={attachment} sufficiency={sufficiency} />
    </article>
  );
}

function AttachmentHead({
  attachment,
  evidence,
  sufficiency
}: {
  attachment: Attachment;
  evidence: Evidence | undefined;
  sufficiency: Sufficiency | null;
}) {
  return (
    <div className="attach-top">
      <div>
        <div className="cell-title">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => navigate(`/evidence/${attachment.evidenceId}`)}
          >
            {evidence?.fields.title ?? attachment.evidenceId}
          </button>
        </div>
        <div className="cell-sub">
          {evidence ? formatDate(evidence.fields.documentDate) : '—'} · {attachment.evidenceId}
        </div>
      </div>
      <div className="row">
        <Badge
          label={ATTACHMENT_STATUS_LABEL[attachment.status]}
          color={ATTACHMENT_STATUS_COLOR[attachment.status]}
        />
        {sufficiency ? (
          <Badge
            label={sufficiencyLabel(sufficiency.class)}
            color={sufficiencyColor(sufficiency.class)}
            soft
            dot={false}
          />
        ) : null}
      </div>
    </div>
  );
}

function AttachmentFoot({
  attachment,
  sufficiency
}: {
  attachment: Attachment;
  sufficiency: Sufficiency | null;
}) {
  return (
    <>
      <div className="row-between small faint">
        <span className="row">
          Confidence <Meter value={attachment.confidence} color={stateColor('TO_VERIFY')} />
          {formatConfidence(attachment.confidence)}
        </span>
        <span>
          {attachment.autoApplied ? 'applied above the threshold' : 'applied after review'} ·{' '}
          {attachment.model}
        </span>
      </div>
      {sufficiency && sufficiency.missing.length > 0 ? (
        <div className="small warn-text">Missing: {sufficiency.missing.join(', ')}</div>
      ) : null}
    </>
  );
}
