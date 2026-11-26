import {
  INVITATION_TOKEN_TTL_SECONDS,
  dashboardInvitationResponseSchema,
  newId,
  problemSchema,
  userDocumentSchema,
  userListDocumentSchema,
} from '@openverify/contracts';
import {
  confirmMfaFactor,
  createRole,
  createTotpFactor,
  getUser,
  listUserRoles,
  updateUser,
  userSessions,
} from '@openverify/db';
import { BUILTIN_ROLES } from '@openverify/core';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { invitationTokenFromUrl } from '../../mail/index.js';
import type { Mailer } from '../../ports.js';
import {
  DASHBOARD_URL,
  PASSWORD,
  createDashboardHarness,
  expectJson,
  type DashboardHarness,
  type TestOrganization,
} from './dashboard.test-support.js';

// Synthetic operators and addresses only.
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

async function setup(options?: Parameters<typeof createDashboardHarness>[1]) {
  const api = await createDashboardHarness(database, options);
  harnesses.push(api);
  const organization = await api.organization();
  const admin = await api.operator(organization, { roles: ['admin'] });
  const token = await api.signIn(admin.email);
  return { api, organization, admin, token };
}

const invite = (api: DashboardHarness, token: string, email: string, roleIds: string[]) =>
  api.call('POST', '/users/invitations', { token, payload: { email, 'role-ids': roleIds } });

/** The token of the last invitation email. */
function lastInvitationToken(api: DashboardHarness): string {
  const message = api.mailer.messages.at(-1);
  const link = /https?:\/\/\S+accept-invitation#token=\S+/.exec(message?.text ?? '')?.[0] ?? '';
  return invitationTokenFromUrl(link) ?? '';
}

describe('GET /users', () => {
  it('lists the organization’s users, newest first, with their roles', async () => {
    const { api, organization, admin, token } = await setup();
    const viewer = await api.operator(organization, { roles: ['viewer'] });
    await api.operator(await api.organization());

    const body = userListDocumentSchema.parse(
      expectJson(await api.call('GET', '/users', { token }), 200),
    );

    expect(body.data.map(({ id }) => id)).toEqual([viewer.user.id, admin.user.id]);
    expect(body.data[0]).toMatchObject({
      attributes: { email: viewer.email, status: 'active', name: null },
      relationships: { roles: { data: [{ type: 'role', id: organization.roleIds.viewer }] } },
    });
  });

  it('says which users have an active MFA factor; an unconfirmed one does not count (Workflow 2C)', async () => {
    const { api, organization, admin, token } = await setup();
    const enrolled = await api.operator(organization, { roles: ['viewer'] });
    const unconfirmed = await api.operator(organization, { roles: ['viewer'] });
    const secret = 'JBSWY3DPEHPK3PXP'; // the RFC 4648 example, not a real enrolment
    const factor = await createTotpFactor(database.db, organization.id, {
      id: newId('mfa'),
      userId: enrolled.user.id,
      name: 'Synthetic phone',
      secret,
    });
    await confirmMfaFactor(database.db, organization.id, factor.id, {});
    await createTotpFactor(database.db, organization.id, {
      id: newId('mfa'),
      userId: unconfirmed.user.id,
      name: 'Never confirmed',
      secret,
    });

    const body = userListDocumentSchema.parse(
      expectJson(await api.call('GET', '/users', { token }), 200),
    );

    expect(
      Object.fromEntries(body.data.map(({ id, attributes }) => [id, attributes['mfa-enabled']])),
    ).toEqual({
      [enrolled.user.id]: true,
      [unconfirmed.user.id]: false,
      [admin.user.id]: false,
    });
  });

  it('filters by status and pages', async () => {
    const { api, organization, token } = await setup();
    const deactivated = await api.operator(organization, { roles: ['viewer'] });
    await updateUser(database.db, organization.id, deactivated.user.id, { status: 'deactivated' });

    const filtered = userListDocumentSchema.parse(
      expectJson(await api.call('GET', '/users?filter[status]=deactivated', { token }), 200),
    );
    const page = userListDocumentSchema.parse(
      expectJson(await api.call('GET', '/users?page[size]=1', { token }), 200),
    );

    expect(filtered.data.map(({ id }) => id)).toEqual([deactivated.user.id]);
    expect(page.data).toHaveLength(1);
    expect(page.links.next).toContain('page[after]=');
  });

  it('needs users:read (403) and a session (401)', async () => {
    const { api, organization } = await setup();
    const developer = await api.operator(organization, { roles: ['developer'] });
    const token = await api.signIn(developer.email);

    const forbidden = await api.call('GET', '/users', { token });

    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ type: 'https://openverify.dev/problems/forbidden' });
    expect((await api.call('GET', '/users')).statusCode).toBe(401);
  });
});

