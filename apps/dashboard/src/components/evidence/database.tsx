/**
 * C58, C59, C66: the `verification/database` evidence. It shows:
 * - what a pass means, and what it does not;
 * - the source the record came from, labelled sandbox, and what its authority means for a miss;
 * - each match field's entered values beside its level, methods and flags (an address also its
 *   components);
 * - each match group's met, unmet or undecidable result, and the group fields the step did not
 *   collect;
 * - the inquiry comparison and the PO box patterns.
 *
 * Everything comes from this verification answer, which the API masked per operator (C53.7): an
 * entered value reads "Hidden" without `pii:view` and "Redacted" after a redaction. The levels,
 * methods and flags are never values (C51.4), so the API leaves them unmasked. A server
 * component; the only export is the component (`index.test.tsx`).
 */
import type { ReactNode } from 'react';
import { reasonText } from '../../lib/check-reasons';
import { comparisonSourceWords } from '../../lib/comparison-source';
import {
  databaseEvidenceOf,
  type CheckOutcome,
  type DatabaseEvidenceData,
  type DatabaseMatchField,
  type DatabaseVerification,
  type FieldEvidence,
  type RecordedGroup,
  type RecordedMatch,
} from '../../lib/database-evidence';
import {
  DATABASE_PASS_MEANING,
  addressComponentText,
  attributeTerm,
  componentMatchText,
  databaseAuthorityText,
  databaseFieldText,
  groupOutcomeText,
  matchFlagText,
  matchLevelText,
  matchMethodText,
  matchRequirementText,
  poBoxPatternText,
  requirementText,
} from '../../lib/database-words';
import { DataTable, type Column } from '../data-table';
import { Detail } from '../detail';
import { RedactedValue } from '../lifecycle/redacted-value';
import { EmptyValue, MaskedValue } from '../masked-value';
import { Badge, CheckStatusBadge } from '../status-badge';
import { GenericEvidence, type EvidenceProps, type EvidenceState } from './generic';

const muted = (text: string) => <span className="text-ink-muted">{text}</span>;
const code = (text: string) => <code className="font-mono text-xs break-all">{text}</code>;
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const fieldWords = (field: string) => databaseFieldText(field) ?? field;

/** The reasons that say the identity found no record, so nothing could be compared. */
const NO_RECORD: readonly string[] = ['no_matching_record', 'record_not_found'];

/** One entered value as the API sent it: "Hidden" when masked, "Redacted" after a redaction. */
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

/** A result's status, whether it is required or advisory, and its reasons in words. */
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

