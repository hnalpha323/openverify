/**
 * C105.7 (Workflow 7B Stage 1b (T)): every read of an inquiry, a verification or a report asks
 * `resolveTransactionRelationships` for the `transaction` relationship, so `api-transactions` builds
 * the resolver and touches no read. Here it is a recording fake that answers what `api-transactions`
 * will: every id asked for, `null` for an object with none. A separate block runs the unbuilt
 * resolver, which leaves the member out, as before. Synthetic values.
 */
import { seedReport, seedReportTemplate, createTestInquiry } from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDashboardHarness, expectJson } from '../routes/dashboard/dashboard.test-support.js';
import { bearer, createInquiry, expectStatus, seedVerification } from '../test-support/harness.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';

const attached = vi.hoisted(() => new Map<string, string>());
const unbuilt = vi.hoisted(() => ({ value: false }));
vi.mock('./transactions/relationships.js', () => ({
  resolveTransactionRelationships: (_db: unknown, _environmentId: string, ids: readonly string[]) =>
    Promise.resolve(
      new Map(unbuilt.value ? [] : ids.map((id) => [id, attached.get(id) ?? null] as const)),
    ),
}));

const TRANSACTION = 'txn_01M5CK16P0D13FXHZSS4TCFBVH';
const OTHER = 'txn_01M5CK16P0D13FXHZSS4TCFBVJ';
const linked = (id: string) => ({ data: { type: 'transaction', id } });

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  attached.clear();
  unbuilt.value = false;
});

interface Resource {
  id: string;
  relationships: { transaction?: unknown };
}

const get = (url: string) => api.app.inject({ url: `/api/v1${url}`, headers: bearer(api.token) });
const read = async (url: string) => expectStatus(await get(url), 200) as unknown as { data: Resource };

describe('inquiries (C105.7)', () => {
  it('GET /inquiries/:id serves the latest transaction, and null without one', async () => {
    const inquiry = await createInquiry(api, {});
    expect((await read(`/inquiries/${inquiry}`)).data.relationships.transaction).toEqual({
      data: null,
    });

    attached.set(inquiry, TRANSACTION);

    expect((await read(`/inquiries/${inquiry}`)).data.relationships.transaction).toEqual(
      linked(TRANSACTION),
    );
  });

  it('GET /inquiries gives each page row its own', async () => {
    const first = await createInquiry(api, {});
    const second = await createInquiry(api, {});
    attached.set(first, TRANSACTION);
    attached.set(second, OTHER);

    const page = expectStatus(await get('/inquiries?page[size]=100'), 200) as unknown as {
      data: Resource[];
    };

    const of = (id: string) => page.data.find((row) => row.id === id)?.relationships.transaction;
    expect(of(first)).toEqual(linked(TRANSACTION));
    expect(of(second)).toEqual(linked(OTHER));
  });

  it('an action’s answer carries it too, through inquiryResourceOf', async () => {
    const inquiry = await createInquiry(api, {});
    attached.set(inquiry, TRANSACTION);

    const response = await api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiries/${inquiry}/add-tag`,
      headers: bearer(api.token),
      payload: { meta: { 'tag-name': 'synthetic' } },
    });

    const answer = expectStatus(response, 200) as unknown as { data: Resource };
    expect(answer.data.relationships.transaction).toEqual(linked(TRANSACTION));
  });
});

describe('verifications (C105.7)', () => {
  it('GET /verifications/:id serves it, and each included one its own', async () => {
    const inquiry = await createInquiry(api, {});
    const verification = await seedVerification(api, api.environmentId, inquiry);
    attached.set(verification.id, OTHER);

    const single = await read(`/verifications/${verification.id}`);
    expect(single.data.relationships.transaction).toEqual(linked(OTHER));

    const withIncluded = expectStatus(
      await get(`/inquiries/${inquiry}?include=verifications`),
      200,
    ) as unknown as { included: Resource[] };
    expect(
      withIncluded.included.find((row) => row.id === verification.id)?.relationships.transaction,
    ).toEqual(linked(OTHER));
  });
});

describe('reports (C105.7)', () => {
  async function report() {
    const { templateId, versionId } = await seedReportTemplate(api.database.db, api.environmentId);
    return seedReport(api.database.db, api.environmentId, { templateId, versionId });
  }

  it('GET /reports/:id serves the latest transaction, and null without one', async () => {
    const id = await report();
    expect((await read(`/reports/${id}`)).data.relationships.transaction).toEqual({ data: null });

    attached.set(id, TRANSACTION);

    expect((await read(`/reports/${id}`)).data.relationships.transaction).toEqual(
      linked(TRANSACTION),
    );
  });

  it('GET /reports gives each page row its own', async () => {
    const id = await report();
    attached.set(id, OTHER);

    const page = expectStatus(await get('/reports?page[size]=100'), 200) as unknown as {
      data: Resource[];
    };

    expect(page.data.find((row) => row.id === id)?.relationships.transaction).toEqual(linked(OTHER));
  });
});

describe('the console reads', () => {
  it('reads and lists inquiries with it, and the included verifications', async () => {
    const harness = await createDashboardHarness(api.database);
    try {
      const organization = await harness.organization();
      const admin = await harness.operator(organization, { roles: ['admin'] });
      const token = await harness.signIn(admin.email);
      const { inquiry } = await createTestInquiry(api.database.db, organization.sandboxId);
      const verification = await seedVerification(api, organization.sandboxId, inquiry.id);
      attached.set(inquiry.id, TRANSACTION);
      attached.set(verification.id, OTHER);

      const list = expectJson<{ data: Resource[] }>(
        await harness.call('GET', '/inquiries', { token }),
        200,
      );
      expect(list.data[0]?.relationships.transaction).toEqual(linked(TRANSACTION));

      const single = expectJson<{ data: Resource; included: Resource[] }>(
        await harness.call('GET', `/inquiries/${inquiry.id}`, { token }),
        200,
      );
      expect(single.data.relationships.transaction).toEqual(linked(TRANSACTION));
      expect(
        single.included.find((row) => row.id === verification.id)?.relationships.transaction,
      ).toEqual(linked(OTHER));
    } finally {
      await harness.close();
    }
  });
});

describe('the unbuilt resolver (Stage 1b)', () => {
  it('leaves the member out of an inquiry and a verification, and null on a report', async () => {
    unbuilt.value = true;
    const inquiry = await createInquiry(api, {});
    const verification = await seedVerification(api, api.environmentId, inquiry);
    const { templateId, versionId } = await seedReportTemplate(api.database.db, api.environmentId);
    const report = await seedReport(api.database.db, api.environmentId, { templateId, versionId });

    expect((await read(`/inquiries/${inquiry}`)).data.relationships).not.toHaveProperty(
      'transaction',
    );
    expect((await read(`/verifications/${verification.id}`)).data.relationships).not.toHaveProperty(
      'transaction',
    );
    expect((await read(`/reports/${report}`)).data.relationships.transaction).toEqual({
      data: null,
    });
  });
});
