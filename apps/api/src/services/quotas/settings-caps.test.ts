/**
 * C251.2 (Workflow 11B, `quotas`; review P15; Stage 1a amendment 17, Stage 1b amendment 14): the
 * settings route holds every queue cap to the install ceiling (`OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX`,
 * 50 by default). A write above it answers C55.7's generic 422 with a pointer per refused cap and
 * changes nothing; a value stored above a ceiling lowered later is served clamped, never refused on
 * read. Phase 8's `workflow-in-flight-cap` is held to the same ceiling.
 */
import { getEnvironment, updateEnvironmentSettings } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
} from '../../routes/dashboard/dashboard.test-support.js';

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
  const organization = await api.organization({});
  const admin = await api.operator(organization, { roles: ['admin'] });
  const token = await api.signIn(admin.email);
  return { api, organization, token };
}

describe('PATCH /settings: the install ceiling (C251.2)', () => {
  it('refuses a queue cap above the ceiling with a pointer per cap, and changes nothing', async () => {
    const { api, organization, token } = await setup();
    const before = await getEnvironment(database.db, organization.sandboxId);

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: {
        'queue-in-flight-caps': { 'report-run': 51, 'case-bulk': 2, 'list-screen': 1000 },
        'workflow-in-flight-cap': 60,
        'account-export-ttl-days': 3,
      },
    });

    expect(response.statusCode, response.body).toBe(422);
    const problem = expectJson<{ detail: string; errors: { pointer: string; detail: string }[] }>(
      response,
      422,
    );
    expect(problem.detail).toBe(
      "A queue's in-flight cap is at most this installation's ceiling, 50.",
    );
    expect(problem.errors.map((error) => [error.pointer, error.detail])).toEqual([
      ['/queue-in-flight-caps/report-run', 'must be at most 50'],
      ['/queue-in-flight-caps/list-screen', 'must be at most 50'],
      ['/workflow-in-flight-cap', 'must be at most 50'],
    ]);
    const after = await getEnvironment(database.db, organization.sandboxId);
    expect(after?.settings).toEqual(before?.settings);
    expect(await api.audit(organization.sandboxId, 'settings.updated')).toEqual([]);
  });

  it('stores caps at or below the ceiling and audits them', async () => {
    const { api, organization, token } = await setup();
    const changes = { 'queue-in-flight-caps': { 'report-run': 50 }, 'workflow-in-flight-cap': 50 };

    expect(
      expectJson(await api.call('PATCH', '/settings', { token, payload: changes }), 200),
    ).toMatchObject(changes);
    const [entry] = await api.audit(organization.sandboxId, 'settings.updated');
    expect(entry?.metadata).toMatchObject(changes);
  });
});

describe('GET /settings: a stored cap above the ceiling (C251.2)', () => {
  it('is served clamped to the ceiling, never refused', async () => {
    const { api, organization, token } = await setup();
    await updateEnvironmentSettings(database.db, organization.sandboxId, {
      'queue-in-flight-caps': { 'report-run': 900, 'case-bulk': 7 },
      'workflow-in-flight-cap': 5000,
    });

    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'queue-in-flight-caps': { 'report-run': 50, 'case-bulk': 7 },
      'workflow-in-flight-cap': 50,
    });
  });
});
