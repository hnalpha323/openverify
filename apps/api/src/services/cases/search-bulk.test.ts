/**
 * C137.2, C137.4 through the routes (Workflow 8B Stage 3, `api-cases`).
 *
 * - `POST /cases/search`: the public tree compiled into parameterised SQL over plaintext columns and
 *   the HMAC field index, read-after-write (decision 74), a template the reader may not see left
 *   out, a `fields.*` leaf only with PII visibility (403 naming `pii:view`, P25), the parser's
 *   refusals by pointer and never a value, sorted and paged both ways, under `case-search`.
 * - `POST /cases/bulk`: 202 with a pending action that its creator alone reads; the job applies each
 *   case through the single routes' services and records `applied`, `no_change` or `refused` with
 *   the refusal's code; assigning needs `cases:assign`; a search past 500 is `case_bulk_too_large`.
 *
 * Every value is synthetic.
 */
import { testId } from '@openverify/db/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../../test-support/harness.js';
import { processCaseBulkAction } from './bulk/process.js';

let api: TestApi;
let token: string;

beforeAll(async () => {
  api = await createTestApi();
  token = api.newUserToken(api.environmentId);
}, 120_000);

afterAll(async () => {
  await api.close();
});

let calls = 0;
const call = (method: 'GET' | 'POST', url: string, payload?: unknown, as = token) => {
  calls += 1;
  return api.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(as), 'idempotency-key': `search-${String(calls)}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
};

interface Resource {
  id: string;
  attributes: Record<string, unknown>;
  relationships: Record<string, { data: unknown }>;
}

let keys = 0;
async function template(attributes: Record<string, unknown> = {}) {
  keys += 1;
  const created = (
    await call('POST', '/case-templates', {
      data: { attributes: { name: 'Synthetic search', key: `SB${String(keys)}`, ...attributes } },
    })
  ).json<{ data: Resource }>().data;
  const draft = (created.relationships['draft-version']?.data as { id: string }).id;
  const published = await call('POST', `/case-template-versions/${draft}/publish`, { meta: {} });
  expect(published.statusCode, published.body).toBe(200);
  return created.id;
}

async function newCase(templateId: string, attributes: Record<string, unknown> = {}) {
  const response = await call('POST', '/cases', {
    data: { attributes: { 'case-template-id': templateId, ...attributes } },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: Resource }>().data;
}

const search = (payload: Record<string, unknown>, as = token) =>
  call('POST', '/cases/search', payload, as);

const ids = (response: LightMyRequestResponse) =>
  response.json<{ data: Resource[] }>().data.map(({ id }) => id);

const FIELDS = [
  { key: 'reference', label: 'Reference', type: 'string', config: { searchable: true } },
  { key: 'note', label: 'Note', type: 'string' },
];

describe('POST /cases/search (C137.2)', () => {
  it('finds a case by status, tag and a searchable field, read after write', async () => {
    const t = await template({ 'field-schemas': FIELDS });
    const hit = await newCase(t, { fields: { reference: 'ref-synthetic-a' }, tags: ['urgent'] });
    await newCase(t, { fields: { reference: 'ref-synthetic-b' } });

    const byField = await search({
      query: {
        and: [
          { attribute: 'case_template_id', operator: 'eq', value: t },
          { attribute: 'fields.reference', operator: 'eq', value: 'ref-synthetic-a' },
        ],
      },
    });
    expect(byField.statusCode, byField.body).toBe(200);
    expect(ids(byField)).toEqual([hit.id]);
    const byTag = await search({
      query: {
        and: [
          { attribute: 'template', operator: 'eq', value: 'Synthetic search' },
          { attribute: 'case_template_id', operator: 'eq', value: t },
          { attribute: 'tag_id', operator: 'eq', value: 'URGENT' },
        ],
      },
    });
    expect(ids(byTag)).toEqual([hit.id]);
    const notOpen = await search({
      query: {
        and: [
          { attribute: 'case_template_id', operator: 'eq', value: t },
          { not: { attribute: 'status', operator: 'eq', value: 'open' } },
        ],
      },
    });
    expect(ids(notOpen)).toEqual([]);
    const unresolved = await search({
      query: {
        and: [
          { attribute: 'case_template_id', operator: 'eq', value: t },
          { attribute: 'resolved_at', operator: 'eq', value: null },
          { attribute: 'created_at', operator: 'gte', value: '2000-01-01T00:00:00Z' },
        ],
      },
    });
    expect(ids(unresolved)).toHaveLength(2);
  });

  it('needs pii:view for a field leaf, and names refusals by pointer without the value', async () => {
    const t = await template({ 'field-schemas': FIELDS });
    const viewer = api.newUserToken(api.environmentId, { permissions: ['cases:read'] });

    const masked = await search(
      { query: { attribute: 'fields.reference', operator: 'eq', value: 'ref-secret-x' } },
      viewer,
    );
    expect(masked.statusCode).toBe(403);
    expect(masked.headers['www-authenticate']).toContain('pii:view');
    expect(masked.body).not.toContain('ref-secret-x');
    const unsearchable = await search({
      query: { attribute: 'fields.note', operator: 'eq', value: 'note-secret-y' },
    });
    expect(unsearchable.statusCode).toBe(422);
    expect(unsearchable.body).toContain('search_field_not_searchable');
    expect(unsearchable.body).not.toContain('note-secret-y');
    expect(t).toMatch(/^ctmpl_/);
  });

  it('sorts and pages both ways', async () => {
    const t = await template();
    const made = [await newCase(t), await newCase(t), await newCase(t)];
    for (const [index, item] of made.entries()) {
      await api.database.client.query('update cases set created_at = $1 where id = $2', [
        new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
        item.id,
      ]);
    }
    const query = { attribute: 'case_template_id', operator: 'eq', value: t };

    const first = (
      await search({
        query,
        sort: { attribute: 'created_at', direction: 'asc' },
        page: { size: 2 },
      })
    ).json<{ data: Resource[]; links: { next: string | null; prev: string | null } }>();
    expect(first.data.map(({ id }) => id)).toEqual([made[0]?.id, made[1]?.id]);
    expect(first.links.prev).toBeNull();
    const second = (
      await search({
        query,
        sort: { attribute: 'created_at', direction: 'asc' },
        page: { size: 2, after: first.links.next ?? undefined },
      })
    ).json<{ data: Resource[]; links: { next: string | null; prev: string | null } }>();
    expect(second.data.map(({ id }) => id)).toEqual([made[2]?.id]);
    expect(second.links.next).toBeNull();
    const back = (
      await search({
        query,
        sort: { attribute: 'created_at', direction: 'asc' },
        page: { size: 2, before: second.links.prev ?? undefined },
      })
    ).json<{ data: Resource[] }>();
    expect(back.data.map(({ id }) => id)).toEqual([made[0]?.id, made[1]?.id]);
    const newest = (await search({ query })).json<{ data: Resource[] }>();
    expect(newest.data.map(({ id }) => id)).toEqual([made[2]?.id, made[1]?.id, made[0]?.id]);
  });

  it('is limited by case-search per key', async () => {
    const refusing = vi.spyOn(api.deps.rateLimiter, 'consume').mockImplementation((key) =>
      Promise.resolve({
        allowed: !key.startsWith('case-search:'),
        limit: 120,
        remaining: 0,
        resetAt: new Date(),
        retryAfterSeconds: 30,
      }),
    );
    try {
      expect((await search({})).statusCode).toBe(429);
    } finally {
      refusing.mockRestore();
    }
  });
});

describe('POST /cases/bulk (C137.4)', () => {
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

  async function run(id: string) {
    await processCaseBulkAction(
      { environmentId: api.environmentId, bulkActionId: id },
      { db: api.database.db, logger, events: api.deps.events },
    );
  }

  it('applies each case through the single services, and only its creator reads it', async () => {
    const t = await template();
    const tagged = await newCase(t, { tags: ['bulk-tag'] });
    const plain = await newCase(t);
    const missing = testId('case');

    const created = await call('POST', '/cases/bulk', {
      data: { attributes: { action: 'add-tags', 'case-ids': [tagged.id, plain.id, missing] } },
      meta: { 'tag-names': ['bulk-tag'] },
    });
    expect(created.statusCode, created.body).toBe(202);
    const action = created.json<{ data: Resource }>().data;
    expect(action.attributes).toMatchObject({ status: 'pending', 'requested-count': 3 });

    await run(action.id);

    const read = (await call('GET', `/case-bulk-actions/${action.id}`)).json<{ data: Resource }>()
      .data;
    expect(read.attributes).toMatchObject({
      status: 'completed',
      'applied-count': 1,
      'no-change-count': 1,
      'refused-count': 1,
    });
    expect(read.attributes.outcomes).toEqual(
      expect.arrayContaining([
        { 'case-id': tagged.id, outcome: 'no_change', code: null },
        { 'case-id': plain.id, outcome: 'applied', code: null },
        { 'case-id': missing, outcome: 'refused', code: 'not_found' },
      ]),
    );
    const other = api.newUserToken(api.environmentId);
    expect(
      (await call('GET', `/case-bulk-actions/${action.id}`, undefined, other)).statusCode,
    ).toBe(404);
    await run(action.id);
  });

  it('sets a status per case and records the map’s refusals', async () => {
    const t = await template({
      transitions: {
        open: ['pending', 'declined'],
        pending: ['open', 'approved'],
        approved: [],
        declined: [],
      },
    });
    const one = await newCase(t);
    const created = await call('POST', '/cases/bulk', {
      data: { attributes: { action: 'set-status', 'case-ids': [one.id] } },
      meta: { status: 'approved' },
    });
    const action = created.json<{ data: Resource }>().data;

    await run(action.id);

    const read = (await call('GET', `/case-bulk-actions/${action.id}`)).json<{ data: Resource }>()
      .data;
    expect(read.attributes.outcomes).toEqual([
      { 'case-id': one.id, outcome: 'refused', code: 'case_transition_refused' },
    ]);
  });

  it('refuses assignment without cases:assign, and a search past 500', async () => {
    const t = await template();
    const writer = api.newUserToken(api.environmentId, {
      permissions: ['cases:read', 'cases:write'],
    });
    const assign = await call(
      'POST',
      '/cases/bulk',
      {
        data: { attributes: { action: 'assign', 'case-ids': [testId('case')] } },
        meta: { 'user-id': null },
      },
      writer,
    );
    expect(assign.statusCode).toBe(403);

    const seed = await newCase(t);
    await api.database.client.query(
      `insert into cases (id, environment_id, case_template_id, case_template_version_id, name,
         status, status_category, creator_type, creator_id, fields)
       select 'case_' || lpad(n::text, 26, '0'), environment_id, case_template_id,
         case_template_version_id, $2 || '-' || (n + 10), 'open', 'initial', 'user', creator_id,
         fields
       from generate_series(1, 501) n, (select * from cases where id = $1) c`,
      [seed.id, String(seed.attributes.name).split('-')[0]],
    );
    const tooMany = await call('POST', '/cases/bulk', {
      data: {
        attributes: {
          action: 'add-tags',
          search: { query: { attribute: 'case_template_id', operator: 'eq', value: t } },
        },
      },
      meta: { 'tag-names': ['x'] },
    });
    expect(tooMany.statusCode).toBe(422);
    expect(tooMany.json<{ code: string }>().code).toBe('case_bulk_too_large');
  });
});
