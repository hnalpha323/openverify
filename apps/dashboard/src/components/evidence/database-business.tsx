/**
 * C61, C66: the `verification/database-business` evidence. It shows:
 * - what a pass means, and what it does not;
 * - the register, labelled sandbox, and what its authority means for a miss;
 * - the register's record id, legal name and status, and how the status was read with its flags;
 * - the entered business beside each match field's level, methods and flags, and the LEI;
 * - each match group's met, unmet or undecidable result;
 * - the associated persons entered and how many the register lists (an advisory check), with who
 *   a register lists;
 * - the country allowlist and whether a register covers the country.
 *
 * Everything comes from this verification answer, which the API masked per operator (C53.7): a
 * personal value reads "Hidden" without `pii:view`, and a value a redaction removed "Redacted".
 * The registration number, LEI, record id and status are not personal data, so the API never
 * masks them. A server component; the only export is the component (`index.test.tsx`).
 */
import { PII_VERIFICATION_ATTRIBUTES } from '@openverify/contracts';
import type { ReactNode } from 'react';
import { reasonText } from '../../lib/check-reasons';
import {
  databaseBusinessEvidenceOf,
  type BusinessMatchField,
  type DatabaseBusinessEvidenceData,
  type DatabaseBusinessVerification,
} from '../../lib/database-business-evidence';
import {
  ASSOCIATED_PERSONS_NOTE,
  DATABASE_BUSINESS_PASS_MEANING,
  businessAuthorityText,
  businessFieldText,
  registryFlagText,
  registrySourceText,
  statusReadingText,
} from '../../lib/database-business-words';
import type {
  CheckOutcome,
  FieldEvidence,
  RecordedGroup,
  RecordedMatch,
} from '../../lib/database-evidence';
import {
  addressComponentText,
  attributeTerm,
  componentMatchText,
  groupOutcomeText,
  matchFlagText,
  matchLevelText,
  matchMethodText,
  matchRequirementText,
  requirementText,
} from '../../lib/database-words';
import { DataTable, type Column } from '../data-table';
import { Detail } from '../detail';
import { RedactedValue } from '../lifecycle/redacted-value';
import { EmptyValue, MaskedValue } from '../masked-value';
import { Badge, CheckStatusBadge } from '../status-badge';
import { GenericEvidence, type EvidenceProps, type EvidenceState } from './generic';

const PII: ReadonlySet<string> = new Set(PII_VERIFICATION_ATTRIBUTES);
const muted = (text: string) => <span className="text-ink-muted">{text}</span>;
const code = (text: string) => <code className="font-mono text-xs break-all">{text}</code>;
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const fieldWords = (field: string) => businessFieldText(field) ?? field;

/** The reasons that say no register record was found, so nothing could be compared. */
const NO_RECORD: readonly string[] = ['registration_number_not_found', 'no_registry_record'];

type Attributes = Readonly<Record<string, unknown>>;

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

/**
 * One attribute as the API sent it: "Redacted" once a redaction removed it, "Hidden" for a
 * personal value the API masked, an em dash for a value that is absent.
 */
function Value({
  name,
  attributes,
  state,
}: {
  readonly name: string;
  readonly attributes: Attributes;
  readonly state: EvidenceState;
}) {
  const value = attributes[name];
  const text = typeof value === 'string' ? value : null;
  if (state === 'redacted' && text === null) {
    return <RedactedValue />;
  }
  return <MaskedValue value={text} masked={state === 'hidden' && PII.has(name)} />;
}

