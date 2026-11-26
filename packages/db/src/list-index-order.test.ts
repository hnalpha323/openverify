/**
 * C38 (the Workflow 2E follow-up): every list orders `created_at DESC, id DESC`, which in Postgres
 * means NULLS FIRST, and an index serves an `ORDER BY` only in its own order. So every descending
 * index column is `DESC NULLS FIRST`, and a list page stops after its rows instead of sorting
 * every row of the scope. The query plans are in `list-index-order.integration.test.ts`.
 */
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema.js';

const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
  is(value, PgTable),
);

/** `<index>.<column>` of every descending index column, with its nulls order. */
function descendingColumns(): { column: string; nulls: string }[] {
  return tables.flatMap((table) =>
    getTableConfig(table).indexes.flatMap(({ config: index }) =>
      index.columns.flatMap((part) =>
        'name' in part && part.indexConfig?.order === 'desc'
          ? [
              {
                column: `${index.name ?? '?'}.${part.name ?? '?'}`,
                nulls: part.indexConfig.nulls ?? 'last',
              },
            ]
          : [],
      ),
    ),
  );
}

describe('list index order (C38)', () => {
  it('finds the descending list-index columns of every table', () => {
    expect(tables.length).toBeGreaterThan(20);
    expect(descendingColumns().length).toBeGreaterThanOrEqual(55);
  });

  it('puts nulls first on every descending index column, as the lists order', () => {
    expect(descendingColumns().filter(({ nulls }) => nulls !== 'first')).toEqual([]);
  });
});
