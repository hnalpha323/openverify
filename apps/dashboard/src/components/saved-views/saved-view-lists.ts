/**
 * Saved views on the console's lists (C165.1, C165.5): each list page keeps its filters in its own
 * URL parameters (C23), and a view stores them as the list route's API filters. This table maps one
 * to the other per list. A page parameter it does not know is never kept silently: saving says which
 * are not kept, and a view filter with no page parameter is never dropped on applying: the view is
 * then not applied, so a view never shows a wider list than it names.
 */
import type { SavedViewList } from '@openverify/core';

type Kind = 'text' | 'list' | 'day-start' | 'day-end';

interface ParamRule {
  /** The page's URL parameter. */
  readonly param: string;
  /** The API filter it stands for. */
  readonly filter: string;
  /** `list`: repeated or comma-separated in the URL, comma-joined (OR) in the API (C9). */
  readonly kind: Kind;
}

interface ListRules {
  /** The list page; `null` for a page whose path depends on the record (a webhook's page). */
  readonly path: string | null;
  readonly params: readonly ParamRule[];
  /** A dynamic API filter, such as a transaction's `filter[fields.<key>]` from `field.<key>`. */
  readonly dynamic?: {
    readonly param: RegExp;
    readonly filter: (key: string) => string;
    readonly key: RegExp;
  };
}

const rule = (param: string, filter: string, kind: Kind = 'text'): ParamRule => ({
  param,
  filter: `filter[${filter}]`,
  kind,
});
const same = (param: string, kind: Kind = 'text') => rule(param, param, kind);
const created = (from: string, to: string) => [
  rule(from, 'created-at-start', 'day-start'),
  rule(to, 'created-at-end', 'day-end'),
];

const LISTS: Readonly<Record<SavedViewList, ListRules>> = Object.freeze({
  inquiries: {
    path: '/inquiries',
    params: [
      same('status', 'list'),
      same('tag', 'list'),
      same('account-id'),
      same('reference-id'),
      ...created('created-from', 'created-to'),
      same('list-match'),
      same('list-id'),
      same('check'),
      same('check-status'),
      same('next-step-name'),
    ],
  },
  accounts: {
    path: '/accounts',
    params: [
      same('status', 'list'),
      same('account-type-id'),
      same('tag', 'list'),
      same('reference-id'),
      ...created('created-from', 'created-to'),
    ],
  },
  reports: {
    path: '/reports',
    params: [
      same('type', 'list'),
      same('status', 'list'),
      rule('template', 'report-template-id'),
      same('tag', 'list'),
      same('account-id'),
      same('inquiry-id'),
    ],
  },
  cases: {
    path: '/cases',
    params: [
      same('status'),
      rule('template', 'case-template-id'),
      rule('queue', 'case-queue-id'),
      rule('assignee', 'assignee-id'),
      rule('category', 'status-category'),
      rule('sla', 'sla-state'),
      rule('account', 'account-id'),
      rule('inquiry', 'inquiry-id'),
      rule('report', 'report-id'),
      rule('reference', 'reference-id'),
    ],
  },
  transactions: {
    path: '/transactions',
    params: [
      rule('type', 'transaction-type-id'),
      same('status'),
      rule('reference', 'reference-id'),
      ...created('from', 'to'),
    ],
    dynamic: {
      param: /^field\.([a-z][a-z0-9_]{0,63})$/,
      key: /^filter\[fields\.([a-z][a-z0-9_]{0,63})\]$/,
      filter: (key) => `filter[fields.${key}]`,
    },
  },
  'api-logs': {
    path: '/api-logs',
    params: [
      'method',
      'status',
      'route',
      'api-key-id',
      'user-id',
      'created-at-start',
      'created-at-end',
    ].map((param) => same(param)),
  },
  'webhook-deliveries': { path: null, params: [same('status'), same('event-id')] },
  events: {
    path: '/events',
    params: ['name', 'object-id', 'created-at-start', 'created-at-end'].map((param) => same(param)),
  },
  'audit-logs': {
    path: '/audit-logs',
    params: [
      same('action'),
      rule('actor', 'actor-id'),
      same('resource-type'),
      same('resource-id'),
      same('action-prefix'),
    ],
  },
});

