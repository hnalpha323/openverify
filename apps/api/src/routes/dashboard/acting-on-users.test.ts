/**
 * C168.1, C168.3 (Phase 9, Workflow 9B; decisions 46, 47 and 70, reviews P02, V05): acting on
 * another user.
 *
 * - The actor holds a superset of the target's permissions in every environment the target can
 *   enter (403 `user_more_privileged`): reactivation, deactivation, the MFA reset, a resend.
 * - The reset and the reactivation need a factor verified on the actor's session within ten minutes
 *   (403 `step_up_required`), so an operator with no factor can do neither; deactivation needs it
 *   only from an actor with an enrolled factor, and stays the emergency control otherwise.
 * - `POST /users/:id/reactivate`: a deactivated user gets a new invitation and keeps its history,
 *   with no role back.
 * - `POST /users/:id/reset-mfa`: never on oneself; removes the factors and recovery codes, revokes
 *   every session and, with a mailer, sends a notice holding a link only.
 * - `POST /invitations/:id/resend`: a new token, the old one revoked, 7 days.
 * - Each is audited in every environment of the organisation.
 *
 * Every value is synthetic.
 */
import {
  INVITATION_TOKEN_TTL_SECONDS,
  STEP_UP_WINDOW_SECONDS,
  dashboardInvitationResponseSchema,
  newId,
  userDocumentSchema,
} from '@openverify/contracts';
import {
  createRole,
  getUser,
  listMfaFactors,
  listUnusedRecoveryCodes,
  listUserRoleAssignments,
  setUserRoleAssignments,
  userSessions,
  type Role,
} from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { invitationTokenFromUrl } from '../../mail/index.js';
import { totpCode } from '../../operator-auth/totp.js';
import {
  PASSWORD,
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

const ELEVEN_MINUTES = (STEP_UP_WINDOW_SECONDS + 60) * 1000;

async function harness(options?: Parameters<typeof createDashboardHarness>[1]) {
  const api = await createDashboardHarness(database, options);
  harnesses.push(api);
  const organization = await api.organization({ production: true });
  return { api, organization };
}

/** Enrols a TOTP factor on `token`'s session, which counts as a factor check (C168.1). */
async function enrolTotp(api: DashboardHarness, token: string): Promise<string> {
  const enrolment = expectJson<{ data: { id: string }; meta: { secret: string } }>(
    await api.call('POST', '/me/mfa-factors/totp', { token, payload: {} }),
    201,
  );
  expectJson(
    await api.call('POST', '/me/mfa-factors/totp/confirm', {
      token,
      payload: {
        'factor-id': enrolment.data.id,
        'totp-code': totpCode(enrolment.meta.secret, api.clock.now()),
      },
    }),
    200,
  );
  return enrolment.meta.secret;
}

/** An admin with a factor, signed in and stepped up just now. */
async function steppedUpAdmin(api: DashboardHarness, organization: TestOrganization) {
  const admin = await api.operator(organization, { roles: ['admin'] });
  const token = await api.signIn(admin.email);
  const secret = await enrolTotp(api, token);
  return { ...admin, token, secret };
}

const role = (organization: TestOrganization, permissions: string[]): Promise<Role> =>
  createRole(database.db, organization.id, {
    id: newId('role'),
    name: `Synthetic ${newId('role')}`,
    permissions,
  });

const deactivate = (api: DashboardHarness, token: string, userId: string) =>
  api.call('PATCH', `/users/${userId}`, {
    token,
    payload: { data: { attributes: { status: 'deactivated' } } },
  });

const post = (api: DashboardHarness, token: string, path: string) =>
  api.call('POST', path, { token, payload: {} });

describe('POST /users/:id/reset-mfa (C168.3)', () => {
  it('removes the factors and recovery codes, revokes every session, audits everywhere and sends a link-only notice', async () => {
    const { api, organization } = await harness();
    const admin = await steppedUpAdmin(api, organization);
    const target = await api.operator(organization, { roles: ['viewer'] });
    const targetToken = await api.signIn(target.email);
    await enrolTotp(api, targetToken);
    const sent = api.mailer.messages.length;

    const response = await post(api, admin.token, `/users/${target.user.id}/reset-mfa`);

    const body = userDocumentSchema.parse(expectJson(response, 200));
    expect(body.data.id).toBe(target.user.id);
    expect(await listMfaFactors(database.db, organization.id, target.user.id)).toEqual([]);
    expect(await listUnusedRecoveryCodes(database.db, organization.id, target.user.id)).toEqual([]);
    const sessions = await database.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, target.user.id));
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
    expect((await api.call('GET', '/me', { token: targetToken })).statusCode).toBe(401);
    for (const environmentId of [organization.sandboxId, organization.productionId ?? '']) {
      const [entry] = await api.audit(environmentId, 'user.mfa-reset');
      expect(entry, environmentId).toMatchObject({
        resourceId: target.user.id,
        metadata: { 'factors-removed': 1, 'sessions-revoked': 1 },
      });
    }
    const notices = api.mailer.messages.slice(sent);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.to).toEqual({ address: target.email });
    expect(notices[0]?.text).toContain('http://localhost:3001/login');
    expect(notices[0]?.text).not.toMatch(/ov[a-z]_/);
    const [notified] = await api.audit(organization.sandboxId, 'user.mfa-reset-notified');
    expect(notified).toMatchObject({ metadata: { outcome: 'sent' } });
  });

  it('is never on oneself (409)', async () => {
    const { api, organization } = await harness();
    const admin = await steppedUpAdmin(api, organization);

    const response = await post(api, admin.token, `/users/${admin.user.id}/reset-mfa`);

    expect(response.statusCode, response.body).toBe(409);
    expect(await listMfaFactors(database.db, organization.id, admin.user.id)).toHaveLength(1);
  });

  it('needs a factor verified within ten minutes (403 step_up_required), and an operator with none cannot reset', async () => {
    const { api, organization } = await harness();
    const admin = await steppedUpAdmin(api, organization);
    const noFactor = await api.operator(organization, { roles: ['admin'] });
    const noFactorToken = await api.signIn(noFactor.email);
    const target = await api.operator(organization, { roles: ['viewer'] });
    api.clock.advance(ELEVEN_MINUTES);

    const stale = await post(api, admin.token, `/users/${target.user.id}/reset-mfa`);
    const none = await post(api, noFactorToken, `/users/${target.user.id}/reset-mfa`);
    expectJson(
      await api.call('POST', '/sessions/current/step-up', {
        token: admin.token,
        payload: { 'totp-code': totpCode(admin.secret, api.clock.now()) },
      }),
      200,
    );
    const fresh = await post(api, admin.token, `/users/${target.user.id}/reset-mfa`);

    for (const refused of [stale, none]) {
      expect(refused.statusCode, refused.body).toBe(403);
      expect(refused.json()).toMatchObject({ code: 'step_up_required' });
    }
    expect(fresh.statusCode, fresh.body).toBe(200);
  });

  it('needs a superset of the target’s permissions in every environment it can enter (403 user_more_privileged)', async () => {
    const { api, organization } = await harness();
    const users = await role(organization, ['users:read', 'users:write', 'inquiries:read']);
    const exporter = await role(organization, ['inquiries:export', 'environments:production']);
    const actor = await api.operator(organization, { roles: [] });
    await setUserRoleAssignments(database.db, organization.id, actor.user.id, [
      { roleId: users.id, environmentIds: null },
      { roleId: exporter.id, environmentIds: [organization.sandboxId] },
    ]);
    const actorToken = await api.signIn(actor.email);
    await enrolTotp(api, actorToken);
    const target = await api.operator(organization, { roles: [] });
    await setUserRoleAssignments(database.db, organization.id, target.user.id, [
      { roleId: exporter.id, environmentIds: [organization.productionId ?? ''] },
    ]);
    const sandboxOnly = await api.operator(organization, { roles: [] });
    await setUserRoleAssignments(database.db, organization.id, sandboxOnly.user.id, [
      { roleId: exporter.id, environmentIds: [organization.sandboxId] },
    ]);

    const refused = await post(api, actorToken, `/users/${target.user.id}/reset-mfa`);
    const allowed = await post(api, actorToken, `/users/${sandboxOnly.user.id}/reset-mfa`);

    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'user_more_privileged' });
    expect(allowed.statusCode, allowed.body).toBe(200);
  });

  it('records a notice it could not send, and still resets', async () => {
    const { api, organization } = await harness({ dashboardPublicUrl: null });
    const admin = await steppedUpAdmin(api, organization);
    const target = await api.operator(organization, { roles: ['viewer'] });

    expectJson(await post(api, admin.token, `/users/${target.user.id}/reset-mfa`), 200);

    const [notified] = await api.audit(organization.sandboxId, 'user.mfa-reset-notified');
    expect(notified).toMatchObject({ metadata: { outcome: 'not-configured' } });
  });
});

