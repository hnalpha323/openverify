/**
 * Values operators type into the integrations pages (C23): list filters, which live in the page
 * URL so a filtered list can be bookmarked and reloaded (the filter forms are plain GET forms),
 * and lists typed into one text field (IDs, CIDR ranges, attribute names).
 *
 * Plain functions without server-only imports: server pages, server actions and their tests
 * share them.
 */

/** A page's `searchParams`. */
export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

/** A query parameter's value, trimmed; empty means absent, and a repeated one gives its first. */
export function queryValue(params: SearchParams, name: string): string | undefined {
  const raw = params[name];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/** Items typed into one text field, separated by commas, spaces or new lines. */
export function splitList(text: string | undefined): string[] {
  return (text ?? '').split(/[\s,]+/).filter((item) => item !== '');
}

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

/**
 * A `datetime-local` value read as UTC (the console shows every time in UTC), as an ISO-8601
 * timestamp: `2026-10-20T10:05` gives `2026-10-20T10:05:00.000Z`. Seconds may carry the fraction
 * a browser writes for a field with `step` (`10:05:30.000`). `undefined` for anything else,
 * including a date that does not exist, which `Date` would roll over into the next month.
 */
export function utcTimestamp(value: string): string | undefined {
  if (!LOCAL_DATE_TIME.test(value)) {
    return undefined;
  }
  const date = new Date(`${value}Z`);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const timestamp = date.toISOString();
  return timestamp.startsWith(value) ? timestamp : undefined;
}

/** What a filter check makes of a value: the value to send, or why it cannot be applied. */
export type FilterCheck = (
  value: string,
) => { readonly value: string } | { readonly error: string };

/** A value from a fixed list. */
export function oneOf(options: readonly string[], error: string): FilterCheck {
  return (value) => (options.includes(value) ? { value } : { error });
}

/** A value that matches `pattern`, or passes `test`. */
export function matching(
  pattern: RegExp | ((value: string) => boolean),
  error: string,
): FilterCheck {
  const test = typeof pattern === 'function' ? pattern : (value: string) => pattern.test(value);
  return (value) => (test(value) ? { value } : { error });
}

/** A `datetime-local` value in UTC, sent as ISO-8601. */
export const utcTime: FilterCheck = (value) => {
  const timestamp = utcTimestamp(value);
  return timestamp === undefined ? { error: 'Enter a date and time.' } : { value: timestamp };
};

export const END_BEFORE_START = 'Choose an end after the start.';

export interface ReadFilters<Name extends string> {
  /** As the URL has them, to fill the filter form and the pagination links. */
  readonly values: Readonly<Partial<Record<Name, string>>>;
  /** The values that passed their check, as the API takes them. */
  readonly applied: Readonly<Partial<Record<Name, string>>>;
  /** Why a value is not applied, by parameter. */
  readonly errors: Readonly<Partial<Record<Name, string>>>;
}

/**
 * The filters of a list page's URL, each through its check. A `created-at-end` that is not
 * after `created-at-start` is not applied (the API would refuse the whole request).
 */
export function readFilters<Name extends string>(
  params: SearchParams,
  checks: Readonly<Record<Name, FilterCheck>>,
): ReadFilters<Name> {
  const values: Partial<Record<Name, string>> = {};
  const applied: Partial<Record<Name, string>> = {};
  const errors: Partial<Record<Name, string>> = {};
  for (const name of Object.keys(checks) as Name[]) {
    const value = queryValue(params, name);
    if (value === undefined) {
      continue;
    }
    values[name] = value;
    const checked = checks[name](value);
    if ('error' in checked) {
      errors[name] = checked.error;
    } else {
      applied[name] = checked.value;
    }
  }
  const range = applied as Partial<Record<string, string>>;
  const start = range['created-at-start'];
  const end = range['created-at-end'];
  if (start !== undefined && end !== undefined && Date.parse(end) <= Date.parse(start)) {
    delete range['created-at-end'];
    (errors as Partial<Record<string, string>>)['created-at-end'] = END_BEFORE_START;
  }
  return { values, applied, errors };
}
