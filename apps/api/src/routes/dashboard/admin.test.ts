import { newId } from '@openverify/contracts';
import { BUILTIN_ROLE_KEYS, BUILTIN_ROLES } from '@openverify/core';
import { createOrganization, listRoles, syncBuiltinRoles } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { createOperatorAuth } from '../../operator-auth/index.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import { routesOf } from '../../test-support/plugins.js';
import { dashboardAdminRoutes, type DashboardAdminContext } from './admin.js';
import { fakeHasher } from './dashboard.test-support.js';
import { dashboardRoutes } from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

function context(): DashboardAdminContext {
  return {
    db: database.db,
    storage: createInMemoryFileStorage(),
    operatorAuth: createOperatorAuth({ db: database.db, hasher: fakeHasher }),
    keyring: () => database.keyring,
  };
}

describe('dashboardAdminRoutes', () => {
  it('registers the C15 dashboard routes', async () => {
    const routes = await routesOf(dashboardAdminRoutes, context());

    expect(routes).toEqual(
      expect.arrayContaining([
        'POST /invitations/accept',
        'PUT /sessions/current/environment',
        'GET /me/mfa-factors',
        'POST /me/mfa-factors/totp',
        'POST /me/mfa-factors/totp/confirm',
        'POST /me/mfa-factors/webauthn/options',
        'POST /me/mfa-factors/webauthn/verify',
        'DELETE /me/mfa-factors/:id',
        'POST /me/recovery-codes',
        'GET /users',
        'POST /users/invitations',
        'PATCH /users/:id',
        'GET /roles',
        'POST /roles',
        'PATCH /roles/:id',
        'DELETE /roles/:id',
        'GET /audit-logs',
        'GET /audit-logs/:id',
        'GET /settings',
        'PATCH /settings',
      ]),
    );
  });

  it('is registered by the dashboard routes, so Stage 2 never edits their index', async () => {
    const app = buildApp({ lookupApiKey: () => Promise.resolve(null), logger: false });
    await app.register(dashboardRoutes, {
      prefix: '/api/v1/dashboard',
      db: database.db,
      storage: createInMemoryFileStorage(),
      keyring: database.keyring,
    });
    await app.ready();
    const plugins = app.printPlugins();
    await app.close();

    expect(plugins).toContain('dashboardAdminRoutes');
  });

  it('syncs every organization’s built-in roles when the app is ready, if asked to (API startup)', async () => {
    const organization = await createOrganization(database.db, {
      id: newId('org'),
      name: 'Example Synthetic Org',
    });
    const app = buildApp({ lookupApiKey: () => Promise.resolve(null), logger: false });
    await app.register(dashboardRoutes, {
      prefix: '/api/v1/dashboard',
      db: database.db,
      storage: createInMemoryFileStorage(),
      keyring: database.keyring,
      admin: { syncBuiltinRolesOnReady: true },
    });

    expect((await listRoles(database.db, organization.id)).items).toEqual([]);
    await app.ready();
    await app.close();

    const roles = await listRoles(database.db, organization.id, { size: 100 });
    expect(roles.items.map((role) => role.key).sort()).toEqual([...BUILTIN_ROLE_KEYS].sort());
  });

  it('gives an organization seeded before a built-in permission was added that permission at startup (2B K001)', async () => {
    const organization = await createOrganization(database.db, {
      id: newId('org'),
      name: 'Example Synthetic Org',
    });
    // The built-in roles as Phase 2A seeded them: developer and reviewer could not read
    // verifications.
    const before = Object.values(BUILTIN_ROLES).map((definition) => ({
      ...definition,
      permissions: definition.permissions.filter(
        (permission) =>
          definition.key === 'viewer' ||
          definition.key === 'admin' ||
          permission !== 'verifications:read',
      ),
    }));
    await syncBuiltinRoles(database.db, organization.id, before, () => newId('role'));
    const app = buildApp({ lookupApiKey: () => Promise.resolve(null), logger: false });
    await app.register(dashboardRoutes, {
      prefix: '/api/v1/dashboard',
      db: database.db,
      storage: createInMemoryFileStorage(),
      keyring: database.keyring,
      admin: { syncBuiltinRolesOnReady: true },
    });

    await app.ready();
    await app.close();

    const roles = (await listRoles(database.db, organization.id, { size: 100 })).items;
    for (const key of ['developer', 'reviewer'] as const) {
      expect(roles.find((role) => role.key === key)?.permissions).toContain('verifications:read');
    }
  });

  it('logs a failed startup sync instead of failing the app, so a database outage stays visible but recoverable', async () => {
    const broken = await createTestDatabase();
    await broken.close();
    const logged: unknown[] = [];
    const app = buildApp({ lookupApiKey: () => Promise.resolve(null), logger: false });
    await app.register(dashboardRoutes, {
      prefix: '/api/v1/dashboard',
      db: broken.db,
      storage: createInMemoryFileStorage(),
      keyring: database.keyring,
      admin: { syncBuiltinRolesOnReady: true },
    });
    app.log.error = (...args: unknown[]) => {
      logged.push(args);
    };

    await expect(app.ready()).resolves.toBeDefined();
    await app.close();

    expect(JSON.stringify(logged)).toContain('syncing the built-in roles failed');
  }, 60_000);
});