describe('POST /users/:id/reactivate (C168.1)', () => {
  it('sends a deactivated user a new invitation, keeps its history and gives no role back', async () => {
    const { api, organization } = await harness();
    const admin = await steppedUpAdmin(api, organization);
    const target = await api.operator(organization, { roles: ['reviewer'] });
    expectJson(await deactivate(api, admin.token, target.user.id), 200);
    const sent = api.mailer.messages.length;

    const response = await post(api, admin.token, `/users/${target.user.id}/reactivate`);

    const body = userDocumentSchema.parse(expectJson(response, 200));
    expect(body.data).toMatchObject({ id: target.user.id, attributes: { status: 'invited' } });
    expect(await listUserRoleAssignments(database.db, organization.id, target.user.id)).toEqual([]);
    const [message] = api.mailer.messages.slice(sent);
    expect(message?.to).toEqual({ address: target.email });
    const link = /https?:\/\/\S+accept-invitation#token=\S+/.exec(message?.text ?? '')?.[0] ?? '';
    const token = invitationTokenFromUrl(link) ?? '';
    // The old password no longer signs in; the invitation sets a new one.
    expect(
      (
        await api.call('POST', '/sessions', {
          payload: { email: target.email, password: PASSWORD },
        })
      ).statusCode,
    ).toBe(401);
    expectJson(
      await api.call('POST', '/invitations/accept', {
        payload: { token, name: 'Synthetic Returner', password: 'another synthetic password' },
      }),
      200,
    );
    expect((await getUser(database.db, organization.id, target.user.id))?.status).toBe('active');
    for (const environmentId of [organization.sandboxId, organization.productionId ?? '']) {
      expect(await api.audit(environmentId, 'user.reactivated'), environmentId).toHaveLength(1);
    }
  });

  it('answers 409 for a user who is not deactivated, and needs the step-up', async () => {
    const { api, organization } = await harness();
    const admin = await steppedUpAdmin(api, organization);
    const active = await api.operator(organization, { roles: ['viewer'] });
    const target = await api.operator(organization, { roles: ['viewer'] });
    expectJson(await deactivate(api, admin.token, target.user.id), 200);

    const notDeactivated = await post(api, admin.token, `/users/${active.user.id}/reactivate`);
    api.clock.advance(ELEVEN_MINUTES);
    const stale = await post(api, admin.token, `/users/${target.user.id}/reactivate`);

    expect(notDeactivated.statusCode, notDeactivated.body).toBe(409);
    expect(stale.statusCode, stale.body).toBe(403);
    expect(stale.json()).toMatchObject({ code: 'step_up_required' });
  });
});

