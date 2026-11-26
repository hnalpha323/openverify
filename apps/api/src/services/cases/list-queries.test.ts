/**
 * K8-30 (Workflow 8D; plan item 115): `GET /cases` and `POST /cases/search` read a page's held
 * objects, comment ids and attachments in a fixed number of queries, whatever the page's size, and
 * each case on the page is what `GET /cases/:id` serves. The count is read from the database client
 * while one request runs. Every value is synthetic.
 */
import { createTestInquiry, seedCaseAttachment } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';

let api: TestApi;
let token: string;
let small: string;
let large: string;

beforeAll(async () => {
  api = await createTestApi();
  token = api.newUserToken(api.environmentId);
  small = await templateWithCases('LQS', 2);
  large = await templateWithCases('LQL', 8);
}, 120_000);

afterAll(async () => {
  await api.close();
});

let calls = 0;
const call = (method: 'GET' | 'POST', url: string, payload?: unknown) => {
  calls += 1;
  return api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(token), 'idempotency-key': `list-queries-${String(calls)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
};

/** A published template with `count` cases, each holding an inquiry, a comment and an attachment. */
async function templateWithCases(key: string, count: number): Promise<string> {
  const created = await call('POST', '/case-templates', {
    data: { attributes: { name: `Synthetic ${key}`, key } },
  });
  expect(created.statusCode, created.body).toBe(201);
  const template = JSON.parse(created.body) as {
    data: { id: string; relationships: Record<string, { data: { id: string } }> };
  };
  const draft = template.data.relationships['draft-version']?.data.id ?? '';
  const published = await call('POST', `/case-template-versions/${draft}/publish`, { meta: {} });
  expect(published.statusCode, published.body).toBe(200);
  for (let index = 0; index < count; index += 1) {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const made = await call('POST', '/cases', {
      data: { attributes: { 'case-template-id': template.data.id, tags: ['synthetic'] } },
      meta: { 'object-ids': [inquiry.id, inquiry.accountId] },
    });
    expect(made.statusCode, made.body).toBe(201);
    const caseId = (JSON.parse(made.body) as { data: { id: string } }).data.id;
    await call('POST', `/cases/${caseId}/add-comment`, { meta: { message: 'Synthetic note' } });
    await seedCaseAttachment(api.database.db, api.environmentId, { caseId });
  }
  return template.data.id;
}

/** The queries the database client ran while `run` did. */
async function queriesOf(run: () => Promise<unknown>): Promise<number> {
  const spy = vi.spyOn(api.database.client, 'query');
  try {
    await run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

interface Page {
  data: { id: string }[];
}

describe('a page of cases is read in a fixed number of queries (K8-30)', () => {
  it('GET /cases', async () => {
    const page = (templateId: string) => async () => {
      const response = await call('GET', `/cases?filter[case-template-id]=${templateId}&page[size]=10`);
      expect(response.statusCode, response.body).toBe(200);
      return JSON.parse(response.body) as Page;
    };

    const few = await queriesOf(page(small));
    const many = await queriesOf(page(large));

    expect(many).toBe(few);
  });

  it('POST /cases/search', async () => {
    const search = (templateId: string) => async () => {
      const response = await call('POST', '/cases/search', {
        query: { attribute: 'case_template_id', operator: 'eq', value: templateId },
        page: { size: 10 },
      });
      expect(response.statusCode, response.body).toBe(200);
    };

    const few = await queriesOf(search(small));
    const many = await queriesOf(search(large));

    expect(many).toBe(few);
  });

  it('serves each case of a page as GET /cases/:id does', async () => {
    const listed = JSON.parse(
      (await call('GET', `/cases?filter[case-template-id]=${large}&page[size]=10`)).body,
    ) as Page;
    const searched = JSON.parse(
      (
        await call('POST', '/cases/search', {
          query: { attribute: 'case_template_id', operator: 'eq', value: large },
          page: { size: 10 },
        })
      ).body,
    ) as Page;

    expect(listed.data).toHaveLength(8);
    for (const item of [...listed.data, ...searched.data]) {
      const one = JSON.parse((await call('GET', `/cases/${item.id}`)).body) as { data: unknown };
      expect(item).toEqual(one.data);
    }
  });
});