function Outcome({ outcome }: { readonly outcome: CheckOutcome | null }) {
  if (outcome === null) {
    return muted('No result');
  }
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

function Register({
  source,
  evidence,
}: {
  readonly source: DatabaseBusinessVerification['attributes']['registry-source'];
  readonly evidence: DatabaseBusinessEvidenceData;
}) {
  const { provider } = evidence;
  let name: ReactNode = muted('Not recorded');
  if (typeof source === 'string') {
    name = registrySourceText(source);
  } else if (provider !== null) {
    name = code(provider.id);
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      {name}
      {provider?.sandbox === true && (
        <Badge status="sandbox" label="Sandbox provider" tone="attention" />
      )}
    </span>
  );
}

function StatusRead({ evidence }: { readonly evidence: DatabaseBusinessEvidenceData }) {
  return (
    <>
      {evidence.reading === null ? (
        muted('Not recorded')
      ) : (
        <Explained {...statusReadingText(evidence.reading)} />
      )}
      {evidence.flags.length > 0 && (
        <ul aria-label="Status flags" className="mt-1 flex flex-col gap-1">
          {evidence.flags.map((flag) => {
            const flagText = registryFlagText(flag);
            return (
              <li key={flag}>
                {flagText === undefined ? code(flag) : <Explained {...flagText} />}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function MatchCell({
  label,
  match,
  evidence,
  state,
}: {
  readonly label: string;
  readonly match: RecordedMatch | null;
  readonly evidence: DatabaseBusinessEvidenceData;
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
  attributes: Attributes,
  evidence: DatabaseBusinessEvidenceData,
  state: EvidenceState,
): readonly Column<FieldEvidence<BusinessMatchField>>[] {
  return [
    { id: 'field', header: 'Field', rowHeader: true, cell: (row) => businessFieldText(row.field) },
    {
      id: 'entered',
      header: 'Entered',
      cell: (row) => (
        <dl className="flex flex-col gap-1">
          {row.members.map((member) => (
            <Detail key={member} term={attributeTerm(member)}>
              <Value name={member} attributes={attributes} state={state} />
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
          label={businessFieldText(row.field)}
          match={row.match}
          evidence={evidence}
          state={state}
        />
      ),
    },
    {
      id: 'methods',
      header: 'Methods',
      cell: (row) => {
        const methods = row.match?.methods ?? [];
        return methods.length === 0 ? (
          <EmptyValue />
        ) : (
          methods.map((method) => matchMethodText(method) ?? method).join(', ')
        );
      },
    },
    {
      id: 'flags',
      header: 'Flags',
      cell: (row) => <Flags label={businessFieldText(row.field)} match={row.match} />,
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

/** The persons entered (masked whole, C53.7), each person's members as entered. */
function EnteredPersons({
  attributes,
  state,
}: {
  readonly attributes: Attributes;
  readonly state: EvidenceState;
}) {
  const persons = attributes['associated-persons'];
  if (!Array.isArray(persons)) {
    if (state === 'redacted') {
      return <RedactedValue />;
    }
    return state === 'hidden' ? <MaskedValue value={null} masked /> : muted('None entered');
  }
  if (persons.length === 0) {
    return muted('None entered');
  }
  return (
    <ul aria-label="Associated persons entered" className="mt-1 flex flex-col gap-2">
      {(persons as unknown[]).map((person, index) => {
        const members: Attributes =
          typeof person === 'object' && person !== null ? (person as Attributes) : {};
        return (
          // The persons have no identity of their own; their order is the API's.
          <li key={index}>
            <dl className="grid grid-cols-3 gap-2 border-l border-line pl-3">
              {['name-first', 'name-last', 'birthdate'].map((member) => {
                const value = members[member];
                return (
                  <Detail key={member} term={attributeTerm(member)}>
                    <MaskedValue value={typeof value === 'string' ? value : null} masked={false} />
                  </Detail>
                );
              })}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

function Persons({
  attributes,
  evidence,
  state,
}: {
  readonly attributes: Attributes;
  readonly evidence: DatabaseBusinessEvidenceData;
  readonly state: EvidenceState;
}) {
  const { persons, matched, unmatched, undecided, outcome } = evidence.persons;
  return (
    <>
      <Outcome outcome={outcome} />
      <EnteredPersons attributes={attributes} state={state} />
      {persons !== null && (
        <span className="mt-1 block">
          {String(persons)} compared: {String(matched ?? 0)} matched, {String(unmatched ?? 0)} not
          on the register, {String(undecided ?? 0)} could not be compared
        </span>
      )}
      <span className="mt-1 block text-xs text-ink-muted">{ASSOCIATED_PERSONS_NOTE}</span>
    </>
  );
}

/** C66: the evidence of a `verification/database-business` (C54.5). */
export function DatabaseBusinessEvidence(props: EvidenceProps) {
  const { verification, label, state } = props;
  if (verification.type !== 'verification/database-business') {
    return <GenericEvidence {...props} />;
  }
  const evidence = databaseBusinessEvidenceOf(verification);
  const attributes: Attributes = verification.attributes;
  const groups = evidence.groups.map((group, index) => ({
    key: `Group ${String(index + 1)}`,
    group,
  }));
  const status = attributes['registry-status'];
  return (
    <div role="group" aria-label={`${label} evidence`} className="flex flex-col gap-5">
      <p className="text-sm">
        <span className="font-medium">What a pass means: </span>
        {DATABASE_BUSINESS_PASS_MEANING}
      </p>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Detail term="Register">
          <Register source={verification.attributes['registry-source']} evidence={evidence} />
        </Detail>
        <Detail term="Authoritative">
          {evidence.authoritative === null ? (
            muted('Not recorded')
          ) : (
            <Explained {...businessAuthorityText(evidence.authoritative)} />
          )}
        </Detail>
        <Detail term="Record ID">
          {typeof attributes['registry-record-id'] === 'string' ? (
            code(attributes['registry-record-id'])
          ) : (
            <Value name="registry-record-id" attributes={attributes} state={state} />
          )}
        </Detail>
        <Detail term="Legal name">
          <Value name="registry-legal-name" attributes={attributes} state={state} />
        </Detail>
        <Detail term="Status on the register">
          {typeof status === 'string' ? (
            code(status)
          ) : (
            <Value name="registry-status" attributes={attributes} state={state} />
          )}
        </Detail>
        <Detail term="Status read as">
          <StatusRead evidence={evidence} />
        </Detail>
        <Detail term="Identity">
          <Outcome outcome={evidence.identity} />
        </Detail>
        <Detail term="Active business">
          <Outcome outcome={evidence.active} />
        </Detail>
      </dl>
      <DataTable
        caption={`${label} values against the register`}
        columns={fieldColumns(attributes, evidence, state)}
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
        <Detail term="LEI">
          <Value name="lei" attributes={attributes} state={state} />
        </Detail>
        <Detail term="Associated persons">
          <Persons attributes={attributes} evidence={evidence} state={state} />
        </Detail>
        <Detail term="Country allowed">
          <Outcome outcome={evidence.country} />
        </Detail>
        <Detail term="Register available">
          <Outcome outcome={evidence.service} />
        </Detail>
      </dl>
    </div>
  );
}