describe('deactivation (C168.1; V05)', () => {
  it('needs the step-up only from an actor with an enrolled factor', async () => {
    const { api, organization } = await harness();
    const withFactor = await steppedUpAdmin(api, organization);
    const withoutFactor = await api.operator(organization, { roles: ['admin'] });
    const withoutToken = await api.signIn(withoutFactor.email);
    const first = await api.operator(organization, { roles: ['viewer'] });
    const second = await api.operator(organization, { roles: ['viewer'] });
    api.clock.advance(ELEVEN_MINUTES);

    const stale = await deactivate(api, withFactor.token, first.user.id);
    const noFactor = await deactivate(api, withoutToken, second.user.id);

    expect(stale.statusCode, stale.body).toBe(403);
    expect(stale.json()).toMatchObject({ code: 'step_up_required' });
    expect(noFactor.statusCode, noFactor.body).toBe(200);
  });

  it('needs a superset of the target’s permissions where it can enter (403 user_more_privileged)', async () => {
    const { api, organization } = await harness();
    const users = await role(organization, ['users:read', 'users:write', 'inquiries:read']);
    const exporter = await role(organization, ['inquiries:export', 'environments:production']);
    const actor = await api.operator(organization, { roles: [] });
    await setUserRoleAssignments(database.db, organization.id, actor.user.id, [
      { roleId: users.id, environmentIds: null },
      { roleId: exporter.id, environmentIds: [organization.sandboxId] },
    ]);
    const actorToken = await api.signIn(actor.email);
    const target = await api.operator(organization, { roles: [] });
    await setUserRoleAssignments(database.db, organization.id, target.user.id, [
      { roleId: exporter.id, environmentIds: [organization.productionId ?? ''] },
    ]);

    const response = await deactivate(api, actorToken, target.user.id);

    expect(response.statusCode, response.body).toBe(403);
    expect(response.json()).toMatchObject({ code: 'user_more_privileged' });
  });
});

