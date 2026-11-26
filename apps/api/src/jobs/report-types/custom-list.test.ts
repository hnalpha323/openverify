/**
 * C106.2 (Workflow 7B, `api-lists`; H08, ADR 0005): the `custom-list` job on PGlite: it screens a
 * report's query against its lists through `matchLists`, each match a report match keyed by the
 * list item, with list provenance. Any unscreened list ends the run `errored` with
 * `list_unavailable` naming it, keeping what it found; a list the subject has no value for does
 * not. Every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { newId } from '@openverify/contracts';
import {
  archiveList,
  createList,
  insertListItems,
  type Db,
  type ListRow,
  type NewList,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { variantGroupsFrom } from '@openverify/watchlist';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newListItem } from '../../services/lists/keys.js';
import type { MatcherData } from '../../watchlists/matcher-data.js';
import { customListReportJob, type CustomListRunResult } from './custom-list.js';
import { reportContext, REPORT_NOW } from './provider-testing.js';

let database: TestDatabase;
let db: Db;
let environmentId: string;
const blindIndexKey = new Uint8Array(randomBytes(32));
/** Synthetic, so no test here needs the generated `data/variant-groups.json`. */
const MATCHER: MatcherData = {
  status: 'loaded',
  groups: variantGroupsFrom([], 'a'.repeat(64)),
  keysVersion: 'synthetic',
};

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

const PREFIX = {
  'email-address': 'liea',
  'phone-number': 'lipn',
  name: 'lin',
  string: 'lis',
} as const;

async function listWith(
  type: keyof typeof PREFIX,
  values: readonly Record<string, unknown>[],
  input: Partial<NewList> = {},
): Promise<{ list: ListRow; itemIds: string[] }> {
  const list = await createList(db, environmentId, {
    id: newId('lst'),
    type,
    name: 'Synthetic blocked list',
    ...input,
  });
  const items = values.map((value) =>
    newListItem(blindIndexKey, environmentId, list, {
      id: newId(PREFIX[type]),
      value,
      creator: { type: 'api-key', id: newId('key') },
    }),
  );
  await insertListItems(db, environmentId, list.id, items);
  return { list, itemIds: items.map(({ id }) => id) };
}

async function run(
  query: Readonly<Record<string, unknown>>,
  options: {
    config?: Record<string, unknown>;
    inquiryId?: string;
    matcherData?: MatcherData;
  } = {},
): Promise<CustomListRunResult> {
  const ctx = reportContext({
    type: 'custom-list',
    query,
    environmentId,
    db,
    deps: { blindIndexKey, matcherData: () => options.matcherData ?? MATCHER },
    ...(options.config === undefined ? {} : { config: options.config }),
    ...(options.inquiryId === undefined ? {} : { inquiryId: options.inquiryId }),
  });
  const outcome = await customListReportJob.run(ctx);
  if (outcome.kind !== 'completed') {
    throw new Error('the run waited');
  }
  return outcome.result as CustomListRunResult;
}

