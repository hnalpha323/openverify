/**
 * Workflow 6D review (rescreen-6d follow-up, migration 0022): the re-screen reads the entries a
 * sync added or changed one page at a time, in entry id order (`listChangedWatchlistEntries`,
 * C74.4). After a large sync, a page must be an index range read, not a top-N sort of the whole
 * changed set (697 ms a page after a 51,592-entry sync on the 2,000,000-name table). The proof is
 * the plan Postgres 17 chooses (EXPLAIN) for the exact query the repository sends, captured from
 * the pool, over an analyzed table where one sync changed 60,000 of 200,000 entries. Every id is
 * synthetic (`SYN-`).
 */
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { runMigrations } from './migrate.js';
import {
  insertWatchlistSync,
  listChangedWatchlistEntries,
  reconcileWatchlistSourceRows,
} from './repositories/index.js';
import { createIntegrationPool, startIntegrationPostgres, ifSet } from './testing.js';

const LIST = 'synthetic-list';
const OTHER = 'synthetic-other';
/** The live entries of the large sync: every third of 180,000, less the removed ones. */
const ENTRIES = 180_000;
const PAGE = 1_000;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let older: number;
let large: number;

/**
 * Inserts `count` synthetic entries of `source`: entry `i` was last changed by `changed(i)` and
 * removed when `removed(i)`. Upper- and lower-case ids alternate, so the "C" order differs from a
 * linguistic one.
 */
async function fillEntries(
  source: string,
  count: number,
  syncs: { first: number; changedEvery: number; changed: number; removedEvery: number },
): Promise<void> {
  await pool.query(
    `insert into watchlist_entries (source_id, entry_id, kind, content_hash, risk_data_hash, data,
                                    first_seen_sync_id, last_seen_sync_id, changed_sync_id,
                                    removed_at)
     select $1, case when i % 2 = 0 then 'SYN-' else 'syn-' end || lpad(i::text, 7, '0'),
            'individual', repeat('a', 64), repeat('b', 64), '{"synthetic": true}'::jsonb,
            $3::bigint, $4::bigint, case when i % $5::int = 0 then $4::bigint else $3::bigint end,
            case when i % $6::int = 0 then now() else null end
       from generate_series(1, $2::int) as i`,
    [source, count, syncs.first, syncs.changed, syncs.changedEvery, syncs.removedEvery],
  );
}

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 4 });
  db = createDatabase(pool);
  await runMigrations(db);
  await reconcileWatchlistSourceRows(db, [
    { id: LIST, enabled: true, sandboxOnly: false },
    { id: OTHER, enabled: true, sandboxOnly: false },
  ]);
  const sync = (sourceId: string) =>
    insertWatchlistSync(db, {
      sourceId,
      startedAt: new Date('2026-10-27T12:00:00.000Z'),
      finishedAt: new Date('2026-10-27T12:05:00.000Z'),
      outcome: 'applied',
      actor: 'cli',
    });
  older = await sync(LIST);
  large = await sync(LIST);
  const other = await sync(OTHER);
  // 60,000 of LIST's entries were changed by the large sync, 1 in 37 of all is removed; OTHER's
  // entries were all changed by its own sync.
  await fillEntries(LIST, ENTRIES, {
    first: older,
    changedEvery: 3,
    changed: large,
    removedEvery: 37,
  });
  await fillEntries(OTHER, 20_000, {
    first: other,
    changedEvery: 1,
    changed: other,
    removedEvery: 50,
  });
  await pool.query('analyze watchlist_entries');
}, 180_000);

afterAll(async () => {
  await ifSet(pool)?.end();
  await container?.stop();
});

/** Runs `list` and returns the plan Postgres chooses for its last query on watchlist_entries. */
async function planOf(list: () => Promise<unknown>): Promise<string> {
  const spy = vi.spyOn(pool, 'query');
  let calls: unknown[][];
  try {
    await list();
  } finally {
    // mockRestore() also forgets the calls, so they are read first.
    calls = [...spy.mock.calls];
    spy.mockRestore();
  }
  const sent = calls
    .map((call) => {
      const [config, values] = call as unknown as [string | { text: string }, unknown[]?];
      return { text: typeof config === 'string' ? config : config.text, values: values ?? [] };
    })
    .filter(({ text }) => text.includes('from watchlist_entries e'))
    .at(-1);
  if (sent === undefined) {
    throw new Error('no query on watchlist_entries was sent');
  }
  const explained = await pool.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sent.text}`, sent.values);
  return explained.rows.map((row) => row['QUERY PLAN']).join('\n');
}

describe('the re-screen reads a large sync’s changed entries by index range (Workflow 6D review)', () => {
  it.each([
    ['the first page', undefined],
    ['a page after an entry id', 'syn-0090001'],
  ])('reads %s with no sort node', async (_label, afterEntryId) => {
    const plan = await planOf(() =>
      listChangedWatchlistEntries(db, { sourceId: LIST, syncId: large, afterEntryId, limit: PAGE }),
    );

    expect(plan).toContain('watchlist_entries_changed_page_idx');
    expect(plan).not.toMatch(/\bSort\b/u);
  });

  it('pages through the large sync’s live changed entries once each, in "C" order', async () => {
    const expected = await pool.query<{ entry_id: string }>(
      `select entry_id from watchlist_entries
        where source_id = $1 and changed_sync_id = $2 and removed_at is null
        order by entry_id collate "C"`,
      [LIST, large],
    );
    const read: string[] = [];
    let afterEntryId: string | undefined;
    for (;;) {
      const page = await listChangedWatchlistEntries(db, {
        sourceId: LIST,
        syncId: large,
        afterEntryId,
        limit: PAGE,
      });
      read.push(...page.map(({ entryId }) => entryId));
      if (page.length < PAGE) {
        break;
      }
      afterEntryId = page.at(-1)?.entryId;
    }

    expect(read).toHaveLength(58_379);
    expect(read).toEqual(expected.rows.map((row) => row.entry_id));
    expect(read.slice(0, 2)).toEqual(['SYN-0000006', 'SYN-0000012']);
    expect(older).toBeLessThan(large);
  });
});
