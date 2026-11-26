/**
 * The Analytics section's filters (C164.8): a plain GET form, so it works before (and without)
 * JavaScript and the whole query lives in the URL (C23). Each view offers only the filters its
 * answer takes; a filter in the URL the view does not take is named as not applied.
 */
import {
  ANALYTICS_BUCKETS,
  ANALYTICS_MAX_RANGE_DAYS,
  FLOW_RECORD_DEVICE_KINDS,
  FLOW_RECORD_PLATFORMS,
} from '@openverify/core';
import { Button } from '@openverify/ui';
import Link from 'next/link';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';
import {
  analyticsViewFields,
  analyticsViewPath,
  type AnalyticsQuery,
  type AnalyticsQueryField,
} from './analytics-query';

const F = ANALYTICS_COPY.filters;

const LABELS: Readonly<Record<AnalyticsQueryField, string>> = Object.freeze({
  from: F.from,
  to: F.to,
  bucket: F.bucket,
  template: F.template,
  version: F.version,
  platform: F.platform,
  device: F.device,
  tag: F.tag,
  'case-template': F.caseTemplate,
});

const CHOICES: Partial<Record<AnalyticsQueryField, readonly { value: string; label: string }[]>> =
  Object.freeze({
    bucket: ANALYTICS_BUCKETS.map((value) => ({ value, label: ANALYTICS_COPY.buckets[value] })),
    platform: [
      { value: '', label: F.any },
      ...FLOW_RECORD_PLATFORMS.map((value) => ({ value, label: value })),
    ],
    device: [
      { value: '', label: F.any },
      ...FLOW_RECORD_DEVICE_KINDS.map((value) => ({ value, label: value })),
    ],
  });

function Control({
  field,
  query,
}: {
  readonly field: AnalyticsQueryField;
  readonly query: AnalyticsQuery;
}) {
  const choices = CHOICES[field];
  const isDate = field === 'from' || field === 'to';
  return (
    <FormField
      label={LABELS[field]}
      error={query.errors[field]}
      {...(field === 'from'
        ? { description: fillCopy(F.windowHint, { days: ANALYTICS_MAX_RANGE_DAYS }) }
        : {})}
    >
      {(control) =>
        choices === undefined ? (
          <input
            {...control}
            type={isDate ? 'date' : 'text'}
            name={field}
            defaultValue={query.values[field]}
            spellCheck={false}
            autoComplete="off"
            className={controlClassName(control)}
          />
        ) : (
          <select
            {...control}
            name={field}
            defaultValue={query.values[field]}
            className={controlClassName(control)}
          >
            {choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        )
      }
    </FormField>
  );
}

export function AnalyticsFilters({ query }: { readonly query: AnalyticsQuery }) {
  const fields: readonly AnalyticsQueryField[] = [
    'from',
    'to',
    'bucket',
    ...analyticsViewFields(query.view),
  ];
  const notTaken = query.notTaken.map((field) => LABELS[field]);
  const elsewhere = Object.entries(query.errors).filter(
    ([field]) => !fields.includes(field as AnalyticsQueryField),
  );
  return (
    <form
      role="search"
      aria-label={F.formLabel}
      method="get"
      action={analyticsViewPath(query.view)}
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <Control key={field} field={field} query={query} />
        ))}
      </div>
      {elsewhere.map(([field, error]) => (
        <p key={field} className="text-sm font-medium text-danger">
          {LABELS[field as AnalyticsQueryField]}: {error}
        </p>
      ))}
      {notTaken.length > 0 && (
        <p className="text-sm text-ink-muted">
          {fillCopy(F.notTaken, { names: notTaken.join(', ') })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="secondary">
          {F.apply}
        </Button>
        <Link href={analyticsViewPath(query.view)} className={LINK_CLASS}>
          {F.reset}
        </Link>
      </div>
    </form>
  );
}
