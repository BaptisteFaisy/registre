/* The two settings cards: engine parameters and platform parameters. */

import type { Settings } from '../../api/types.ts';
import { Card, CardBody, CardHeader } from '../../components/Card.tsx';
import { Field, Select, TextInput } from '../../components/Form.tsx';
import { formatPeriodicity } from '../../lib/format.ts';

const PERIODICITIES = ['P30D', 'P3M', 'P6M', 'P1Y', 'P2Y'];

interface CardProps {
  draft: Settings;
  onPatch: (part: Partial<Settings>) => void;
}

export function EngineCard({ draft, onPatch }: CardProps) {
  return (
    <Card>
      <CardHeader
        title="Engine"
        subtitle="Changing a value recomputes every control state immediately"
      />
      <CardBody>
        <div className="settings-form">
          <EngineFields draft={draft} onPatch={onPatch} />
        </div>
      </CardBody>
    </Card>
  );
}

function EngineFields({ draft, onPatch }: CardProps) {
  return (
    <>
          <Field
            label="Attachment confidence threshold"
            hint="Attachments at or above this confidence are applied without review."
          >
            <TextInput
              ariaLabel="Confidence threshold"
              value={String(draft.confidenceThreshold)}
              onChange={(value) => onPatch({ confidenceThreshold: Number(value) || 0 })}
            />
          </Field>
          <Field
            label="Reminder lead time (days)"
            hint="Owners are reminded this many days before an evidence expires."
          >
            <TextInput
              ariaLabel="Reminder lead time"
              value={String(draft.reminderLeadDays)}
              onChange={(value) => onPatch({ reminderLeadDays: Number(value) || 0 })}
            />
          </Field>
          <Field label="Default periodicity" hint="Applied to a control imported without one.">
            <Select
              ariaLabel="Default periodicity"
              value={draft.defaultPeriodicity}
              onChange={(value) => onPatch({ defaultPeriodicity: value })}
              options={PERIODICITIES.map((value) => ({
                value,
                label: `${value} — ${formatPeriodicity(value)}`
              }))}
            />
          </Field>
          <Field label="Evidence retention (months)" hint="Retention window of the vault.">
            <TextInput
              ariaLabel="Retention months"
              value={String(draft.retentionMonths)}
              onChange={(value) => onPatch({ retentionMonths: Number(value) || 0 })}
            />
          </Field>
    </>
  );
}

export function PlatformCard({ draft, onPatch }: CardProps) {
  return (
    <Card>
      <CardHeader title="Platform" subtitle="Where the reading and the reasoning happen" />
      <CardBody>
        <div className="settings-form">
          <RegionFields draft={draft} onPatch={onPatch} />
          <ModelFields draft={draft} onPatch={onPatch} />
        </div>
      </CardBody>
    </Card>
  );
}

function RegionFields({ draft, onPatch }: CardProps) {
  return (
    <>
      <Field label="AWS region" hint="Evidence never leaves this region.">
        <TextInput
          ariaLabel="AWS region"
          value={draft.region}
          onChange={(value) => onPatch({ region: value })}
        />
      </Field>
      <Field label="Nightly service tier" hint="Flex keeps the batch cost down.">
        <Select
          ariaLabel="Nightly service tier"
          value={draft.nightlyServiceTier}
          onChange={(value) =>
            onPatch({ nightlyServiceTier: value as Settings['nightlyServiceTier'] })
          }
          options={[
            { value: 'FLEX', label: 'Flex' },
            { value: 'STANDARD', label: 'Standard' }
          ]}
        />
      </Field>
    </>
  );
}

function ModelFields({ draft, onPatch }: CardProps) {
  return (
    <>
      <Field label="Reader model" hint="Bedrock Data Automation field plan.">
            <TextInput
              ariaLabel="Reader model"
              value={draft.readerModel}
              onChange={(value) => onPatch({ readerModel: value })}
            />
          </Field>
          <Field label="Reasoning model" hint="Structured output for attachment and sufficiency.">
            <TextInput
              ariaLabel="Reasoning model"
              value={draft.reasoningModel}
              onChange={(value) => onPatch({ reasoningModel: value })}
            />
          </Field>
          <Field label="Answer model" hint="Composes answers from retrieved passages.">
            <TextInput
              ariaLabel="Answer model"
              value={draft.answerModel}
              onChange={(value) => onPatch({ answerModel: value })}
            />
          </Field>
          <Field label="Guardrail" hint="Anchoring check and personal-data masking.">
        <TextInput
          ariaLabel="Guardrail identifier"
          value={draft.guardrailId ?? ''}
          onChange={(value) => onPatch({ guardrailId: value || null })}
        />
      </Field>
    </>
  );
}
