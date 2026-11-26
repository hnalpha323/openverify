/**
 * The Analytics section's URL state (C23, C164.8): the window, the bucket and the filters of one
 * view, kept in the page URL so a view can be bookmarked and reloaded, and checked before the API is
 * asked, so a value the API would refuse is explained at its field instead.
 *
 * `/analytics/funnel?from=2026-10-01&to=2026-10-30&bucket=week&template=itmpl_…&version=itmplv_…`
 */
import { idSchema, tagSchema } from '@openverify/contracts';
import {
  ANALYTICS_BUCKETS,
  ANALYTICS_MAX_RANGE_DAYS,
  FLOW_RECORD_DEVICE_KINDS,
  FLOW_RECORD_PLATFORMS,
  type AnalyticsReport,
} from '@openverify/core';
import type { z } from 'zod';
import { ANALYTICS_COPY, fillCopy } from '../../lib/copy/analytics';

/** The six views of the section (C164.9) and the answer each reads. */
export const ANALYTICS_VIEWS = Object.freeze([
  'overview',
  'funnel',
  'verifications',
  'checks',
  'cases',
  'signals',
] as const);
export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number];

export const ANALYTICS_VIEW_REPORTS: Readonly<Record<AnalyticsView, AnalyticsReport>> =
  Object.freeze({
    overview: 'inquiries',
    funnel: 'funnel',
    verifications: 'verifications',
    checks: 'checks',
    cases: 'cases',
    signals: 'signals',
  });

/** The URL parameters of the section. */
export const ANALYTICS_QUERY_FIELDS = Object.freeze([
  'from',
  'to',
  'bucket',
  'template',
  'version',
  'platform',
  'device',
  'tag',
  'case-template',
] as const);
export type AnalyticsQueryField = (typeof ANALYTICS_QUERY_FIELDS)[number];
export type AnalyticsQueryValues = Readonly<Record<AnalyticsQueryField, string>>;

export interface AnalyticsQuery {
  readonly view: AnalyticsView;
  /** What the URL holds, as typed, with the window filled in when it was left out. */
  readonly values: AnalyticsQueryValues;
  /** Why a value cannot be used, by URL parameter; nothing is asked while any is set. */
  readonly errors: Partial<Record<AnalyticsQueryField, string>>;
  /** Filters the URL set that this view does not take: shown as not applied, never sent. */
  readonly notTaken: readonly AnalyticsQueryField[];
  /** The query the API route takes, or `null` while a value has an error. */
  readonly api: Readonly<Record<string, string>> | null;
}

/** The path of each view. */
export function analyticsViewPath(view: AnalyticsView): string {
  return view === 'overview' ? '/analytics' : `/analytics/${view}`;
}

/** The URL parameters `view` takes besides the window (C164.8; AA1, B15). */
const VIEW_FIELDS: Readonly<Record<AnalyticsView, readonly AnalyticsQueryField[]>> = Object.freeze({
  overview: ['template', 'version', 'platform', 'device', 'tag'],
  funnel: ['template', 'version'],
  verifications: ['template', 'version'],
  checks: ['template', 'version'],
  signals: ['template', 'version', 'platform', 'device'],
  cases: ['case-template'],
});

/** The views whose rollups record no platform or device kind, so the API refuses them (AA1). */
const NO_DEVICE: ReadonlySet<AnalyticsView> = new Set(['funnel', 'verifications', 'checks']);

/** The route's name of each filter. */
const API_NAMES: Readonly<Record<string, string>> = Object.freeze({
  template: 'filter[inquiry-template-id]',
  version: 'filter[inquiry-template-version-id]',
  platform: 'filter[platform]',
  device: 'filter[device-kind]',
  tag: 'filter[tag]',
  'case-template': 'filter[case-template-id]',
});

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** The UTC day number of `date`, or `undefined` for no such calendar day. */
function dayNumber(date: string): number | undefined {
  if (!DATE.test(date)) {
    return undefined;
  }
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== date
    ? undefined
    : time / DAY_MS;
}

