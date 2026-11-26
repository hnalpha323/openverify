/**
 * The report template filters (C71, C86): a plain GET form, so the type and status live in the
 * URL and the list can be bookmarked and reloaded (C23).
 */
import type { ReportTemplateStatus } from '@openverify/contracts';
import { REPORT_TYPES, toReportResourceType, type ReportType } from '@openverify/core';
import { Button } from '@openverify/ui';
import Link from 'next/link';
import { REPORT_TYPE_LABELS } from '../../lib/labels';
import { FormField, controlClassName } from '../form-field';
import { LINK_CLASS } from '../link-styles';

export interface ReportTemplateFiltersProps {
  readonly type: ReportType | undefined;
  readonly status: ReportTemplateStatus | undefined;
}

const STATUSES: readonly { readonly value: ReportTemplateStatus; readonly label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];

export function ReportTemplateFilters({ type, status }: ReportTemplateFiltersProps) {
  return (
    <form
      role="search"
      aria-label="Filter report templates"
      method="get"
      action="/report-templates"
      className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Type">
          {(control) => (
            <select
              {...control}
              name="type"
              defaultValue={type ?? ''}
              className={controlClassName(control)}
            >
              <option value="">All types</option>
              {REPORT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {REPORT_TYPE_LABELS[toReportResourceType(value)]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label="Status">
          {(control) => (
            <select
              {...control}
              name="status"
              defaultValue={status ?? ''}
              className={controlClassName(control)}
            >
              <option value="">All statuses</option>
              {STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
        {(type !== undefined || status !== undefined) && (
          <Link href="/report-templates" className={LINK_CLASS}>
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}
