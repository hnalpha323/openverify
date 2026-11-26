/**
 * C99.1 (Workflow 7B, `api-lists`; F08): the real `ListItemWriter` and `ListService`, against the
 * same behaviour their fakes promise: refusals by position and never thrown, a repeat counted, the
 * list's rules applied. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { LIST_LIMITS } from '@openverify/core';
import { getList, listListItems, type Db } from '@openverify/db';
import { createTestDatabase, createTestTenant, seedList, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ListProblemError, NotFoundError } from '../../errors.js';
import {
  createAllowAllRateLimiter,
  createRecordingEventPublisher,
} from '../../test-support/fakes.js';
import { createListItemWriter, createListService } from './item-writer.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
const blindIndexKey = new Uint8Array(randomBytes(32));
const creator = { type: 'importer', id: 'mprt_00000000000000000000000000' } as const;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

describe('ListItemWriter (C99.1, C100.5)', () => {
  const writer = () => createListItemWriter({ blindIndexKey });

  it('keys and writes each item, counting what is already live', async () => {
    const list = await seedList(db, environmentId, { kind: 'email-address' });
    const write = (values: string[]) =>
      db.transaction((tx) =>
        writer().insertItems(tx, {
          environmentId,
          listId: list.id,
          items: values.map((value) => ({ attributes: { value }, creator })),
        }),
      );

    const first = await write(['one@example.com', 'two@example.com']);
    expect(first.inserted).toHaveLength(2);
    expect(first).toMatchObject({ alreadyPresent: 0, refused: [] });

    const second = await write(['ONE@example.com', 'three@example.com']);
    expect(second.inserted).toHaveLength(1);
    expect(second).toMatchObject({ alreadyPresent: 1, refused: [] });

    const page = await listListItems(db, environmentId, { listId: list.id }, { size: 10 });
    expect(page.items.map(({ value }) => value?.['match-type'])).toEqual(
      Array.from({ length: 3 }, () => 'email_address'),
    );
    expect(page.items[0]).toMatchObject({ createdByType: 'importer', createdById: creator.id });
  });

  it('answers a refusal by position and code, writing the rest', async () => {
    const list = await seedList(db, environmentId, { kind: 'phone-number' });
    const result = await db.transaction((tx) =>
      writer().insertItems(tx, {
        environmentId,
        listId: list.id,
        items: [
          { attributes: { value: '+12025550100' }, creator },
          { attributes: { value: 'not a number' }, creator },
        ],
      }),
    );
    expect(result.inserted).toHaveLength(1);
    expect(result.refused).toEqual([{ index: 1, code: 'unparseable_phone' }]);
  });

  it('refuses the rows past the list’s limit, by position (C97.5)', async () => {
    const list = await seedList(db, environmentId, { kind: 'string' });
    await db.execute(
      sql`update lists set item_count = ${LIST_LIMITS.itemsPerList - 1} where id = ${list.id}`,
    );
    const result = await db.transaction((tx) =>
      writer().insertItems(tx, {
        environmentId,
        listId: list.id,
        items: [
          { attributes: { value: 'fits' }, creator },
          { attributes: { value: 'past it' }, creator },
        ],
      }),
    );
    expect(result.inserted).toHaveLength(1);
    expect(result.refused).toEqual([{ index: 1, code: 'row_limit_exceeded' }]);
  });

  it('throws for a list that is gone, archived or biometric', async () => {
    const write = (listId: string) =>
      db.transaction((tx) =>
        writer().insertItems(tx, { environmentId, listId, items: [] }),
      );
    await expect(write('lst_00000000000000000000000000')).rejects.toBeInstanceOf(NotFoundError);
    const archived = await seedList(db, environmentId, { status: 'archived' });
    await expect(write(archived.id)).rejects.toBeInstanceOf(ListProblemError);
    const faces = await seedList(db, environmentId, { kind: 'face' });
    await expect(write(faces.id)).rejects.toBeInstanceOf(ListProblemError);
  });
});

describe('ListService (C99.1, C103)', () => {
  const service = () =>
    createListService({
      db,
      blindIndexKey,
      rateLimiter: createAllowAllRateLimiter(),
      events: createRecordingEventPublisher(),
    });

  it('creates an item, and answers the live one for a value already there', async () => {
    const list = await seedList(db, environmentId, { kind: 'string' });
    const item = { attributes: { value: 'graph value' }, creator };
    const created = await service().createItem({ environmentId, listId: list.id, item });
    expect(created.alreadyPresent).toBe(false);

    const again = await service().createItem({ environmentId, listId: list.id, item });
    expect(again).toEqual({ id: created.id, alreadyPresent: true });
    expect(await getList(db, environmentId, list.id)).toMatchObject({ itemCount: 1 });
  });

  it('answers a value it refuses as a problem with its code', async () => {
    const list = await seedList(db, environmentId, { kind: 'phone-number' });
    await expect(
      service().createItem({
        environmentId,
        listId: list.id,
        item: { attributes: { value: 'not a number' }, creator },
      }),
    ).rejects.toMatchObject({ code: 'unparseable_phone' });
  });
});
