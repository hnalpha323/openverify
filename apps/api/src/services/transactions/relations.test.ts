/**
 * K7C-2 (C105.2, C108): `GET /transactions/:id/relations` serves the relations set by `add-relation`
 * and not yet removed, newest first with a cursor, under `transactions:read`. A `many` relation has
 * no cap, so it is a resource of its own and not a member. It serves ids only, never a target's
 * attributes. A redaction leaves the rows as they are (C105.5), so they are served as they were.
 * Every value is synthetic.
 */
import { createAccount } from '@openverify/db';
import { seedTransaction, seedTransactionType, testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, expectStatus } from '../../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const RELATION_SCHEMAS = [
  { key: 'payer', target: 'account', cardinality: 'many' },
  { key: 'refund-of', target: 'transaction', cardinality: 'one' },
];

async function transaction(): Promise<{ id: string; other: string }> {
  const type = await seedTransactionType(api.database.db, api.environmentId, {
    id: testId('txntp'),
    versionId: testId('txntpv'),
    relationSchemas: RELATION_SCHEMAS,
  });
  const seed = () =>
    seedTransaction(api.database.db, api.environmentId, {
      transactionTypeId: type.id,
      transactionTypeVersionId: type.versionId,
    });
  return { id: (await seed()).id, other: (await seed()).id };
}

const account = async (referenceId?: string) =>
  (
    await createAccount(api.database.db, api.environmentId, {
      id: testId('acc'),
      ...(referenceId === undefined ? {} : { referenceId }),
    })
  ).id;

interface Listed {
  data: { id: string; type: string; attributes: Record<string, unknown> }[];
  links: { next: string | null };
}

const list = async (url: string, token = api.token) =>
  expectStatus(
    await api.app.inject({ url: `/api/v1${url}`, headers: bearer(token) }),
    200,
  ) as unknown as Listed;

const relation = async (
  action: 'add-relation' | 'remove-relation',
  id: string,
  key: string,
  targetId: string,
) =>
  expectStatus(
    await api.app.inject({
      method: 'POST',
      url: `/api/v1/transactions/${id}/${action}`,
      headers: bearer(api.token),
      payload: { meta: { 'relation-schema-key': key, 'target-object-id': targetId } },
    }),
    200,
  );

const stamp = (id: string, targetId: string, at: string) =>
  api.database.client.query(
    'update transaction_relations set created_at = $1::timestamptz where transaction_id = $2 and target_id = $3',
    [at, id, targetId],
  );

const afterOf = (next: string | null) =>
  new URL(next ?? '', 'http://api.invalid').searchParams.get('page[after]') ?? '';

describe('GET /transactions/:id/relations (K7C-2, C108)', () => {
  it('serves each relation as a transaction-relation, newest first, naming an account or a transaction by its id', async () => {
    const { id, other } = await transaction();
    const payer = await account();
    await relation('add-relation', id, 'payer', payer);
    await relation('add-relation', id, 'refund-of', other);
    await stamp(id, payer, '2026-10-01T00:00:00.000000Z');
    await stamp(id, other, '2026-10-02T00:00:00.000000Z');

    const listed = await list(`/transactions/${id}/relations`);

    expect(listed).toEqual({
      data: [
        {
          type: 'transaction-relation',
          id: `${id}:refund-of:${other}`,
          attributes: {
            'relation-schema-key': 'refund-of',
            target: { type: 'transaction', id: other },
            'created-at': '2026-10-02T00:00:00.000Z',
          },
        },
        {
          type: 'transaction-relation',
          id: `${id}:payer:${payer}`,
          attributes: {
            'relation-schema-key': 'payer',
            target: { type: 'account', id: payer },
            'created-at': '2026-10-01T00:00:00.000Z',
          },
        },
      ],
      links: { next: null },
    });
  });

  it('serves ids only, never an attribute of a target', async () => {
    const { id } = await transaction();
    const reference = `synthetic-reference-${testId('acc').slice(-8)}`;
    await relation('add-relation', id, 'payer', await account(reference));

    const response = await api.app.inject({
      url: `/api/v1/transactions/${id}/relations`,
      headers: bearer(api.token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(reference);
  });

  it('pages by a cursor, keeps its place when a row is added or removed, and refuses a cursor that is no position', async () => {
    const { id } = await transaction();
    const [oldest, middle, newest] = [await account(), await account(), await account()];
    for (const [target, day] of [
      [oldest, '01'],
      [middle, '02'],
      [newest, '03'],
    ] as const) {
      await relation('add-relation', id, 'payer', target);
      await stamp(id, target, `2026-10-${day}T00:00:00.000000Z`);
    }

    const first = await list(`/transactions/${id}/relations?page[size]=2`);
    expect(first.data.map(({ attributes }) => attributes.target)).toEqual([
      { type: 'account', id: newest },
      { type: 'account', id: middle },
    ]);
    const after = afterOf(first.links.next);
    expect(new URL(first.links.next ?? '', 'http://api.invalid').searchParams.get('page[size]')).toBe(
      '2',
    );

    await relation('add-relation', id, 'payer', await account());
    await relation('remove-relation', id, 'payer', middle);
    const second = await list(
      `/transactions/${id}/relations?page[size]=2&page[after]=${encodeURIComponent(after)}`,
    );

    expect(second.data.map(({ attributes }) => attributes.target)).toEqual([
      { type: 'account', id: oldest },
    ]);
    expect(second.links.next).toBeNull();
    for (const cursor of ['nowhere', `${id}:payer:${oldest}`, '0000-01-01T00:00:00.000000Z~a~b']) {
      const refused = await api.app.inject({
        url: `/api/v1/transactions/${id}/relations?page[after]=${encodeURIComponent(cursor)}`,
        headers: bearer(api.token),
      });
      expect(refused.statusCode, cursor).toBe(400);
    }
  });

  it('is gone once removed', async () => {
    const { id } = await transaction();
    const payer = await account();
    await relation('add-relation', id, 'payer', payer);
    await relation('remove-relation', id, 'payer', payer);

    expect((await list(`/transactions/${id}/relations`)).data).toEqual([]);
  });

  it('serves the rows of a redacted transaction as they were: they hold ids, and a redaction leaves them', async () => {
    const { id } = await transaction();
    const payer = await account();
    await relation('add-relation', id, 'payer', payer);
    const before = await list(`/transactions/${id}/relations`);

    expectStatus(
      await api.app.inject({
        method: 'DELETE',
        url: `/api/v1/transactions/${id}`,
        headers: bearer(api.token),
        payload: {},
      }),
      200,
    );

    expect(before.data).toHaveLength(1);
    expect(await list(`/transactions/${id}/relations`)).toEqual(before);
  });

  it('answers 404 for a transaction this environment does not hold, and needs transactions:read', async () => {
    const { id } = await transaction();
    await relation('add-relation', id, 'payer', await account());
    const tenant = await api.newTenant();
    const none = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });
    const viewer = api.newUserToken(api.environmentId, { permissions: ['transactions:read'] });
    const read = (token: string) =>
      api.app.inject({ url: `/api/v1/transactions/${id}/relations`, headers: bearer(token) });

    expect((await read(tenant.token)).statusCode).toBe(404);
    expect((await read(none)).statusCode).toBe(403);
    expect((await read(viewer)).statusCode).toBe(200);
  });

  it('is in /openapi.json', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, { get?: unknown }>;
    }>();

    expect(document.paths['/api/v1/transactions/{id}/relations']?.get).toBeDefined();
  });
});
