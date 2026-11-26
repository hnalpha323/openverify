/**
 * C72.3 (Workflow 6A Stage 1b): the dashboard report routes and the watchlist sources page are
 * registered under `/api/v1/dashboard` with their frozen schemas, behind an operator session
 * (`reports:read`, `watchlists:read`; every built-in role holds both). Each answers 401 without a
 * session, 400 for an id or query its schema refuses, and 501 until its owner builds it:
 * `api-reports` the reports, `api-watchlists` the sources. Synthetic values only.
 */
import { testId, createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDashboardHarness, type DashboardHarness } from './dashboard.test-support.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function viewer() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const operator = await api.operator(await api.organization(), { roles: ['viewer'] });
  return { api, token: await api.signIn(operator.email) };
}

const ROUTES = ['/reports', `/reports/${testId('rep')}`, '/watchlist-sources'];

describe('the frozen dashboard report routes (C72.3)', () => {
  it.each(ROUTES)('GET %s needs an operator session', async (path) => {
    const { api } = await viewer();

    expect((await api.call('GET', path)).statusCode).toBe(401);
  });

  // Every route is built: the reports (api-reports, reports.test.ts) and the sources page
  // (api-watchlists, watchlist-sources.test.ts).

  it.each(['/reports/rep_not-an-id', '/reports?filter[has-match]=maybe'])(
    'GET %s refuses what its schema does not take',
    async (path) => {
      const { api, token } = await viewer();

      expect((await api.call('GET', path, { token })).statusCode).toBe(400);
    },
  );
});
