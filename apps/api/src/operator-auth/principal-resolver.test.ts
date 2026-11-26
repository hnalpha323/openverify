import { newId, newUserSessionToken } from '@openverify/contracts';
import { BUILTIN_ROLES } from '@openverify/core';
import {
  createEnvironment,
  createUser,
  createUserSession,
  hashSessionToken,
  revokeUserSession,
  setOrganizationRequireMfa,
  setUserRoles,
  syncBuiltinRoles,
  updateUser,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import type { FastifyPluginCallback, FastifyRequest } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { requirePrincipal } from '../plugins/principal-auth.js';
import { fixedClock } from '../test-support/fakes.js';
import { createUserSessionPrincipalResolver } from './principal-resolver.js';

// Synthetic operators only.
let database: TestDatabase;
const request = {} as FastifyRequest;
const apps: { close(): Promise<unknown> }[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

afterAll(async () => {
  await database.close();
});

async function seed(
  options: {
    roles?: (keyof typeof BUILTIN_ROLES)[];
    mfaSatisfied?: boolean;
    kind?: 'sandbox' | 'production';
  } = {},
) {
  const clock = fixedClock();
  const { organization, environment } = await createTestTenant(database.db, {
    kind: options.kind ?? 'sandbox',
  });
  const user = await createUser(database.db, {
    id: newId('usr'),
    organizationId: organization.id,
    email: `resolver-${newId('usr').slice(-8).toLowerCase()}@example.test`,
    passwordHash: '$argon2id$fake$unused',
  });
  const roles = await syncBuiltinRoles(
    database.db,
    organization.id,
    Object.values(BUILTIN_ROLES),
    () => newId('role'),
  );
  await setUserRoles(
    database.db,
    organization.id,
    user.id,
    roles
      .filter((role) =>
        (options.roles ?? ['admin']).includes(role.key as keyof typeof BUILTIN_ROLES),
      )
      .map(({ id }) => id),
  );
  const token = newUserSessionToken();
  const session = await createUserSession(database.db, {
    id: newId('uss'),
    organizationId: organization.id,
    userId: user.id,
    environmentId: environment.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(clock.now().getTime() + 3_600_000),
    mfaSatisfied: options.mfaSatisfied ?? false,
  });
  const resolve = createUserSessionPrincipalResolver({ db: database.db, clock });
  return { clock, organization, environment, user, session, token, resolve };
}

describe('createUserSessionPrincipalResolver', () => {
  it('resolves an ovu_ token to a user principal in the session’s environment (C12, C15)', async () => {
    const { resolve, token, user, session, organization, environment } = await seed({
      roles: ['developer', 'reviewer'],
    });

    await expect(resolve(token, request)).resolves.toEqual({
      kind: 'user',
      userId: user.id,
      userSessionId: session.id,
      organizationId: organization.id,
      environmentId: environment.id,
      environmentKind: 'sandbox',
      permissions: new Set([
        ...BUILTIN_ROLES.developer.permissions,
        ...BUILTIN_ROLES.reviewer.permissions,
      ]),
      mfaSatisfied: true,
    });
  });

  it('follows the session into production', async () => {
    const { resolve, token } = await seed({ kind: 'production' });

    await expect(resolve(token, request)).resolves.toMatchObject({ environmentKind: 'production' });
  });

  it('stops resolving a production session once the user lost environments:production (2B F003)', async () => {
    const { resolve, token, organization, user } = await seed({
      kind: 'production',
      roles: ['developer'],
    });
    await expect(resolve(token, request)).resolves.toMatchObject({
      environmentKind: 'production',
    });
    const roles = await syncBuiltinRoles(
      database.db,
      organization.id,
      Object.values(BUILTIN_ROLES),
      () => newId('role'),
    );

    await setUserRoles(
      database.db,
      organization.id,
      user.id,
      roles.filter((role) => role.key === 'viewer').map(({ id }) => id),
    );

    await expect(resolve(token, request)).resolves.toBeNull();
  });

  it('grants nothing to a user without roles', async () => {
    const { resolve, token } = await seed({ roles: [] });

    await expect(resolve(token, request)).resolves.toMatchObject({ permissions: new Set() });
  });

  it('is not MFA-satisfied while the organization requires MFA and the session has not passed it', async () => {
    const unsatisfied = await seed();
    const satisfied = await seed({ mfaSatisfied: true });
    await setOrganizationRequireMfa(database.db, unsatisfied.organization.id, true);
    await setOrganizationRequireMfa(database.db, satisfied.organization.id, true);

    await expect(unsatisfied.resolve(unsatisfied.token, request)).resolves.toMatchObject({
      mfaSatisfied: false,
    });
    await expect(satisfied.resolve(satisfied.token, request)).resolves.toMatchObject({
      mfaSatisfied: true,
    });
  });

  it('resolves revoked, deactivated, unknown and malformed tokens to null, and refuses an expired one', async () => {
    const revoked = await seed();
    await revokeUserSession(database.db, revoked.session.id);
    const expired = await seed();
    expired.clock.advance(3_600_000);
    const deactivated = await seed();
    await updateUser(database.db, deactivated.organization.id, deactivated.user.id, {
      status: 'deactivated',
    });

    await expect(revoked.resolve(revoked.token, request)).resolves.toBeNull();
    // C245.2 (Workflow 11B): a session past its expiry is refused as session_expired, reason absolute.
    await expect(expired.resolve(expired.token, request)).rejects.toMatchObject({
      code: 'session_expired',
      reason: 'absolute',
    });
    await expect(deactivated.resolve(deactivated.token, request)).resolves.toBeNull();
    await expect(revoked.resolve(newUserSessionToken(), request)).resolves.toBeNull();
    await expect(revoked.resolve('ovu_short', request)).resolves.toBeNull();
  });

  it('uses the session’s current environment after a switch', async () => {
    const { resolve, token, organization, session } = await seed();
    const production = await createEnvironment(database.db, {
      id: newId('env'),
      organizationId: organization.id,
      kind: 'production',
    });
    await database.client.query('update user_sessions set environment_id = $1 where id = $2', [
      production.id,
      session.id,
    ]);

    await expect(resolve(token, request)).resolves.toMatchObject({
      environmentId: production.id,
      environmentKind: 'production',
    });
  });
});

describe('the resolver behind the server API principal plugin', () => {
  const probe: FastifyPluginCallback = (app, _options, done) => {
    app.get('/probe', { config: { scopes: ['audit-logs:read'] } }, (req) => {
      const principal = requirePrincipal(req);
      return { kind: principal.kind, environmentId: principal.environmentId };
    });
    done();
  };

  async function appFor(resolve: ReturnType<typeof createUserSessionPrincipalResolver>) {
    const app = buildApp({
      lookupApiKey: () => Promise.resolve(null),
      logger: false,
      mode: 'test',
      resolveUserSession: resolve,
    });
    apps.push(app);
    await app.register(probe, { prefix: '/api/v1' });
    await app.ready();
    return app;
  }

  it('lets a user with the permission in, 403 forbidden without it, 401 mfa-required when unsatisfied', async () => {
    const admin = await seed({ roles: ['admin'] });
    const developer = await seed({ roles: ['developer'] });
    const restricted = await seed({ roles: ['admin'] });
    await setOrganizationRequireMfa(database.db, restricted.organization.id, true);
    const call = async (seeded: Awaited<ReturnType<typeof seed>>) =>
      (await appFor(seeded.resolve)).inject({
        url: '/api/v1/probe',
        headers: { authorization: `Bearer ${seeded.token}` },
      });

    const allowed = await call(admin);
    const forbidden = await call(developer);
    const unsatisfied = await call(restricted);

    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ kind: 'user', environmentId: admin.environment.id });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ type: 'https://openverify.dev/problems/forbidden' });
    expect(unsatisfied.statusCode).toBe(401);
    expect(unsatisfied.json()).toMatchObject({
      type: 'https://openverify.dev/problems/mfa-required',
    });
  });
});