/** The URL parameters that are never filters: paging and the saved view's own. */
const NOT_FILTERS: ReadonlySet<string> = new Set(['after', 'before', 'view']);

const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_MS = 86_400_000;

function dayToInstant(day: string, plusDays: number): string | undefined {
  if (!DAY.test(day)) {
    return undefined;
  }
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(time) ? undefined : new Date(time + plusDays * DAY_MS).toISOString();
}

/** A UTC midnight back to its day (`plusDays` undone); `undefined` for any other instant. */
function instantToDay(instant: string, plusDays: number): string | undefined {
  const time = Date.parse(instant);
  if (Number.isNaN(time) || time % DAY_MS !== 0) {
    return undefined;
  }
  return new Date(time - plusDays * DAY_MS).toISOString().slice(0, 10);
}

const valuesOf = (value: string | string[] | undefined): string[] =>
  (typeof value === 'string' ? [value] : (value ?? []))
    .flatMap((each) => each.split(','))
    .map((each) => each.trim())
    .filter((each) => each !== '');

export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** The page path of `list`, or `undefined` for a record's page (a webhook's deliveries). */
export function savedViewListPath(list: SavedViewList): string | undefined {
  return LISTS[list].path ?? undefined;
}

export interface CurrentFilters {
  /** The API filters the page's URL stands for. */
  readonly filters: Readonly<Record<string, string>>;
  /** URL parameters a view of this list cannot keep (never saved silently). */
  readonly notKept: readonly string[];
}

/** The API filters `params` stand for on `list`'s page. */
export function filtersOfParams(list: SavedViewList, params: SearchParams): CurrentFilters {
  const rules = LISTS[list];
  const filters: Record<string, string> = {};
  const notKept: string[] = [];
  for (const [param, raw] of Object.entries(params)) {
    const values = valuesOf(raw);
    if (values.length === 0 || NOT_FILTERS.has(param)) {
      continue;
    }
    const found = rules.params.find((each) => each.param === param);
    const dynamic = rules.dynamic?.param.exec(param)?.[1];
    if (found === undefined && dynamic === undefined) {
      notKept.push(param);
      continue;
    }
    if (found === undefined) {
      filters[rules.dynamic?.filter(dynamic ?? '') ?? param] = values.join(',');
      continue;
    }
    const value =
      found.kind === 'day-start'
        ? dayToInstant(values[0] ?? '', 0)
        : found.kind === 'day-end'
          ? dayToInstant(values[0] ?? '', 1)
          : found.kind === 'list'
            ? values.join(',')
            : values[0];
    if (value === undefined) {
      notKept.push(param);
    } else {
      filters[found.filter] = value;
    }
  }
  return { filters, notKept };
}

export interface ViewParams {
  /** The page URL parameters of the view's filters. */
  readonly params: Readonly<Record<string, string | readonly string[]>>;
  /** Filters with no page parameter: the view is not applied rather than widened. */
  readonly dropped: readonly string[];
}

/** The page URL parameters of a view's `filters` on `list`'s page. */
export function paramsOfFilters(
  list: SavedViewList,
  filters: Readonly<Record<string, string | readonly string[]>>,
): ViewParams {
  const rules = LISTS[list];
  const params: Record<string, string | readonly string[]> = {};
  const dropped: string[] = [];
  for (const [filter, raw] of Object.entries(filters)) {
    const joined = typeof raw === 'string' ? raw : raw.join(',');
    const found = rules.params.find((each) => each.filter === filter);
    const dynamic = rules.dynamic?.key.exec(filter)?.[1];
    if (found === undefined) {
      if (dynamic === undefined) {
        dropped.push(filter);
      } else {
        params[`field.${dynamic}`] = joined;
      }
      continue;
    }
    const value =
      found.kind === 'day-start'
        ? instantToDay(joined, 0)
        : found.kind === 'day-end'
          ? instantToDay(joined, 1)
          : found.kind === 'list'
            ? joined.split(',')
            : joined;
    if (value === undefined) {
      dropped.push(filter);
    } else {
      params[found.param] = value;
    }
  }
  return { params, dropped };
}
