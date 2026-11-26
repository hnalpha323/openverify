/**
 * C137.2, C138.1: how a case search and an export by search order their cases, in one place, so
 * the key a page is cursored by is the key its index holds (Workflow 8C review R007).
 *
 * A missing timestamp sorts last in either direction.
 */
import { cases } from '@openverify/db';
import { asc, desc, sql, type SQL } from 'drizzle-orm';

export const CASE_SORT_COLUMNS = {
  created_at: cases.createdAt,
  updated_at: cases.updatedAt,
  resolved_at: cases.resolvedAt,
  sla_expires_at: cases.slaExpiresAt,
} as const;

export type CaseSortAttribute = keyof typeof CASE_SORT_COLUMNS;
export type CaseSortDirection = 'asc' | 'desc';

/**
 * The key a search sorted by `attribute` in `direction` orders and cursors its cases by. The two
 * timestamps every case has are their own key; a nullable one sorts a missing value last in either
 * direction, through a key each direction has an index on (`cases_environment_id_*_last_*_idx`).
 */
export function caseSortKey(attribute: CaseSortAttribute, direction: CaseSortDirection): SQL {
  switch (attribute) {
    case 'created_at':
    case 'updated_at':
      return sql`${CASE_SORT_COLUMNS[attribute]}`;
    case 'resolved_at':
    case 'sla_expires_at':
      return direction === 'asc'
        ? sql`coalesce(${CASE_SORT_COLUMNS[attribute]}, 'infinity'::timestamptz)`
        : sql`coalesce(${CASE_SORT_COLUMNS[attribute]}, '-infinity'::timestamptz)`;
  }
}

/**
 * The `ORDER BY` of such a search, read forward (`ascending` as the direction) or backward (a page
 * before a cursor reads the other way and is reversed).
 */
export function caseSortOrder(
  attribute: CaseSortAttribute,
  direction: CaseSortDirection,
  ascending: boolean = direction === 'asc',
): SQL[] {
  const key = caseSortKey(attribute, direction);
  return ascending ? [asc(key), asc(cases.id)] : [desc(key), desc(cases.id)];
}

/**
 * The keyset condition of a page that reads on from a cursor case whose key (as text) is
 * `position.key`: the cases past it in the order the page reads (`ascending`).
 */
export function caseSortPast(
  attribute: CaseSortAttribute,
  direction: CaseSortDirection,
  ascending: boolean,
  position: { key: string; id: string },
): SQL {
  const key = caseSortKey(attribute, direction);
  return ascending
    ? sql`(${key}, ${cases.id}) > (${position.key}::timestamptz, ${position.id})`
    : sql`(${key}, ${cases.id}) < (${position.key}::timestamptz, ${position.id})`;
}
