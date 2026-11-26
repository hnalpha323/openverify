/**
 * C232.1, C241.3 (Workflow 11A Stage 1a, common): Connect's two environment settings on the C16
 * settings route. Each is served with its default, set on the environment and audited as every
 * change is; the bounds are the contract's (400 outside them).
 *
 * C231.10 (Workflow 11A Stage 1a (C); decision 71): the organisation setting `connect-inbound`,
 * stored where `require-mfa` is (on the organisation), off by default, audited, and changed only
 * through an organisation-wide `settings:write` (C167.2's `SETTING_LEVEL`).
 */
import { newId } from '@openverify/contracts';
import { createRole, getOrganization, setUserRoleAssignments } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
} from './dashboard.test-support.js';

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

/** The organisation's stored `connect-inbound`, read past the typed row. */
async function inbound(organizationId: string): Promise<unknown> {
  const row: Readonly<Record<string, unknown>> | null = await getOrganization(
    database.db,
    organizationId,
  );
  return row?.connectInbound;
}

const DEFAULTS = { 'share-token-max-seconds': 1_814_400, 'consent-proof-retention-days': 0 };

describe("GET /settings: Connect's settings (C232.1, C241.3)", () => {
  it('serves a token lifetime of the public maximum and no consent proof kept', async () => {
    const { api, token } = await setup();

    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject(DEFAULTS);
  });
});

describe("PATCH /settings: Connect's settings (C232.1, C241.3)", () => {
  it('stores and serves each on the environment, and audits the change', async () => {
    const { api, organization, token } = await setup();
    const changes = { 'share-token-max-seconds': 86_400, 'consent-proof-retention-days': 2190 };

    const body = expectJson(await api.call('PATCH', '/settings', { token, payload: changes }), 200);

    expect(body).toMatchObject(changes);
    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject(changes);
    const [entry] = await api.audit(organization.sandboxId, 'settings.updated');
    expect(entry?.metadata).toMatchObject(changes);
  });

  it.each([
    ['share-token-max-seconds', 59],
    ['share-token-max-seconds', 1_814_401],
    ['consent-proof-retention-days', -1],
    ['consent-proof-retention-days', 3651],
  ] as const)('refuses %s of %d and changes nothing', async (key, value) => {
    const { api, token } = await setup();

    const response = await api.call('PATCH', '/settings', { token, payload: { [key]: value } });

    expect(response.statusCode, response.body).toBe(400);
    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject(DEFAULTS);
  });
});

describe('connect-inbound, an organisation setting (C231.10)', () => {
  it('is off by default', async () => {
    const { api, token } = await setup();

    expect(expectJson(await api.call('GET', '/settings', { token }), 200)).toMatchObject({
      'connect-inbound': false,
    });
  });

  it('is stored on the organisation, served in each of its environments and audited', async () => {
    const api = await createDashboardHarness(database);
    harnesses.push(api);
    const organization = await api.organization({ production: true });
    const admin = await api.operator(organization, { roles: ['admin'] });
    const token = await api.signIn(admin.email);

    const body = expectJson(
      await api.call('PATCH', '/settings', { token, payload: { 'connect-inbound': true } }),
      200,
    );

    expect(body).toMatchObject({ 'connect-inbound': true });
    expect(await inbound(organization.id)).toBe(true);
    const [entry] = await api.audit(organization.sandboxId, 'settings.updated');
    expect(entry?.metadata).toMatchObject({ 'connect-inbound': true });
  });

  it('refuses a sandbox-only settings:write (403) and writes nothing', async () => {
    const api = await createDashboardHarness(database);
    harnesses.push(api);
    const organization = await api.organization({ production: true });
    const writer = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: `Synthetic settings ${newId('role')}`,
      permissions: ['settings:read', 'settings:write', 'inquiries:read'],
    });
    const operator = await api.operator(organization, { roles: [] });
    await setUserRoleAssignments(database.db, organization.id, operator.user.id, [
      { roleId: writer.id, environmentIds: [organization.sandboxId] },
    ]);
    const token = await api.signIn(operator.email);

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'connect-inbound': true },
    });

    expect(response.statusCode, response.body).toBe(403);
    expect(await inbound(organization.id)).toBe(false);
    expect(await api.audit(organization.sandboxId, 'settings.updated')).toEqual([]);
  });
});
