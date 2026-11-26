/**
 * The inquiries page's URL state (C23: filters live in the URL query, so a filtered list can be
 * bookmarked, shared and reloaded, and the filter form is a plain GET form):
 *
 * `/inquiries?status=failed&status=needs_review&tag=vip&account-id=acc_…&reference-id=…`
 * `&created-from=2026-10-01&created-to=2026-10-20&after=inq_…`
 *
 * Statuses and the cursor come only from links and checkboxes, so unknown values are dropped.
 * Text and date filters are typed by the operator: a value the API would refuse is kept for the
 * form and explained instead of being sent.
 */
import { idSchema } from '@openverify/contracts';
import { CHECK_STATUSES, INQUIRY_LIST_MATCH_FILTERS, type InquiryStatus } from '@openverify/core';
import {
  createdRangeFilters,
  dayRangeFilter,
  joinedFilter,
  referenceFilter,
  tagsFilter,
  typedValues,
  type SearchParams,
} from '../components/lifecycle/list-filters';
import { INQUIRY_STATUS_LABELS } from './labels';
import { parseCursor, type ListQueryValue } from './list-query';

/** The filters the operator typed, by URL parameter. */
export const INQUIRY_TEXT_FILTERS = [
  'tag',
  'account-id',
  'reference-id',
  'created-from',
  'created-to',
  // C165.3 (Workflow 9C): over Phase 7's screenings, a check's outcome and the step reached.
  'list-match',
  'list-id',
  'check',
  'check-status',
  'next-step-name',
] as const;
export type InquiryTextFilter = (typeof INQUIRY_TEXT_FILTERS)[number];

/** Valid filters of an inquiry list; empty lists and absent members filter nothing. */
export interface InquiryFilters {
  /** Any of them (OR). */
  readonly statuses: readonly InquiryStatus[];
  /** Any of them (OR). */
  readonly tags: readonly string[];
  readonly accountId?: string;
  readonly referenceId?: string;
  /** A UTC day, `YYYY-MM-DD`, inclusive. */
  readonly createdFrom?: string;
  /** A UTC day, `YYYY-MM-DD`, inclusive. */
  readonly createdTo?: string;
  /** C165.3: `matched`, `not-matched` or `unscreened` (`INQUIRY_LIST_MATCH_FILTERS`). */
  readonly listMatch?: string;
  /** C165.3: an open match on this list. */
  readonly listId?: string;
  /** C165.3: a check by name, always with `checkStatus`. */
  readonly check?: string;
  readonly checkStatus?: string;
  /** C165.3: the step the inquiry is on; the API needs `pii:view` for it (review P15). */
  readonly nextStepName?: string;
}

export interface InquiryListQuery {
  /** What is sent to the API: empty while any typed value has an error. */
  readonly filters: InquiryFilters;
  /**
   * The statuses ticked in the URL, for the form, even while a typed value has an error: a
   * checkbox cannot be invalid, so correcting the typed value must not drop them (Workflow 2D
   * F003).
   */
  readonly selected: { readonly statuses: readonly InquiryStatus[] };
  /** What the operator typed, as typed, for the form. */
  readonly values: Partial<Record<InquiryTextFilter, string>>;
  /** The last inquiry ID of the previous page. */
  readonly after?: string;
  /** Why a typed value cannot be used, by URL parameter. Nothing is listed while any is set. */
  readonly errors: Partial<Record<InquiryTextFilter, string>>;
}

const ACCOUNT_ERROR = 'Enter an account ID: acc_ followed by 26 letters and digits.';
const CHOICE_ERROR = 'Choose a value from the list.';
const CHECK_NAME = /^[a-z][a-z0-9_]{0,79}$/;
const STEP_ID = /^[a-z][a-z0-9_-]{0,63}$/;

/** C165.3's filters, checked as the API checks them; a check never without its status. */
function screeningFilters(
  values: Partial<Record<InquiryTextFilter, string>>,
  errors: Partial<Record<InquiryTextFilter, string>>,
): Pick<InquiryFilters, 'listMatch' | 'listId' | 'check' | 'checkStatus' | 'nextStepName'> {
  const text = (name: InquiryTextFilter) => {
    const value = values[name]?.trim();
    return value === undefined || value === '' ? undefined : value;
  };
  const listMatch = text('list-match');
  const listId = text('list-id');
  const check = text('check');
  const checkStatus = text('check-status');
  const nextStepName = text('next-step-name');
  if (
    listMatch !== undefined &&
    !(INQUIRY_LIST_MATCH_FILTERS as readonly string[]).includes(listMatch)
  ) {
    errors['list-match'] = CHOICE_ERROR;
  }
  if (listId !== undefined && !idSchema('lst').safeParse(listId).success) {
    errors['list-id'] = 'Enter a list ID: lst_ followed by 26 letters and digits.';
  }
  if (check !== undefined && !CHECK_NAME.test(check)) {
    errors.check = 'Enter a check name in lower case, such as id_barcode_detection.';
  }
  if (checkStatus !== undefined && !(CHECK_STATUSES as readonly string[]).includes(checkStatus)) {
    errors['check-status'] = CHOICE_ERROR;
  }
  if (check !== undefined && checkStatus === undefined) {
    errors['check-status'] = 'Choose the status of the check too.';
  }
  if (checkStatus !== undefined && check === undefined) {
    errors.check = 'Enter the check this status is for.';
  }
  if (nextStepName !== undefined && !STEP_ID.test(nextStepName)) {
    errors['next-step-name'] = 'Enter a step ID as the flow names it, in lower case.';
  }
  return {
    ...(listMatch === undefined ? {} : { listMatch }),
    ...(listId === undefined ? {} : { listId }),
    ...(check === undefined ? {} : { check }),
    ...(checkStatus === undefined ? {} : { checkStatus }),
    ...(nextStepName === undefined ? {} : { nextStepName }),
  };
}

