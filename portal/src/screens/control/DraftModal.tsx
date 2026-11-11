/* The generated draft: watermark, sections to complete, markdown download. */

import type { Draft, DraftSection } from '../../api/types.ts';
import { Notice } from '../../components/Card.tsx';
import { Button, Modal } from '../../components/Form.tsx';
import { Tag } from '../../components/Primitives.tsx';
import { formatDateTime } from '../../lib/format.ts';
import { downloadDraft, draftProgress, draftProgressLabel } from '../../lib/draft.ts';

/** Read-only view of a draft — a draft is never evidence, never attachable. */
export function DraftModal({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  return (
    <Modal
      title={draft.title}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" onClick={() => downloadDraft(draft)}>
            Download markdown
          </Button>
        </>
      }
    >
      <div className="draft-watermark">
        <strong>{draft.watermark}</strong>
      </div>
      <DraftMeta draft={draft} />
      <DraftNotice draft={draft} />
      <div className="draft-sections">
        {draft.sections.map((section) => (
          <DraftSectionView key={section.expected} section={section} />
        ))}
      </div>
    </Modal>
  );
}

/** Generation date, carried-over evidence and progress, as tags. */
function DraftMeta({ draft }: { draft: Draft }) {
  return (
    <div className="row" style={{ margin: '8px 0 12px' }}>
      <Tag title="Generated at">{formatDateTime(draft.createdAt)}</Tag>
      <Tag title="Sections the owner must write">{draftProgressLabel(draft)}</Tag>
      {draft.basedOn.map((id) => (
        <Tag key={id} title="Carried over from the partner's previous version">
          from <span className="mono">{id}</span>
        </Tag>
      ))}
      <Tag title="A draft cannot be attached">{draft.attachable ? 'attachable' : 'not attachable'}</Tag>
    </div>
  );
}

function DraftNotice({ draft }: { draft: Draft }) {
  const remaining = draftProgress(draft).toComplete;
  if (remaining === 0) {
    return (
      <Notice tone="info">
        Every expected element was carried over. Read it, complete what is outdated, sign it and
        deposit it: it only becomes evidence through the normal ingest path.
      </Notice>
    );
  }
  return (
    <Notice>
      {remaining} section(s) are left to write. The register never invents them: a draft becomes
      evidence only when a human completes it, signs it and deposits it.
    </Notice>
  );
}

/** One expected element: carried text, or an explicit hole to fill. */
function DraftSectionView({ section }: { section: DraftSection }) {
  return (
    <div className={section.toComplete ? 'draft-section draft-todo' : 'draft-section'}>
      <div className="label">
        {section.expected}
        {section.toComplete ? <span className="draft-flag">to complete</span> : null}
      </div>
      {section.toComplete ? (
        <span className="faint small">_To complete: {section.expected}._</span>
      ) : (
        <p className="small">{section.body}</p>
      )}
    </div>
  );
}
