/**
 * C108, C92.4, C92.8 (Workflow 7A, integration-7a): the network sources page document is served on
 * the dashboard API. api-network built `networkSourceRoutes` and left it unregistered until its
 * schema moved into `@openverify/contracts` with the OpenAPI snapshot (Workflow 7A rule 1).
 */
import type { BuiltinRoleKey } from '@openverify/core';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadNetworkManifest } from '../../network/manifest.js';
import { reconcileNetworkSources } from '../../network/reconcile.js';
import { createDashboardHarness, type DashboardHarness } from './dashboard.test-support.js';
import { dashboardNetworkSourcesSchema } from './network-sources.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  await reconcileNetworkSources(database.db, {
    sourcesDisabled: [],
    sourcesEnabled: [],
    clock: { now: () => new Date('2026-10-20T06:00:00.000Z') },
  });
}, 120_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function signedIn(roles: BuiltinRoleKey[]) {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const operator = await api.operator(organization, { roles });
  return { api, token: await api.signIn(operator.email) };
}

describe('GET /api/v1/dashboard/network-sources (C108)', () => {
  it('needs an operator session', async () => {
    const { api } = await signedIn(['viewer']);

    expect((await api.call('GET', '/network-sources')).statusCode).toBe(401);
  });

  it('serves every manifest source to an operator with settings:read, in the frozen schema', async () => {
    const { api, token } = await signedIn(['viewer']);

    const response = await api.call('GET', '/network-sources', { token });

    expect(response.statusCode, response.body).toBe(200);
    const document = dashboardNetworkSourcesSchema.parse(response.json());
    expect(document.sources.map(({ id }) => id)).toEqual(
      loadNetworkManifest().sources.map(({ id }) => id),
    );
  });
});
