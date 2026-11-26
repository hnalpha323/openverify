'use client';

/**
 * The create report form (C72.1, C86): one field per member of the template type's query
 * (`REPORT_QUERY_FIELDS`), each with its member's own length limit from the contract (owner
 * decision 24, R014), up to three additional names for the person types, an existing
 * account for an operator who reads accounts (C72.2), and a new account only when asked. Every
 * value is the server's to check: the browser's validation is off, and a 422 shows on its field
 * by its JSON Pointer (`/data/attributes/query/<member>`), tied to it, and is not repeated in the
 * summary. A created report opens at once.
 */
import { REPORT_QUERY_FIELDS, REPORT_QUERY_LIMITS } from '@openverify/contracts';
import type { ReportType } from '@openverify/core';
import { Checkbox } from '@openverify/ui';
import { useRouter } from 'next/navigation';
import {
  fieldErrorOf,
  type ActionResult,
  type ActionState,
  type DisplayProblem,
} from '../../lib/action-state';
import { queryMaxLength } from '../../lib/report-query-limits';
import { queryFieldLabel } from '../../lib/report-query-words';
import { EnvironmentField } from '../environment-field';
import { withoutFieldErrors } from '../field-errors';
import { FormField, controlClassName } from '../form-field';
import { ProblemDisplay } from '../problem-display';
import { SubmitButton } from '../submit-button';
import { useFormAction } from '../use-form-action';

export interface CreateReportFormProps {
  readonly type: ReportType;
  readonly templateId: string;
  /** The session's environment, which the report is created in (Workflow 2D F002). */
  readonly environmentId: string;
  /** `accounts:read`: the operator may link an existing account (C72.2). */
  readonly canLinkAccounts: boolean;
  readonly action: (
    state: ActionState<{ readonly id: string }>,
    formData: FormData,
  ) => Promise<ActionResult<{ readonly id: string }>>;
}

const ADDITIONAL = 'additional-names';
const NAME_PARTS = ['name-first', 'name-middle', 'name-last', 'term'] as const;
const QUERY = '/data/attributes/query';
const ACCOUNT = '/data/attributes/account-id';

/** The members chosen from a list rather than typed. */
const CHOICES: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  gender: [
    ['', 'Not given'],
    ['female', 'Female'],
    ['male', 'Male'],
  ],
  'identification-type': [
    ['', 'Not given'],
    ['passport', 'Passport'],
    ['national_id', 'National ID'],
    ['tax_id', 'Tax ID'],
  ],
};

const COUNTRY = 'Two letters (ISO 3166-1), such as GB.';
/** What to type, where the format is not obvious. */
const HINTS: Readonly<Record<string, string>> = {
  term: 'The whole name in one field, instead of its parts.',
  birthdate: 'YYYY, YYYY-MM or YYYY-MM-DD.',
  'address-country-code': COUNTRY,
  'country-code': COUNTRY,
  'identification-country-code': COUNTRY,
  'identification-number': 'With its type below.',
  'phone-number': 'In E.164, such as +12025550100.',
  'chain-id': 'For an EVM address on a named chain, such as eip155:1.',
  lei: '20 characters.',
  'imo-number': '7 digits.',
  mmsi: '9 digits.',
  'swift-bic': '8 or 11 characters.',
  addressee: 'Sent to an address provider only when the template allows it.',
};