describe('POST /users/invitations', () => {
  it('creates an invited user and emails a 7 day ovi_ link, never returning the token', async () => {
    const { api, organization, admin, token } = await setup();

    const response = await invite(api, token, 'New.Person@Example.test', [
      organization.roleIds.reviewer,
    ]);

    const body = dashboardInvitationResponseSchema.parse(expectJson(response, 201));
    expect(body).toEqual({
      email: 'new.person@example.test',
      'role-ids': [organization.roleIds.reviewer],
      'expires-at': new Date(
        api.clock.now().getTime() + INVITATION_TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
    });
    expect(response.body).not.toContain('ovi_');
    const [message] = api.mailer.messages;
    expect(message?.to).toEqual({ address: 'new.person@example.test' });
    expect(message?.text).toContain(`${DASHBOARD_URL}/accept-invitation#token=ovi_`);
    const users = userListDocumentSchema.parse(
      expectJson(await api.call('GET', '/users', { token }), 200),
    );
    expect(users.data[0]?.attributes).toMatchObject({
      email: 'new.person@example.test',
      status: 'invited',
    });
    const [entry] = await api.audit(organization.sandboxId, 'user.invited');
    expect(entry).toMatchObject({
      actorId: admin.user.id,
      resourceType: 'user',
      resourceId: users.data[0]?.id,
      metadata: { 'role-ids': [organization.roleIds.reviewer] },
    });
  });

  it('sends a fresh link to a user still invited, and refuses an existing user (409)', async () => {
    const { api, organization, admin, token } = await setup();
    expectJson(await invite(api, token, 'again@example.test', [organization.roleIds.viewer]), 201);
    const first = lastInvitationToken(api);

    expectJson(
      await invite(api, token, 'again@example.test', [organization.roleIds.developer]),
      201,
    );
    const existing = await invite(api, token, admin.email, [organization.roleIds.viewer]);

    expect(lastInvitationToken(api)).not.toBe(first);
    expect(existing.statusCode).toBe(409);
    const accepted = await api.call('POST', '/invitations/accept', {
      payload: { token: first, password: PASSWORD, name: 'Synthetic Invitee' },
    });
    expect(accepted.statusCode).toBe(404);
  });

  it('refuses unknown or foreign roles (422) and roles beyond the inviter’s own permissions (403)', async () => {
    const { api, organization } = await setup();
    const other = await api.organization();
    const manager = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic User Manager',
      permissions: ['users:read', 'users:write'],
    });
    const managerUser = await api.operator(organization, { roles: [], roleIds: [manager.id] });
    const managerToken = await api.signIn(managerUser.email);

    const foreign = await invite(api, managerToken, 'a@example.test', [other.roleIds.viewer]);
    const escalation = await invite(api, managerToken, 'b@example.test', [
      organization.roleIds.admin,
    ]);
    const allowed = await invite(api, managerToken, 'c@example.test', [manager.id]);

    expect(foreign.statusCode).toBe(422);
    expect(escalation.statusCode).toBe(403);
    expect(escalation.json()).toMatchObject({ type: 'https://openverify.dev/problems/forbidden' });
    expect(allowed.statusCode).toBe(201);
  });

  it('needs users:write', async () => {
    const { api, organization } = await setup();
    const viewer = await api.operator(organization, { roles: ['viewer'] });
    const token = await api.signIn(viewer.email);

    expect(
      (await invite(api, token, 'd@example.test', [organization.roleIds.viewer])).statusCode,
    ).toBe(403);
  });

  it('answers 503 without a dashboard URL or SMTP, and 502 when sending fails, creating nobody', async () => {
    const noUrl = await setup({ dashboardPublicUrl: null });
    const failing: Mailer = {
      configured: true,
      send: () => Promise.reject(new Error('synthetic SMTP failure')),
    };
    const broken = await setup({ mailer: failing });
    const { MailerNotConfiguredError } = await import('../../mail/index.js');
    const unconfigured = await setup({
      mailer: { configured: false, send: () => Promise.reject(new MailerNotConfiguredError()) },
    });

    const withoutUrl = await invite(noUrl.api, noUrl.token, 'e@example.test', [
      noUrl.organization.roleIds.viewer,
    ]);
    const sendFailure = await invite(broken.api, broken.token, 'f@example.test', [
      broken.organization.roleIds.viewer,
    ]);
    const withoutSmtp = await invite(unconfigured.api, unconfigured.token, 'g@example.test', [
      unconfigured.organization.roleIds.viewer,
    ]);

    expect(withoutUrl.statusCode).toBe(503);
    expect(problemSchema.parse(withoutUrl.json()).detail).toContain(
      'OPENVERIFY_DASHBOARD_PUBLIC_URL',
    );
    expect(sendFailure.statusCode).toBe(502);
    expect(withoutSmtp.statusCode).toBe(503);
    expect(problemSchema.parse(withoutSmtp.json()).detail).toContain('OPENVERIFY_SMTP_URL');
    for (const { api, token } of [noUrl, broken, unconfigured]) {
      const users = userListDocumentSchema.parse(
        expectJson(await api.call('GET', '/users', { token }), 200),
      );
      expect(users.data.map(({ attributes }) => attributes.status)).toEqual(['active']);
    }
  });
});

