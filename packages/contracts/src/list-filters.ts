/**
 * List queries (contracts C1 and C9): cursor pagination, `filter[<attribute>]` with
 * comma-separated values meaning OR, and the `created-at` range (inclusive start, exclusive
 * end). Query schemas carry no transforms, so they convert to JSON Schema both ways; the API
 * splits a list with `filterValues()`.
 */
import { z } from 'zod';
import { idSchema, type IdPrefix } from './ids.js';
import { pageSizeSchema } from './json-api.js';

/** Most values one filter may list. */
export const MAX_FILTER_VALUES = 100;

/** A `filter[...]` value: one item, or several separated by commas. */
export function filterListSchema(item: z.ZodType, maxItems: number = MAX_FILTER_VALUES) {
  return z
    .string()
    .min(1)
    .max(8192)
    .refine(
      (value) => {
        const items = value.split(',');
        return items.length <= maxItems && items.every((part) => item.safeParse(part).success);
      },
      `must be one value or up to ${String(maxItems)} comma-separated values`,
    );
}

/**
 * The typed values of a validated filter, or `undefined` when the filter was not sent.
 * @throws {z.ZodError} when a value does not match `item`.
 */
export function filterValues<Item>(
  value: string | undefined,
  item: z.ZodType<Item>,
): Item[] | undefined {
  return value === undefined ? undefined : value.split(',').map((part) => item.parse(part));
}

/** ISO-8601 date-time with `Z` or an offset. */
export const filterTimestampSchema = z.iso.datetime({ offset: true });

/** `true` or `false`, as a query string carries them. */
export const booleanFilterSchema = z.enum(['true', 'false']);

const CREATED_AT_RANGE = {
  'filter[created-at-start]': filterTimestampSchema.optional(),
  'filter[created-at-end]': filterTimestampSchema.optional(),
};

interface CreatedAtRange {
  'filter[created-at-start]'?: string | undefined;
  'filter[created-at-end]'?: string | undefined;
}

function startsBeforeEnd(query: CreatedAtRange): boolean {
  const start = query['filter[created-at-start]'];
  const end = query['filter[created-at-end]'];
  return start === undefined || end === undefined || Date.parse(start) < Date.parse(end);
}

/**
 * A list query: `page[after]` (an ID of `prefix`), `page[size]`, the given filters and, unless
 * `createdAt` is false, the `created-at` range. Unknown parameters are rejected.
 */
export function listQuerySchema<Filters extends z.ZodRawShape>(
  prefix: IdPrefix,
  filters: Filters,
  options: { createdAt?: boolean } = {},
) {
  const pagination = {
    'page[after]': idSchema(prefix).optional(),
    'page[size]': pageSizeSchema.optional(),
  };
  const range = options.createdAt === false ? {} : CREATED_AT_RANGE;
  return z
    .strictObject({ ...pagination, ...filters, ...range })
    .refine((query) => startsBeforeEnd(query as CreatedAtRange), {
      message: 'filter[created-at-end] must be after filter[created-at-start]',
      path: ['filter[created-at-end]'],
    });
}

/**
 * C165.3 (Workflow 9B): a list query as {@link listQuerySchema} builds it, that also takes up to
 * `max` dynamic filters whose names match `pattern` (such as `filter[fields.<key>]`), each a string
 * value. Any other unknown parameter is still rejected.
 */
export function listQueryWithDynamicFiltersSchema<Filters extends z.ZodRawShape>(
  prefix: IdPrefix,
  filters: Filters,
  dynamic: { pattern: RegExp; value: z.ZodString; max: number; name: string },
) {
  const known = {
    'page[after]': idSchema(prefix).optional(),
    'page[size]': pageSizeSchema.optional(),
    ...filters,
    ...CREATED_AT_RANGE,
  };
  const knownKeys = new Set(Object.keys(known));
  return z
    .object(known)
    .catchall(dynamic.value)
    .superRefine((query, ctx) => {
      const extra = Object.keys(query).filter((key) => !knownKeys.has(key));
      for (const key of extra) {
        if (!dynamic.pattern.test(key)) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'is not a filter of this list' });
        }
      }
      if (extra.length > dynamic.max) {
        ctx.addIssue({
          code: 'custom',
          path: [],
          message: `at most ${String(dynamic.max)} ${dynamic.name} filters at once`,
        });
      }
      if (!startsBeforeEnd(query as CreatedAtRange)) {
        ctx.addIssue({
          code: 'custom',
          path: ['filter[created-at-end]'],
          message: 'filter[created-at-end] must be after filter[created-at-start]',
        });
      }
    });
}