function QueryField({
  type,
  member,
  path,
  name,
  pointer,
  problem,
  of,
}: {
  readonly type: ReportType;
  readonly member: string;
  /** Where the member sits in the query, for its length limit (owner decision 24). */
  readonly path: readonly string[];
  readonly name: string;
  readonly pointer: string;
  readonly problem: DisplayProblem | undefined;
  /** Whose field it is, said to screen readers after the label ("of additional name 1"). */
  readonly of?: string;
}) {
  const choices = CHOICES[member];
  const hint = HINTS[member];
  const label = queryFieldLabel(type, member) ?? member;
  return (
    <FormField
      label={
        of === undefined ? (
          label
        ) : (
          <>
            {label} <span className="sr-only">of {of}</span>
          </>
        )
      }
      {...(hint === undefined ? {} : { description: hint })}
      error={fieldErrorOf(problem, pointer)}
    >
      {(control) =>
        choices === undefined ? (
          <input
            {...control}
            type="text"
            name={name}
            maxLength={queryMaxLength(type, path)}
            spellCheck={false}
            autoComplete="off"
            className={controlClassName(control)}
          />
        ) : (
          <select {...control} name={name} defaultValue="" className={controlClassName(control)}>
            {choices.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        )
      }
    </FormField>
  );
}

const additionalPointer = (index: number, part: string) =>
  `${QUERY}/${ADDITIONAL}/${String(index)}/${part}`;

/** Creates a report from the chosen template and the typed query. */
export function CreateReportForm({
  type,
  templateId,
  environmentId,
  canLinkAccounts,
  action,
}: CreateReportFormProps) {
  const router = useRouter();
  const { pending, problem, formProps } = useFormAction(action, {
    onSuccess: ({ id }) => {
      router.push(`/reports/${id}`);
    },
  });
  const members = REPORT_QUERY_FIELDS[type].filter((member) => member !== ADDITIONAL);
  const additional = REPORT_QUERY_FIELDS[type].includes(ADDITIONAL);
  const indexes = Array.from({ length: REPORT_QUERY_LIMITS.additionalNames }, (_, index) => index);
  const pointers = [
    ...members.map((member) => `${QUERY}/${member}`),
    ...(additional
      ? indexes.flatMap((index) => NAME_PARTS.map((part) => additionalPointer(index, part)))
      : []),
    ACCOUNT,
  ];
  return (
    <form {...formProps} aria-label="Create report" noValidate className="flex flex-col gap-6">
      <EnvironmentField environmentId={environmentId} />
      <input type="hidden" name="type" value={`report/${type}`} />
      <input type="hidden" name="report-template-id" value={templateId} />
      <fieldset className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6">
        <legend className="px-1 text-lg font-semibold text-ink">Query</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {members.map((member) => (
            <QueryField
              key={member}
              type={type}
              member={member}
              path={[member]}
              name={`query/${member}`}
              pointer={`${QUERY}/${member}`}
              problem={problem}
            />
          ))}
        </div>
      </fieldset>
      {additional && (
        <fieldset className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6">
          <legend className="px-1 text-lg font-semibold text-ink">
            Additional names (optional)
          </legend>
          <p className="text-sm text-ink-muted">
            Other names of the same person: every one is screened.
          </p>
          {indexes.map((index) => (
            <fieldset key={index} className="flex flex-col gap-3">
              <legend className="text-sm font-medium text-ink">Additional name {index + 1}</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                {NAME_PARTS.map((part) => (
                  <QueryField
                    key={part}
                    type={type}
                    member={part}
                    path={[ADDITIONAL, part]}
                    name={`query/${ADDITIONAL}/${String(index)}/${part}`}
                    pointer={additionalPointer(index, part)}
                    problem={problem}
                    of={`additional name ${String(index + 1)}`}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6">
        <legend className="px-1 text-lg font-semibold text-ink">Account</legend>
        {canLinkAccounts && (
          <FormField label="Account ID (optional)" error={fieldErrorOf(problem, ACCOUNT)}>
            {(control) => (
              <input
                {...control}
                type="text"
                name="account-id"
                spellCheck={false}
                autoComplete="off"
                className={controlClassName(control)}
              />
            )}
          </FormField>
        )}
        <Checkbox
          name="auto-create-account"
          value="true"
          label="Create a new account for this report when no account ID is given"
          description="Without one, the report links no account."
        />
      </fieldset>
      <ProblemDisplay problem={withoutFieldErrors(problem, pointers)} />
      <div>
        <SubmitButton pending={pending} pendingLabel="Creating…">
          Create report
        </SubmitButton>
      </div>
    </form>
  );
}
