/**
 * C165.3 (Workflow 9B, `api-exports`; K10; contracts B16-B18): the new inquiry and transaction list
 * filters, through `GET /inquiries` and `GET /transactions`.
 *
 * - `filter[list-match]`: `matched` an open match; `not-matched` a completed screening and none;
 *   `unscreened` a pending, partial or errored screening and none; an inquiry with no screening matches
 *   none (B17). `filter[list-id]`: an open match on that list.
 * - `filter[check]` with `filter[check-status]`: a check's outcome on one of the inquiry's
 *   verifications.
 * - `filter[next-step-name]`: the step the inquiry is on, with PII visibility only (403 otherwise).
 * - `filter[fields.<key>]` on a filterable field: the plaintext projection for choices, boolean,
 *   integer, number and date fields, written on create and update; a string field through the equality
 *   index, with PII visibility and the blind-index key; a key no version marks filterable, or a value
 *   the field cannot hold, answers 400.
 * - `filter[identifier]` needs PII visibility inside the hook too (B18).
 *
 * Order is asserted only on `created_at DESC, id DESC`. Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import {
  completeListScreening,
  createListScreening,
  insertListMatches,
  listTransactionFilterValues,
} from '@openverify/db';
import { seedList, seedListItem } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createInquiry,
  createTestApi,
  seedVerification,
  type TestApi,
} from '../../test-support/harness.js';
import { fieldValueKey } from '../transactions/write-checks.js';
import { transactionListFilters } from './transactions.js';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi();
}, 120_000);

afterAll(async () => {
  await api.close();
});

const get = (url: string, token = api.token) =>
  api.app.inject({ url: `/api/v1${url}`, headers: bearer(token) });

const idsOf = (response: { json: () => unknown; statusCode: number; body: string }) => {
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { data: { id: string }[] }).data.map(({ id }) => id);
};

describe('the inquiry list filters (C165.3; B17)', () => {
  let matched: string;
  let clean: string;
  let pending: string;
  let erroredWithMatch: string;
  let none: string;
  let listId: string;
  let otherList: string;

  beforeAll(async () => {
    const { db } = api.database;
    const env = api.environmentId;
    listId = (await seedList(db, env)).id;
    otherList = (await seedList(db, env)).id;
    const item = await seedListItem(db, env, { listId });
    matched = await createInquiry(api);
    clean = await createInquiry(api);
    pending = await createInquiry(api);
    erroredWithMatch = await createInquiry(api);
    none = await createInquiry(api);
    const screened = async (inquiryId: string, status: 'completed' | 'errored' | null) => {
      await createListScreening(db, env, { inquiryId, triggerStatus: 'completed' });
      if (status !== null) {
        await completeListScreening(db, env, inquiryId, {
          status,
          matchCount: 0,
          unscreened: [],
          notApplicable: [],
          reviewCause: null,
          at: api.clock.now(),
        });
      }
    };
    await screened(matched, 'completed');
    await screened(clean, 'completed');
    await screened(pending, null);
    await screened(erroredWithMatch, 'errored');
    const match = (inquiryId: string) => ({
      id: newId('lmt'),
      listId,
      listItemId: item.id,
      inquiryId,
      accountId: null,
      source: 'inquiry.fields' as const,
      method: 'exact' as const,
      tier: 'R' as const,
      confidence: null,
      approximate: false,
      score: null,
      distanceMeters: null,
      listVersion: 1,
      matchedValue: 'synthetic-matched-value',
    });
    await insertListMatches(db, env, [match(matched), match(erroredWithMatch)]);
  });

  it('reads list-match over the screenings and their open matches', async () => {
    const of = async (value: string) =>
      new Set(idsOf(await get(`/inquiries?filter[list-match]=${value}&page[size]=100`)));

    const isMatched = await of('matched');
    const notMatched = await of('not-matched');
    const unscreened = await of('unscreened');

    expect(isMatched).toEqual(new Set([matched, erroredWithMatch]));
    expect(notMatched).toEqual(new Set([clean]));
    expect(unscreened).toEqual(new Set([pending]));
    for (const each of [isMatched, notMatched, unscreened]) {
      expect(each.has(none)).toBe(false);
    }
  });

  it('reads list-id as an open match on that list, and repeats it in the next link', async () => {
    const onList = await get(`/inquiries?filter[list-id]=${listId}&page[size]=1`);
    const onOther = await get(`/inquiries?filter[list-id]=${otherList}`);

    expect(idsOf(onList)).toHaveLength(1);
    expect(onList.json<{ links: { next: string | null } }>().links.next).toContain(
      `filter[list-id]=${listId}`,
    );
    expect(idsOf(onOther)).toEqual([]);
  });

  it("reads a check's outcome on one of the inquiry's verifications", async () => {
    const inquiryId = await createInquiry(api);
    await seedVerification(api, api.environmentId, inquiryId, {
      checks: [{ name: 'id_expired', status: 'failed' }],
    });

    const failed = await get('/inquiries?filter[check]=id_expired&filter[check-status]=failed');
    const passed = await get('/inquiries?filter[check]=id_expired&filter[check-status]=passed');

    expect(idsOf(failed)).toEqual([inquiryId]);
    expect(idsOf(passed)).toEqual([]);
  });

  it('reads the step the inquiry is on with PII visibility, and refuses it without', async () => {
    const onStep = await createInquiry(api);
    const ended = await createInquiry(api);
    await api.database.db.execute(sql`update inquiries set flow_step_id = 'address-step',
      flow_state = case when id = ${ended} then 'ended' else 'active' end, flow_spec_version = 2
      where id in (${onStep}, ${ended})`);
    const masked = await api.newApiKey(api.environmentId, {
      scopes: ['inquiries:read'],
      piiMasked: true,
    });

    const visible = await get('/inquiries?filter[next-step-name]=address-step');
    const refused = await get('/inquiries?filter[next-step-name]=address-step', masked);

    expect(idsOf(visible)).toEqual([onStep]);
    expect(refused.statusCode).toBe(403);
  });
});

describe('the transaction field filters (C165.3; B18)', () => {
  const FIELDS = [
    { type: 'integer', key: 'amount', label: 'Amount', config: { filterable: true } },
    { type: 'boolean', key: 'flagged', label: 'Flagged', config: { filterable: true } },
    { type: 'date', key: 'due', label: 'Due', config: { filterable: true } },
    {
      type: 'choices',
      key: 'plan',
      label: 'Plan',
      config: { options: ['basic', 'plus'], filterable: true },
    },
    {
      type: 'string',
      key: 'channel',
      label: 'Channel',
      config: { searchable: true, filterable: true },
    },
    { type: 'string', key: 'memo', label: 'Memo' },
  ];
  let typeId: string;
  let first: string;
  let second: string;

  async function newTransaction(fields: Record<string, unknown>): Promise<string> {
    const response = await api.app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: bearer(api.token),
      payload: {
        data: { type: 'transaction', attributes: { 'transaction-type-id': typeId, fields } },
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ data: { id: string } }>().data.id;
  }

  beforeAll(async () => {
    const created = await api.app.inject({
      method: 'POST',
      url: '/api/v1/transaction-types',
      headers: bearer(api.token),
      payload: {
        data: {
          type: 'transaction-type',
          attributes: { name: 'Synthetic filters', 'field-schemas': FIELDS },
        },
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    typeId = created.json<{ data: { id: string } }>().data.id;
    const result = await api.database.db.execute(
      sql`select id from transaction_type_versions where transaction_type_id = ${typeId}`,
    );
    const versionId = (result as unknown as { rows: { id: string }[] }).rows[0]?.id ?? '';
    const published = await api.app.inject({
      method: 'POST',
      url: `/api/v1/transaction-type-versions/${versionId}/publish`,
      headers: bearer(api.token),
    });
    expect(published.statusCode, published.body).toBe(200);
    first = await newTransaction({
      amount: 42,
      flagged: true,
      due: '2026-11-06',
      plan: 'plus',
      channel: 'web',
      memo: 'synthetic-memo',
    });
    second = await newTransaction({ amount: 7, flagged: false, plan: 'basic', channel: 'app' });
  });

  it('projects the filterable values on creation, by their canonical text', async () => {
    const values = await listTransactionFilterValues(api.database.db, api.environmentId, first);

    expect(values).toEqual([
      { fieldKey: 'amount', value: '42' },
      { fieldKey: 'due', value: '2026-11-06' },
      { fieldKey: 'flagged', value: 'true' },
      { fieldKey: 'plan', value: 'plus' },
    ]);
  });

  it('filters by an integer, a boolean, a date and a choice, each read as its type reads it', async () => {
    expect(idsOf(await get('/transactions?filter[fields.amount]=42'))).toEqual([first]);
    expect(idsOf(await get('/transactions?filter[fields.amount]=42.0'))).toEqual([first]);
    expect(idsOf(await get('/transactions?filter[fields.flagged]=false'))).toEqual([second]);
    expect(idsOf(await get('/transactions?filter[fields.due]=2026-11-06'))).toEqual([first]);
    expect(
      idsOf(await get('/transactions?filter[fields.plan]=basic&filter[fields.amount]=7')),
    ).toEqual([second]);
  });

  it('follows an update: the changed field is projected again', async () => {
    const changed = await api.app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${second}`,
      headers: bearer(api.token),
      payload: { data: { type: 'transaction', attributes: { fields: { amount: 8 } } } },
    });
    expect(changed.statusCode, changed.body).toBe(200);

    expect(idsOf(await get('/transactions?filter[fields.amount]=7'))).toEqual([]);
    expect(idsOf(await get('/transactions?filter[fields.amount]=8'))).toEqual([second]);
  });

  it('answers 400 for a field no version marks filterable, or a value it cannot hold', async () => {
    const outcomes = await Promise.all(
      [
        'filter[fields.memo]=synthetic-memo',
        'filter[fields.unknown]=1',
        'filter[fields.amount]=many',
        'filter[fields.flagged]=yes',
        'filter[fields.due]=06-11-2026',
      ].map(async (query) => (await get(`/transactions?${query}`)).statusCode),
    );

    expect(outcomes).toEqual([400, 400, 400, 400, 400]);
  });

  it('repeats the field filters in the next link', async () => {
    const page = await get('/transactions?filter[fields.amount]=42&page[size]=1');

    expect(idsOf(page)).toEqual([first]);
    expect(page.json<{ links: { next: string | null } }>().links.next).toBeNull();
  });

  it('reads a string field through the equality index, with PII visibility and the key', async () => {
    const conditions = await transactionListFilters(api.database.db, {
      environmentId: api.environmentId,
      query: { 'filter[fields.channel]': 'web' },
      piiVisible: true,
      blindIndexKey: api.deps.blindIndexKey,
    });
    const found = await api.database.db.execute(sql`select t.id from transactions t
      where t.environment_id = ${api.environmentId} and exists (select 1 from transaction_field_keys k
        where k.environment_id = t.environment_id and k.transaction_id = t.id
          and k.field_key = 'channel'
          and k.value_key = ${fieldValueKey(api.deps.blindIndexKey, api.environmentId, 'channel', 'web')})`);

    expect(conditions.where).toHaveLength(1);
    expect(conditions.links).toEqual({ 'filter[fields.channel]': 'web' });
    expect((found as unknown as { rows: { id: string }[] }).rows.map(({ id }) => id)).toEqual([
      first,
    ]);
  });

  it('refuses a string field filter and filter[identifier] without PII visibility', async () => {
    const masked = await api.newApiKey(api.environmentId, {
      scopes: ['transactions:read'],
      piiMasked: true,
    });
    const hidden = (query: Record<string, string>) =>
      transactionListFilters(api.database.db, {
        environmentId: api.environmentId,
        query,
        piiVisible: false,
        blindIndexKey: api.deps.blindIndexKey,
      });

    expect((await get('/transactions?filter[fields.channel]=web', masked)).statusCode).toBe(403);
    await expect(hidden({ 'filter[fields.channel]': 'web' })).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      hidden({ 'filter[identifier][key]': 'channel', 'filter[identifier][value]': 'web' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('answers a string field filter on the route through the environment’s blind-index key', async () => {
    expect(idsOf(await get('/transactions?filter[fields.channel]=web'))).toEqual([first]);
    expect(idsOf(await get('/transactions?filter[fields.channel]=app'))).toEqual([second]);
    expect(idsOf(await get('/transactions?filter[fields.channel]=kiosk'))).toEqual([]);
  });
});
