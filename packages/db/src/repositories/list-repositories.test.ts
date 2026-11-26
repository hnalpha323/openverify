/**
 * C97, C98, C99.3, C99.4 (Workflow 7B, `api-lists`): the list repositories on PGlite: lists, items
 * with their keys and side rows, matches and the screening outbox. Every value is synthetic, and
 * every key here is a made-up digest: the keyed HMACs are the API's.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import { InvalidCursorError } from '../errors.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  createdAtClock,
  openListMatchValues,
  seedList,
  seedListItem,
  wallClockStepsBack,
  type TestDatabase,
} from '../testing.js';
import { createEvent } from './events.js';
import {
  archiveListItem,
  findCountryListItems,
  findGeoListItems,
  findListItemsByKeys,
  findListItemsInRange,
  findNameCandidates,
  getListItem,
  getLiveListItemByKey,
  insertListItems,
  listListItemHealth,
  listListItems,
  listListItemsForRebuild,
  lockList,
  redactExpiredListItems,
  redactListItems,
  rewriteListItemKeys,
  type NewListItem,
} from './list-items.js';
import {
  dismissListMatch,
  getListMatch,
  insertListMatches,
  listListMatches,
  listOpenListMatches,
  type NewListMatch,
} from './list-matches.js';
import {
  completeListScreening,
  createListScreening,
  failListScreening,
  getListScreening,
  listPendingListScreenings,
  lockPendingListScreening,
  markListScreeningsEnqueued,
  recordListScreeningFailure,
} from './list-screenings.js';
import {
  archiveList,
  countActiveLists,
  createList,
  getList,
  getLists,
  listActiveListsOfKinds,
  listCompromisedIdLists,
  listLists,
  listListsScreenedByAll,
  lockListLimit,
  updateList,
} from './lists.js';
import { redactInquiryRecords } from './redaction.js';

let database: TestDatabase;
let environmentId: string;
let otherEnvironmentId: string;

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  database = await createTestDatabase();
  environmentId = (await createTestTenant(database.db)).environment.id;
  otherEnvironmentId = (await createTestTenant(database.db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

let sequence = 0;
const ulid = () => {
  sequence += 1;
  return String(sequence).padStart(26, '0').replaceAll('0', 'A');
};
const hex = () => randomBytes(32).toString('hex');
const newList = (input: Partial<Parameters<typeof createList>[2]> = {}) =>
  createList(database.db, environmentId, {
    id: `lst_${ulid()}`,
    type: 'string',
    name: 'Synthetic list',
    ...input,
  });
const item = (prefix: string, input: Partial<NewListItem> = {}): NewListItem => ({
  id: `${prefix}_${ulid()}`,
  value: { value: 'synthetic' },
  matchKey: hex(),
  normaliserVersion: 'lists-1',
  ...input,
});

describe('lists (C97.1, C97.2)', () => {
  it('creates a list with the defaults of C97.2 and reads it back', async () => {
    const list = await newList({ name: 'Strings', caseSensitive: true });

    expect(list).toMatchObject({
      name: 'Strings',
      type: 'string',
      status: 'active',
      version: 1,
      itemCount: 0,
      screenAtCompletion: true,
      caseSensitive: true,
    });
    expect(await getList(database.db, environmentId, list.id)).toEqual(list);
  });

  it('never reads a list of another environment', async () => {
    const list = await newList();
    expect(await getList(database.db, otherEnvironmentId, list.id)).toBeNull();
    expect(await getLists(database.db, otherEnvironmentId, [list.id])).toEqual([]);
    expect(await updateList(database.db, otherEnvironmentId, list.id, { name: 'x' })).toBeNull();
    expect(await archiveList(database.db, otherEnvironmentId, list.id, new Date())).toBeNull();
  });

  it('pages newest first, filtered by status and kind (C1)', async () => {
    onTestFinished(wallClockStepsBack());
    const { environment } = await createTestTenant(database.db);
    const clock = createdAtClock(database.db);
    const lists = [];
    for (let index = 0; index < 3; index += 1) {
      const list = await seedList(database.db, environment.id, {
        kind: index === 0 ? 'email-address' : 'string',
      });
      await clock.at('lists', list.id);
      lists.push(list);
    }
    const [emails, first, second] = lists;
    const page = await listLists(database.db, environment.id, {}, { size: 2 });
    expect(page.items.map(({ id }) => id)).toEqual([second?.id, first?.id]);
    const rest = await listLists(
      database.db,
      environment.id,
      {},
      { size: 2, after: page.next ?? '' },
    );
    expect(rest.items.map(({ id }) => id)).toEqual([emails?.id]);
    expect(rest.next).toBeNull();
    const byKind = await listLists(
      database.db,
      environment.id,
      { kinds: ['email-address'] },
      { size: 5 },
    );
    expect(byKind.items.map(({ id }) => id)).toEqual([emails?.id]);
    await archiveList(database.db, environment.id, emails?.id ?? '', new Date());
    const archived = await listLists(
      database.db,
      environment.id,
      { statuses: ['archived'] },
      { size: 5 },
    );
    expect(archived.items.map(({ id }) => id)).toEqual([emails?.id]);
    await expect(
      listLists(database.db, environment.id, {}, { after: 'lst_nothing' }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it('changes the four members, and archives once', async () => {
    const list = await newList({ type: 'government-id-number' });
    const changed = await updateList(database.db, environmentId, list.id, {
      name: 'Renamed',
      itemRetentionDays: 30,
      screenAtCompletion: false,
      useForCompromisedIds: true,
    });
    expect(changed).toMatchObject({
      name: 'Renamed',
      itemRetentionDays: 30,
      screenAtCompletion: false,
      useForCompromisedIds: true,
    });

    const at = new Date('2026-10-31T12:00:00.000Z');
    const archived = await archiveList(database.db, environmentId, list.id, at);
    expect(archived).toMatchObject({ status: 'archived', archivedAt: at });
    const again = await archiveList(
      database.db,
      environmentId,
      list.id,
      new Date('2026-11-01T12:00:00.000Z'),
    );
    expect(again?.archivedAt).toEqual(at);
  });

  it('counts the active lists against the limit, under one lock per environment', async () => {
    const { environment } = await createTestTenant(database.db);
    await seedList(database.db, environment.id, { status: 'archived' });
    await seedList(database.db, environment.id);

    expect(await countActiveLists(database.db, environment.id)).toBe(1);
    await database.db.transaction(async (tx) => {
      await lockListLimit(tx, environment.id);
    });
  });

  it('finds the lists each exit selects (C99.4, C99.5, C99.9)', async () => {
    const { environment } = await createTestTenant(database.db);
    const seed = (input: Parameters<typeof seedList>[2]) =>
      seedList(database.db, environment.id, input);
    const email = await seed({ kind: 'email-address' });
    await seed({ kind: 'email-address', status: 'archived' });
    await seed({ kind: 'email-address', screenAtCompletion: false });
    await seed({ kind: 'string' });
    await seed({ kind: 'face' });
    const compromised = await seed({ kind: 'government-id-number', useForCompromisedIds: true });
    await seed({ kind: 'government-id-number' });

    const screened = await listListsScreenedByAll(database.db, environment.id);
    expect(screened.map(({ type }) => type).sort()).toEqual([
      'email-address',
      'government-id-number',
      'government-id-number',
    ]);
    const active = await listActiveListsOfKinds(database.db, environment.id, ['email-address']);
    expect(active.map(({ screenAtCompletion }) => screenAtCompletion).sort()).toEqual([
      false,
      true,
    ]);
    expect(active.map(({ id }) => id)).toContain(email.id);
    const opted = await listCompromisedIdLists(database.db, environment.id);
    expect(opted.map(({ id }) => id)).toEqual([compromised.id]);
  });
});

describe('list items (C98.1)', () => {
  it('seals the value, bumps the list once and writes the keys and side rows', async () => {
    const list = await newList({ type: 'ip-address' });
    const single = item('liip', { value: { value: '192.0.2.1' } });
    const range = item('liip', { value: { value: '198.51.100.0/24' }, range: '198.51.100.0/24' });
    const named = item('liip', {
      keys: [{ keyKind: 'identifier-ip', matchKey: hex() }],
      creator: { type: 'importer', id: `mprt_${ulid()}` },
    });

    const result = await insertListItems(database.db, environmentId, list.id, [
      single,
      range,
      named,
    ]);

    expect(result.inserted.map(({ id }) => id).sort()).toEqual(
      [single.id, range.id, named.id].sort(),
    );
    expect(result.alreadyPresent).toBe(0);
    expect(await getList(database.db, environmentId, list.id)).toMatchObject({
      version: 2,
      itemCount: 3,
    });
    const read = await getListItem(database.db, environmentId, single.id);
    expect(read).toMatchObject({
      value: { value: '192.0.2.1' },
      status: 'active',
      matchCount: 0,
      listId: list.id,
      listKind: 'ip-address',
    });
    expect(await getListItem(database.db, environmentId, named.id)).toMatchObject({
      createdByType: 'importer',
      createdById: named.creator?.id,
    });
    const stored = await database.client.query<{ value: string }>(
      `select value from list_items where id = $1`,
      [single.id],
    );
    expect(stored.rows[0]?.value).not.toContain('192.0.2.1');
    expect(await getListItem(database.db, otherEnvironmentId, single.id)).toBeNull();
  });

  it('counts a value already live, and a repeat inside the batch, as alreadyPresent (C100.5)', async () => {
    const list = await newList();
    const matchKey = hex();
    await insertListItems(database.db, environmentId, list.id, [item('lis', { matchKey })]);
    const result = await insertListItems(database.db, environmentId, list.id, [
      item('lis', { matchKey }),
      item('lis', { matchKey: hex() }),
    ]);
    expect(result.inserted).toHaveLength(1);
    expect(result.alreadyPresent).toBe(1);
    expect(await getList(database.db, environmentId, list.id)).toMatchObject({
      version: 3,
      itemCount: 2,
    });

    const repeat = hex();
    const inside = await insertListItems(database.db, environmentId, list.id, [
      item('lis', { matchKey: repeat }),
      item('lis', { matchKey: repeat }),
    ]);
    expect(inside.inserted).toHaveLength(1);
    expect(inside.alreadyPresent).toBe(1);
  });

  it('leaves the list unbumped when nothing was written', async () => {
    const list = await newList();
    const matchKey = hex();
    await insertListItems(database.db, environmentId, list.id, [item('lis', { matchKey })]);
    await insertListItems(database.db, environmentId, list.id, [item('lis', { matchKey })]);
    expect(await getList(database.db, environmentId, list.id)).toMatchObject({ version: 2 });
    expect(await insertListItems(database.db, environmentId, list.id, [])).toEqual({
      inserted: [],
      alreadyPresent: 0,
    });
  });

  it('holds the list while items go in, answering its row and nothing for another environment', async () => {
    const list = await newList();
    await database.db.transaction(async (tx) => {
      expect((await lockList(tx, environmentId, list.id))?.id).toBe(list.id);
      expect(await lockList(tx, otherEnvironmentId, list.id)).toBeNull();
    });
  });

  it('finds a live item by its key, for a value already present', async () => {
    const list = await newList();
    const added = item('lis');
    await insertListItems(database.db, environmentId, list.id, [added]);
    expect(
      await getLiveListItemByKey(database.db, environmentId, list.id, added.matchKey ?? ''),
    ).toBe(added.id);
    await archiveListItem(database.db, environmentId, added.id, new Date());
    expect(
      await getLiveListItemByKey(database.db, environmentId, list.id, added.matchKey ?? ''),
    ).toBeNull();
  });

  it('pages a list’s items newest first, by status (C97.1)', async () => {
    onTestFinished(wallClockStepsBack());
    const list = await newList();
    const clock = createdAtClock(database.db);
    const seed = async (status?: 'pending') => {
      const seeded = await seedListItem(database.db, environmentId, {
        listId: list.id,
        ...(status === undefined ? {} : { status }),
      });
      await clock.at('list_items', seeded.id);
      return seeded;
    };
    const older = await seed();
    const newer = await seed();
    const pending = await seed('pending');

    const page = await listListItems(
      database.db,
      environmentId,
      { listId: list.id, statuses: ['active'] },
      { size: 1 },
    );
    expect(page.items.map(({ id }) => id)).toEqual([newer.id]);
    const rest = await listListItems(
      database.db,
      environmentId,
      { listId: list.id, statuses: ['active'] },
      { size: 1, after: page.next ?? '' },
    );
    expect(rest.items.map(({ id }) => id)).toEqual([older.id]);
    const all = await listListItems(database.db, environmentId, { listId: list.id }, { size: 5 });
    expect(all.items.map(({ id }) => id)).toEqual([pending.id, newer.id, older.id]);
    expect(all.items[0]?.value).toEqual({ value: 'synthetic' });
  });

  it('archives an item once: it stops counting and stays readable, and its value may return', async () => {
    const list = await newList();
    const added = item('lis');
    await insertListItems(database.db, environmentId, list.id, [added]);
    const at = new Date('2026-10-31T12:00:00.000Z');

    const archived = await archiveListItem(database.db, environmentId, added.id, at);
    expect(archived).toMatchObject({ status: 'archived', archivedAt: at, value: added.value });
    const list2 = await getList(database.db, environmentId, list.id);
    expect(list2).toMatchObject({ version: 3, itemCount: 0 });

    const again = await archiveListItem(database.db, environmentId, added.id, new Date());
    expect(again?.archivedAt).toEqual(at);
    expect(await getList(database.db, environmentId, list.id)).toMatchObject({ version: 3 });
    const back = await insertListItems(database.db, environmentId, list.id, [
      item('lis', { matchKey: added.matchKey }),
    ]);
    expect(back.inserted).toHaveLength(1);
    expect(await archiveListItem(database.db, otherEnvironmentId, added.id, at)).toBeNull();
  });
});

describe('what matching reads (C99.2)', () => {
  it('finds an active item by its match key or an extra key, and tells which key', async () => {
    const list = await newList({ type: 'name' });
    const other = await newList({ type: 'name' });
    const keyed = item('lin', {
      keys: [{ keyKind: 'identifier-name', matchKey: hex() }],
    });
    const elsewhere = item('lin', { matchKey: keyed.matchKey });
    await insertListItems(database.db, environmentId, list.id, [keyed]);
    await insertListItems(database.db, environmentId, other.id, [elsewhere]);
    const extra = keyed.keys?.[0]?.matchKey ?? '';

    const found = await findListItemsByKeys(database.db, environmentId, {
      listIds: [list.id],
      keys: [keyed.matchKey ?? '', extra, hex()],
      keyKinds: ['identifier-name'],
      normaliserVersion: 'lists-1',
      keyId: null,
    });

    expect(found.map((row) => row.key).sort()).toEqual([keyed.matchKey, extra].sort());
    expect(new Set(found.map((row) => row.itemId))).toEqual(new Set([keyed.id]));
    expect(found[0]?.listId).toBe(list.id);
  });

  it('never reads an archived, pending, outdated or rotated item, or another environment', async () => {
    const list = await newList({ type: 'browser-fingerprint' });
    const archived = item('libf', { keyId: 'AAAAAAAAAAA' });
    const pending = item('libf', { keyId: 'AAAAAAAAAAA', status: 'pending' });
    const outdated = item('libf', { keyId: 'AAAAAAAAAAA', normaliserVersion: 'lists-0' });
    const rotated = item('libf', { keyId: 'BBBBBBBBBBB' });
    const live = item('libf', { keyId: 'AAAAAAAAAAA' });
    await insertListItems(database.db, environmentId, list.id, [
      archived,
      pending,
      outdated,
      rotated,
      live,
    ]);
    await archiveListItem(database.db, environmentId, archived.id, new Date());
    const keys = [archived, pending, outdated, rotated, live].map(({ matchKey }) => matchKey ?? '');
    const query = {
      listIds: [list.id],
      keys,
      keyKinds: [],
      normaliserVersion: 'lists-1',
      keyId: 'AAAAAAAAAAA',
    };

    const found = await findListItemsByKeys(database.db, environmentId, query);

    expect(found.map(({ itemId }) => itemId)).toEqual([live.id]);
    expect(await findListItemsByKeys(database.db, otherEnvironmentId, query)).toEqual([]);
  });

  it('says which lists hold an outdated or rotated item (C98.2, C94.4)', async () => {
    const list = await newList({ type: 'browser-fingerprint' });
    const fine = await newList({ type: 'browser-fingerprint' });
    await insertListItems(database.db, environmentId, list.id, [
      item('libf', { keyId: 'AAAAAAAAAAA', normaliserVersion: 'lists-0' }),
      item('libf', { keyId: 'BBBBBBBBBBB' }),
    ]);
    await insertListItems(database.db, environmentId, fine.id, [
      item('libf', { keyId: 'AAAAAAAAAAA' }),
    ]);

    const health = await listListItemHealth(database.db, environmentId, [list.id, fine.id], {
      normaliserVersion: 'lists-1',
      keyId: 'AAAAAAAAAAA',
    });

    expect(health.get(list.id)).toEqual({ outdated: true, rotated: true });
    expect(health.get(fine.id)).toEqual({ outdated: false, rotated: false });
  });

  it('does not count an archived item against its list’s health', async () => {
    const list = await newList();
    const stale = item('lis', { normaliserVersion: 'lists-0' });
    await insertListItems(database.db, environmentId, list.id, [stale]);
    await archiveListItem(database.db, environmentId, stale.id, new Date());
    const health = await listListItemHealth(database.db, environmentId, [list.id], {
      normaliserVersion: 'lists-1',
      keyId: null,
    });
    expect(health.get(list.id)).toEqual({ outdated: false, rotated: false });
  });

  it('tests a range by containment, IPv4 and IPv6 apart', async () => {
    const list = await newList({ type: 'ip-address' });
    const v4 = item('liip', { range: '198.51.100.0/24' });
    const v6 = item('liip', { range: '2001:db8::/48' });
    await insertListItems(database.db, environmentId, list.id, [v4, v6]);
    const find = (address: string) =>
      findListItemsInRange(database.db, environmentId, {
        listIds: [list.id],
        address,
        normaliserVersion: 'lists-1',
      });

    expect((await find('198.51.100.7')).map(({ itemId }) => itemId)).toEqual([v4.id]);
    expect((await find('2001:db8::1')).map(({ itemId }) => itemId)).toEqual([v6.id]);
    expect(await find('203.0.113.1')).toEqual([]);
    expect(await find('198.51.101.1')).toEqual([]);
  });

  it('matches a country on its plaintext column, live rows only', async () => {
    const list = await newList({ type: 'country' });
    const zz = item('lic', { countryCode: 'ZZ' });
    const gone = item('lic', { countryCode: 'XX' });
    await insertListItems(database.db, environmentId, list.id, [zz, gone]);
    await archiveListItem(database.db, environmentId, gone.id, new Date());

    const found = await findCountryListItems(database.db, environmentId, {
      listIds: [list.id],
      codes: ['ZZ', 'XX'],
      normaliserVersion: 'lists-1',
    });

    expect(found).toEqual([{ itemId: zz.id, listId: list.id, countryCode: 'ZZ' }]);
  });

  it('finds candidates by overlapping boxes and opens only those', async () => {
    const list = await newList({ type: 'geolocation' });
    const near = item('ligl', {
      value: { latitude: -30, longitude: -140, 'radius-meters': 1000 },
      boxes: ['(-140.02,-30.02),(-139.98,-29.98)'],
    });
    const far = item('ligl', {
      value: { latitude: 10, longitude: 10, 'radius-meters': 1000 },
      boxes: ['(9.98,9.98),(10.02,10.02)'],
    });
    const wrapped = item('ligl', {
      value: { latitude: 0, longitude: 180, 'radius-meters': 1000 },
      boxes: ['(179.98,-0.02),(180,0.02)', '(-180,-0.02),(-179.98,0.02)'],
    });
    await insertListItems(database.db, environmentId, list.id, [near, far, wrapped]);

    const found = await findGeoListItems(database.db, environmentId, {
      listIds: [list.id],
      boxes: ['(-140.5,-30.5),(-139.5,-29.5)'],
      normaliserVersion: 'lists-1',
    });
    expect(found.map(({ itemId }) => itemId)).toEqual([near.id]);
    expect(found[0]?.value).toEqual(near.value);

    const across = await findGeoListItems(database.db, environmentId, {
      listIds: [list.id],
      boxes: ['(-180,-1),(-179.9,1)'],
      normaliserVersion: 'lists-1',
    });
    expect(across.map(({ itemId }) => itemId)).toEqual([wrapped.id]);
  });

  it('opens at most the limit of last-name candidates, and only live ones (F17)', async () => {
    const list = await newList({ type: 'name', allowFuzzyNameFirst: true });
    const last = hex();
    const key = { keyKind: 'identifier-name-last' as const, matchKey: last };
    const one = item('lin', { value: { 'name-first': 'One' }, keys: [key] });
    const two = item('lin', { value: { 'name-first': 'Two' }, keys: [key] });
    const three = item('lin', { value: { 'name-first': 'Three' }, keys: [key] });
    await insertListItems(database.db, environmentId, list.id, [one, two, three]);
    await archiveListItem(database.db, environmentId, three.id, new Date());

    const found = await findNameCandidates(database.db, environmentId, {
      listId: list.id,
      keys: [last],
      limit: 1,
      normaliserVersion: 'lists-1',
    });
    expect(found).toHaveLength(1);
    const all = await findNameCandidates(database.db, environmentId, {
      listId: list.id,
      keys: [last],
      limit: 10,
      normaliserVersion: 'lists-1',
    });
    expect(all.map(({ itemId }) => itemId).sort()).toEqual([one.id, two.id].sort());
    expect(all.find(({ itemId }) => itemId === one.id)?.value).toEqual(one.value);
  });
});

describe('the rebuild reads and writes (C98.2)', () => {
  it('walks every item by id with what its keys need, and rewrites them in place', async () => {
    const { environment } = await createTestTenant(database.db);
    const list = await createList(database.db, environment.id, {
      id: `lst_${ulid()}`,
      type: 'name',
      name: 'Names',
      allowFuzzyNameFirst: true,
    });
    const added = item('lin', {
      normaliserVersion: 'lists-0',
      keys: [{ keyKind: 'identifier-name', matchKey: hex() }],
    });
    await insertListItems(database.db, environment.id, list.id, [added]);

    const page = await listListItemsForRebuild(database.db, { afterId: null, limit: 1000 });
    const row = page.find(({ id }) => id === added.id);
    expect(row).toMatchObject({
      environmentId: environment.id,
      listId: list.id,
      kind: 'name',
      allowFuzzyNameFirst: true,
      value: added.value,
    });

    const matchKey = hex();
    const extra = hex();
    const outcome = await rewriteListItemKeys(database.db, environment.id, {
      id: added.id,
      listId: list.id,
      matchKey,
      normaliserVersion: 'lists-1',
      keys: [{ keyKind: 'identifier-name', matchKey: extra }],
    });

    expect(outcome).toBe('rewritten');
    const health = await listListItemHealth(database.db, environment.id, [list.id], {
      normaliserVersion: 'lists-1',
      keyId: null,
    });
    expect(health.get(list.id)?.outdated).toBe(false);
    const found = await findListItemsByKeys(database.db, environment.id, {
      listIds: [list.id],
      keys: [matchKey, extra, added.keys?.[0]?.matchKey ?? ''],
      keyKinds: ['identifier-name'],
      normaliserVersion: 'lists-1',
      keyId: null,
    });
    expect(found.map(({ key }) => key).sort()).toEqual([matchKey, extra].sort());
    expect(await getList(database.db, environment.id, list.id)).toMatchObject({ version: 3 });
  });

  it('archives an item whose new key meets a live one, keeping the older', async () => {
    const list = await newList();
    const older = item('lis');
    const newer = item('lis', { normaliserVersion: 'lists-0' });
    await insertListItems(database.db, environmentId, list.id, [older, newer]);

    const outcome = await rewriteListItemKeys(database.db, environmentId, {
      id: newer.id,
      listId: list.id,
      matchKey: older.matchKey ?? '',
      normaliserVersion: 'lists-1',
      keys: [],
    });

    expect(outcome).toBe('merged');
    expect(await getListItem(database.db, environmentId, newer.id)).toMatchObject({
      status: 'archived',
    });
    expect(await getList(database.db, environmentId, list.id)).toMatchObject({ itemCount: 1 });
  });

  it('rewrites an item’s range and boxes with its keys', async () => {
    const list = await newList({ type: 'ip-address' });
    const added = item('liip', { range: '198.51.100.0/24', normaliserVersion: 'lists-0' });
    await insertListItems(database.db, environmentId, list.id, [added]);

    await rewriteListItemKeys(database.db, environmentId, {
      id: added.id,
      listId: list.id,
      matchKey: hex(),
      normaliserVersion: 'lists-1',
      keys: [],
      range: '203.0.113.0/24',
    });

    const find = (address: string) =>
      findListItemsInRange(database.db, environmentId, {
        listIds: [list.id],
        address,
        normaliserVersion: 'lists-1',
      });
    expect(await find('198.51.100.1')).toEqual([]);
    expect((await find('203.0.113.1')).map(({ itemId }) => itemId)).toEqual([added.id]);
  });
});

describe('item redaction (C98.4, P04, F23)', () => {
  it('nulls the value and keys, drops the side rows, archives, and forgets every copy', async () => {
    const list = await newList({ type: 'ip-address' });
    const added = item('liip', {
      range: '198.51.100.0/24',
      keys: [{ keyKind: 'identifier-ip', matchKey: hex() }],
    });
    await insertListItems(database.db, environmentId, list.id, [added]);
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    const [match] = await insertListMatches(database.db, environmentId, [
      newMatch(list.id, added.id, inquiry.id),
    ]);
    await createEvent(database.db, environmentId, {
      id: `evt_${ulid()}`,
      name: 'list-match.created',
      objectType: 'list-item/ip-address',
      objectId: added.id,
      payload: { data: { attributes: { value: '198.51.100.0/24' } } },
    });
    await database.client.query(
      `insert into api_logs (id, environment_id, method, path, status, duration_ms, resource_id,
         request_body)
       values ($1, $2, 'POST', '/x', 201, 1, $3, 'sealed-body')`,
      [`alog_${ulid()}`, environmentId, added.id],
    );
    const at = new Date('2026-10-31T12:00:00.000Z');

    const { storageKeys } = await database.db.transaction((tx) =>
      redactListItems(tx, environmentId, [added.id], at),
    );

    expect(storageKeys).toEqual([]);
    expect(await getListItem(database.db, environmentId, added.id)).toMatchObject({
      value: null,
      matchKey: null,
      status: 'archived',
      redactedAt: at,
      archivedAt: at,
    });
    expect(await getList(database.db, environmentId, list.id)).toMatchObject({ itemCount: 0 });
    const left = await database.client.query(
      `select 1 from list_item_keys where item_id = $1
       union all select 1 from list_item_ip_ranges where item_id = $1`,
      [added.id],
    );
    expect(left.rows).toEqual([]);
    expect(
      (await getListMatch(database.db, environmentId, match?.id ?? ''))?.listItemId,
    ).toBeNull();
    const stored = await database.client.query<{ payload: unknown; request_body: string | null }>(
      `select e.payload, l.request_body from events e, api_logs l
        where e.object_id = $1 and l.resource_id = $1`,
      [added.id],
    );
    expect(JSON.stringify(stored.rows[0]?.payload)).not.toContain('198.51.100.0');
    expect(stored.rows[0]?.request_body).toBeNull();
  });

  it('returns the masked background object, to delete after the commit', async () => {
    const list = await seedList(database.db, environmentId, { kind: 'selfie-background' });
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    const added = await seedListItem(database.db, environmentId, {
      listId: list.id,
      prefix: 'lisb',
      matchKey: null,
      value: null,
    });
    await database.client.query(
      `insert into list_item_backgrounds (environment_id, item_id, masked_file_key,
         masked_file_wrapped_dek, source_inquiry_id)
       values ($1, $2, 'lists/masked-object', 'wrapped', $3)`,
      [environmentId, added.id, inquiry.id],
    );

    const { storageKeys } = await database.db.transaction((tx) =>
      redactListItems(tx, environmentId, [added.id], new Date()),
    );

    expect(storageKeys).toEqual(['lists/masked-object']);
    const left = await database.client.query(
      `select 1 from list_item_backgrounds where item_id = $1`,
      [added.id],
    );
    expect(left.rows).toEqual([]);
  });

  it('keeps the first redaction, and reads nothing of another environment', async () => {
    const list = await newList();
    const added = item('lis');
    await insertListItems(database.db, environmentId, list.id, [added]);
    const at = new Date('2026-10-31T12:00:00.000Z');
    await database.db.transaction((tx) =>
      redactListItems(tx, otherEnvironmentId, [added.id], new Date()),
    );
    expect(await getListItem(database.db, environmentId, added.id)).toMatchObject({
      redactedAt: null,
    });
    await database.db.transaction((tx) => redactListItems(tx, environmentId, [added.id], at));
    await database.db.transaction((tx) =>
      redactListItems(tx, environmentId, [added.id], new Date('2027-01-01T00:00:00.000Z')),
    );
    expect((await getListItem(database.db, environmentId, added.id))?.redactedAt).toEqual(at);
  });

  it('redacts items past their list’s retention, batch by batch, and no others (C16)', async () => {
    const { environment } = await createTestTenant(database.db);
    const now = new Date('2026-10-31T12:00:00.000Z');
    const days = (count: number) => new Date(now.getTime() - count * 86_400_000);
    const kept = await seedList(database.db, environment.id, { itemRetentionDays: 30 });
    const forever = await seedList(database.db, environment.id, { itemRetentionDays: null });
    const seed = (listId: string, createdAt: Date) =>
      seedListItem(database.db, environment.id, { listId, createdAt });
    const old = await seed(kept.id, days(31));
    const older = await seed(kept.id, days(40));
    const fresh = await seed(kept.id, days(10));
    const unbounded = await seed(forever.id, days(400));

    expect(await redactExpiredListItems(database.db, { now, limit: 1 })).toBe(1);
    expect(await redactExpiredListItems(database.db, { now, limit: 5 })).toBe(1);
    expect(await redactExpiredListItems(database.db, { now, limit: 5 })).toBe(0);

    const read = (id: string) => getListItem(database.db, environment.id, id);
    expect((await read(old.id))?.redactedAt).toEqual(now);
    expect((await read(older.id))?.redactedAt).toEqual(now);
    expect((await read(fresh.id))?.redactedAt).toBeNull();
    expect((await read(unbounded.id))?.redactedAt).toBeNull();
  });
});

describe('item retention of background lists (C98.4)', () => {
  async function dueBackground() {
    const { environment } = await createTestTenant(database.db);
    const { inquiry } = await createTestInquiry(database.db, environment.id);
    const list = await seedList(database.db, environment.id, {
      kind: 'selfie-background',
      itemRetentionDays: 1,
    });
    const added = await seedListItem(database.db, environment.id, {
      listId: list.id,
      prefix: 'lisb',
      matchKey: null,
      value: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await database.client.query(
      `insert into list_item_backgrounds (environment_id, item_id, masked_file_key,
         masked_file_wrapped_dek, source_inquiry_id)
       values ($1, $2, 'lists/expired-object', 'wrapped', $3)`,
      [environment.id, added.id, inquiry.id],
    );
    return { environmentId: environment.id, id: added.id };
  }

  it('leaves them for a pass that can delete their object', async () => {
    const { environmentId: environment, id } = await dueBackground();
    const now = new Date('2026-10-31T12:00:00.000Z');

    await redactExpiredListItems(database.db, { now });

    expect((await getListItem(database.db, environment, id))?.redactedAt).toBeNull();
  });

  it('deletes the object after the commit when it can', async () => {
    const { environmentId: environment, id } = await dueBackground();
    const deleted: string[] = [];

    await redactExpiredListItems(database.db, {
      now: new Date('2026-10-31T12:00:00.000Z'),
      limit: 1000,
      deleteObjects: (keys) => {
        deleted.push(...keys);
        return Promise.resolve();
      },
    });

    expect(deleted).toContain('lists/expired-object');
    expect((await getListItem(database.db, environment, id))?.redactedAt).not.toBeNull();
  });
});

const newMatch = (listId: string, listItemId: string, inquiryId: string): NewListMatch => ({
  id: `lmt_${ulid()}`,
  listId,
  listItemId,
  inquiryId,
  accountId: null,
  source: 'inquiry.fields',
  method: 'exact',
  tier: 'R',
  confidence: null,
  approximate: false,
  score: null,
  distanceMeters: null,
  listVersion: 1,
  matchedValue: 'jane@example.com',
});

describe('list matches (C99.3)', () => {
  async function seeded() {
    const list = await newList();
    const added = item('lis');
    await insertListItems(database.db, environmentId, list.id, [added]);
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    return { list, added, inquiry };
  }

  it('writes one match per inquiry, item and source, and counts it on the item', async () => {
    const { list, added, inquiry } = await seeded();
    const first = newMatch(list.id, added.id, inquiry.id);

    const written = await insertListMatches(database.db, environmentId, [first]);
    const again = await insertListMatches(database.db, environmentId, [
      newMatch(list.id, added.id, inquiry.id),
    ]);
    const otherSource = await insertListMatches(database.db, environmentId, [
      { ...newMatch(list.id, added.id, inquiry.id), source: 'account.fields' },
    ]);

    expect(written.map(({ id }) => id)).toEqual([first.id]);
    expect(written[0]).toMatchObject({ matchedValue: 'jane@example.com', status: 'open' });
    expect(again).toEqual([]);
    expect(otherSource).toHaveLength(1);
    expect(await getListItem(database.db, environmentId, added.id)).toMatchObject({
      matchCount: 2,
    });
    const stored = await openListMatchValues(database.db, environmentId, first.id);
    expect(stored?.matchedValue).toBe('jane@example.com');
    expect(await getListMatch(database.db, otherEnvironmentId, first.id)).toBeNull();
  });

  it('filters by inquiry, account, list and status, newest first', async () => {
    onTestFinished(wallClockStepsBack());
    const { list, added, inquiry } = await seeded();
    const { inquiry: other } = await createTestInquiry(database.db, environmentId);
    await insertListMatches(database.db, environmentId, [
      newMatch(list.id, added.id, inquiry.id),
      { ...newMatch(list.id, added.id, other.id), accountId: other.accountId },
    ]);

    const byInquiry = await listListMatches(
      database.db,
      environmentId,
      { inquiryIds: [inquiry.id] },
      { size: 5 },
    );
    expect(byInquiry.items).toHaveLength(1);
    const byAccount = await listListMatches(
      database.db,
      environmentId,
      { accountIds: [other.accountId] },
      { size: 5 },
    );
    expect(byAccount.items.map(({ inquiryId }) => inquiryId)).toEqual([other.id]);
    const byList = await listListMatches(
      database.db,
      environmentId,
      { listIds: [list.id], statuses: ['open'] },
      { size: 5 },
    );
    expect(byList.items).toHaveLength(2);
    const none = await listListMatches(
      database.db,
      environmentId,
      { listIds: [list.id], statuses: ['dismissed'] },
      { size: 5 },
    );
    expect(none.items).toEqual([]);
  });

  it('dismisses an open match once, sealing its reason', async () => {
    const { list, added, inquiry } = await seeded();
    const match = newMatch(list.id, added.id, inquiry.id);
    await insertListMatches(database.db, environmentId, [match]);
    const at = new Date('2026-10-31T12:00:00.000Z');

    const dismissed = await dismissListMatch(database.db, environmentId, match.id, {
      reason: 'Reviewed by hand',
      at,
    });

    expect(dismissed).toMatchObject({
      status: 'dismissed',
      dismissedAt: at,
      reason: 'Reviewed by hand',
    });
    expect(
      await dismissListMatch(database.db, environmentId, match.id, { reason: 'Again', at }),
    ).toBeNull();
    expect((await openListMatchValues(database.db, environmentId, match.id))?.reason).toBe(
      'Reviewed by hand',
    );
  });

  it('dismisses no redacted match', async () => {
    const { list, added, inquiry } = await seeded();
    const match = newMatch(list.id, added.id, inquiry.id);
    await insertListMatches(database.db, environmentId, [match]);
    await redactInquiryRecords(database.db, environmentId, inquiry.id);

    expect(
      await dismissListMatch(database.db, environmentId, match.id, {
        reason: 'Too late',
        at: new Date(),
      }),
    ).toBeNull();
  });

  it('reads the inquiry’s open matches for the screening, without their values', async () => {
    const { list, added, inquiry } = await seeded();
    const open = newMatch(list.id, added.id, inquiry.id);
    const closed = {
      ...newMatch(list.id, added.id, inquiry.id),
      source: 'account.fields' as const,
    };
    await insertListMatches(database.db, environmentId, [open, closed]);
    await dismissListMatch(database.db, environmentId, closed.id, { reason: 'No', at: new Date() });

    const rows = await listOpenListMatches(database.db, environmentId, inquiry.id);

    expect(rows.map(({ id }) => id)).toEqual([open.id]);
  });

  it('keeps a completed screening’s count equal to the open matches', async () => {
    const { list, added, inquiry } = await seeded();
    await createListScreening(database.db, environmentId, {
      inquiryId: inquiry.id,
      triggerStatus: 'completed',
    });
    const match = newMatch(list.id, added.id, inquiry.id);
    await insertListMatches(database.db, environmentId, [match]);
    await completeListScreening(database.db, environmentId, inquiry.id, {
      status: 'completed',
      matchCount: 1,
      unscreened: [],
      notApplicable: [],
      reviewCause: null,
      at: new Date(),
    });
    await dismissListMatch(database.db, environmentId, match.id, { reason: 'No', at: new Date() });
    expect((await getListScreening(database.db, environmentId, inquiry.id))?.matchCount).toBe(0);

    await insertListMatches(database.db, environmentId, [
      { ...newMatch(list.id, added.id, inquiry.id), source: 'government-id.identification-number' },
    ]);
    expect((await getListScreening(database.db, environmentId, inquiry.id))?.matchCount).toBe(1);
  });
});

describe('the screening outbox (C99.4)', () => {
  it('lists pending rows not enqueued lately, oldest first, naming a redacted inquiry', async () => {
    const { environment } = await createTestTenant(database.db);
    const inquiries = [];
    for (let index = 0; index < 3; index += 1) {
      const { inquiry } = await createTestInquiry(database.db, environment.id);
      await createListScreening(database.db, environment.id, {
        inquiryId: inquiry.id,
        triggerStatus: 'completed',
      });
      inquiries.push(inquiry);
    }
    const [first, second, third] = inquiries;
    const at = new Date('2026-10-31T12:00:00.000Z');
    await markListScreeningsEnqueued(
      database.db,
      [{ environmentId: environment.id, inquiryId: first?.id ?? '' }],
      at,
    );
    await redactInquiryRecords(database.db, environment.id, second?.id ?? '');
    await database.db.execute(
      sql`update list_screenings set status = 'errored', screened_at = now()
           where inquiry_id = ${third?.id ?? ''}`,
    );

    const pending = await listPendingListScreenings(database.db, {
      olderThan: new Date(at.getTime() - 1000),
      limit: 100,
    });
    const ours = pending.filter((row) => row.environmentId === environment.id);
    expect(ours.map(({ inquiryId }) => inquiryId)).toEqual([second?.id]);
    expect(ours[0]).toMatchObject({ inquiryRedacted: true, triggerStatus: 'completed' });

    const later = await listPendingListScreenings(database.db, {
      olderThan: new Date(at.getTime() + 1000),
      limit: 100,
    });
    expect(
      later.filter((row) => row.environmentId === environment.id).map((row) => row.inquiryId),
    ).toEqual(expect.arrayContaining([first?.id, second?.id]));
    await markListScreeningsEnqueued(database.db, [], at);
  });

  it('ends a pending row once, in the transaction that wrote its matches', async () => {
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    await createListScreening(database.db, environmentId, {
      inquiryId: inquiry.id,
      triggerStatus: 'expired',
    });
    const at = new Date('2026-10-31T12:00:00.000Z');
    const unscreened = [{ 'list-id': 'lst_a', reason: 'probe_unavailable' }];

    const outcome = {
      status: 'partial',
      matchCount: null,
      unscreened,
      notApplicable: [],
      reviewCause: 'list_unscreened',
      at,
    } as const;
    await database.db.transaction(async (tx) => {
      expect(await lockPendingListScreening(tx, environmentId, inquiry.id)).toBe(true);
      expect(await completeListScreening(tx, environmentId, inquiry.id, outcome)).toBe(true);
    });

    expect(await completeListScreening(database.db, environmentId, inquiry.id, outcome)).toBe(
      false,
    );
    await database.db.transaction(async (tx) => {
      expect(await lockPendingListScreening(tx, environmentId, inquiry.id)).toBe(false);
    });
    expect(await getListScreening(database.db, environmentId, inquiry.id)).toMatchObject({
      status: 'partial',
      matchCount: null,
      unscreened,
      reviewCause: 'list_unscreened',
      screenedAt: at,
    });
  });

  it('counts a failed attempt, and ends a row with a code and no value', async () => {
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    await createListScreening(database.db, environmentId, {
      inquiryId: inquiry.id,
      triggerStatus: 'completed',
    });
    expect(
      await recordListScreeningFailure(database.db, environmentId, inquiry.id, 'screening_failed'),
    ).toBe(1);
    expect(
      await recordListScreeningFailure(database.db, environmentId, inquiry.id, 'screening_failed'),
    ).toBe(2);

    const at = new Date('2026-10-31T12:00:00.000Z');
    expect(
      await failListScreening(database.db, environmentId, inquiry.id, {
        code: 'inquiry_redacted',
        at,
      }),
    ).toBe(true);
    expect(
      await failListScreening(database.db, environmentId, inquiry.id, {
        code: 'inquiry_redacted',
        at,
      }),
    ).toBe(false);
    expect(await getListScreening(database.db, environmentId, inquiry.id)).toMatchObject({
      status: 'errored',
      matchCount: null,
      screenedAt: at,
    });
    const row = await database.client.query<{ last_error_code: string }>(
      `select last_error_code from list_screenings where inquiry_id = $1`,
      [inquiry.id],
    );
    expect(row.rows[0]?.last_error_code).toBe('inquiry_redacted');
    expect(
      await recordListScreeningFailure(database.db, environmentId, inquiry.id, 'screening_failed'),
    ).toBeNull();
  });

  it('serves the row’s creation time, which a pending entry reads', async () => {
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    await createListScreening(database.db, environmentId, {
      inquiryId: inquiry.id,
      triggerStatus: 'completed',
    });
    expect(
      (await getListScreening(database.db, environmentId, inquiry.id))?.createdAt,
    ).toBeInstanceOf(Date);
  });
});
