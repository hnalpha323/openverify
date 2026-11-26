/**
 * C98.2 (Workflow 7B, `api-lists`): `rebuildListIndexes`, which `blind-index:rebuild` calls: every
 * key recomputed from the sealed values under the new key, an item outdated by a new
 * `LIST_KEYS_VERSION` brought current, a fingerprint under another key left `key_rotated`, a value
 * the normaliser no longer reads left outdated, never dropped. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import {
  createList,
  getList,
  getListItem,
  insertListItems,
  type Db,
  type ListRow,
  type NewList,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedList,
  seedListItem,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newListItem } from './keys.js';
import { matchLists, type ListProbe } from './match.js';
import { rebuildListIndexes } from './rebuild.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
const oldKey = new Uint8Array(randomBytes(32));
const newKey = new Uint8Array(randomBytes(32));

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

async function listWith(
  type: NewList['type'],
  prefix: 'lis' | 'lin' | 'libf' | 'liip' | 'ligl',
  values: readonly Record<string, unknown>[],
  input: Partial<NewList> = {},
): Promise<{ list: ListRow; itemIds: string[] }> {
  const list = await createList(db, environmentId, {
    id: newId('lst'),
    type,
    name: 'Synthetic',
    ...input,
  });
  const items = values.map((value) =>
    newListItem(oldKey, environmentId, list, {
      id: newId(prefix),
      value,
      creator: { type: 'api-key', id: newId('key') },
    }),
  );
  await insertListItems(db, environmentId, list.id, items);
  return { list, itemIds: items.map(({ id }) => id) };
}

const run = async (list: ListRow, probe: ListProbe, key: Uint8Array) =>
  matchLists(db, environmentId, [probe], {
    key,
    lists: [(await getList(db, environmentId, list.id)) ?? list],
    matcherData: { status: 'missing' },
  });

describe('rebuildListIndexes (C98.2)', () => {
  it('recomputes every key under the new key, the extra keys too', async () => {
    const strings = await listWith('string', 'lis', [{ value: 'listed' }]);
    const names = await listWith('name', 'lin', [
      { 'name-first': 'Jürgen', 'name-last': 'Müller' },
    ]);
    const stringProbe: ListProbe = {
      source: 'request',
      kind: 'string',
      values: [{ value: 'listed' }],
    };
    const nameProbe: ListProbe = {
      source: 'request',
      kind: 'name',
      values: [{ 'name-first': 'Mueller', 'name-last': 'Juergen' }],
    };
    expect((await run(strings.list, stringProbe, newKey)).matches).toEqual([]);

    const result = await rebuildListIndexes(db, newKey, { batchSize: 1 });

    expect(result.scanned).toBeGreaterThanOrEqual(2);
    expect(result.updated).toBeGreaterThanOrEqual(2);
    expect((await run(strings.list, stringProbe, newKey)).matches).toHaveLength(1);
    expect((await run(names.list, nameProbe, newKey)).matches).toHaveLength(1);
    expect((await run(strings.list, stringProbe, oldKey)).matches).toEqual([]);
  });

  it('does nothing a second time', async () => {
    await rebuildListIndexes(db, newKey, { batchSize: 100 });
    const again = await rebuildListIndexes(db, newKey, { batchSize: 100 });
    expect(again.updated).toBe(0);
  });

  it('brings an outdated row current, so its list reads screened again', async () => {
    const { list, itemIds } = await listWith('string', 'lis', [{ value: 'stale' }]);
    await rebuildListIndexes(db, newKey, { batchSize: 100 });
    await db.execute(
      sql`update list_items set normaliser_version = 'lists-0' where id = ${itemIds[0] ?? ''}`,
    );
    const probe: ListProbe = { source: 'request', kind: 'string', values: [{ value: 'stale' }] };
    expect((await run(list, probe, newKey)).unscreened).toEqual([
      { 'list-id': list.id, reason: 'normaliser_outdated' },
    ]);

    const { updated } = await rebuildListIndexes(db, newKey, { batchSize: 100 });

    expect(updated).toBe(1);
    const outcome = await run(list, probe, newKey);
    expect(outcome.unscreened).toEqual([]);
    expect(outcome.matches).toHaveLength(1);
  });

  it('leaves a fingerprint under another key rotated: it cannot be re-derived (C94.4)', async () => {
    const value = 'd'.repeat(64);
    const { list } = await listWith('browser-fingerprint', 'libf', [{ value }]);
    await rebuildListIndexes(db, newKey, { batchSize: 100 });

    const outcome = await run(
      list,
      { source: 'request', kind: 'browser-fingerprint', values: [{ value }] },
      newKey,
    );

    expect(outcome.matches).toEqual([]);
    expect(outcome.unscreened).toEqual([{ 'list-id': list.id, reason: 'key_rotated' }]);
  });

  it('leaves a row it can no longer read outdated, and its list says so', async () => {
    const list = await seedList(db, environmentId, { kind: 'phone-number' });
    await seedListItem(db, environmentId, {
      listId: list.id,
      prefix: 'lipn',
      value: { value: 'not a number' },
      normaliserVersion: 'lists-0',
    });

    await rebuildListIndexes(db, newKey, { batchSize: 100 });

    const row = await getList(db, environmentId, list.id);
    if (row === null) {
      throw new Error('the list is gone');
    }
    const outcome = await run(
      row,
      { source: 'request', kind: 'phone-number', values: [{ value: '+12025550100' }] },
      newKey,
    );
    expect(outcome.unscreened).toEqual([{ 'list-id': list.id, reason: 'normaliser_outdated' }]);
  });

  it('keeps the older of two rows that now read the same, and archives the other', async () => {
    const list = await seedList(db, environmentId, { kind: 'string' });
    await db.execute(sql`update lists set item_count = 2 where id = ${list.id}`);
    const seed = () =>
      seedListItem(db, environmentId, {
        listId: list.id,
        value: { value: 'same value' },
        normaliserVersion: 'lists-0',
      });
    const older = await seed();
    const newer = await seed();
    const [first, second] = [older.id, newer.id].sort();

    await rebuildListIndexes(db, newKey, { batchSize: 100 });

    expect(await getListItem(db, environmentId, first ?? '')).toMatchObject({ status: 'active' });
    expect(await getListItem(db, environmentId, second ?? '')).toMatchObject({
      status: 'archived',
    });
    expect(await getList(db, environmentId, list.id)).toMatchObject({ itemCount: 1 });
  });
});
