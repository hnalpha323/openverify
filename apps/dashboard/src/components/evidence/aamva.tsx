/**
 * C59.4–C59.6, C66: the `verification/aamva` evidence. It shows:
 * - what a pass means, and what it does not;
 * - where the values came from: the AAMVA form the user filled, or the inquiry's government ID,
 *   copied by the server for the silent step (the API does not name which ID verification, so
 *   the console says so rather than guess);
 * - the provider, labelled sandbox, and the identity result;
 * - each value beside how the issuing jurisdiction's record answered it (never "no difference"
 *   for a field the answer does not name);
 * - the ignored fields, and what the template does when the jurisdiction does not take part.
 *
 * Everything comes from this verification answer, which the API masked per operator (C53.7): a
 * value reads "Hidden" without `pii:view` and "Redacted" after a redaction. A server component;
 * the only export is the component (`index.test.tsx`).
 */
import { reasonText } from '../../lib/check-reasons';
import {
  aamvaEvidenceOf,
  type AamvaEvidenceData,
  type AamvaFieldEvidence,
  type AamvaSource,
} from '../../lib/aamva-evidence';
import {
  AAMVA_COPIED_FROM,
  AAMVA_PASS_MEANING,
  aamvaFieldAnswerText,
  aamvaSourceText,
  nonParticipationText,
} from '../../lib/aamva-words';
import type { CheckOutcome } from '../../lib/database-evidence';
import { attributeTerm, requirementText } from '../../lib/database-words';
import { DataTable, type Column } from '../data-table';
import { Detail } from '../detail';
import { RedactedValue } from '../lifecycle/redacted-value';
import { EmptyValue, MaskedValue } from '../masked-value';
import { Badge, CheckStatusBadge } from '../status-badge';
import { GenericEvidence, type EvidenceProps, type EvidenceState } from './generic';

const muted = (text: string) => <span className="text-ink-muted">{text}</span>;
const code = (text: string) => <code className="font-mono text-xs break-all">{text}</code>;

function Explained({
  words,
  explanation,
}: {
  readonly words: string;
  readonly explanation?: string;
}) {
  return (
    <>
      <span>{words}</span>
      {explanation !== undefined && (
        <span className="block text-xs text-ink-muted">{explanation}</span>
      )}
    </>
  );
}

/** One value as the API sent it: "Hidden" when masked, "Redacted" after a redaction. */
function PersonalValue({
  value,
  state,
}: {
  readonly value: unknown;
  readonly state: EvidenceState;
}) {
  const text = typeof value === 'string' ? value : null;
  if (state === 'redacted' && text === null) {
    return <RedactedValue />;
  }
  return <MaskedValue value={text} masked={state === 'hidden'} />;
}

function Outcome({ outcome }: { readonly outcome: CheckOutcome }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <CheckStatusBadge status={outcome.status} />
      <span>{requirementText(outcome.required)}</span>
      {outcome.reasons.map((reason) => (
        <span key={reason}>{reasonText(reason, outcome.name)?.words ?? code(reason)}</span>
      ))}
    </span>
  );
}

function ValuesFrom({ source }: { readonly source: AamvaSource | null }) {
  if (source === null) {
    return muted('Not recorded yet');
  }
  return (
    <>
      <Explained {...aamvaSourceText(source)} />
      {source === 'government_id' && (
        <span className="block text-xs text-ink-muted">{AAMVA_COPIED_FROM}</span>
      )}
    </>
  );
}

function Provider({ evidence }: { readonly evidence: AamvaEvidenceData }) {
  const { provider } = evidence;
  if (provider === null) {
    return muted('Not recorded');
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      {code(provider.id)}
      {provider.sandbox && <Badge status="sandbox" label="Sandbox provider" tone="attention" />}
    </span>
  );
}

function NonParticipation({ evidence }: { readonly evidence: AamvaEvidenceData }) {
  // C59.6: the silent step always skips; only the form source follows the template.
  if (evidence.source === 'government_id') {
    return <Explained words="Skip the step" explanation="The silent step always skips." />;
  }
  const choice = evidence.onNonParticipation;
  return choice === null ? (
    muted('Not recorded')
  ) : (
    <>{nonParticipationText(choice) ?? code(choice)}</>
  );
}

function Answer({
  field,
  value,
  evidence,
  state,
}: {
  readonly field: AamvaFieldEvidence;
  readonly value: unknown;
  readonly evidence: AamvaEvidenceData;
  readonly state: EvidenceState;
}) {
  const { answer } = field;
  if (answer !== 'routing') {
    if (!evidence.ran) {
      return muted(evidence.skipped ? 'Skipped, not compared' : 'Not compared yet');
    }
    if (state === 'redacted') {
      return <RedactedValue />;
    }
    if (state === 'visible' && typeof value !== 'string') {
      return muted('Not sent');
    }
  }
  if (answer === null) {
    return muted('Not recorded');
  }
  return <Explained {...aamvaFieldAnswerText(answer)} />;
}

function columns(
  attributes: Readonly<Record<string, unknown>>,
  evidence: AamvaEvidenceData,
  state: EvidenceState,
): readonly Column<AamvaFieldEvidence>[] {
  return [
    { id: 'field', header: 'Field', rowHeader: true, cell: (row) => attributeTerm(row.member) },
    {
      id: 'value',
      header: 'Value',
      cell: (row) => <PersonalValue value={attributes[row.member]} state={state} />,
    },
    {
      id: 'answer',
      header: 'Issuer’s record',
      cell: (row) => (
        <Answer field={row} value={attributes[row.member]} evidence={evidence} state={state} />
      ),
    },
  ];
}

/** C66: the evidence of a `verification/aamva` (C54.5 replaces the generic view with it). */
export function AamvaEvidence(props: EvidenceProps) {
  const { verification, label, state } = props;
  if (verification.type !== 'verification/aamva') {
    return <GenericEvidence {...props} />;
  }
  const evidence = aamvaEvidenceOf(verification);
  const attributes: Readonly<Record<string, unknown>> = verification.attributes;
  let pending = 'No result yet';
  if (evidence.ran) {
    pending = 'Not run by this template';
  } else if (evidence.skipped) {
    pending = 'Skipped';
  }
  return (
    <div role="group" aria-label={`${label} evidence`} className="flex flex-col gap-5">
      <p className="text-sm">
        <span className="font-medium">What a pass means: </span>
        {AAMVA_PASS_MEANING}
      </p>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Detail term="Values from">
          <ValuesFrom source={evidence.source} />
        </Detail>
        <Detail term="Provider">
          <Provider evidence={evidence} />
        </Detail>
        <Detail term="Identity">
          {evidence.identity === null ? muted(pending) : <Outcome outcome={evidence.identity} />}
        </Detail>
        <Detail term="Ignored fields">
          {evidence.ignoredFields.length === 0 ? (
            <EmptyValue />
          ) : (
            evidence.ignoredFields.map(attributeTerm).join(', ')
          )}
        </Detail>
        <Detail term="If the jurisdiction does not take part">
          <NonParticipation evidence={evidence} />
        </Detail>
      </dl>
      <DataTable
        caption={`${label} values against the issuer’s record`}
        columns={columns(attributes, evidence, state)}
        rows={evidence.fields}
        getRowKey={(row) => row.member}
        emptyMessage="No values."
      />
    </div>
  );
}
