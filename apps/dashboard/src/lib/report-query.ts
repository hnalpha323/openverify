/**
 * The reports page's URL state (C23, C86): filters live in the URL query, so a filtered list can
 * be bookmarked, shared and reloaded, and the filter form is a plain GET form:
 *
 * `/reports?type=report/watchlist&status=errored&result=match&template=rptp_…&tag=vip`
 * `&account-id=acc_…&inquiry-id=inq_…&after=rep_…`
 *
 * Types, statuses, the result and the cursor come only from links, checkboxes and a select, so
 * unknown values are dropped. Text filters are typed by the operator: a value the API would
 * refuse is kept for the form and explained instead of being sent. "No match" is
 * `filter[has-match]=false`, which the API answers with `ready` reports only (C69.4): an errored
 * report was not screened.
 */
import { REPORT_RESOURCE_TYPES, idSchema, type ReportResourceType } from '@openverify/contracts';
import { REPORT_STATUSES, type ReportStatus } from '@openverify/core';
import { tagsFilter, typedValues, type SearchParams } from '../components/lifecycle/list-filters';
import { parseCursor, type ListQueryValue } from './list-query';

/** The filters the operator typed, by URL parameter. */
export const REPORT_TEXT_FILTERS = ['template', 'tag', 'account-id', 'inquiry-id'] as const;
export type ReportTextFilter = (typeof REPORT_TEXT_FILTERS)[number];

/** The result filter: a match, or no match (which lists `ready` reports only, C69.4). */
export const REPORT_RESULT_FILTERS = ['match', 'no-match'] as const;
export type ReportResultFilter = (typeof REPORT_RESULT_FILTERS)[number];

/** Valid filters of a report list; empty lists and absent members filter nothing. */
export interface ReportFilters {
  readonly types: readonly ReportResourceType[];
  readonly statuses: readonly ReportStatus[];
  readonly result?: ReportResultFilter;
  readonly templateId?: string;
  readonly tags: readonly string[];
  readonly accountId?: string;
  readonly inquiryId?: string;
}

export interface ReportListQuery {
  /** What is sent to the API: empty while any typed value has an error. */
  readonly filters: ReportFilters;
  /** The boxes ticked in the URL, kept for the form while a typed value has an error. */
  readonly selected: {
    readonly types: readonly ReportResourceType[];
    readonly statuses: readonly ReportStatus[];
    readonly result?: ReportResultFilter;
  };
  /** What the operator typed, as typed, for the form. */
  readonly values: Partial<Record<ReportTextFilter, string>>;
  /** The last report ID of the previous page. */
  readonly after?: string;
  /** Why a typed value cannot be used, by URL parameter. Nothing is listed while any is set. */
  readonly errors: Partial<Record<ReportTextFilter, string>>;
}

/** The id filters, each with its prefix and what to type. */
const ID_FILTERS = [
  ['template', 'rptp', 'Enter a report template ID: rptp_ followed by 26 letters and digits.'],
  ['account-id', 'acc', 'Enter an account ID: acc_ followed by 26 letters and digits.'],
  ['inquiry-id', 'inq', 'Enter an inquiry ID: inq_ followed by 26 letters and digits.'],
] as const;

/** The known values of a repeated or comma-separated parameter, each once, in URL order. */
function listOf<Value extends string>(
  value: string | string[] | undefined,
  known: readonly Value[],
): Value[] {
  const items = (typeof value === 'string' ? [value] : (value ?? [])).flatMap((item) =>
    item.split(','),
  );
  const allowed: ReadonlySet<string> = new Set(known);
  return [
    ...new Set(items.map((item) => item.trim()).filter((item): item is Value => allowed.has(item))),
  ];
}

export function parseReportListQuery(params: SearchParams): ReportListQuery {
  const values = typedValues(params, REPORT_TEXT_FILTERS);
  const errors: Partial<Record<ReportTextFilter, string>> = {};
  const ids: Partial<Record<ReportTextFilter, string>> = {};
  for (const [name, prefix, error] of ID_FILTERS) {
    const id = values[name]?.trim();
    if (id === undefined) {
      continue;
    }
    if (idSchema(prefix).safeParse(id).success) {
      ids[name] = id;
    } else {
      errors[name] = error;
    }
  }
  const { tags, error: tagError } = tagsFilter(values.tag);
  if (tagError !== undefined) {
    errors.tag = tagError;
  }
  const types = listOf(params.type, REPORT_RESOURCE_TYPES);
  const statuses = listOf(params.status, REPORT_STATUSES);
  const [result] = listOf(params.result, REPORT_RESULT_FILTERS);
  const selected = { types, statuses, ...(result === undefined ? {} : { result }) };
  const after = parseCursor(params.after, 'rep');
  const valid = Object.keys(errors).length === 0;
  return {
    filters: valid
      ? {
          ...selected,
          tags,
          ...(ids.template === undefined ? {} : { templateId: ids.template }),
          ...(ids['account-id'] === undefined ? {} : { accountId: ids['account-id'] }),
          ...(ids['inquiry-id'] === undefined ? {} : { inquiryId: ids['inquiry-id'] }),
        }
      : { types: [], statuses: [], tags: [] },
    selected,
    values,
    ...(after === undefined ? {} : { after }),
    errors,
  };
}

/** A list filter (OR), joined by commas, or nothing when empty. */
const joined = (items: readonly string[]) => (items.length === 0 ? undefined : items.join(','));

/** The C9 list filters of `filters` for `GET /dashboard/reports`. */
export function reportApiFilters(filters: ReportFilters): Record<string, string | undefined> {
  return {
    'filter[type]': joined(filters.types),
    'filter[status]': joined(filters.statuses),
    'filter[has-match]':
      filters.result === undefined ? undefined : String(filters.result === 'match'),
    'filter[report-template-id]': filters.templateId,
    'filter[tag]': joined(filters.tags),
    'filter[account-id]': filters.accountId,
    'filter[inquiry-id]': filters.inquiryId,
  };
}

/** Whether `filters` filter anything. */
export function hasReportFilters(filters: ReportFilters): boolean {
  return Object.values(reportApiFilters(filters)).some((value) => value !== undefined);
}

/** The page URL query of `filters`, for links that keep them (pagination). */
export function reportFilterQuery(filters: ReportFilters): Record<string, ListQueryValue> {
  return {
    type: [...filters.types],
    status: [...filters.statuses],
    result: filters.result,
    template: filters.templateId,
    tag: joined(filters.tags),
    'account-id': filters.accountId,
    'inquiry-id': filters.inquiryId,
  };
}
