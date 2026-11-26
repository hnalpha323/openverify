import { eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { lowerTags } from '../tables/columns.js';

/** The first row, or `null` when the query matched nothing. */
export const firstOrNull = <T>(rows: readonly T[]): T | null => rows[0] ?? null;

/** The row an `INSERT ... RETURNING` produced. */
export function inserted<T>(rows: readonly T[], what: string): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`${what}: the database returned no row`);
  }
  return row;
}

/**
 * `column = value`, or `column IN (values)` for a list. `undefined` means "no filter";
 * `null` means an empty list, which matches nothing, so the caller can skip the query.
 */
export function equalsAny<T extends string>(
  column: AnyPgColumn,
  value: T | readonly T[] | undefined,
): SQL | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return eq(column, value);
  }
  return value.length === 0 ? null : inArray(column, [...value]);
}

/** One value or several, as C9 comma-separated filters give them. */
export type OneOrMany<T> = T | readonly T[];

/** C9 date filters: `created-at-start` is inclusive, `created-at-end` exclusive. */
export interface CreatedAtRange {
  createdAtStart?: Date | undefined;
  createdAtEnd?: Date | undefined;
}

/** The SQL conditions of a {@link CreatedAtRange} on `column`. */
export function createdAtRange(column: AnyPgColumn, range: CreatedAtRange): (SQL | undefined)[] {
  return [
    range.createdAtStart === undefined ? undefined : gte(column, range.createdAtStart),
    range.createdAtEnd === undefined ? undefined : lt(column, range.createdAtEnd),
  ];
}

/**
 * C9 `filter[tag]`: the row has any of the tags, ignoring case (served by the
 * `openverify_lower_tags` GIN index). `undefined` means no filter, `null` an empty list.
 */
export function hasAnyTag(
  column: AnyPgColumn,
  tags: OneOrMany<string> | undefined,
): SQL | undefined | null {
  if (tags === undefined) {
    return undefined;
  }
  const list = (typeof tags === 'string' ? [tags] : [...tags]).map((tag) => tag.toLowerCase());
  if (list.length === 0) {
    return null;
  }
  return sql`${lowerTags(column)} && ${textArray(list)}`;
}

/** `ARRAY[$1, $2, ...]::text[]`, bound value by value so every driver sends it the same way. */
export const textArray = (values: readonly string[]): SQL =>
  values.length === 0
    ? sql`'{}'::text[]`
    : sql`ARRAY[${sql.join(
        values.map((value) => sql`${value}`),
        sql`, `,
      )}]::text[]`;

/** Combines filters where `null` (an empty OR list) makes the whole query match nothing. */
export function allFilters(filters: (SQL | undefined | null)[]): (SQL | undefined)[] | null {
  return filters.includes(null) ? null : (filters as (SQL | undefined)[]);
}
