/**
 * C99.1, C99.2 (Workflow 7B, `api-lists`): `matchLists` on PGlite, method by method: keys, ranges,
 * boxes and the fuzzy first name, each with its tier and evidence, and every way a list goes
 * unscreened or not applicable, which is never "no match". Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { LIST_KEYS_VERSION } from '@openverify/checks';
import { LIST_MATCH_CONSTANTS, type ListKind } from '@openverify/core';
import {
  archiveListItem,
  createList,
  insertListItems,
  type Db,
  type ListRow,
  type NewList,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { newId } from '@openverify/contracts';
import { variantGroupsFrom } from '@openverify/watchlist';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newListItem } from './keys.js';
import {
  matchLists,
  type ListMatchOutcome,
  type ListProbe,
  type MatchListsOptions,
} from './match.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
const key = new Uint8Array(randomBytes(32));
const matcherData = {
  status: 'loaded',
  groups: variantGroupsFrom([], 'a'.repeat(64)),
  keysVersion: 'synthetic',
} as const;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

const PREFIX: Partial<Record<ListKind, 'lis' | 'liea' | 'lipn' | 'ligin' | 'lin' | 'liip' | 'lic' | 'ligl' | 'libf' | 'lidf' | 'liif'>> =
  {
    string: 'lis',
    'email-address': 'liea',
    'phone-number': 'lipn',
    'government-id-number': 'ligin',
    name: 'lin',
    'ip-address': 'liip',
    country: 'lic',
    geolocation: 'ligl',
    'browser-fingerprint': 'libf',
    'device-fingerprint': 'lidf',
    field: 'liif',
  };

async function listWith(
  type: ListKind,
  values: readonly Readonly<Record<string, unknown>>[],
  input: Partial<NewList> = {},
): Promise<{ list: ListRow; itemIds: string[] }> {
  const list = await createList(db, environmentId, {
    id: newId('lst'),
    type,
    name: 'Synthetic',
    ...input,
  });
  const items = values.map((value) =>
    newListItem(key, environmentId, list, {
      id: newId(PREFIX[type] ?? 'lis'),
      value,
      creator: { type: 'api-key', id: newId('key') },
    }),
  );
  await insertListItems(db, environmentId, list.id, items);
  return { list: { ...list, version: 2 }, itemIds: items.map(({ id }) => id) };
}

const run = (
  lists: readonly ListRow[],
  probes: readonly ListProbe[],
  options: Partial<MatchListsOptions> = {},
): Promise<ListMatchOutcome> =>
  matchLists(db, environmentId, probes, { key, lists, matcherData, ...options });

const probe = (
  kind: ListKind,
  value: Readonly<Record<string, unknown>>,
  source: ListProbe['source'] = 'request',
): ListProbe => ({ source, kind, values: [value] });

describe('exact keys (C99.2)', () => {
  it('names the list, item, method and an R-tier evidence', async () => {
    const { list, itemIds } = await listWith('string', [{ value: 'Listed Value' }]);
    const outcome = await run([list], [probe('string', { value: '  listed   VALUE ' })]);

    expect(outcome).toEqual({
      matches: [
        {
          listId: list.id,
          listKind: 'string',
          listVersion: 2,
          listItemId: itemIds[0],
          source: 'request',
          method: 'exact',
          tier: 'R',
          confidence: null,
          approximate: false,
          score: null,
          distanceMeters: null,
          matchedValue: '  listed   VALUE ',
        },
      ],
      unscreened: [],
      notApplicable: [],
    });
  });

  it('reads a value that is not listed as compared, with no match', async () => {
    const { list } = await listWith('string', [{ value: 'listed' }]);
    expect(await run([list], [probe('string', { value: 'other' })])).toEqual({
      matches: [],
      unscreened: [],
      notApplicable: [],
    });
  });

  it('keys a case-sensitive list by its own rule, per list', async () => {
    const strict = await listWith('string', [{ value: 'Listed' }], { caseSensitive: true });
    const loose = await listWith('string', [{ value: 'Listed' }]);
    const outcome = await run([strict.list, loose.list], [probe('string', { value: 'LISTED' })]);
    expect(outcome.matches.map(({ listId }) => listId)).toEqual([loose.list.id]);
  });

  it('matches an address, its domain and a parent domain (C98.2)', async () => {
    const { list, itemIds } = await listWith('email-address', [
      { value: 'jane@mail.example.com', 'match-type': 'email_address' },
      { value: 'example.com', 'match-type': 'domain' },
    ]);
    const outcome = await run(
      [list],
      [probe('email-address', { value: 'Jane@MAIL.example.com' }, 'otp.email-address')],
    );
    expect(outcome.matches.map(({ listItemId }) => listItemId).sort()).toEqual(
      [...itemIds].sort(),
    );
  });

  it('reads a national phone number under its list’s region', async () => {
    const { list, itemIds } = await listWith('phone-number', [{ value: '+12025550100' }], {
      defaultRegion: 'US',
    });
    const outcome = await run([list], [probe('phone-number', { value: '(202) 555-0100' })]);
    expect(outcome.matches.map(({ listItemId }) => listItemId)).toEqual(itemIds);
  });

  it('matches an ID number by its class or by any class', async () => {
    const { list, itemIds } = await listWith('government-id-number', [
      { 'id-number': 'X1234567', 'id-class': 'passport' },
      { 'id-number': 'Y7654321' },
    ]);
    const ids = async (value: Record<string, unknown>) =>
      (await run([list], [probe('government-id-number', value)])).matches.map(
        ({ listItemId }) => listItemId,
      );

    expect(await ids({ 'id-number': 'x123 4567', 'id-class': 'passport' })).toEqual([itemIds[0]]);
    expect(await ids({ 'id-number': 'X1234567', 'id-class': 'visa' })).toEqual([]);
    expect(await ids({ 'id-number': 'Y7654321', 'id-class': 'visa' })).toEqual([itemIds[1]]);
    expect(await ids({ 'id-number': 'X1234567' })).toEqual([itemIds[0]]);
  });

  it('matches a name in either order and fold', async () => {
    const { list, itemIds } = await listWith('name', [
      { 'name-first': 'Jürgen', 'name-last': 'Müller' },
    ]);
    const outcome = await run(
      [list],
      [probe('name', { 'name-first': 'Mueller', 'name-last': 'Juergen' }, 'government-id.name')],
    );
    expect(outcome.matches.map(({ listItemId }) => listItemId)).toEqual(itemIds);
    expect(outcome.matches[0]).toMatchObject({ method: 'exact', tier: 'R' });
  });

  it('reads a field under the list’s key, and leaves another key’s list alone', async () => {
    const { list, itemIds } = await listWith('field', [{ 'field-value': '42.50' }], {
      fieldKey: 'amount',
    });
    const other = await listWith('field', [{ 'field-value': '42.5' }], { fieldKey: 'other' });
    const outcome = await run(
      [list, other.list],
      [probe('field', { 'field-key': 'amount', 'field-value': 42.5 }, 'inquiry.fields')],
    );
    expect(outcome.matches.map(({ listItemId }) => listItemId)).toEqual(itemIds);
    expect(outcome.notApplicable).toEqual([
      { 'list-id': other.list.id, reason: 'subject_has_no_value' },
    ]);
  });

  it('writes one match per item and source when two values hit it', async () => {
    const { list } = await listWith('string', [{ value: 'listed' }]);
    const outcome = await run(
      [list],
      [{ source: 'request', kind: 'string', values: [{ value: 'LISTED' }, { value: 'listed' }] }],
    );
    expect(outcome.matches).toHaveLength(1);
  });

  it('never reads an archived item, or another environment’s list', async () => {
    const { list, itemIds } = await listWith('string', [{ value: 'listed' }]);
    await archiveListItem(db, environmentId, itemIds[0] ?? '', new Date());
    expect((await run([list], [probe('string', { value: 'listed' })])).matches).toEqual([]);

    const live = await listWith('string', [{ value: 'listed' }]);
    const other = (await createTestTenant(db)).environment.id;
    const outcome = await matchLists(db, other, [probe('string', { value: 'listed' })], {
      key,
      lists: [live.list],
      matcherData,
    });
    expect(outcome.matches).toEqual([]);
  });
});

describe('IP addresses (C99.2)', () => {
  it('tests the HMAC of an address and containment in a range', async () => {
    const { list, itemIds } = await listWith('ip-address', [
      { value: '192.0.2.1' },
      { value: '198.51.100.0/24' },
      { value: '2001:db8::/48' },
    ]);
    const hit = async (address: string) =>
      (await run([list], [probe('ip-address', { value: address }, 'session.ip-address')])).matches;

    expect(await hit('192.0.2.1')).toEqual([
      expect.objectContaining({ listItemId: itemIds[0], method: 'exact', tier: 'R' }),
    ]);
    expect(await hit('198.51.100.25')).toEqual([
      expect.objectContaining({ listItemId: itemIds[1], method: 'cidr', tier: 'R' }),
    ]);
    expect(await hit('2001:db8::1')).toEqual([
      expect.objectContaining({ listItemId: itemIds[2], method: 'cidr' }),
    ]);
    expect(await hit('::ffff:198.51.100.25')).toEqual([
      expect.objectContaining({ listItemId: itemIds[1], method: 'cidr' }),
    ]);
    expect(await hit('203.0.113.9')).toEqual([]);
  });

  it('leaves an untrusted address out, and says so (P05)', async () => {
    const { list } = await listWith('ip-address', [{ value: '192.0.2.1' }]);
    const outcome = await run(
      [list],
      [{ source: 'session.ip-address', kind: 'ip-address', values: [], untrusted: true }],
    );
    expect(outcome).toEqual({
      matches: [],
      unscreened: [{ 'list-id': list.id, reason: 'client_address_untrusted' }],
      notApplicable: [],
    });
  });
});

describe('countries (C98.2, H15)', () => {
  it('reads the ID’s country as R, and an IP’s as H and approximate', async () => {
    const { list, itemIds } = await listWith('country', [{ 'country-code': 'ZZ' }]);
    const outcome = await run(
      [list],
      [
        probe('country', { 'country-code': 'zz' }, 'government-id.issuing-country'),
        probe('country', { 'country-code': 'ZZ' }, 'session.ip-country'),
      ],
    );
    expect(outcome.matches).toEqual([
      expect.objectContaining({
        listItemId: itemIds[0],
        source: 'government-id.issuing-country',
        tier: 'R',
        confidence: null,
        approximate: false,
      }),
      expect.objectContaining({
        source: 'session.ip-country',
        tier: 'H',
        confidence: 0.8,
        approximate: true,
      }),
    ]);
  });
});

describe('geolocations (C99.2, C95.3)', () => {
  const point = { latitude: -30, longitude: -140 };

  it('matches within the radius plus the IP point’s uncertainty, and records the distance', async () => {
    const { list, itemIds } = await listWith('geolocation', [
      { latitude: -30.5, longitude: -140, 'radius-meters': 60_000 },
    ]);
    const outcome = await run([list], [probe('geolocation', point, 'session.ip-point')]);

    expect(outcome.matches).toEqual([
      expect.objectContaining({
        listItemId: itemIds[0],
        method: 'radius',
        tier: 'H',
        approximate: true,
        distanceMeters: 55_598,
      }),
    ]);
    expect(outcome.matches[0]?.confidence).toBeGreaterThan(0);
  });

  it('finds an item whose centre lies outside the probe’s own box', async () => {
    const { list } = await listWith('geolocation', [
      { latitude: -31.2, longitude: -140, 'radius-meters': 100_000 },
    ]);
    const outcome = await run([list], [probe('geolocation', point, 'session.ip-point')]);
    // 133 km away: outside the radius, inside the radius plus the 50 km uncertainty.
    expect(outcome.matches).toHaveLength(1);
  });

  it('says no match past the radius plus the uncertainty', async () => {
    const { list } = await listWith('geolocation', [
      { latitude: -33, longitude: -140, 'radius-meters': 60_000 },
    ]);
    expect(await run([list], [probe('geolocation', point, 'session.ip-point')])).toEqual({
      matches: [],
      unscreened: [],
      notApplicable: [],
    });
  });

  it('answers probe_too_coarse for a smaller item it cannot rule out, never no match', async () => {
    const { list } = await listWith('geolocation', [
      { latitude: -30.1, longitude: -140, 'radius-meters': 1000 },
    ]);
    expect(await run([list], [probe('geolocation', point, 'session.ip-point')])).toEqual({
      matches: [],
      unscreened: [{ 'list-id': list.id, reason: 'probe_too_coarse' }],
      notApplicable: [],
    });
  });

  it('compares an exact point exactly, on demand, as R', async () => {
    const { list, itemIds } = await listWith('geolocation', [
      { latitude: -30.01, longitude: -140, 'radius-meters': 2000 },
    ]);
    const near = await run([list], [probe('geolocation', point)], { onDemand: true });
    expect(near.matches).toEqual([
      expect.objectContaining({
        listItemId: itemIds[0],
        tier: 'R',
        approximate: false,
        confidence: null,
        distanceMeters: 1112,
      }),
    ]);
    const far = await run(
      [list],
      [probe('geolocation', { latitude: -30.05, longitude: -140 })],
      { onDemand: true },
    );
    expect(far).toEqual({ matches: [], unscreened: [], notApplicable: [] });
  });

  it('matches across the antimeridian', async () => {
    const { list } = await listWith('geolocation', [
      { latitude: 0, longitude: 179.99, 'radius-meters': 5000 },
    ]);
    const outcome = await run(
      [list],
      [probe('geolocation', { latitude: 0, longitude: -179.99 })],
      { onDemand: true },
    );
    expect(outcome.matches).toEqual([expect.objectContaining({ distanceMeters: 2224 })]);
  });
});

describe('fingerprints (C94.4, H15)', () => {
  const value = 'c'.repeat(64);

  it('reads a fingerprint as the same device: H, with a confidence', async () => {
    const { list, itemIds } = await listWith('browser-fingerprint', [{ value }]);
    const outcome = await run(
      [list],
      [probe('browser-fingerprint', { value }, 'session.browser-fingerprint')],
    );
    expect(outcome.matches).toEqual([
      expect.objectContaining({ listItemId: itemIds[0], method: 'exact', tier: 'H' }),
    ]);
    expect(outcome.matches[0]?.confidence).toBeGreaterThan(0);
  });

  it('answers key_rotated for an item under another key, never no match', async () => {
    const { list } = await listWith('browser-fingerprint', [{ value }]);
    const outcome = await run(
      [list],
      [probe('browser-fingerprint', { value }, 'session.browser-fingerprint')],
      { key: new Uint8Array(randomBytes(32)) },
    );
    expect(outcome).toEqual({
      matches: [],
      unscreened: [{ 'list-id': list.id, reason: 'key_rotated' }],
      notApplicable: [],
    });
  });
});

describe('fuzzy first names (C99.2, F17)', () => {
  const fuzzy = { allowFuzzyNameFirst: true };

  it('scores the first names of last-name candidates, H with the score as confidence', async () => {
    const { list, itemIds } = await listWith(
      'name',
      [
        { 'name-first': 'Jonathan', 'name-last': 'Example' },
        { 'name-first': 'Maria', 'name-last': 'Example' },
      ],
      fuzzy,
    );
    const outcome = await run(
      [list],
      [probe('name', { 'name-first': 'Jonathon', 'name-last': 'Example' }, 'inquiry.fields')],
    );

    expect(outcome.unscreened).toEqual([]);
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.matches[0]).toMatchObject({
      listItemId: itemIds[0],
      method: 'fuzzy_name',
      tier: 'H',
      approximate: false,
    });
    const { confidence, score } = outcome.matches[0] ?? {};
    expect(confidence).toBe(score);
    expect(score).toBeGreaterThanOrEqual(0.8);
    expect(score).toBeLessThan(1);
  });

  it('keeps an exact name exact, once', async () => {
    const { list } = await listWith(
      'name',
      [{ 'name-first': 'Jonathan', 'name-last': 'Example' }],
      fuzzy,
    );
    const outcome = await run(
      [list],
      [probe('name', { 'name-first': 'Jonathan', 'name-last': 'Example' })],
    );
    expect(outcome.matches).toEqual([expect.objectContaining({ method: 'exact', tier: 'R' })]);
  });

  it('never scores a list that does not allow it', async () => {
    const { list } = await listWith('name', [
      { 'name-first': 'Jonathan', 'name-last': 'Example' },
    ]);
    const outcome = await run(
      [list],
      [probe('name', { 'name-first': 'Jonathon', 'name-last': 'Example' })],
    );
    expect(outcome).toEqual({ matches: [], unscreened: [], notApplicable: [] });
  });

  it('answers limit_exceeded beyond the candidate cap, never a silent cap', async () => {
    const cap = Number(LIST_MATCH_CONSTANTS['fuzzy-name-candidate-cap']?.value);
    const { list } = await listWith(
      'name',
      [
        { 'name-first': 'Alpha', 'name-last': 'Crowded' },
        { 'name-first': 'Bravo', 'name-last': 'Crowded' },
      ],
      fuzzy,
    );
    const outcome = await run(
      [list],
      [probe('name', { 'name-first': 'Alpho', 'name-last': 'Crowded' })],
      { fuzzyCandidateCap: 1 },
    );
    expect(cap).toBe(5000);
    expect(outcome).toEqual({
      matches: [],
      unscreened: [{ 'list-id': list.id, reason: 'limit_exceeded' }],
      notApplicable: [],
    });
  });

  it('says the fuzzy method could not run without the matcher data', async () => {
    const { list } = await listWith(
      'name',
      [{ 'name-first': 'Jonathan', 'name-last': 'Example' }],
      fuzzy,
    );
    const outcome = await run(
      [list],
      [probe('name', { 'name-first': 'Jonathon', 'name-last': 'Example' })],
      { matcherData: { status: 'missing' } },
    );
    expect(outcome).toEqual({
      matches: [],
      unscreened: [{ 'list-id': list.id, reason: 'probe_unavailable' }],
      notApplicable: [],
    });
  });
});

describe('what is not "no match" (C99.1, H02, H16)', () => {
  it('reads a list the subject has no value for as not applicable', async () => {
    const { list } = await listWith('phone-number', [{ value: '+12025550100' }]);
    expect(await run([list], [probe('string', { value: 'x' })])).toEqual({
      matches: [],
      unscreened: [],
      notApplicable: [{ 'list-id': list.id, reason: 'subject_has_no_value' }],
    });
  });

  it('answers probe_unavailable for a value it could not read, naming no value', async () => {
    const { list } = await listWith('phone-number', [{ value: '+12025550100' }]);
    const outcome = await run([list], [probe('phone-number', { value: 'not a number' })]);
    expect(outcome).toEqual({
      matches: [],
      unscreened: [{ 'list-id': list.id, reason: 'probe_unavailable' }],
      notApplicable: [],
    });
  });

  it('keeps the matches of the values it could read beside the one it could not', async () => {
    const { list } = await listWith('phone-number', [{ value: '+12025550100' }]);
    const outcome = await run(
      [list],
      [
        {
          source: 'inquiry.fields',
          kind: 'phone-number',
          values: [{ value: 'not a number' }, { value: '+12025550100' }],
        },
      ],
    );
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.unscreened).toEqual([{ 'list-id': list.id, reason: 'probe_unavailable' }]);
  });

  it('answers normaliser_outdated for a list holding an older row, and skips that row', async () => {
    const { list, itemIds } = await listWith('string', [{ value: 'listed' }, { value: 'current' }]);
    await db.execute(
      sql`update list_items set normaliser_version = 'lists-0' where id = ${itemIds[0] ?? ''}`,
    );
    const outcome = await run(
      [list],
      [{ source: 'request', kind: 'string', values: [{ value: 'listed' }, { value: 'current' }] }],
    );
    expect(LIST_KEYS_VERSION).not.toBe('lists-0');
    expect(outcome.matches.map(({ listItemId }) => listItemId)).toEqual([itemIds[1]]);
    expect(outcome.unscreened).toEqual([{ 'list-id': list.id, reason: 'normaliser_outdated' }]);
  });

  it('answers list_archived for a named list that was archived', async () => {
    const { list } = await listWith('string', [{ value: 'listed' }]);
    const archived: ListRow = { ...list, status: 'archived' };
    expect(await run([archived], [probe('string', { value: 'listed' })])).toEqual({
      matches: [],
      unscreened: [{ 'list-id': list.id, reason: 'list_archived' }],
      notApplicable: [],
    });
  });
});

describe('on demand (C99.4, P25)', () => {
  it('reads no fuzzy or biometric list', async () => {
    const fuzzy = await listWith('name', [{ 'name-first': 'Jane', 'name-last': 'Example' }], {
      allowFuzzyNameFirst: true,
    });
    const face = await createList(db, environmentId, {
      id: newId('lst'),
      type: 'face',
      name: 'Faces',
      itemRetentionDays: 30,
    });
    const outcome = await run(
      [fuzzy.list, face],
      [probe('name', { 'name-first': 'Jane', 'name-last': 'Example' })],
      { onDemand: true },
    );
    expect(outcome.matches).toEqual([]);
    expect(outcome.unscreened).toHaveLength(2);
    expect(outcome.unscreened).toEqual(
      expect.arrayContaining([
        { 'list-id': fuzzy.list.id, reason: 'method_not_on_demand' },
        { 'list-id': face.id, reason: 'method_not_on_demand' },
      ]),
    );
  });
});

describe('biometric lists at screening (C99.7)', () => {
  async function biometricLists() {
    const make = (type: 'face' | 'selfie-background') =>
      createList(db, environmentId, {
        id: newId('lst'),
        type,
        name: 'Synthetic',
        itemRetentionDays: 30,
      });
    return { face: await make('face'), background: await make('selfie-background') };
  }

  it('merges the matcher’s outcome: a face is R, a background H, each with its score', async () => {
    const { face, background } = await biometricLists();
    const faceItem = newId('lifc');
    const backgroundItem = newId('lisb');
    const outcome = await run([face, background], [], {
      biometric: {
        matches: [
          {
            listId: face.id,
            listItemId: faceItem,
            listVersion: 3,
            method: 'face_cosine',
            score: 0.62,
          },
          {
            listId: background.id,
            listItemId: backgroundItem,
            listVersion: 2,
            method: 'background',
            score: 0.7,
          },
        ],
        unscreened: [],
        compared: [],
      },
    });

    expect(outcome.matches).toEqual([
      expect.objectContaining({
        listItemId: faceItem,
        source: 'selfie.center',
        method: 'face_cosine',
        tier: 'R',
        confidence: null,
        score: 0.62,
        listVersion: 3,
      }),
      expect.objectContaining({
        listItemId: backgroundItem,
        method: 'background',
        tier: 'H',
        confidence: 0.7,
        score: 0.7,
      }),
    ]);
  });

  it('keeps what the matcher could not read, and reads a run without it as unscreened', async () => {
    const { face, background } = await biometricLists();
    const outcome = await run([face], [], {
      biometric: {
        matches: [],
        unscreened: [{ 'list-id': face.id, reason: 'consent_not_given' }],
        compared: [],
      },
    });
    expect(outcome.unscreened).toEqual([{ 'list-id': face.id, reason: 'consent_not_given' }]);

    const none = await run([background], []);
    expect(none.unscreened).toEqual([{ 'list-id': background.id, reason: 'list_items_pending' }]);
  });

  it('reads a subject with no selfie as not applicable when the matcher is told so', async () => {
    const { face } = await biometricLists();
    expect(await run([face], [], { biometric: 'no_subject' })).toEqual({
      matches: [],
      unscreened: [],
      notApplicable: [{ 'list-id': face.id, reason: 'subject_has_no_value' }],
    });
  });
});
