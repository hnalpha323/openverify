/**
 * C245.3 (Phase 11, Workflow 11B, auth-sessions; Stage 1a amendment 40):
 * `POST /api/v1/dashboard/users/:id/end-sessions` ends every live console session of another user
 * (`users:write`, C168.1's superset rule), audited as `user.sessions-ended` in every environment;
 * never on oneself (409: the caller uses `POST /sessions/revoke-others`); the one 404 for a user of
 * another organisation. Every value is synthetic.
 */
import {
  ACCESS_11B_AUDIT_ACTIONS,
  endUserSessionsResponseSchema,
  newId,
} from '@openverify/contracts';
import { createRole } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
  type TestOrganization,
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

async function harness() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization({ production: true });
  const admin = await api.operator(organization, { roles: ['admin'] });
  const adminToken = await api.signIn(admin.email);
  return { api, organization, admin, adminToken };
}

const endSessions = (api: DashboardHarness, token: string, userId: string) =>
  api.call('POST', `/users/${userId}/end-sessions`, { token, payload: {} });

const me = (api: DashboardHarness, token: string) => api.call('GET', '/me', { token });

describe('POST /dashboard/users/:id/end-sessions (C245.3)', () => {
  it('revokes every live session of the user, answers how many, and audits it in every environment', async () => {
    const { api, organization, admin, adminToken } = await harness();
    const target = await api.operator(organization, { roles: ['developer'] });
    const first = await api.signIn(target.email);
    const second = await api.signIn(target.email);
    expect((await me(api, first)).statusCode).toBe(200);

    const body = expectJson(await endSessions(api, adminToken, target.user.id), 200);

    expect(endUserSessionsResponseSchema.parse(body)).toEqual({ 'sessions-ended': 2 });
    expect((await me(api, first)).statusCode).toBe(401);
    expect((await me(api, second)).statusCode).toBe(401);
    expect((await me(api, adminToken)).statusCode).toBe(200);
    for (const environmentId of [organization.sandboxId, organization.productionId ?? '']) {
      const entries = await api.audit(environmentId, ACCESS_11B_AUDIT_ACTIONS.sessionsEnded);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorType: 'user',
        actorId: admin.user.id,
        resourceType: 'user',
        resourceId: target.user.id,
        metadata: { 'sessions-ended': 2 },
      });
    }
  });

  it('answers 0 for a user without a live session, and audits that too', async () => {
    const { api, organization, adminToken } = await harness();
    const target = await api.operator(organization, { roles: ['viewer'] });

    expect(expectJson(await endSessions(api, adminToken, target.user.id), 200)).toEqual({
      'sessions-ended': 0,
    });
    expect(
      await api.audit(organization.sandboxId, ACCESS_11B_AUDIT_ACTIONS.sessionsEnded),
    ).toHaveLength(1);
  });

  it('refuses the operator’s own id with 409 and ends nothing', async () => {
    const { api, organization, admin, adminToken } = await harness();

    const response = await endSessions(api, adminToken, admin.user.id);

    expect(response.statusCode, response.body).toBe(409);
    expect((await me(api, adminToken)).statusCode).toBe(200);
    expect(await api.audit(organization.sandboxId, ACCESS_11B_AUDIT_ACTIONS.sessionsEnded)).toEqual(
      [],
    );
  });

  it('needs users:write', async () => {
    const { api, organization } = await harness();
    const developer = await api.operator(organization, { roles: ['developer'] });
    const token = await api.signIn(developer.email);
    const target = await api.operator(organization, { roles: ['viewer'] });
    const targetToken = await api.signIn(target.email);

    const response = await endSessions(api, token, target.user.id);

    expect(response.statusCode, response.body).toBe(403);
    expect((await me(api, targetToken)).statusCode).toBe(200);
  });

  it('refuses with 403 user_more_privileged when the target holds what the operator does not', async () => {
    const { api, organization, admin } = await harness();
    const manager = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: `Synthetic ${newId('role')}`,
      permissions: ['users:read', 'users:write'],
    });
    const operator = await api.operator(organization, { roles: [], roleIds: [manager.id] });
    const token = await api.signIn(operator.email);
    const adminSession = await api.signIn(admin.email);

    const response = await endSessions(api, token, admin.user.id);

    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({ code: 'user_more_privileged' });
    expect((await me(api, adminSession)).statusCode).toBe(200);
  });

  it('answers 404 for a user of another organisation or none, ending nothing', async () => {
    const { api, adminToken } = await harness();
    const elsewhere: TestOrganization = await api.organization();
    const stranger = await api.operator(elsewhere, { roles: ['viewer'] });
    const strangerToken = await api.signIn(stranger.email);

    const foreign = await endSessions(api, adminToken, stranger.user.id);
    const unknown = await endSessions(api, adminToken, newId('usr'));

    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(unknown.statusCode, unknown.body).toBe(404);
    expect(foreign.json()).toMatchObject({ detail: unknown.json<{ detail: string }>().detail });
    expect((await me(api, strangerToken)).statusCode).toBe(200);
  });

  it('refuses a body with members', async () => {
    const { api, organization, adminToken } = await harness();
    const target = await api.operator(organization, { roles: ['viewer'] });

    const response = await api.call('POST', `/users/${target.user.id}/end-sessions`, {
      token: adminToken,
      payload: { reason: 'synthetic' },
    });

    expect(response.statusCode, response.body).toBe(400);
  });
});
