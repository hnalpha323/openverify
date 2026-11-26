/**
 * K7B-3 (owner decision 7 after Workflow 7B): the versions of a transaction type or a graph query
 * template are listed as inquiry template versions are, newest first with a cursor, and both parent
 * resources name their latest version's id, so a first draft is readable without audit metadata.
 * Every value is synthetic.
 */
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

interface Resource {
  id: string;
  attributes: Record<string, unknown>;
  relationships: Record<string, { data: { type: string; id: string } | null }>;
}

const post = async (url: string, type: string, attributes: Record<string, unknown>) =>
  (
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1${url}`,
        headers: bearer(api.token),
        payload: { data: { type, attributes } },
      }),
      201,
    ) as unknown as { data: Resource }
  ).data;

const get = async (url: string, token = api.token) =>
  expectStatus(
    await api.app.inject({ url: `/api/v1${url}`, headers: bearer(token) }),
    200,
  ) as unknown as { data: Resource; links?: { next: string | null } };

const list = async (url: string, token = api.token) =>
  expectStatus(
    await api.app.inject({ url: `/api/v1${url}`, headers: bearer(token) }),
    200,
  ) as unknown as { data: Resource[]; links: { next: string | null } };

const CONFIG = {
  parameters: [{ name: 'account_id', kind: 'account_id' }],
  start: [{ kind: 'account_id', value: '{{account_id}}' }],
  'connect-kinds': ['email_address'],
};

describe('GET /transaction-type-versions (K7B-3)', () => {
  it('lists a type’s versions newest first, and the type names its latest and published', async () => {
    const type = await post('/transaction-types', 'transaction-type', { name: 'Synthetic' });
    expect(type.relationships['published-version']?.data).toBeNull();
    const first = type.relationships['latest-version']?.data?.id ?? '';
    expect(first).toMatch(/^txntpv_/);
    await post('/transaction-type-versions', 'transaction-type-version', {
      'transaction-type-id': type.id,
    });

    const versions = await list(
      `/transaction-type-versions?filter[transaction-type-id]=${type.id}`,
    );

    expect(versions.data.map(({ attributes }) => attributes['version-number'])).toEqual([2, 1]);
    expect(versions.data[1]?.id).toBe(first);
    const [latest] = versions.data;
    const read = await get(`/transaction-types/${type.id}`);
    expect(read.data.relationships['latest-version']?.data).toEqual({
      type: 'transaction-type-version',
      id: latest?.id,
    });
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/transaction-type-versions/${first}/publish`,
        headers: bearer(api.token),
      }),
      200,
    );
    expect(
      (await get(`/transaction-types/${type.id}`)).data.relationships['published-version']?.data,
    ).toEqual({ type: 'transaction-type-version', id: first });
  });

  it('pages by a cursor, keeps to its environment, and needs transactions:read', async () => {
    const type = await post('/transaction-types', 'transaction-type', { name: 'Paged' });
    await post('/transaction-type-versions', 'transaction-type-version', {
      'transaction-type-id': type.id,
    });
    const tenant = await api.newTenant();
    const none = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });
    const url = `/api/v1/transaction-type-versions?filter[transaction-type-id]=${type.id}`;

    const first = await list(
      `/transaction-type-versions?filter[transaction-type-id]=${type.id}&page[size]=1`,
    );

    expect(first.data).toHaveLength(1);
    expect(first.links.next).toContain('page[after]');
    expect(
      (
        await list(
          `/transaction-type-versions?filter[transaction-type-id]=${type.id}`,
          tenant.token,
        )
      ).data,
    ).toEqual([]);
    expect((await api.app.inject({ url, headers: bearer(none) })).statusCode).toBe(403);
  });
});

describe('GET /graph-query-template-versions (K7B-3)', () => {
  it('lists a template’s versions newest first, and the template names its latest', async () => {
    const template = await post('/graph-query-templates', 'graph-query-template', {
      name: 'Synthetic',
      config: CONFIG,
    });
    const first = template.relationships['latest-version']?.data?.id ?? '';
    expect(first).toMatch(/^grqtv_/);
    await post('/graph-query-template-versions', 'graph-query-template-version', {
      'graph-query-template-id': template.id,
      config: CONFIG,
    });

    const versions = await list(
      `/graph-query-template-versions?filter[graph-query-template-id]=${template.id}`,
    );

    expect(versions.data.map(({ attributes }) => attributes['version-number'])).toEqual([2, 1]);
    expect(versions.data[1]?.id).toBe(first);
    const read = await get(`/graph-query-templates/${template.id}`);
    expect(read.data.relationships['latest-version']?.data).toEqual({
      type: 'graph-query-template-version',
      id: versions.data[0]?.id,
    });
  });

  it('needs graph:read', async () => {
    const none = api.newUserToken(api.environmentId, { permissions: ['transactions:read'] });

    const response = await api.app.inject({
      url: '/api/v1/graph-query-template-versions',
      headers: bearer(none),
    });

    expect(response.statusCode).toBe(403);
  });
});