/** How one field compared, or why nothing is recorded. */
function MatchCell({
  label,
  match,
  evidence,
  state,
}: {
  readonly label: string;
  readonly match: RecordedMatch | null;
  readonly evidence: DatabaseEvidenceData;
  readonly state: EvidenceState;
}) {
  if (match === null) {
    if (!evidence.ran) {
      return muted('Not compared yet');
    }
    if (state === 'redacted') {
      return <RedactedValue />;
    }
    const reasons = evidence.identity?.reasons ?? [];
    if (reasons.some((reason) => NO_RECORD.includes(reason))) {
      return muted('No record to compare');
    }
    return muted(evidence.identity?.status === 'not_applicable' ? 'Not compared' : 'Not recorded');
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">
        <Explained {...matchLevelText(match.level)} />
      </span>
      {match.components.length > 0 && (
        <ul aria-label={`${label} components`} className="flex flex-col text-xs">
          {match.components.map(([component, how]) => (
            <li key={component}>
              {addressComponentText(component) ?? component}:{' '}
              {lowerFirst(componentMatchText(how) ?? how)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Methods({ match }: { readonly match: RecordedMatch | null }) {
  const methods = match?.methods ?? [];
  return methods.length === 0 ? (
    <EmptyValue />
  ) : (
    <>{methods.map((method) => matchMethodText(method) ?? method).join(', ')}</>
  );
}

function Flags({ label, match }: { readonly label: string; readonly match: RecordedMatch | null }) {
  const flags = match?.flags ?? [];
  if (flags.length === 0) {
    return <EmptyValue />;
  }
  return (
    <ul aria-label={`${label} flags`} className="flex flex-col gap-1">
      {flags.map((flag) => {
        const text = matchFlagText(flag);
        return <li key={flag}>{text === undefined ? code(flag) : <Explained {...text} />}</li>;
      })}
    </ul>
  );
}

function fieldColumns(
  verification: DatabaseVerification,
  evidence: DatabaseEvidenceData,
  state: EvidenceState,
): readonly Column<FieldEvidence<DatabaseMatchField>>[] {
  const attributes: Readonly<Record<string, unknown>> = verification.attributes;
  return [
    { id: 'field', header: 'Field', rowHeader: true, cell: (row) => databaseFieldText(row.field) },
    {
      id: 'entered',
      header: 'Entered',
      cell: (row) => (
        <dl className="flex flex-col gap-1">
          {row.members.map((member) => (
            <Detail key={member} term={attributeTerm(member)}>
              <PersonalValue value={attributes[member]} state={state} />
            </Detail>
          ))}
        </dl>
      ),
    },
    {
      id: 'match',
      header: 'Match',
      cell: (row) => (
        <MatchCell
          label={databaseFieldText(row.field)}
          match={row.match}
          evidence={evidence}
          state={state}
        />
      ),
    },
    { id: 'methods', header: 'Methods', cell: (row) => <Methods match={row.match} /> },
    {
      id: 'flags',
      header: 'Flags',
      cell: (row) => <Flags label={databaseFieldText(row.field)} match={row.match} />,
    },
  ];
}

interface GroupRow {
  readonly key: string;
  readonly group: RecordedGroup;
}

function groupColumns(state: EvidenceState): readonly Column<GroupRow>[] {
  return [
    { id: 'group', header: 'Group', rowHeader: true, cell: (row) => row.key },
    {
      id: 'needs',
      header: 'Needs',
      cell: ({ group }) => (
        <ul className="flex flex-col">
          {group.fields.map(([field, requirement]) => (
            <li key={field}>
              {fieldWords(field)}: {lowerFirst(matchRequirementText(requirement))}
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: 'result',
      header: 'Result',
      cell: ({ group }) => {
        if (group.outcome === null) {
          return state === 'redacted' ? <RedactedValue /> : muted('Not recorded');
        }
        return <Explained {...groupOutcomeText(group.outcome)} />;
      },
    },
  ];
}

function Source({ evidence }: { readonly evidence: DatabaseEvidenceData }) {
  const { source } = evidence;
  if (source === null) {
    return muted('Not recorded');
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      {code(source.id)}
      {source.sandbox && <Badge status="sandbox" label="Sandbox provider" tone="attention" />}
    </span>
  );
}

function Authority({ evidence }: { readonly evidence: DatabaseEvidenceData }) {
  return evidence.authoritative === null ? (
    muted('Not recorded')
  ) : (
    <Explained {...databaseAuthorityText(evidence.authoritative)} />
  );
}

function InquiryComparison({ evidence }: { readonly evidence: DatabaseEvidenceData }) {
  const { inquiry } = evidence;
  if (inquiry === null) {
    return null;
  }
  return (
    <Detail term="Inquiry comparison">
      <Outcome outcome={inquiry.outcome} />
      {inquiry.fields.length > 0 && (
        <ul aria-label="Inquiry comparison fields" className="mt-1 flex flex-col">
          {inquiry.fields.map(([field, match]) => (
            <li key={field}>
              {fieldWords(field)}: {lowerFirst(matchLevelText(match.level).words)},{' '}
              {comparisonSourceWords(inquiry.sources[field] ?? null)}
            </li>
          ))}
        </ul>
      )}
      {inquiry.notRequested.length > 0 && (
        <span className="block text-xs text-ink-muted">
          Not collected by the step: {inquiry.notRequested.map(fieldWords).join(', ')}
        </span>
      )}
    </Detail>
  );
}

function PoBox({ evidence }: { readonly evidence: DatabaseEvidenceData }) {
  const { poBox } = evidence;
  if (poBox === null) {
    return null;
  }
  let patterns: ReactNode = null;
  if (poBox.patterns.length > 0) {
    patterns = (
      <ul aria-label="PO box patterns" className="mt-1 flex flex-col">
        {poBox.patterns.map((pattern) => (
          <li key={pattern}>{poBoxPatternText(pattern) ?? code(pattern)}</li>
        ))}
      </ul>
    );
  } else if (poBox.outcome.status === 'passed') {
    patterns = <span className="block">No PO box pattern matched</span>;
  }
  return (
    <Detail term="PO box">
      <Outcome outcome={poBox.outcome} />
      {patterns}
    </Detail>
  );
}

/** C66: the evidence of a `verification/database` (C54.5 replaces the generic view with it). */
export function DatabaseEvidence(props: EvidenceProps) {
  const { verification, label, state } = props;
  if (verification.type !== 'verification/database') {
    return <GenericEvidence {...props} />;
  }
  const evidence = databaseEvidenceOf(verification);
  const groups = evidence.groups.map((group, index) => ({
    key: `Group ${String(index + 1)}`,
    group,
  }));
  return (
    <div role="group" aria-label={`${label} evidence`} className="flex flex-col gap-5">
      <p className="text-sm">
        <span className="font-medium">What a pass means: </span>
        {DATABASE_PASS_MEANING}
      </p>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Detail term="Source">
          <Source evidence={evidence} />
        </Detail>
        <Detail term="Authoritative">
          <Authority evidence={evidence} />
        </Detail>
        <Detail term="Identity">
          {evidence.identity === null ? (
            muted(evidence.ran ? 'Not run by this template' : 'No result yet')
          ) : (
            <Outcome outcome={evidence.identity} />
          )}
        </Detail>
      </dl>
      <DataTable
        caption={`${label} values against the record`}
        columns={fieldColumns(verification, evidence, state)}
        rows={evidence.fields}
        getRowKey={(row) => row.field}
        emptyMessage="No fields."
      />
      <div className="flex flex-col gap-2">
        <DataTable
          caption={`${label} match groups`}
          columns={groupColumns(state)}
          rows={groups}
          getRowKey={(row) => row.key}
          emptyMessage={evidence.ran ? 'No group recorded.' : 'No group recorded yet.'}
        />
        <p className="text-xs text-ink-muted">
          The identity check passes when any group is met, fails only when every group is unmet, and
          otherwise goes to review.
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {evidence.notRequested.length > 0 && (
          <Detail term="Not collected by the step">
            {evidence.notRequested.map(fieldWords).join(', ')}
          </Detail>
        )}
        <InquiryComparison evidence={evidence} />
        <PoBox evidence={evidence} />
      </dl>
    </div>
  );
}
