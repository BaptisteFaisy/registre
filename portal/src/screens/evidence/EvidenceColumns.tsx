/* Two columns of the evidence detail: content on the left, metadata on the right. */

import type { Evidence } from '../../api/types.ts';
import { ExtractsCard, FieldsCard } from './FieldsCard.tsx';
import { IntegrityCard, LocationsCard, FlagsCard, HistoryCard } from './MetaCards.tsx';

export function EvidenceColumns({ evidence }: { evidence: Evidence }) {
  return (
    <div className="page-grid">
      <div className="stack">
        <ExtractsCard evidence={evidence} />
        <FieldsCard evidence={evidence} />
      </div>
      <div className="stack">
        <IntegrityCard evidence={evidence} />
        <LocationsCard evidence={evidence} />
        <FlagsCard evidence={evidence} />
        <HistoryCard evidence={evidence} />
      </div>
    </div>
  );
}
