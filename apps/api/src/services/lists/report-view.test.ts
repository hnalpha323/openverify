/**
 * C106.2 (Workflow 7B, `api-lists`): what the report resource reads for a custom-list report: live
 * matches grouped by list with their C99.1 evidence, and the rules a report and a template are held
 * to. Synthetic values.
 */
import { LIST_LIMITS } from '@openverify/core';
import type { Db, StoredReportMatch } from '@openverify/db';
import { createTestDatabase, createTestTenant, seedList, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customListListProblems, customListMatchedLists } from './report-view.js';

const LIST = 'lst_01M5CK3190XEVBM5ZXA76E1JSN';
const OTHER = 'lst_01M5CK3190XEVBM5ZXA76E1JSM';

const stored = (id: string, listId: string, item: string): StoredReportMatch =>
  ({
    id,
    score: 1,
    snapshot: {
      list: { 'list-id': listId, 'list-type': 'list/string', name: 'Synthetic', version: 2 },
      entity: {
        'entity-id': `${listId}:${item}`,
        'list-item': { type: 'list-item/string', id: item },
        source: 'report.query',
        method: 'exact',
        tier: 'R',
        confidence: null,
        approximate: false,
        score: null,
        'distance-meters': null,
        'matched-value': 'synthetic',
      },
    },
  }) as unknown as StoredReportMatch;

describe('customListMatchedLists (C106.2)', () => {
  it('groups by list, each item with its match id and its own evidence', () => {
    const lists = customListMatchedLists([
      stored('rpm_1', LIST, 'lis_1'),
      stored('rpm_2', LIST, 'lis_2'),
      stored('rpm_3', OTHER, 'lis_3'),
    ]);

    expect(lists.map((list) => list['list-id'])).toEqual([LIST, OTHER]);
    expect(lists[0]).toMatchObject({ 'list-type': 'list/string', name: 'Synthetic', version: 2 });
    expect(lists[0]?.items.map((item) => item['match-id'])).toEqual(['rpm_1', 'rpm_2']);
    expect(lists[0]?.items[0]).toMatchObject({
      'entity-id': `${LIST}:lis_1`,
      method: 'exact',
      score: null,
    });
  });

  it('leaves out a match whose snapshot was redacted', () => {
    const redacted = { ...stored('rpm_1', LIST, 'lis_1'), snapshot: null };
    expect(customListMatchedLists([redacted])).toEqual([]);
  });
});

describe('customListListProblems (C106.2)', () => {
  let database: TestDatabase;
  let db: Db;
  let environmentId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    db = database.db;
    environmentId = (await createTestTenant(db)).environment.id;
  }, 120_000);

  afterAll(async () => {
    await database.close();
  });

  it('needs a list, from the query or pinned on the template', async () => {
    expect(await customListListProblems(db, environmentId, { pinned: null, asked: undefined })).toEqual(
      [expect.objectContaining({ code: 'report_lists_required' })],
    );
    const list = await seedList(db, environmentId);
    expect(await customListListProblems(db, environmentId, { pinned: [list.id] })).toEqual([]);
    expect(await customListListProblems(db, environmentId, { asked: [list.id] })).toEqual([]);
  });

  it('refuses a pinned list that is archived or gone, pointing at it', async () => {
    const live = await seedList(db, environmentId);
    const archived = await seedList(db, environmentId, { status: 'archived' });
    const other = await seedList(db, (await createTestTenant(db)).environment.id);

    expect(
      await customListListProblems(db, environmentId, {
        pinned: [live.id, archived.id, other.id],
      }),
    ).toEqual([
      {
        code: 'report_list_unavailable',
        detail: `List ${archived.id} is archived or gone.`,
        pointer: '/data/attributes/config/list-ids/1',
      },
      {
        code: 'report_list_unavailable',
        detail: `List ${other.id} is archived or gone.`,
        pointer: '/data/attributes/config/list-ids/2',
      },
    ]);
    expect(LIST_LIMITS.reportLists).toBe(20);
  });
});