describe('POST /invitations/:id/resend (C168.1)', () => {
  it('sends a new 7 day token, revokes the old one, and audits everywhere', async () => {
    const { api, organization } = await harness();
    const admin = await api.operator(organization, { roles: ['admin'] });
    const token = await api.signIn(admin.email);
    const email = `resent-${newId('usr').slice(-6).toLowerCase()}@example.test`;
    expectJson(
      await api.call('POST', '/users/invitations', {
        token,
        payload: { email, 'role-ids': [organization.roleIds.viewer] },
      }),
      201,
    );
    const tokenOf = (index: number) => {
      const link =
        /https?:\/\/\S+accept-invitation#token=\S+/.exec(
          api.mailer.messages.at(index)?.text ?? '',
        )?.[0] ?? '';
      return invitationTokenFromUrl(link) ?? '';
    };
    const old = tokenOf(-1);
    const invited =
      (
        await database.client.query<{ id: string }>('select id from users where email = $1', [
          email,
        ])
      ).rows[0]?.id ?? '';

    const response = await post(api, token, `/invitations/${invited}/resend`);

    const body = dashboardInvitationResponseSchema.parse(expectJson(response, 201));
    expect(body).toEqual({
      email,
      'role-ids': [organization.roleIds.viewer],
      'expires-at': new Date(
        api.clock.now().getTime() + INVITATION_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
    });
    const fresh = tokenOf(-1);
    expect(fresh).not.toBe(old);
    const accept = (value: string) =>
      api.call('POST', '/invitations/accept', {
        payload: { token: value, name: 'Synthetic Invitee', password: 'a synthetic password' },
      });
    expect((await accept(old)).statusCode).toBe(404);
    expect((await accept(fresh)).statusCode).toBe(200);
    for (const environmentId of [organization.sandboxId, organization.productionId ?? '']) {
      expect(await api.audit(environmentId, 'user.invitation-resent'), environmentId).toHaveLength(
        1,
      );
    }
  });

  it('answers 409 for a user who is not invited and 404 for an unknown one', async () => {
    const { api, organization } = await harness();
    const admin = await api.operator(organization, { roles: ['admin'] });
    const token = await api.signIn(admin.email);

    expect((await post(api, token, `/invitations/${admin.user.id}/resend`)).statusCode).toBe(409);
    expect((await post(api, token, `/invitations/${newId('usr')}/resend`)).statusCode).toBe(404);
  });
});
