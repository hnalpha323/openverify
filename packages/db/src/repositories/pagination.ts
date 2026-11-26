import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Db } from '../client.js';
import { InvalidCursorError } from '../errors.js';

/** `page[size]` default. */
export const DEFAULT_PAGE_SIZE = 10;
/** `page[size]` maximum (C1). */
export const MAX_PAGE_SIZE = 100;

export interface PageRequest {
  /** `page[after]`: the id of the last item on the previous page. */
  after?: string | undefined;
  /** `page[size]`: clamped to 1-100; defaults to 10. */
  size?: number | undefined;
}

export interface Page<T> {
  items: T[];
  /** The `page[after]` value for the next page, or `null` on the last page. */
  next: string | null;
}

/** Clamps a requested page size to 1-100, defaulting to 10. */
export function pageSize(size: number | undefined): number {
  if (size === undefined || Number.isNaN(size)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(size)));
}

/**
 * The columns every cursor-paged table has. `scope` is the tenant column the list is
 * filtered by: `environment_id`, or `organization_id` for organization-level tables.
 */
export interface CursorTable {
  table: PgTable;
  id: AnyPgColumn;
  scope: AnyPgColumn;
  createdAt: AnyPgColumn;
}

/** The C1 list order: newest first, ties broken by id. */
export const newestFirst = (cursor: CursorTable): SQL[] => [
  desc(cursor.createdAt),
  desc(cursor.id),
];

/** A cursor over a table's `id`, `created_at` and `environment_id` columns. */
export const environmentCursor = (
  table: {
    id: AnyPgColumn;
    environmentId: AnyPgColumn;
    createdAt: AnyPgColumn;
  } & PgTable,
): CursorTable => ({
  table,
  id: table.id,
  scope: table.environmentId,
  createdAt: table.createdAt,
});

/**
 * One page in C1 order. `fetch` runs the caller's query with the cursor condition (if
 * any) added to its filters, ordered by {@link newestFirst}, with the given limit. The
 * cursor row's position is read inside the query, so timestamps never round-trip
 * through JavaScript and lose their microseconds. An `after` id that is not in this
 * environment (or organization) raises {@link InvalidCursorError}.
 */
export async function paginate<T>(
  db: Db,
  cursor: CursorTable,
  scopeId: string,
  page: PageRequest,
  fetch: (afterCondition: SQL | undefined, limit: number) => Promise<T[]>,
  /** The value of `cursor.id` in an item; its `id` by default. */
  cursorOf: (item: T) => string = (item) => (item as { id: string }).id,
): Promise<Page<T>> {
  const size = pageSize(page.size);
  const { after } = page;
  const afterCondition =
    after === undefined
      ? undefined
      : sql`(${cursor.createdAt}, ${cursor.id}) < (
          select c.${sql.identifier(cursor.createdAt.name)}, c.${sql.identifier(cursor.id.name)}
            from ${cursor.table} as c
           where c.${sql.identifier(cursor.id.name)} = ${after}
             and c.${sql.identifier(cursor.scope.name)} = ${scopeId})`;
  const rows = await fetch(afterCondition, size + 1);
  if (rows.length === 0 && after !== undefined) {
    const found = await db
      .select({ id: cursor.id })
      .from(cursor.table)
      .where(and(eq(cursor.id, after), eq(cursor.scope, scopeId)))
      .limit(1);
    if (found.length === 0) {
      throw new InvalidCursorError();
    }
  }
  const items = rows.slice(0, size);
  const last = items.at(-1);
  return { items, next: rows.length > size && last !== undefined ? cursorOf(last) : null };
}