/** A C1 inquiry ID: `inq_` and a ULID. */
export function isInquiryId(value: string): boolean {
  return idSchema('inq').safeParse(value).success;
}

function isInquiryStatus(value: string): value is InquiryStatus {
  return Object.hasOwn(INQUIRY_STATUS_LABELS, value);
}

/** The statuses of `status`, repeated or comma-separated, known ones only, each once. */
function statusesOf(value: string | string[] | undefined): InquiryStatus[] {
  const items = (typeof value === 'string' ? [value] : (value ?? [])).flatMap((item) =>
    item.split(','),
  );
  return [...new Set(items.map((item) => item.trim()).filter(isInquiryStatus))];
}

export function parseInquiryListQuery(params: SearchParams): InquiryListQuery {
  const values = typedValues(params, INQUIRY_TEXT_FILTERS);
  const errors: Partial<Record<InquiryTextFilter, string>> = {};
  const { tags, error: tagError } = tagsFilter(values.tag);
  if (tagError !== undefined) {
    errors.tag = tagError;
  }
  const accountId = values['account-id']?.trim();
  if (accountId !== undefined && !idSchema('acc').safeParse(accountId).success) {
    errors['account-id'] = ACCOUNT_ERROR;
  }
  const { referenceId, error: referenceError } = referenceFilter(values['reference-id']);
  if (referenceError !== undefined) {
    errors['reference-id'] = referenceError;
  }
  const { errors: rangeErrors, ...range } = dayRangeFilter(
    values['created-from'],
    values['created-to'],
  );
  Object.assign(errors, rangeErrors);
  const screening = screeningFilters(values, errors);

  const after = parseCursor(params.after, 'inq');
  const valid = Object.keys(errors).length === 0;
  const statuses = statusesOf(params.status);
  return {
    filters: valid
      ? {
          statuses,
          tags,
          ...(accountId === undefined ? {} : { accountId }),
          ...(referenceId === undefined ? {} : { referenceId }),
          ...range,
          ...screening,
        }
      : { statuses: [], tags: [] },
    selected: { statuses },
    values,
    ...(after === undefined ? {} : { after }),
    errors,
  };
}

/** Whether `filters` filter anything. */
export function hasInquiryFilters(filters: InquiryFilters): boolean {
  return Object.values(inquiryApiFilters(filters)).some((value) => value !== undefined);
}

/** The page URL query of `filters`, for links that keep them (pagination). */
export function inquiryFilterQuery(filters: InquiryFilters): Record<string, ListQueryValue> {
  return {
    status: [...filters.statuses],
    tag: filters.tags.length === 0 ? undefined : filters.tags.join(','),
    'account-id': filters.accountId,
    'reference-id': filters.referenceId,
    'created-from': filters.createdFrom,
    'created-to': filters.createdTo,
    'list-match': filters.listMatch,
    'list-id': filters.listId,
    check: filters.check,
    'check-status': filters.checkStatus,
    'next-step-name': filters.nextStepName,
  };
}

/**
 * The C9 list filters of `filters`: lists joined by commas (OR), and the creation range as UTC
 * instants, inclusive start and exclusive end (the day after `createdTo`).
 */
export function inquiryApiFilters(filters: InquiryFilters): Record<string, string | undefined> {
  const range = createdRangeFilters(filters);
  return {
    'filter[status]': joinedFilter(filters.statuses),
    'filter[tag]': joinedFilter(filters.tags),
    'filter[account-id]': filters.accountId,
    'filter[reference-id]': filters.referenceId,
    'filter[created-at-start]': range['created-at-start'],
    'filter[created-at-end]': range['created-at-end'],
    'filter[list-match]': filters.listMatch,
    'filter[list-id]': filters.listId,
    'filter[check]': filters.check,
    'filter[check-status]': filters.checkStatus,
    'filter[next-step-name]': filters.nextStepName,
  };
}
