/**
 * Workflow 9A Stage 1b (T): the simulation preset routes (C156.4), frozen at 501 in
 * `routes/dashboard/simulation-presets.ts` by `foundation-9a`, are built (Workflow 9B,
 * `api-templates-carry`; their own tests are `simulation-presets.test.ts`): each answers an operator
 * and 401 to anyone else. Every value is synthetic.
 */
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

async function setup() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const admin = await api.operator(organization, { roles: ['admin'] });
  const token = await api.signIn(admin.email);
  return { api, token };
}

const PRESET = {
  data: {
    type: 'simulation-preset',
    attributes: { name: 'Synthetic pass', scope: { fields: { name_first: 'Robin' } } },
  },
};

describe('the simulation preset routes, built (C156.4)', () => {
  it('answers an operator on every route, no longer 501', async () => {
    const { api, token } = await setup();

    const list = await api.call('GET', '/simulation-presets', { token });
    const save = await api.call('POST', '/simulation-presets', { token, payload: PRESET });
    const remove = await api.call('DELETE', '/simulation-presets/ssp_01M5CJXHG07XPHF3HRM6NREDH8', {
      token,
    });

    expect([list.statusCode, save.statusCode, remove.statusCode]).toEqual([200, 201, 404]);
  });

  it('answers 401 without a session', async () => {
    const { api } = await setup();

    const response = await api.call('GET', '/simulation-presets');

    expect(response.statusCode).toBe(401);
  });
});
