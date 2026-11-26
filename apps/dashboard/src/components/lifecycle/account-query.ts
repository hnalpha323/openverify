/**
 * The accounts page's URL state (C13, C23): `/accounts?status=archived&account-type-id=acctp_…`
 * `&tag=vip&reference-id=…&created-from=…&created-to=…&after=acc_…`. The status and type come
 * from selects, so unknown values are dropped; typed values the API would refuse are explained.
 */
import { accountStatusSchema, idSchema, type AccountStatus } from '@openverify/contracts';
import type { ListQueryValue } from '../../lib/list-query';
import { parseCursor } from '../../lib/list-query';
import {
  createdRangeFilters,
  dayRangeFilter,
  joinedFilter,
  referenceFilter,
  tagsFilter,
  typedValues,
  type SearchParams,
} from './list-filters';

export const ACCOUNT_TEXT_FILTERS = ['tag', 'reference-id', 'created-from', 'created-to'] as const;
export type AccountTextFilter = (typeof ACCOUNT_TEXT_FILTERS)[number];

export interface AccountFilters {
  readonly status?: AccountStatus;
  readonly accountTypeId?: string;
  /** Any of them (OR). */
  readonly tags: readonly string[];
  readonly referenceId?: string;
  /** A UTC day, `YYYY-MM-DD`, inclusive. */
  readonly createdFrom?: string;
  readonly createdTo?: string;
}

/** The choices of the filter form's selects. */
export type AccountSelections = Pick<AccountFilters, 'status' | 'accountTypeId'>;

export interface AccountListQuery {
  /** What is sent to the API: empty while any typed value has an error. */
  readonly filters: AccountFilters;
  /**
   * The status and account type chosen in the URL, for the form, even while a typed value has
   * an error: a select cannot be invalid (Workflow 2D F003).
   */
  readonly selected: AccountSelections;
  readonly values: Partial<Record<AccountTextFilter, string>>;
  readonly after?: string;
  readonly errors: Partial<Record<AccountTextFilter, string>>;
}

export function parseAccountListQuery(params: SearchParams): AccountListQuery {
  const values = typedValues(params, ACCOUNT_TEXT_FILTERS);
  const errors: Partial<Record<AccountTextFilter, string>> = {};
  const { tags, error: tagError } = tagsFilter(values.tag);
  if (tagError !== undefined) {
    errors.tag = tagError;
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

  const status = accountStatusSchema.safeParse(params.status);
  const type = idSchema('acctp').safeParse(params['account-type-id']);
  const after = parseCursor(params.after, 'acc');
  const valid = Object.keys(errors).length === 0;
  const selected: AccountSelections = {
    ...(status.success ? { status: status.data } : {}),
    ...(type.success ? { accountTypeId: type.data } : {}),
  };
  return {
    filters: valid
      ? {
          ...selected,
          tags,
          ...(referenceId === undefined ? {} : { referenceId }),
          ...range,
        }
      : { tags: [] },
    selected,
    values,
    ...(after === undefined ? {} : { after }),
    errors,
  };
}

/** Whether `filters` filter anything. */
export function hasAccountFilters(filters: AccountFilters): boolean {
  return Object.values(accountListFilter(filters)).some((value) => value !== undefined);
}

/** The page URL query of `filters`, for links that keep them. */
export function accountFilterQuery(filters: AccountFilters): Record<string, ListQueryValue> {
  return {
    status: filters.status,
    'account-type-id': filters.accountTypeId,
    tag: joinedFilter(filters.tags),
    'reference-id': filters.referenceId,
    'created-from': filters.createdFrom,
    'created-to': filters.createdTo,
  };
}

/** The C13 list filters of `filters`, as `client.accounts.list({ filter })` takes them. */
export function accountListFilter(filters: AccountFilters) {
  return {
    status: filters.status,
    'account-type-id': filters.accountTypeId,
    tag: joinedFilter(filters.tags),
    'reference-id': filters.referenceId,
    ...createdRangeFilters(filters),
  };
}
