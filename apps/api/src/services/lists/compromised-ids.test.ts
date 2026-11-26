/**
 * C99.9 (Workflow 7B, `api-lists`; H09, P13): `CompromisedIdLookup`, an exact match of the
 * extraction's number and class against every active list opted in with
 * `use-for-compromised-ids`: never another environment's, never an archived item, and an outdated
 * normaliser reads as unscreened, which the check answers `not_applicable`. A match writes one
 * `list-match` record. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import {
  archiveListItem,
  createList,
  insertListItems,
  listListMatches,
  redactInquiryRecords,
  type Db,
  type ListRow,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createRecordingEventPublisher,
  type RecordingEventPublisher,
} from '../../test-support/fakes.js';
import { createCompromisedIdLookup } from './compromised-ids.js';
import { newListItem } from './keys.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
let events: RecordingEventPublisher;
const blindIndexKey = new Uint8Array(randomBytes(32));
const NUMBER = 'X1234567';

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(() => {
  events = createRecordingEventPublisher();
});

async function optedIn(
  values: readonly Record<string, unknown>[],
  environment = environmentId,
  useForCompromisedIds = true,
): Promise<{ list: ListRow; itemIds: string[] }> {
  const list = await createList(db, environment, {
    id: newId('lst'),
    type: 'government-id-number',
    name: 'Compromised',
    useForCompromisedIds,
  });
  const items = values.map((value) =>
    newListItem(blindIndexKey, environment, list, {
      id: newId('ligin'),
      value,
      creator: { type: 'api-key', id: newId('key') },
    }),
  );
  await insertListItems(db, environment, list.id, items);
  return { list, itemIds: items.map(({ id }) => id) };
}

async function lookup(input: { environment: string; number?: string; idClass?: 'passport' }) {
  const { inquiry } = await createTestInquiry(db, input.environment);
  const answer = await createCompromisedIdLookup({ db, blindIndexKey, events }).lookup({
    environmentId: input.environment,
    inquiryId: inquiry.id,
    verificationId: newId('ver'),
    identificationNumber: input.number ?? NUMBER,
    idClass: input.idClass ?? null,
  });
  return { answer, inquiry };
}

const tenant = async () => (await createTestTenant(db)).environment.id;

describe('CompromisedIdLookup (C99.9)', () => {
  it('answers null with no opted-in list, so the input stays absent', async () => {
    const environment = await tenant();
    await optedIn([{ 'id-number': NUMBER }], environment, false);
    expect((await lookup({ environment })).answer).toBeNull();
  });

  it('matches a listed number, writes one record and its event, and names no value', async () => {
    const environment = await tenant();
    const { list, itemIds } = await optedIn([{ 'id-number': NUMBER }], environment);

    const { answer, inquiry } = await lookup({ environment, idClass: 'passport' });

    expect(answer).toEqual({ matched: true, unscreened: [], screened: [list.id] });
    const { items } = await listListMatches(
      db,
      environment,
      { inquiryIds: [inquiry.id] },
      { size: 5 },
    );
    expect(items).toEqual([
      expect.objectContaining({
        listItemId: itemIds[0],
        source: 'government-id.identification-number',
        method: 'exact',
        tier: 'R',
        accountId: inquiry.accountId,
        matchedValue: NUMBER,
      }),
    ]);
    expect(events.named('list-match.created')).toHaveLength(1);
    expect(JSON.stringify(events.events)).not.toContain(NUMBER);
  });

  it('writes one record when a retried job looks again', async () => {
    const environment = await tenant();
    await optedIn([{ 'id-number': NUMBER }], environment);
    const { inquiry } = await createTestInquiry(db, environment);
    const run = () =>
      createCompromisedIdLookup({ db, blindIndexKey, events }).lookup({
        environmentId: environment,
        inquiryId: inquiry.id,
        verificationId: newId('ver'),
        identificationNumber: NUMBER,
        idClass: null,
      });

    await run();
    await run();

    const { items } = await listListMatches(
      db,
      environment,
      { inquiryIds: [inquiry.id] },
      { size: 5 },
    );
    expect(items).toHaveLength(1);
    expect(events.named('list-match.created')).toHaveLength(1);
  });

  it('holds a class to its class, and reads an item of any class', async () => {
    const environment = await tenant();
    await optedIn([{ 'id-number': NUMBER, 'id-class': 'visa' }], environment);
    expect((await lookup({ environment, idClass: 'passport' })).answer?.matched).toBe(false);
    await optedIn([{ 'id-number': NUMBER }], environment);
    expect((await lookup({ environment, idClass: 'passport' })).answer?.matched).toBe(true);
  });

  it('never matches an archived item', async () => {
    const environment = await tenant();
    const { itemIds } = await optedIn([{ 'id-number': NUMBER }], environment);
    await archiveListItem(db, environment, itemIds[0] ?? '', new Date());
    expect((await lookup({ environment })).answer).toMatchObject({ matched: false });
  });

  it('never reads an archived list', async () => {
    const environment = await tenant();
    const { list } = await optedIn([{ 'id-number': NUMBER }], environment);
    await db.execute(
      sql`update lists set status = 'archived', archived_at = now() where id = ${list.id}`,
    );
    expect((await lookup({ environment })).answer).toBeNull();
  });

  it('never matches another environment’s list', async () => {
    const environment = await tenant();
    await optedIn([{ 'id-number': NUMBER }], environment);
    const other = await tenant();
    await optedIn([{ 'id-number': 'Y7654321' }], other);
    expect((await lookup({ environment: other })).answer).toMatchObject({ matched: false });
  });

  it('answers unscreened for an outdated normaliser, never not matched alone', async () => {
    const environment = await tenant();
    const { list, itemIds } = await optedIn([{ 'id-number': NUMBER }], environment);
    await db.execute(
      sql`update list_items set normaliser_version = 'lists-0' where id = ${itemIds[0] ?? ''}`,
    );

    expect((await lookup({ environment })).answer).toEqual({
      matched: false,
      unscreened: [{ 'list-id': list.id, reason: 'normaliser_outdated' }],
      screened: [],
    });
  });

  it('writes nothing for a redacted inquiry', async () => {
    const environment = await tenant();
    await optedIn([{ 'id-number': NUMBER }], environment);
    const { inquiry } = await createTestInquiry(db, environment);
    await redactInquiryRecords(db, environment, inquiry.id);

    const answer = await createCompromisedIdLookup({ db, blindIndexKey, events }).lookup({
      environmentId: environment,
      inquiryId: inquiry.id,
      verificationId: newId('ver'),
      identificationNumber: NUMBER,
      idClass: null,
    });

    expect(answer).toBeNull();
    expect(events.events).toEqual([]);
  });
});