describe('POST /invitations/accept', () => {
  it('sets the name and password once, after which the user signs in', async () => {
    const { api, organization, token } = await setup();
    expectJson(
      await invite(api, token, 'invitee@example.test', [organization.roleIds.viewer]),
      201,
    );
    const invitation = lastInvitationToken(api);

    const response = await api.call('POST', '/invitations/accept', {
      payload: { token: invitation, password: PASSWORD, name: 'Synthetic Invitee' },
    });

    const body = userDocumentSchema.parse(expectJson(response, 200));
    expect(body.data.attributes).toMatchObject({ name: 'Synthetic Invitee', status: 'active' });
    const stored = await getUser(database.db, organization.id, body.data.id);
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await api.signIn('invitee@example.test')).toMatch(/^ovu_/);
    const [entry] = await api.audit(organization.sandboxId, 'user.invitation-accepted');
    expect(entry).toMatchObject({ actorId: body.data.id, resourceId: body.data.id });
    const reused = await api.call('POST', '/invitations/accept', {
      payload: { token: invitation, password: PASSWORD, name: 'Synthetic Invitee' },
    });
    expect(reused.statusCode).toBe(404);
  });

  it('answers 404 after 7 days, and 400 for a short password', async () => {
    const { api, organization, token } = await setup();
    expectJson(await invite(api, token, 'late@example.test', [organization.roleIds.viewer]), 201);
    const invitation = lastInvitationToken(api);

    const short = await api.call('POST', '/invitations/accept', {
      payload: { token: invitation, password: 'too short', name: 'Late' },
    });
    api.clock.advance(INVITATION_TOKEN_TTL_SECONDS * 1000);
    const late = await api.call('POST', '/invitations/accept', {
      payload: { token: invitation, password: PASSWORD, name: 'Late' },
    });

    expect(short.statusCode).toBe(400);
    expect(late.statusCode).toBe(404);
  });
});

