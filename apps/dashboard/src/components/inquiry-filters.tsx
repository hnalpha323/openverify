import type { InquiryStatus } from '@openverify/core';
import { Button, Checkbox } from '@openverify/ui';
import Link from 'next/link';
import type { InquiryTextFilter } from '../lib/inquiry-query';
import { INQUIRY_STATUS_LABELS } from '../lib/labels';
import { FormField, controlClassName } from './form-field';
import { LINK_CLASS } from './link-styles';

export interface InquiryFiltersProps {
  /** The text filters as the operator typed them. */
  readonly values: Partial<Record<InquiryTextFilter, string>>;
  /** The checked statuses. */
  readonly statuses: readonly InquiryStatus[];
  /** Why a typed value cannot be used, by URL parameter. */
  readonly errors: Partial<Record<InquiryTextFilter, string>>;
  /**
   * The reader sees personal data (`pii:view`): only then is the step filter offered, because the
   * step reached can reveal a masked value (C165.3, review P15).
   */
  readonly canFilterByStep?: boolean;
}

const TEXT_FIELDS: readonly {
  readonly name: InquiryTextFilter;
  readonly label: string;
  readonly type: 'text' | 'date';
  readonly description?: string;
}[] = [
  {
    name: 'tag',
    label: 'Tags',
    type: 'text',
    description: 'Separate several with commas; an inquiry with any of them matches.',
  },
  { name: 'account-id', label: 'Account ID', type: 'text' },
  { name: 'reference-id', label: 'Reference ID', type: 'text' },
  { name: 'created-from', label: 'Created from (UTC)', type: 'date' },
  { name: 'created-to', label: 'Created to (UTC)', type: 'date' },
  // C165.3 (Workflow 9C).
  { name: 'list-id', label: 'List ID', type: 'text', description: 'An open match on this list.' },
  {
    name: 'check',
    label: 'Check',
    type: 'text',
    description: 'Its name, such as id_barcode_detection; choose its status too.',
  },
];

/** C165.3's choices: the list screening (ADR 0005: only a completed screening claims no match). */
const SELECT_FIELDS: readonly {
  readonly name: InquiryTextFilter;
  readonly label: string;
  readonly choices: readonly (readonly [string, string])[];
}[] = [
  {
    name: 'list-match',
    label: 'List screening',
    choices: [
      ['matched', 'Matched a list'],
      ['not-matched', 'Screened, no match'],
      ['unscreened', 'Not fully screened'],
    ],
  },
  {
    name: 'check-status',
    label: 'Check status',
    choices: [
      ['passed', 'Passed'],
      ['failed', 'Failed'],
      ['not_applicable', 'Not applicable'],
      ['pending', 'Pending'],
    ],
  },
];

/** C165.3: the step filter, offered only with `pii:view` (the step reached can reveal a value). */
const STEP_FIELD = {
  name: 'next-step-name',
  label: 'Current step',
  type: 'text',
  description: 'The step ID the inquiry is on.',
} as const;

/**
 * The inquiry filters: a plain GET form, so it works before (and without) JavaScript and every
 * filter lives in the URL (C23).
 */
export function InquiryFilters({
  values,
  statuses,
  errors,
  canFilterByStep = false,
}: InquiryFiltersProps) {
  const textFields = canFilterByStep ? [...TEXT_FIELDS, STEP_FIELD] : TEXT_FIELDS;
  const active = statuses.length > 0 || Object.values(values).some((value) => value.trim() !== '');
  return (
    <form
      role="search"
      aria-label="Filter inquiries"
      method="get"
      action="/inquiries"
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">Status</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {Object.entries(INQUIRY_STATUS_LABELS).map(([value, label]) => (
            <Checkbox
              key={value}
              name="status"
              value={value}
              label={label}
              defaultChecked={statuses.includes(value as InquiryStatus)}
            />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SELECT_FIELDS.map((field) => (
          <FormField key={field.name} label={field.label} error={errors[field.name]}>
            {(control) => (
              <select
                {...control}
                name={field.name}
                defaultValue={values[field.name] ?? ''}
                className={controlClassName(control)}
              >
                <option value="">Any</option>
                {field.choices.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        ))}
        {textFields.map((field) => (
          <FormField
            key={field.name}
            label={field.label}
            {...(field.description === undefined ? {} : { description: field.description })}
            error={errors[field.name]}
          >
            {(control) => (
              <input
                {...control}
                type={field.type}
                name={field.name}
                defaultValue={values[field.name] ?? ''}
                spellCheck={false}
                autoComplete="off"
                className={controlClassName(control)}
              />
            )}
          </FormField>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
        {active && (
          <Link href="/inquiries" className={LINK_CLASS}>
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}
