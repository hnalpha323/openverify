/**
 * Workflow 9B Stage 1b, checkpoint (X): the saved view routes `foundation-9b` freezes for
 * `api-exports` (C165.1, C165.2, C165.5; contracts B20): `GET` and `POST /dashboard/saved-views`,
 * `PATCH` and `DELETE /dashboard/saved-views/:id`, a user session and no permission (a view's list is
 * the owner's to check), with the contract's bodies, 501 until built, and listed in the OpenAPI
 * document.
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDashboardHarness, type DashboardHarness } from './dashboard.test-support.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function signedIn() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const operator = await api.operator(organization, { roles: ['viewer'] });
  return { api, token: await api.signIn(operator.email) };
}

const viewBody = (attributes: Record<string, unknown> = {}) => ({
  data: {
    type: 'saved-view',
    attributes: {
      list: 'inquiries',
      name: 'Completed this week',
      filters: { 'filter[status]': 'completed' },
      ...attributes,
    },
  },
});

describe('the saved view routes, frozen for api-exports (C165.1)', () => {
  it('answer a signed-in user once built (api-exports), and 401 without a session', async () => {
    const { api, token } = await signedIn();
    const id = newId('svw');

    const outcomes = [
      await api.call('GET', '/saved-views?filter[list]=inquiries', { token }),
      await api.call('POST', '/saved-views', { token, payload: viewBody() }),
      await api.call('PATCH', `/saved-views/${id}`, {
        token,
        payload: { data: { type: 'saved-view', attributes: { name: 'Renamed' } } },
      }),
      await api.call('DELETE', `/saved-views/${id}`, { token }),
      await api.call('GET', '/saved-views'),
    ];

    expect(outcomes.map((response) => response.statusCode)).toEqual([200, 201, 404, 404, 401]);
  });

  it('read the contract: a known list, a name, filters of the list, and something to change', async () => {
    const { api, token } = await signedIn();

    const outcomes = [
      await api.call('POST', '/saved-views', { token, payload: viewBody({ list: 'files' }) }),
      await api.call('POST', '/saved-views', { token, payload: viewBody({ name: '' }) }),
      await api.call('POST', '/saved-views', {
        token,
        payload: viewBody({ filters: { status: 'completed' } }),
      }),
      await api.call('PATCH', `/saved-views/${newId('svw')}`, {
        token,
        payload: { data: { type: 'saved-view', attributes: {} } },
      }),
      await api.call('GET', '/saved-views?filter[list]=files', { token }),
      await api.call('DELETE', `/saved-views/${newId('rbulk')}`, { token }),
    ];

    expect(outcomes.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400, 400]);
  });

  it('are listed in the OpenAPI document', async () => {
    const { api } = await signedIn();
    const { paths } = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    }>();

    expect(Object.keys(paths['/api/v1/dashboard/saved-views']?.get?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '401']),
    );
    expect(Object.keys(paths['/api/v1/dashboard/saved-views']?.post?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '422']),
    );
    expect(
      Object.keys(paths['/api/v1/dashboard/saved-views/{id}']?.patch?.responses ?? {}),
    ).toEqual(expect.arrayContaining(['200', '400', '401', '403', '404', '422']));
    expect(
      Object.keys(paths['/api/v1/dashboard/saved-views/{id}']?.delete?.responses ?? {}),
    ).toEqual(expect.arrayContaining(['204', '401', '403', '404']));
  });
});