const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** The URL parameters `view` takes besides the window. */
export function analyticsViewFields(view: AnalyticsView): readonly AnalyticsQueryField[] {
  return VIEW_FIELDS[view];
}

/** The 30 local days ending `today` (`YYYY-MM-DD`), both included. */
export function defaultAnalyticsWindow(today: string): { from: string; to: string } {
  const end = dayNumber(today) ?? 0;
  return { from: dateOf(end - 29), to: today };
}

/** The local date of `instant` in the IANA `zone`, `YYYY-MM-DD`. */
export function localDayIn(instant: Date, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const first = (value: string | string[] | undefined) =>
  (typeof value === 'string' ? value : (value?.[0] ?? '')).trim();

const valid = (schema: z.ZodType, value: string) => schema.safeParse(value).success;

/** Why `value` cannot be used as `field`, or `undefined`. */
function errorOf(field: AnalyticsQueryField, value: string): string | undefined {
  const words = ANALYTICS_COPY.errors;
  switch (field) {
    case 'template':
      return valid(idSchema('itmpl'), value) ? undefined : words.template;
    case 'version':
      return valid(idSchema('itmplv'), value) ? undefined : words.version;
    case 'case-template':
      return valid(idSchema('ctmpl'), value) ? undefined : words.caseTemplate;
    case 'platform':
      return (FLOW_RECORD_PLATFORMS as readonly string[]).includes(value)
        ? undefined
        : words.choice;
    case 'device':
      return (FLOW_RECORD_DEVICE_KINDS as readonly string[]).includes(value)
        ? undefined
        : words.choice;
    case 'tag':
      return valid(tagSchema, value) ? undefined : words.tag;
    default:
      return undefined;
  }
}

/** Reads and checks `view`'s URL; `today` fills a window left out. */
export function parseAnalyticsQuery(
  view: AnalyticsView,
  params: Readonly<Record<string, string | string[] | undefined>>,
  today: string,
): AnalyticsQuery {
  const typed = Object.fromEntries(
    ANALYTICS_QUERY_FIELDS.map((field) => [field, first(params[field])]),
  ) as Record<AnalyticsQueryField, string>;
  const window = defaultAnalyticsWindow(today);
  const values: Record<AnalyticsQueryField, string> = {
    ...typed,
    from: typed.from === '' ? window.from : typed.from,
    to: typed.to === '' ? window.to : typed.to,
    bucket: typed.bucket === '' ? 'day' : typed.bucket,
  };
  const errors: Partial<Record<AnalyticsQueryField, string>> = {};
  const words = ANALYTICS_COPY.errors;
  const from = dayNumber(values.from);
  const to = dayNumber(values.to);
  if (from === undefined) {
    errors.from = words.date;
  }
  if (to === undefined) {
    errors.to = words.date;
  } else if (from !== undefined && to < from) {
    errors.to = words.order;
  } else if (from !== undefined && to - from + 1 > ANALYTICS_MAX_RANGE_DAYS) {
    errors.to = fillCopy(words.range, { days: ANALYTICS_MAX_RANGE_DAYS });
  }
  if (!(ANALYTICS_BUCKETS as readonly string[]).includes(values.bucket)) {
    errors.bucket = words.choice;
  }
  const taken = VIEW_FIELDS[view];
  const notTaken: AnalyticsQueryField[] = [];
  const api: Record<string, string> = {
    'filter[from]': values.from,
    'filter[to]': values.to,
    bucket: values.bucket,
  };
  for (const field of ANALYTICS_QUERY_FIELDS.slice(3)) {
    const value = values[field];
    if (value === '') {
      continue;
    }
    if (NO_DEVICE.has(view) && (field === 'platform' || field === 'device')) {
      errors[field] = ANALYTICS_COPY.filters.refusedDevice;
      continue;
    }
    if (!taken.includes(field)) {
      notTaken.push(field);
      continue;
    }
    const error = errorOf(field, value);
    if (error === undefined) {
      api[API_NAMES[field] ?? field] = value;
    } else {
      errors[field] = error;
    }
  }
  return {
    view,
    values,
    errors,
    notTaken,
    api: Object.keys(errors).length === 0 ? api : null,
  };
}
