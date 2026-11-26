/**
 * C167.2 (Phase 9, Workflow 9B; verification round V14): an organisation setting (`SETTING_LEVEL`,
 * today `require-mfa`) changes only for a caller holding `settings:write` through an
 * organisation-wide assignment, while a `settings:write` held in one environment still changes that
 * environment's own settings. The refusal test of C167.2: a sandbox-only `settings:write` cannot
 * change `require-mfa`.
 *
 * Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import { createRole, getOrganization, setUserRoleAssignments } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
} from '../../routes/dashboard/dashboard.test-support.js';
import { assertSettingsLevelAllowed } from './settings-level.js';

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

/** An operator holding `settings:write` (and a read) through one assignment of `environmentIds`. */
async function settingsWriter(scope: 'sandbox' | 'organization') {
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
    {
      roleId: writer.id,
      environmentIds: scope === 'organization' ? null : [organization.sandboxId],
    },
  ]);
  return { api, organization, operator, token: await api.signIn(operator.email) };
}

describe('PATCH /settings and the organisation settings (C167.2; V14)', () => {
  it('refuses require-mfa to a sandbox-only settings:write (403), writing nothing', async () => {
    const { api, organization, token } = await settingsWriter('sandbox');

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'require-mfa': true, 'inquiry-retention-days': 365 },
    });

    expect(response.statusCode, response.body).toBe(403);
    expect(response.json<{ detail: string }>().detail).toContain('require-mfa');
    expect((await getOrganization(database.db, organization.id))?.requireMfa).toBe(false);
    expect(await api.audit(organization.sandboxId, 'settings.updated')).toEqual([]);
  });

  it('still lets a sandbox-only settings:write change the sandbox’s own settings', async () => {
    const { api, token } = await settingsWriter('sandbox');

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'inquiry-retention-days': 365 },
    });

    expect(response.statusCode, response.body).toBe(200);
  });

  it('lets an organisation-wide settings:write change require-mfa', async () => {
    const { api, organization, token } = await settingsWriter('organization');

    expectJson(
      await api.call('PATCH', '/settings', { token, payload: { 'require-mfa': true } }),
      200,
    );

    expect((await getOrganization(database.db, organization.id))?.requireMfa).toBe(true);
  });
});

describe('assertSettingsLevelAllowed', () => {
  it('refuses an organisation setting to an actor that is not a user, and accepts environment keys', async () => {
    const { organization } = await settingsWriter('organization');
    const check = (type: 'api-key' | 'user', keys: string[]) =>
      assertSettingsLevelAllowed(database.db, {
        organizationId: organization.id,
        environmentId: organization.sandboxId,
        actor: { type, id: type === 'user' ? newId('usr') : newId('key') },
        keys,
      });

    await expect(check('api-key', ['require-mfa'])).rejects.toMatchObject({ status: 403 });
    await expect(check('user', ['require-mfa'])).rejects.toMatchObject({ status: 403 });
    await expect(check('api-key', ['inquiry-retention-days'])).resolves.toBeUndefined();
  });
});

describe('an organisation setting is audited in every environment (C167.2; integration-9b)', () => {
  it('records require-mfa’s change in each environment, the environment’s own settings only in its own', async () => {
    const { api, organization, token } = await settingsWriter('organization');

    const response = await api.call('PATCH', '/settings', {
      token,
      payload: { 'require-mfa': true, 'inquiry-retention-days': 365 },
    });

    expect(response.statusCode, response.body).toBe(200);
    const metadataIn = async (environmentId: string | undefined) =>
      (await api.audit(environmentId ?? '', 'settings.updated')).map(({ metadata }) => metadata);
    expect(await metadataIn(organization.sandboxId)).toEqual([
      { 'require-mfa': true, 'inquiry-retention-days': 365 },
    ]);
    expect(await metadataIn(organization.productionId)).toEqual([{ 'require-mfa': true }]);
  });
});
