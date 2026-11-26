/**
 * K7B-4 (owner decision 8 after Workflow 7B, C108): a transaction's status history and its labels
 * have read routes, newest first with cursor pagination, under `transactions:read`. The history is
 * unbounded and append-only, so it stays off the transaction resource. Its free text is `null` once
 * redacted; redacted labels are left out. Every value is synthetic.
 */
import { redactTransactionRecords } from '@openverify/db';
import {
  seedTransaction,
  seedTransactionLabel,
  seedTransactionStatus,
  seedTransactionType,
  testId,
} from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, expectStatus } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

async function transaction(): Promise<string> {
  const type = await seedTransactionType(api.database.db, api.environmentId, {
    id: testId('txntp'),
    versionId: testId('txntpv'),
  });
  const { id } = await seedTransaction(api.database.db, api.environmentId, {
    transactionTypeId: type.id,
    transactionTypeVersionId: type.versionId,
  });
  return id;
}

interface Listed {
  data: { id: string; type: string; attributes: Record<string, unknown> }[];
  links: { next: string | null };
}

const list = async (url: string, token = api.token) =>
  expectStatus(
    await api.app.inject({ url: `/api/v1${url}`, headers: bearer(token) }),
    200,
  ) as unknown as Listed;

const redact = (id: string) => redactTransactionRecords(api.database.db, api.environmentId, id, {});

describe('GET /transactions/:id/status-changes (C108)', () => {
  it('serves a change a workflow run made as the run, never as an API key (C121.1)', async () => {
    const id = await transaction();
    await api.database.db.execute(sql`
      insert into transaction_status_history (environment_id, transaction_id, to_status, actor_type,
        actor_id)
      values (${api.environmentId}, ${id}, 'approved', 'workflow_run', ${testId('wfr')})`);

    const { data } = await list(`/transactions/${id}/status-changes`);

    expect(data[0]?.attributes['actor-type']).toBe('workflow-run');
  });

  it('lists the changes newest first, with who moved it by type', async () => {
    const id = await transaction();
    await seedTransactionStatus(api.database.db, api.environmentId, {
      transactionId: id,
      fromStatus: null,
      toStatus: 'created',
    });
    await seedTransactionStatus(api.database.db, api.environmentId, {
      transactionId: id,
      fromStatus: 'created',
      toStatus: 'approved',
    });

    const { data } = await list(`/transactions/${id}/status-changes`);

    expect(data.map(({ type }) => type)).toEqual([
      'transaction-status-change',
      'transaction-status-change',
    ]);
    expect(data.map(({ attributes }) => attributes['to-status'])).toEqual(['approved', 'created']);
    expect(data[0]?.attributes).toMatchObject({
      'from-status': 'created',
      'actor-type': 'system',
      'redacted-at': null,
    });
    expect(data[0]?.attributes['created-at']).not.toBeNull();
  });

  it('pages by a cursor, and refuses a cursor of nothing', async () => {
    const id = await transaction();
    for (const toStatus of ['approved', 'declined', 'needs review']) {
      await seedTransactionStatus(api.database.db, api.environmentId, {
        transactionId: id,
        toStatus,
      });
    }

    const first = await list(`/transactions/${id}/status-changes?page[size]=2`);
    expect(first.data).toHaveLength(2);
    const next = new URL(first.links.next ?? '', 'http://api.invalid');
    const after = next.searchParams.get('page[after]') ?? '';
    const second = await list(
      `/transactions/${id}/status-changes?page[size]=2&page[after]=${after}`,
    );
    expect(second.data.map(({ attributes }) => attributes['to-status'])).toEqual(['approved']);
    expect(second.links.next).toBeNull();
    const refused = await api.app.inject({
      url: `/api/v1/transactions/${id}/status-changes?page[after]=999999999`,
      headers: bearer(api.token),
    });
    expect(refused.statusCode).toBe(400);
  });

  it('keeps who and when of a redacted transaction, and nulls the free text', async () => {
    const id = await transaction();
    await seedTransactionStatus(api.database.db, api.environmentId, {
      transactionId: id,
      fromStatus: 'created',
      toStatus: 'approved',
    });
    await redact(id);

    const { data } = await list(`/transactions/${id}/status-changes`);

    expect(data[0]?.attributes).toMatchObject({
      'from-status': null,
      'to-status': null,
      'actor-type': 'system',
    });
    expect(data[0]?.attributes['redacted-at']).not.toBeNull();
  });

  it('answers 404 for a transaction this environment does not hold, and needs transactions:read', async () => {
    const id = await transaction();
    const tenant = await api.newTenant();
    const none = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });
    const read = (token: string) =>
      api.app.inject({
        url: `/api/v1/transactions/${id}/status-changes`,
        headers: bearer(token),
      });

    expect((await read(tenant.token)).statusCode).toBe(404);
    expect((await read(none)).statusCode).toBe(403);
  });
});

describe('GET /transactions/:id/labels (C108)', () => {
  it('lists the labels newest first, as transaction-label resources, and pages', async () => {
    const id = await transaction();
    for (const label of ['older', 'middle', 'newest']) {
      await seedTransactionLabel(api.database.db, api.environmentId, {
        transactionId: id,
        label,
      });
    }

    const first = await list(`/transactions/${id}/labels?page[size]=2`);

    expect(first.data.map(({ type }) => type)).toEqual(['transaction-label', 'transaction-label']);
    expect(first.data[0]?.attributes['model-version']).toBe('synthetic-model');
    expect(first.links.next).not.toBeNull();
  });

  it('leaves out the labels of a redacted transaction', async () => {
    const id = await transaction();
    await seedTransactionLabel(api.database.db, api.environmentId, { transactionId: id });
    await redact(id);

    expect((await list(`/transactions/${id}/labels`)).data).toEqual([]);
  });

  it('answers 404 for a transaction this environment does not hold', async () => {
    const id = await transaction();
    const tenant = await api.newTenant();

    const response = await api.app.inject({
      url: `/api/v1/transactions/${id}/labels`,
      headers: bearer(tenant.token),
    });

    expect(response.statusCode).toBe(404);
  });
});
