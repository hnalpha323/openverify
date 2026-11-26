/**
 * C248.8 (Workflow 11B, `sso-oidc`; Stage 1a amendments 10 and 39): the organisation setting
 * `organization-slug`, the console's "sign-in name", is stored and served by `PATCH` and `GET
 * /dashboard/settings`, cleared with `null`, refused with 409 `organization_slug_taken` while
 * another organisation holds it (nothing written), audited in every environment, and changed only
 * through an organisation-wide `settings:write`. Synthetic operators only.
 */
import { problemSchema } from '@openverify/contracts';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
} from './dashboard.test-support.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function admin(api: DashboardHarness) {
  const organization = await api.organization({ production: true });
  const { email } = await api.operator(organization);
  return { organization, token: await api.signIn(email) };
}

function slug(): string {
  counter += 1;
  return `synthetic-name-${String(counter)}`;
}

describe('the sign-in name (C248.8)', () => {
  it('is stored, served, audited in every environment and cleared with null', async () => {
    const api = await harness();
    const { organization, token } = await admin(api);
    const name = slug();

    const set = expectJson<{ 'organization-slug': string | null }>(
      await api.call('PATCH', '/settings', { token, payload: { 'organization-slug': name } }),
      200,
    );
    expect(set['organization-slug']).toBe(name);
    expect(
      expectJson<{ 'organization-slug': string | null }>(
        await api.call('GET', '/settings', { token }),
        200,
      )['organization-slug'],
    ).toBe(name);
    for (const environmentId of [organization.sandboxId, organization.productionId ?? '']) {
      const entries = await api.audit(environmentId, 'settings.updated');
      expect(entries.map((entry) => entry.metadata)).toContainEqual(
        expect.objectContaining({ 'organization-slug': name }),
      );
    }

    const cleared = expectJson<{ 'organization-slug': string | null }>(
      await api.call('PATCH', '/settings', { token, payload: { 'organization-slug': null } }),
      200,
    );
    expect(cleared['organization-slug']).toBeNull();
  });

  it('answers 409 organization_slug_taken while another organisation holds the name, writing nothing', async () => {
    const api = await harness();
    const first = await admin(api);
    const second = await admin(api);
    const name = slug();
    expectJson(
      await api.call('PATCH', '/settings', {
        token: first.token,
        payload: { 'organization-slug': name },
      }),
      200,
    );

    const taken = await api.call('PATCH', '/settings', {
      token: second.token,
      payload: { 'organization-slug': name, 'require-mfa': true },
    });

    expect(taken.statusCode).toBe(409);
    expect(problemSchema.parse(taken.json())).toMatchObject({
      code: 'organization_slug_taken',
      detail: 'Another organization already uses this sign-in name.',
    });
    const after = expectJson<{ 'organization-slug': string | null; 'require-mfa': boolean }>(
      await api.call('GET', '/settings', { token: second.token }),
      200,
    );
    expect(after).toMatchObject({ 'organization-slug': null, 'require-mfa': false });
  });
});

async function harness() {
  const created = await createDashboardHarness(database);
  harnesses.push(created);
  return created;
}
