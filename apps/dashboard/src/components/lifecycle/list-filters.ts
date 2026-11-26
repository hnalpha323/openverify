/**
 * Filters an operator types into a list's GET form (C9, C23), shared by the inquiry and account
 * lists: tags, a reference ID and a creation range in UTC days. A typed value the API would
 * refuse is explained instead of being sent.
 */
import { referenceIdSchema, tagInputSchema } from '@openverify/contracts';

export type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

export const FILTER_ERRORS = {
  tag: 'Enter tags of 1 to 64 letters, digits, spaces or "_ . : - /" characters, separated by commas.',
  reference: 'Enter a reference ID of 1 to 255 characters, without control characters.',
  date: 'Enter a date as YYYY-MM-DD.',
  range: 'The end date must be on or after the start date.',
} as const;

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A single text parameter, as typed; blank and repeated ones count as absent. */
export function textParam(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** The text parameters of `names` that are set, as typed, for the form. */
export function typedValues<Name extends string>(
  params: SearchParams,
  names: readonly Name[],
): Partial<Record<Name, string>> {
  const values: Partial<Record<Name, string>> = {};
  for (const name of names) {
    const value = textParam(params, name);
    if (value !== undefined) {
      values[name] = value;
    }
  }
  return values;
}

/** Comma-separated tags (any of them matches). */
export function tagsFilter(text: string | undefined): { tags: string[]; error?: string } {
  const tags = (text ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
  return tags.every((tag) => tagInputSchema.safeParse(tag).success)
    ? { tags }
    : { tags: [], error: FILTER_ERRORS.tag };
}

/** One reference ID, trimmed. */
export function referenceFilter(text: string | undefined): {
  referenceId?: string;
  error?: string;
} {
  const referenceId = text?.trim();
  if (referenceId === undefined) {
    return {};
  }
  return referenceIdSchema.safeParse(referenceId).success
    ? { referenceId }
    : { error: FILTER_ERRORS.reference };
}

/** Midnight UTC of a `YYYY-MM-DD` day, or `undefined` when it is not a real day. */
function dayStart(day: string): number | undefined {
  if (!DAY.test(day)) {
    return undefined;
  }
  const time = Date.parse(`${day}T00:00:00.000Z`);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day ? undefined : time;
}

/** A creation range of UTC days, both inclusive. */
export interface DayRange {
  /** `YYYY-MM-DD`. */
  readonly createdFrom?: string;
  /** `YYYY-MM-DD`. */
  readonly createdTo?: string;
}

/** The typed `created-from` and `created-to` days, with an error for each that cannot be used. */
export function dayRangeFilter(
  fromText: string | undefined,
  toText: string | undefined,
): DayRange & { errors: { 'created-from'?: string; 'created-to'?: string } } {
  const createdFrom = fromText?.trim();
  const createdTo = toText?.trim();
  const from = createdFrom === undefined ? undefined : dayStart(createdFrom);
  const to = createdTo === undefined ? undefined : dayStart(createdTo);
  const errors: { 'created-from'?: string; 'created-to'?: string } = {};
  if (createdFrom !== undefined && from === undefined) {
    errors['created-from'] = FILTER_ERRORS.date;
  }
  if (createdTo !== undefined && to === undefined) {
    errors['created-to'] = FILTER_ERRORS.date;
  } else if (from !== undefined && to !== undefined && to < from) {
    errors['created-to'] = FILTER_ERRORS.range;
  }
  return {
    ...(createdFrom === undefined ? {} : { createdFrom }),
    ...(createdTo === undefined ? {} : { createdTo }),
    errors,
  };
}

/**
 * The C9 creation range of `range`: UTC instants, inclusive start and exclusive end (midnight
 * after `createdTo`).
 */
export function createdRangeFilters(range: DayRange): {
  'created-at-start': string | undefined;
  'created-at-end': string | undefined;
} {
  const from = range.createdFrom === undefined ? undefined : dayStart(range.createdFrom);
  const to = range.createdTo === undefined ? undefined : dayStart(range.createdTo);
  return {
    'created-at-start': from === undefined ? undefined : new Date(from).toISOString(),
    'created-at-end': to === undefined ? undefined : new Date(to + DAY_MS).toISOString(),
  };
}

/** Values joined by commas (C9: any of them), or `undefined` for none. */
export function joinedFilter(values: readonly string[]): string | undefined {
  return values.length === 0 ? undefined : values.join(',');
}