describe('the custom-list job (C106.2)', () => {
  it('finds a listed value, keyed by the item, with its evidence and provenance', async () => {
    const { list, itemIds } = await listWith('email-address', [
      { value: 'listed@example.com', 'match-type': 'email_address' },
    ]);

    const result = await run({ 'email-address': 'LISTED@example.com', 'list-ids': [list.id] });

    expect(result.errors).toEqual([]);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      sourceId: list.id,
      entryKey: `${list.id}:${itemIds[0] ?? ''}`,
      riskDataHash: null,
      matchedName: 'Synthetic blocked list',
      score: 1,
      snapshot: {
        list: {
          'list-id': list.id,
          'list-type': 'list/email-address',
          name: 'Synthetic blocked list',
          version: 2,
        },
        entity: {
          'entity-id': `${list.id}:${itemIds[0] ?? ''}`,
          'list-item': { type: 'list-item/email-address', id: itemIds[0] },
          source: 'report.query',
          method: 'exact',
          tier: 'R',
          confidence: null,
          approximate: false,
          score: null,
          'distance-meters': null,
          'matched-value': 'LISTED@example.com',
        },
        'match-types': ['identifier_exact'],
        qualifiers: [],
        components: { methods: ['exact'] },
      },
    });
    expect(result.listSources).toEqual([
      {
        'list-id': list.id,
        version: 2,
        'normaliser-version': 'lists-1',
        'item-count': 1,
        'screened-at': REPORT_NOW.toISOString(),
      },
    ]);
    expect(result.result).toEqual({
      'lists-searched': [list.id],
      unscreened: [],
      'not-applicable': [],
    });
  });

  it('reads the lists pinned on the template before the query’s', async () => {
    const pinned = await listWith('string', [{ value: 'pinned' }]);
    const asked = await listWith('string', [{ value: 'pinned' }]);

    const result = await run(
      { string: 'pinned', 'list-ids': [asked.list.id] },
      { config: { 'list-ids': [pinned.list.id] } },
    );

    expect(result.matches.map(({ sourceId }) => sourceId)).toEqual([pinned.list.id]);
  });

  it('runs the fuzzy method a list allows, with its score', async () => {
    const { list } = await listWith(
      'name',
      [{ 'name-first': 'Jonathan', 'name-last': 'Example' }],
      { allowFuzzyNameFirst: true },
    );

    const result = await run({
      'name-first': 'Jonathon',
      'name-last': 'Example',
      'list-ids': [list.id],
    });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.score).toBeLessThan(1);
    expect(result.matches[0]?.snapshot).toMatchObject({
      'match-types': ['name_fuzzy'],
      components: { methods: ['fuzzy-name'] },
      entity: { method: 'fuzzy_name', tier: 'H' },
    });
  });

  it('screens with the matcher data it was given, so a list it cannot read says so', async () => {
    const { list } = await listWith(
      'name',
      [{ 'name-first': 'Jonathan', 'name-last': 'Example' }],
      { allowFuzzyNameFirst: true },
    );

    const result = await run(
      { 'name-first': 'Jonathon', 'name-last': 'Example', 'list-ids': [list.id] },
      { matcherData: { status: 'missing' } },
    );

    expect(result.matches).toEqual([]);
    expect(result.errors).toEqual([{ code: 'list_unavailable', source: list.id }]);
    expect(result.result).toMatchObject({
      unscreened: [{ 'list-id': list.id, reason: 'probe_unavailable' }],
    });
  });

  it('is no error for a subject with no value of a list’s kind (H16)', async () => {
    const { list } = await listWith('phone-number', [{ value: '+12025550100' }]);

    const result = await run({ string: 'anything', 'list-ids': [list.id] });

    expect(result.errors).toEqual([]);
    expect(result.result).toMatchObject({
      'not-applicable': [{ 'list-id': list.id, reason: 'subject_has_no_value' }],
    });
    expect(result.listSources.map((source) => source['list-id'])).toEqual([list.id]);
  });

  it('errors on an outdated normaliser, naming the list and keeping what it found', async () => {
    const stale = await listWith('string', [{ value: 'kept' }, { value: 'stale' }]);
    await db.execute(
      sql`update list_items set normaliser_version = 'lists-0' where id = ${stale.itemIds[1] ?? ''}`,
    );

    const result = await run({ string: 'kept', 'list-ids': [stale.list.id] });

    expect(result.errors).toEqual([{ code: 'list_unavailable', source: stale.list.id }]);
    expect(result.matches).toHaveLength(1);
    expect(result.result).toMatchObject({
      unscreened: [{ 'list-id': stale.list.id, reason: 'normaliser_outdated' }],
    });
    expect(result.listSources).toEqual([]);
  });

  it('errors on a pending face list, keeping the matches of the others', async () => {
    const emails = await listWith('email-address', [
      { value: 'listed@example.com', 'match-type': 'email_address' },
    ]);
    const faces = await createList(db, environmentId, {
      id: newId('lst'),
      type: 'face',
      name: 'Faces',
      itemRetentionDays: 30,
    });

    const result = await run(
      { 'email-address': 'listed@example.com', 'list-ids': [emails.list.id, faces.id] },
      { inquiryId: newId('inq') },
    );

    expect(result.errors).toEqual([{ code: 'list_unavailable', source: faces.id }]);
    expect(result.matches).toHaveLength(1);
  });

  it('reads a biometric list as not applicable with no inquiry to read', async () => {
    const faces = await createList(db, environmentId, {
      id: newId('lst'),
      type: 'face',
      name: 'Faces',
      itemRetentionDays: 30,
    });

    const result = await run({ string: 'anything', 'list-ids': [faces.id] });

    expect(result.errors).toEqual([]);
    expect(result.result).toMatchObject({
      'not-applicable': [{ 'list-id': faces.id, reason: 'subject_has_no_value' }],
    });
  });

  it('errors on an archived or missing list', async () => {
    const { list } = await listWith('string', []);
    await archiveList(db, environmentId, list.id, new Date());
    const gone = 'lst_00000000000000000000000000';

    const result = await run({ string: 'anything', 'list-ids': [list.id, gone] });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        { code: 'list_unavailable', source: list.id },
        { code: 'list_unavailable', source: gone },
      ]),
    );
    expect(result.result).toMatchObject({ 'lists-searched': [list.id, gone] });
  });

  it('names a list once, whatever its reasons', async () => {
    const { list, itemIds } = await listWith('name', [
      { 'name-first': 'Avery', 'name-last': 'Quillfeather' },
    ]);
    await db.execute(
      sql`update list_items set normaliser_version = 'lists-0' where id = ${itemIds[0] ?? ''}`,
    );

    const result = await run({ 'name-first': 'Avery', 'list-ids': [list.id] });

    expect(result.errors).toEqual([{ code: 'list_unavailable', source: list.id }]);
    expect(result.result).toMatchObject({
      unscreened: expect.arrayContaining([
        { 'list-id': list.id, reason: 'probe_unavailable' },
        { 'list-id': list.id, reason: 'normaliser_outdated' },
      ]) as unknown,
    });
  });

  it('errors with insufficient_input for an empty query or no list, never as screened', async () => {
    const { list } = await listWith('string', []);
    expect((await run({ 'list-ids': [list.id] })).errors).toEqual([{ code: 'insufficient_input' }]);
    expect((await run({ string: 'anything' })).errors).toEqual([{ code: 'insufficient_input' }]);
  });
});