describe('PATCH /users/:id', () => {
  const patch = (
    api: DashboardHarness,
    token: string,
    id: string,
    attributes: Record<string, unknown>,
  ) =>
    api.call('PATCH', `/users/${id}`, { token, payload: { data: { type: 'user', attributes } } });

  it('replaces the roles and audits the change', async () => {
    const { api, organization, admin, token } = await setup();
    const target = await api.operator(organization, { roles: ['viewer'] });

    const response = await patch(api, token, target.user.id, {
      'role-ids': [organization.roleIds.reviewer, organization.roleIds.developer],
    });

    const body = userDocumentSchema.parse(expectJson(response, 200));
    expect(body.data.relationships?.roles.data.map(({ id }) => id).sort()).toEqual(
      [organization.roleIds.reviewer, organization.roleIds.developer].sort(),
    );
    const [entry] = await api.audit(organization.sandboxId, 'user.updated');
    expect(entry).toMatchObject({ actorId: admin.user.id, resourceId: target.user.id });
  });

  it('deactivates a user, revoking their sessions, and never reactivates them through PATCH (AC2)', async () => {
    const { api, organization, token } = await setup();
    const target = await api.operator(organization, { roles: ['viewer'] });
    const targetToken = await api.signIn(target.email);

    expectJson(await patch(api, token, target.user.id, { status: 'deactivated' }), 200);

    expect((await api.call('GET', '/me', { token: targetToken })).statusCode).toBe(401);
    const sessions = await database.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, target.user.id));
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
    expect(
      (
        await api.call('POST', '/sessions', {
          payload: { email: target.email, password: PASSWORD },
        })
      ).statusCode,
    ).toBe(401);
    // Orchestrator decision AC2 before Workflow 9C: reactivation is POST /reactivate's (C168.1: a
    // new invitation, no role back); PATCH answers 422 at the status and changes nothing.
    const refused = await patch(api, token, target.user.id, { status: 'active' });
    expect(refused.statusCode).toBe(422);
    const problem = refused.json<{
      code: string;
      detail: string;
      errors: { location: string; pointer: string }[];
    }>();
    expect(problem.code).toBe('user_reactivation_required');
    expect(problem.detail).toContain('/reactivate');
    expect(problem.errors).toEqual([
      expect.objectContaining({ location: 'body', pointer: '/data/attributes/status' }),
    ]);
    expect((await getUser(database.db, organization.id, target.user.id))?.status).toBe(
      'deactivated',
    );
    expect(
      (
        await api.call('POST', '/sessions', {
          payload: { email: target.email, password: PASSWORD },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('refuses status active through PATCH with the role ids too, keeping the roles (AC2)', async () => {
    const { api, organization, token } = await setup();
    const target = await api.operator(organization, { roles: ['viewer'] });
    expectJson(await patch(api, token, target.user.id, { status: 'deactivated' }), 200);

    const refused = await patch(api, token, target.user.id, {
      status: 'active',
      'role-ids': [organization.roleIds.admin],
    });

    expect(refused.statusCode).toBe(422);
    expect(refused.json<{ code: string }>().code).toBe('user_reactivation_required');
    const roles = await listUserRoles(database.db, organization.id, target.user.id);
    expect(roles.map(({ id }) => id)).toEqual([organization.roleIds.viewer]);
  });

  it('never demotes or deactivates the last active admin (409)', async () => {
    const { api, organization, admin, token } = await setup();

    const demote = await patch(api, token, admin.user.id, {
      'role-ids': [organization.roleIds.viewer],
    });
    const deactivate = await patch(api, token, admin.user.id, { status: 'deactivated' });
    const second = await api.operator(organization, { roles: ['admin'] });
    const allowed = await patch(api, token, second.user.id, { status: 'deactivated' });

    expect(demote.statusCode).toBe(409);
    expect(deactivate.statusCode).toBe(409);
    expect(allowed.statusCode).toBe(200);
  });

  it('answers 409 for a status change of an invited user', async () => {
    const { api, organization, token } = await setup();
    expectJson(
      await invite(api, token, 'pending@example.test', [organization.roleIds.viewer]),
      201,
    );
    const users = userListDocumentSchema.parse(
      expectJson(await api.call('GET', '/users', { token }), 200),
    );
    const invited = users.data.find(({ attributes }) => attributes.status === 'invited');

    expect((await patch(api, token, invited?.id ?? '', { status: 'active' })).statusCode).toBe(409);
  });

  it('answers 404 for another organization’s user, 422 for unknown roles, 403 without users:write or beyond the actor’s permissions', async () => {
    const { api, organization, token } = await setup();
    const foreign = await api.operator(await api.organization());
    const target = await api.operator(organization, { roles: ['viewer'] });
    const manager = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Manager',
      permissions: ['users:read', 'users:write'],
    });
    const managerUser = await api.operator(organization, { roles: [], roleIds: [manager.id] });
    const managerToken = await api.signIn(managerUser.email);
    const viewer = await api.operator(organization, { roles: ['viewer'] });
    const viewerToken = await api.signIn(viewer.email);

    expect((await patch(api, token, foreign.user.id, { status: 'deactivated' })).statusCode).toBe(
      404,
    );
    expect(
      (await patch(api, token, target.user.id, { 'role-ids': [newId('role')] })).statusCode,
    ).toBe(422);
    expect(
      (await patch(api, managerToken, target.user.id, { 'role-ids': [organization.roleIds.admin] }))
        .statusCode,
    ).toBe(403);
    expect(
      (await patch(api, viewerToken, target.user.id, { status: 'deactivated' })).statusCode,
    ).toBe(403);
    expect((await patch(api, token, target.user.id, {})).statusCode).toBe(400);
  });
});

describe('PATCH /users/:id and re-invitations change only access the operator holds (Workflow 2D K002)', () => {
  const FORBIDDEN = 'https://openverify.dev/problems/forbidden';
  const patch = (
    api: DashboardHarness,
    token: string,
    id: string,
    attributes: Record<string, unknown>,
  ) =>
    api.call('PATCH', `/users/${id}`, { token, payload: { data: { type: 'user', attributes } } });

  /** An operator who manages users and holds the viewer permissions, but not pii:view. */
  async function manager(api: DashboardHarness, organization: TestOrganization) {
    const role = await createRole(database.db, organization.id, {
      id: newId('role'),
      name: 'Synthetic Viewer Manager',
      permissions: [...BUILTIN_ROLES.viewer.permissions, 'users:read', 'users:write'],
    });
    const user = await api.operator(organization, { roles: [], roleIds: [role.id] });
    return { roleId: role.id, token: await api.signIn(user.email) };
  }

  const roleIdsOf = async (userId: string, organizationId: string) =>
    (await listUserRoles(database.db, organizationId, userId)).map(({ id }) => id).sort();

  it('refuses to remove a role with permissions the operator does not hold (403), and keeps it', async () => {
    const { api, organization } = await setup();
    const { token } = await manager(api, organization);
    const target = await api.operator(organization, { roles: ['admin', 'viewer'] });

    const response = await patch(api, token, target.user.id, {
      'role-ids': [organization.roleIds.viewer],
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ type: string; detail: string }>()).toMatchObject({ type: FORBIDDEN });
    expect(response.json<{ detail: string }>().detail).toMatch(
      /^You cannot remove permissions you do not hold: .*pii:view/,
    );
    expect(await roleIdsOf(target.user.id, organization.id)).toEqual(
      [organization.roleIds.admin, organization.roleIds.viewer].sort(),
    );
  });

  it('refuses to deactivate or reactivate a user with permissions the operator does not hold (403)', async () => {
    const { api, organization, token: adminToken } = await setup();
    const { token } = await manager(api, organization);
    const active = await api.operator(organization, { roles: ['reviewer'] });
    const activeToken = await api.signIn(active.email);
    const inactive = await api.operator(organization, { roles: ['reviewer'] });
    expectJson(await patch(api, adminToken, inactive.user.id, { status: 'deactivated' }), 200);

    const deactivate = await patch(api, token, active.user.id, { status: 'deactivated' });
    const reactivate = await patch(api, token, inactive.user.id, { status: 'active' });

    expect(deactivate.statusCode).toBe(403);
    expect(deactivate.json<{ type: string }>().type).toBe(FORBIDDEN);
    expect(deactivate.json<{ detail: string }>().detail).toMatch(
      /^You cannot change the status of a user with permissions you do not hold: .*pii:view/,
    );
    // AC2: PATCH never reactivates, whoever asks (POST /reactivate holds the superset rule).
    expect(reactivate.statusCode).toBe(422);
    expect(reactivate.json<{ code: string }>().code).toBe('user_reactivation_required');
    expect((await getUser(database.db, organization.id, active.user.id))?.status).toBe('active');
    expect((await api.call('GET', '/me', { token: activeToken })).statusCode).toBe(200);
    expect((await getUser(database.db, organization.id, inactive.user.id))?.status).toBe(
      'deactivated',
    );
  });

  it('still lets the operator remove roles and change the status within their reach', async () => {
    const { api, organization } = await setup();
    const { token, roleId } = await manager(api, organization);
    const target = await api.operator(organization, { roles: ['viewer'], roleIds: [roleId] });

    expectJson(await patch(api, token, target.user.id, { 'role-ids': [roleId] }), 200);
    expectJson(await patch(api, token, target.user.id, { status: 'deactivated' }), 200);
    // AC2: the way back is POST /reactivate, never PATCH.
    expect((await patch(api, token, target.user.id, { status: 'active' })).statusCode).toBe(422);

    expect(await roleIdsOf(target.user.id, organization.id)).toEqual([roleId]);
  });

  it('refuses a re-invitation that drops a role with permissions the operator does not hold (403)', async () => {
    const { api, organization, token: adminToken } = await setup();
    const { token } = await manager(api, organization);
    expectJson(
      await invite(api, adminToken, 'reinvite@example.test', [organization.roleIds.admin]),
      201,
    );

    const response = await invite(api, token, 'reinvite@example.test', [
      organization.roleIds.viewer,
    ]);

    expect(response.statusCode).toBe(403);
    expect(response.json<{ detail: string }>().detail).toMatch(
      /^You cannot remove permissions you do not hold: .*pii:view/,
    );
  });
});
