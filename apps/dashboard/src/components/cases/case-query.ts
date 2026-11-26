/**
 * The case list's filters in the URL (C23, C129.5): every public filter and ours, read from the
 * page's query, each checked before the API is asked, so a value the console cannot use is said in
 * words at its field and no request is sent with it.
 */
import { idSchema, type IdPrefix } from '@openverify/contracts';
import {
  CASE_SLA_STATES,
  CASE_STATUS_CATEGORIES,
  CASE_STATUS_KEY_PATTERN,
  type CaseSlaState,
  type CaseStatusCategory,
} from '@openverify/core';
import { parseCursor } from '../../lib/list-query';

export interface CaseFilterValues {
  readonly status: string;
  readonly template: string;
  readonly queue: string;
  readonly assignee: string;
  readonly category: string;
  readonly sla: string;
  readonly account: string;
  readonly inquiry: string;
  readonly report: string;
  readonly reference: string;
}

export interface CaseFilters {
  readonly status?: string;
  readonly templateId?: string;
  readonly queueId?: string;
  readonly assigneeId?: string;
  readonly category?: CaseStatusCategory;
  readonly slaState?: CaseSlaState;
  readonly accountId?: string;
  readonly inquiryId?: string;
  readonly reportId?: string;
  readonly referenceId?: string;
}

export interface CaseQuery {
  readonly values: CaseFilterValues;
  readonly filters: CaseFilters;
  readonly errors: Partial<Record<keyof CaseFilterValues, string>>;
  readonly after: string | undefined;
}

const KEYS = [
  'status',
  'template',
  'queue',
  'assignee',
  'category',
  'sla',
  'account',
  'inquiry',
  'report',
  'reference',
] as const;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? (value[0] ?? '') : (value ?? '')).trim();

const ID_FILTERS: readonly {
  readonly key: 'template' | 'queue' | 'assignee' | 'account' | 'inquiry' | 'report';
  readonly prefix: IdPrefix;
  readonly filter: 'templateId' | 'queueId' | 'assigneeId' | 'accountId' | 'inquiryId' | 'reportId';
  readonly error: string;
}[] = [
  {
    key: 'template',
    prefix: 'ctmpl',
    filter: 'templateId',
    error: 'Choose a template from the list.',
  },
  { key: 'queue', prefix: 'cqueue', filter: 'queueId', error: 'Choose a queue from the list.' },
  {
    key: 'assignee',
    prefix: 'usr',
    filter: 'assigneeId',
    error: 'Enter an operator’s user ID (usr_…).',
  },
  { key: 'account', prefix: 'acc', filter: 'accountId', error: 'Enter an account ID (acc_…).' },
  { key: 'inquiry', prefix: 'inq', filter: 'inquiryId', error: 'Enter an inquiry ID (inq_…).' },
  { key: 'report', prefix: 'rep', filter: 'reportId', error: 'Enter a report ID (rep_…).' },
];

/** The filters and cursor of the case list's URL. */
export function parseCaseQuery(
  params: Readonly<Record<string, string | string[] | undefined>>,
): CaseQuery {
  const values = Object.fromEntries(KEYS.map((key) => [key, first(params[key])])) as Record<
    (typeof KEYS)[number],
    string
  >;
  const errors: Partial<Record<keyof CaseFilterValues, string>> = {};
  const filters: Record<string, string> = {};
  if (values.status !== '') {
    if (CASE_STATUS_KEY_PATTERN.test(values.status)) {
      filters.status = values.status;
    } else {
      errors.status = 'A status key is lower-case letters, digits, _ or -.';
    }
  }
  for (const { key, prefix, filter, error } of ID_FILTERS) {
    if (values[key] === '') {
      continue;
    }
    if (idSchema(prefix).safeParse(values[key]).success) {
      filters[filter] = values[key];
    } else {
      errors[key] = error;
    }
  }
  if (values.category !== '') {
    if ((CASE_STATUS_CATEGORIES as readonly string[]).includes(values.category)) {
      filters.category = values.category;
    } else {
      errors.category = 'Choose a category from the list.';
    }
  }
  if (values.sla !== '') {
    if ((CASE_SLA_STATES as readonly string[]).includes(values.sla)) {
      filters.slaState = values.sla;
    } else {
      errors.sla = 'Choose an SLA state from the list.';
    }
  }
  if (values.reference !== '') {
    filters.referenceId = values.reference;
  }
  return {
    values,
    filters,
    errors,
    after: parseCursor(first(params.after), 'case'),
  };
}

/** Whether any filter narrows the list. */
export function hasCaseFilters(filters: CaseFilters): boolean {
  return Object.keys(filters).length > 0;
}

/** The filter values to keep in a pagination link (empty ones are left out by `listHref`). */
export function caseFilterQuery(values: CaseFilterValues): Record<string, string> {
  return { ...values };
}
