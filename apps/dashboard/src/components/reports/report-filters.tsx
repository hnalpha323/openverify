import type { ReportResourceType, ReportTemplateResource } from '@openverify/contracts';
import type { ReportStatus } from '@openverify/core';
import { Button, Checkbox } from '@openverify/ui';
import Link from 'next/link';
import { REPORT_STATUS_LABELS, REPORT_TYPE_LABELS } from '../../lib/labels';
import type { ReportResultFilter, ReportTextFilter } from '../../lib/report-query';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';

export interface ReportFiltersProps {
  /** The text filters as the operator typed them. */
  readonly values: Partial<Record<ReportTextFilter, string>>;
  readonly types: readonly ReportResourceType[];
  readonly statuses: readonly ReportStatus[];
  readonly result?: ReportResultFilter | undefined;
  /** Why a typed value cannot be used, by URL parameter. */
  readonly errors: Partial<Record<ReportTextFilter, string>>;
  /** The templates to choose from (`report-templates:read`); a template ID field without. */
  readonly templates?: readonly ReportTemplateResource[] | undefined;
  /** How many `templates` lists when more exist (Workflow 6B R013), said under the field. */
  readonly templatesListedOf?: number | undefined;
}

/** `submitted` is reserved and never reached in Phase 6 (decision 3), so it is not offered. */
const STATUSES: readonly ReportStatus[] = ['pending', 'ready', 'errored'];

const TEXT_FIELDS: readonly {
  readonly name: Exclude<ReportTextFilter, 'template'>;
  readonly label: string;
  readonly description?: string;
}[] = [
  {
    name: 'tag',
    label: 'Tags',
    description: 'Separate several with commas; a report with any of them matches.',
  },
  { name: 'account-id', label: 'Account ID' },
  { name: 'inquiry-id', label: 'Inquiry ID' },
];

function TemplateFilter({
  value,
  error,
  templates,
  listedOf,
}: {
  readonly value: string;
  readonly error: string | undefined;
  readonly templates: readonly ReportTemplateResource[] | undefined;
  readonly listedOf: number | undefined;
}) {
  if (templates === undefined) {
    return (
      <FormField label="Report template ID" error={error}>
        {(control) => (
          <input
            {...control}
            type="text"
            name="template"
            defaultValue={value}
            spellCheck={false}
            autoComplete="off"
            className={controlClassName(control)}
          />
        )}
      </FormField>
    );
  }
  const known = templates.some((template) => template.id === value);
  return (
    <FormField
      label="Report template"
      error={error}
      {...(listedOf === undefined
        ? {}
        : {
            description: `Only the first ${listedOf.toLocaleString('en-US')} templates are listed.`,
          })}
    >
      {(control) => (
        <select
          {...control}
          name="template"
          defaultValue={value}
          className={controlClassName(control)}
        >
          <option value="">Any template</option>
          {!known && value !== '' && <option value={value}>{value}</option>}
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.attributes.name} (
              {REPORT_TYPE_LABELS[`report/${template.attributes['report-type']}`]})
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}

/**
 * The report filters: a plain GET form, so it works before (and without) JavaScript and every
 * filter lives in the URL (C23). "No match" lists `ready` reports only (C69.4).
 */
export function ReportFilters({
  values,
  types,
  statuses,
  result,
  errors,
  templates,
  templatesListedOf,
}: ReportFiltersProps) {
  const active =
    types.length > 0 ||
    statuses.length > 0 ||
    result !== undefined ||
    Object.values(values).some((value) => value.trim() !== '');
  return (
    <form
      role="search"
      aria-label="Filter reports"
      method="get"
      action="/reports"
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4"
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">Type</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => (
            <Checkbox
              key={value}
              name="type"
              value={value}
              label={label}
              defaultChecked={types.includes(value as ReportResourceType)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-ink">Status</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {STATUSES.map((status) => (
            <Checkbox
              key={status}
              name="status"
              value={status}
              label={REPORT_STATUS_LABELS[status]}
              defaultChecked={statuses.includes(status)}
            />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="Result">
          {(control) => (
            <select
              {...control}
              name="result"
              defaultValue={result ?? ''}
              className={controlClassName(control)}
            >
              <option value="">Any result</option>
              <option value="match">Match</option>
              <option value="no-match">No match (ready reports only)</option>
            </select>
          )}
        </FormField>
        <TemplateFilter
          value={values.template ?? ''}
          error={errors.template}
          templates={templates}
          listedOf={templatesListedOf}
        />
        {TEXT_FIELDS.map((field) => (
          <FormField
            key={field.name}
            label={field.label}
            {...(field.description === undefined ? {} : { description: field.description })}
            error={errors[field.name]}
          >
            {(control) => (
              <input
                {...control}
                type="text"
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
          <Link href="/reports" className={LINK_CLASS}>
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}
