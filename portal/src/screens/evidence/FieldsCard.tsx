/* Extracted text (masked when needed) and the fields read by Data Automation. */

import type { Evidence } from '../../api/types.ts';
import { Card, CardBody, CardHeader, KeyValue } from '../../components/Card.tsx';
import { formatDate } from '../../lib/format.ts';
import { maskPersonalData } from '../../lib/redact.ts';

export function ExtractsCard({ evidence }: { evidence: Evidence }) {
  const masked = evidence.fields.personalData;
  return (
    <Card>
      <CardHeader
        title="Extracts"
        subtitle={
          masked
            ? 'Personal data is masked before display (ENF-CONF-02)'
            : 'Verbatim text used for the citations of this document'
        }
      />
      <CardBody>
        {evidence.textPages.map((page) => (
          <div key={page.page} style={{ marginBottom: 12 }}>
            <div className="label">Page {page.page}</div>
            <p className={masked ? 'muted' : ''}>
              {masked ? maskPersonalData(page.text) : page.text}
            </p>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export function FieldsCard({ evidence }: { evidence: Evidence }) {
  const fields = evidence.fields;
  const period =
    fields.period.start || fields.period.end
      ? `${formatDate(fields.period.start)} → ${formatDate(fields.period.end)}`
      : '—';
  return (
    <Card>
      <CardHeader title="Fields read" subtitle="Extracted with Bedrock Data Automation" />
      <CardBody>
        <KeyValue
          items={[
            { label: 'Title', value: fields.title ?? '—' },
            { label: 'Type', value: fields.type ?? '—' },
            { label: 'Document date', value: formatDate(fields.documentDate) },
            { label: 'Period covered', value: period },
            { label: 'Author', value: fields.author ?? <span className="warn-text">not read</span> },
            {
              label: 'Approver',
              value: fields.approver ?? <span className="warn-text">no signature found</span>
            },
            { label: 'Approval date', value: formatDate(fields.approvalDate) },
            { label: 'Client', value: fields.client ?? '—' },
            { label: 'Summary', value: fields.summary ?? '—' }
          ]}
        />
      </CardBody>
    </Card>
  );
}
