/**
 * C165.1, C165.2, C165.5 (Workflow 9B, `api-exports`; decision 44; contracts B20): saved views on the
 * dashboard API, through their routes.
 *
 * - `POST` saves a view of a list the caller can read (403 otherwise), with filters its list takes
 *   (400 at each refused key) and no personal-data key (422 `saved_view_pii_filter`, the pointer
 *   naming the key and never its value), a transaction string field included.
 * - `GET` answers the caller's own views and the environment's shared ones of lists the caller can
 *   read; another environment's views are never listed.
 * - Only the owner changes or deletes a view (403), an unknown one is 404, and a view whose filter
 *   its list no longer accepts says so (`filters-valid`, `invalid-filters`).
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  type DashboardHarness,
  type TestOrganization,
} from '../../routes/dashboard/dashboard.test-support.js';

let database: TestDatabase;
let api: DashboardHarness;
let organization: TestOrganization;
let admin: string;
let viewer: string;
let developer: string;

beforeAll(async () => {
  database = await createTestDatabase();
  api = await createDashboardHarness(database);
  organization = await api.organization();
  admin = await api.signIn((await api.operator(organization, { roles: ['admin'] })).email);
  viewer = await api.signIn((await api.operator(organization, { roles: ['viewer'] })).email);
  developer = await api.signIn((await api.operator(organization, { roles: ['developer'] })).email);
}, 120_000);

afterAll(async () => {
  await api.close();
  await database.close();
});

interface View {
  id: string;
  attributes: Record<string, unknown>;
}

const viewBody = (attributes: Record<string, unknown> = {}) => ({
  data: {
    type: 'saved-view',
    attributes: {
      list: 'inquiries',
      name: 'Completed',
      filters: { 'filter[status]': 'completed' },
      ...attributes,
    },
  },
});

async function save(token: string, attributes: Record<string, unknown> = {}): Promise<View> {
  const response = await api.call('POST', '/saved-views', { token, payload: viewBody(attributes) });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ data: View }>().data;
}

async function listed(token: string, query = ''): Promise<View[]> {
  const response = await api.call('GET', `/saved-views${query}`, { token });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ data: View[] }>().data;
}

describe('saving a view (C165.1, C165.2)', () => {
  it('saves a view with its filters, columns and sort, owned by the caller', async () => {
    const view = await save(admin, {
      columns: ['status', 'created-at'],
      sort: '-created-at',
      shared: false,
    });

    expect(view.attributes).toMatchObject({
      list: 'inquiries',
      name: 'Completed',
      filters: { 'filter[status]': 'completed' },
      columns: ['status', 'created-at'],
      sort: '-created-at',
      shared: false,
      'filters-valid': true,
      'invalid-filters': [],
    });
    expect(view.attributes['owner-id']).toMatch(/^usr_/);
  });

  it('refuses a personal-data filter with saved_view_pii_filter, naming the key and never the value', async () => {
    const response = await api.call('POST', '/saved-views', {
      token: admin,
      payload: viewBody({ filters: { 'filter[reference-id]': 'synthetic-reference-9' } }),
    });

    expect(response.statusCode).toBe(422);
    const problem = response.json<{ code: string; errors: { pointer: string }[] }>();
    expect(problem.code).toBe('saved_view_pii_filter');
    expect(problem.errors.map(({ pointer }) => pointer)).toEqual([
      '/data/attributes/filters/filter[reference-id]',
    ]);
    expect(response.body).not.toContain('synthetic-reference-9');
  });

  it('refuses a transaction field filter on a string field as personal data', async () => {
    const typeId = newId('txntp');
    await database.db.execute(sql`insert into transaction_types (id, environment_id, name)
      values (${typeId}, ${organization.sandboxId}, 'Synthetic')`);
    await database.db.execute(sql`insert into transaction_type_versions
        (id, environment_id, transaction_type_id, version, field_schemas, statuses)
      values (${newId('txntpv')}, ${organization.sandboxId}, ${typeId}, 1,
        ${JSON.stringify([
          { type: 'string', key: 'channel', label: 'Channel' },
          { type: 'integer', key: 'amount', label: 'Amount' },
        ])}::jsonb, '{created}')`);

    const refused = await api.call('POST', '/saved-views', {
      token: admin,
      payload: viewBody({ list: 'transactions', filters: { 'filter[fields.channel]': 'web' } }),
    });
    const kept = await save(admin, {
      list: 'transactions',
      filters: { 'filter[fields.amount]': '42' },
    });

    expect(refused.statusCode).toBe(422);
    expect(refused.json<{ code: string }>().code).toBe('saved_view_pii_filter');
    expect(kept.attributes['filters-valid']).toBe(true);
  });

  it('refuses a filter its list does not take (400) and a list the caller cannot read (403)', async () => {
    const unknown = await api.call('POST', '/saved-views', {
      token: admin,
      payload: viewBody({ filters: { 'filter[colour]': 'blue' } }),
    });
    const unreadable = await api.call('POST', '/saved-views', {
      token: viewer,
      payload: viewBody({ list: 'api-logs', filters: {} }),
    });

    expect(unknown.statusCode).toBe(400);
    expect(unknown.json<{ errors: { pointer: string }[] }>().errors[0]?.pointer).toBe(
      '/data/attributes/filters/filter[colour]',
    );
    expect(unreadable.statusCode).toBe(403);
  });
});

describe('listing, sharing and changing views (C165.1, C165.5)', () => {
  it("lists the caller's own and the shared views of lists the caller can read", async () => {
    const own = await save(developer, { name: 'Mine', list: 'accounts', filters: {} });
    const shared = await save(admin, { name: 'Shared', shared: true });
    const hidden = await save(admin, { name: 'Private' });
    const sharedLogs = await save(admin, {
      name: 'Logs',
      list: 'api-logs',
      filters: {},
      shared: true,
    });

    const forViewer = (await listed(viewer)).map(({ id }) => id);
    const forDeveloper = (await listed(developer, '?filter[list]=accounts')).map(({ id }) => id);

    expect(forViewer).toContain(shared.id);
    expect(forViewer).not.toContain(hidden.id);
    expect(forViewer).not.toContain(sharedLogs.id);
    expect(forDeveloper).toEqual([own.id]);
  });

  it('lets only the owner change or delete a view; an unknown view is 404', async () => {
    const view = await save(admin, { name: 'Owned', shared: true });
    const rename = { data: { type: 'saved-view', attributes: { name: 'Renamed' } } };

    const byOther = await api.call('PATCH', `/saved-views/${view.id}`, {
      token: viewer,
      payload: rename,
    });
    const deleteByOther = await api.call('DELETE', `/saved-views/${view.id}`, { token: viewer });
    const byOwner = await api.call('PATCH', `/saved-views/${view.id}`, {
      token: admin,
      payload: rename,
    });
    const deleted = await api.call('DELETE', `/saved-views/${view.id}`, { token: admin });
    const gone = await api.call('DELETE', `/saved-views/${view.id}`, { token: admin });

    expect([byOther.statusCode, deleteByOther.statusCode]).toEqual([403, 403]);
    expect(byOwner.statusCode, byOwner.body).toBe(200);
    expect(byOwner.json<{ data: View }>().data.attributes.name).toBe('Renamed');
    expect([deleted.statusCode, gone.statusCode]).toEqual([204, 404]);
  });

  it('refuses a personal-data filter on a change too', async () => {
    const view = await save(admin, { name: 'To change' });

    const response = await api.call('PATCH', `/saved-views/${view.id}`, {
      token: admin,
      payload: {
        data: {
          type: 'saved-view',
          attributes: { filters: { 'filter[next-step-name]': 'address-step' } },
        },
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('says when its list no longer accepts a filter, naming the key', async () => {
    const view = await save(admin, { name: 'Will break' });
    await database.db.execute(sql`update saved_views
      set filters = '{"filter[status]": "completed", "filter[colour]": "blue"}'::jsonb
      where id = ${view.id}`);

    const read = (await listed(admin, '?filter[list]=inquiries')).find(({ id }) => id === view.id);

    expect(read?.attributes['filters-valid']).toBe(false);
    expect(read?.attributes['invalid-filters']).toEqual(['filter[colour]']);
  });
});
