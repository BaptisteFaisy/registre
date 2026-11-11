/* Control detail: requirement, expected evidence, attachments with quotes. */

import { useApiData } from '../state/useData.ts';
import { ErrorState } from '../components/Card.tsx';
import { Spinner } from '../components/Primitives.tsx';
import { Crumbs } from '../components/Page.tsx';
import { navigate } from '../lib/router.ts';
import { ControlBody } from './control/ControlBody.tsx';

export function ControlDetailScreen({ controlId }: { controlId: string }) {
  const state = useApiData((api) => api.getControl(controlId), [controlId]);
  const data = state.data;

  return (
    <div className="stack">
      <Crumbs
        items={[{ label: 'Controls', onClick: () => navigate('/controls') }, { label: controlId }]}
      />
      {state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
      {state.loading && !data ? <Spinner label="Opening the control…" /> : null}
      {data ? <ControlBody data={data} /> : null}
    </div>
  );
}
