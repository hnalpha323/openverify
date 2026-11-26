/**
 * C248.3, C248.5 (Workflow 11B, `sso-oidc`): the SSO provider service on PGlite. Reads need
 * `settings:read` and changes `settings:write` through an organisation-wide assignment, and changes
 * the step-up; a provider is refused without the sign-in name, with a plain http issuer in
 * production, for a multi-tenant issuer without its pin, and with a default role that does not exist
 * or holds a permission C248.5 forbids; the secret is never served or audited. Synthetic values only.
 */
import { createHash } from 'node:crypto';
import {
  auditLogs,
  createUserSession,
  createUser,
  listEnvironments,
  roles,
  setOrganizationSlug,
  setUserRoleAssignments,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { ulidIdGenerator } from '../ports.js';
import { fixedClock } from '../test-support/fakes.js';
import { createAuditLogger } from './audit-log.js';
import {
  createSsoProviderFor,
  deleteSsoProviderFor,
  getSsoProviderResource,
  listSsoProviderResources,
  updateSsoProviderFor,
  type SsoProviderActing,
  type SsoProviderServiceDeps,
} from './sso-providers.js';

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.close();
});

const SECRET = 'synthetic-client-secret-canary';
const ISSUER = 'https://idp.example.com/oauth2/default';
const T0 = new Date('2026-11-13T12:00:00Z');

function body(attributes: Record<string, unknown> = {}) {
  return {
    data: {
      type: 'sso-provider' as const,
      attributes: {
        'display-name': 'Workforce',
        issuer: ISSUER,
        'client-id': 'synthetic-client-id',
        'client-secret': SECRET,
        'allowed-email-domains': ['example.com'],
        'tenant-pin': null,
        'required-amr': ['mfa'],
        'required-acr': [],
        'jit-provisioning': false,
        'default-role-ids': [],
        enforced: false,
        ...attributes,
      },
    },
  };
}

async function setUp({
  wide = true,
  steppedUp = true,
  slug = true,
  production = false,
}: { wide?: boolean; steppedUp?: boolean; slug?: boolean; production?: boolean } = {}) {
  const db: Db = database.db;
  const clock = fixedClock(T0);
  const { organization, environment } = await createTestTenant(db);
  if (slug) {
    await setOrganizationSlug(db, organization.id, `org-${testId('org').slice(-10).toLowerCase()}`);
  }
  const [settingsRole, viewerRole, writerRole] = await db
    .insert(roles)
    .values([
      {
        id: testId('role'),
        organizationId: organization.id,
        name: `Settings ${testId('role')}`,
        permissions: ['settings:read', 'settings:write'],
      },
      {
        id: testId('role'),
        organizationId: organization.id,
        name: `Viewer ${testId('role')}`,
        permissions: ['inquiries:read'],
      },
      {
        id: testId('role'),
        organizationId: organization.id,
        name: `Writer ${testId('role')}`,
        permissions: ['inquiries:read', 'settings:write'],
      },
    ])
    .returning();
  const user = await createUser(db, {
    id: testId('usr'),
    organizationId: organization.id,
    email: `admin-${testId('usr').slice(-6).toLowerCase()}@example.com`,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic',
  });
  await setUserRoleAssignments(db, organization.id, user.id, [
    { roleId: settingsRole?.id ?? '', environmentIds: wide ? null : [environment.id] },
  ]);
  const session = await createUserSession(db, {
    id: testId('uss'),
    organizationId: organization.id,
    userId: user.id,
    environmentId: environment.id,
    tokenHash: createHash('sha256').update(testId('uss')).digest('hex'),
    expiresAt: new Date(T0.getTime() + 3_600_000),
    mfaSatisfied: true,
    mfaVerifiedAt: steppedUp ? new Date(T0.getTime() - 60_000) : null,
    at: T0,
  });
  const deps: SsoProviderServiceDeps = {
    db,
    audit: createAuditLogger(),
    clock,
    ids: ulidIdGenerator,
    production,
    dashboardPublicUrl: 'https://console.example.com',
  };
  const acting: SsoProviderActing = {
    ctx: { organizationId: organization.id, environmentId: environment.id },
    userId: user.id,
    sessionId: session.id,
  };
  return { db, deps, acting, organization, viewerRole, writerRole, clock };
}

async function problemOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  const { status, code, errors, type } = error as AppError;
  return { status, code, type, pointers: (errors ?? []).map((each) => each.pointer) };
}

describe('the SSO provider service (C248.3, C248.5)', () => {
  it('adds, reads, changes and removes a provider, never serving or auditing its secret', async () => {
    const { db, deps, acting, viewerRole } = await setUp();
    const created = await createSsoProviderFor(
      deps,
      acting,
      body({ 'jit-provisioning': true, 'default-role-ids': [viewerRole?.id] }),
    );
    expect(created.attributes).toMatchObject({
      'client-secret-set': true,
      'jit-provisioning': true,
      'redirect-uri': `https://console.example.com/sso/callback/${created.id}`,
    });
    expect(JSON.stringify(created)).not.toContain(SECRET);
    expect((await listSsoProviderResources(deps, acting)).map((each) => each.id)).toEqual([
      created.id,
    ]);
    expect((await getSsoProviderResource(deps, acting, created.id)).id).toBe(created.id);
    const changed = await updateSsoProviderFor(deps, acting, created.id, {
      data: {
        type: 'sso-provider',
        attributes: { enforced: true, 'client-secret': 'synthetic-new-secret-canary' },
      },
    });
    expect(changed.attributes).toMatchObject({
      enforced: true,
      'display-name': 'Workforce',
      'jit-provisioning': true,
    });
    await deleteSsoProviderFor(deps, acting, created.id);
    expect(await listSsoProviderResources(deps, acting)).toEqual([]);
    const environments = await listEnvironments(db, acting.ctx.organizationId);
    const entries = await db
      .select()
      .from(auditLogs)
      .where(
        inArray(
          auditLogs.environmentId,
          environments.map((each) => each.id),
        ),
      );
    expect(entries.map((entry) => entry.action).sort()).toEqual([
      'sso-provider.created',
      'sso-provider.deleted',
      'sso-provider.updated',
    ]);
    expect(JSON.stringify(entries)).not.toMatch(/synthetic-(new-)?secret/);
    expect(entries.find((entry) => entry.action === 'sso-provider.updated')?.metadata).toEqual({
      changed: ['enforced'],
      'client-secret-changed': true,
    });
  });

  it('answers the one 404 for another organisation’s provider', async () => {
    const own = await setUp();
    const other = await setUp();
    const theirs = await createSsoProviderFor(other.deps, other.acting, body());
    expect((await problemOf(getSsoProviderResource(own.deps, own.acting, theirs.id))).status).toBe(
      404,
    );
    expect(
      (
        await problemOf(
          updateSsoProviderFor(own.deps, own.acting, theirs.id, {
            data: { type: 'sso-provider', attributes: { enforced: true } },
          }),
        )
      ).status,
    ).toBe(404);
    expect((await problemOf(deleteSsoProviderFor(own.deps, own.acting, theirs.id))).status).toBe(
      404,
    );
  });

  it('needs settings through an organisation-wide assignment, and the step-up for a change', async () => {
    const scoped = await setUp({ wide: false });
    const forbidden = await problemOf(listSsoProviderResources(scoped.deps, scoped.acting));
    expect(forbidden.status).toBe(403);
    expect(forbidden.type).toMatch(/forbidden$/);
    expect(await problemOf(createSsoProviderFor(scoped.deps, scoped.acting, body()))).toMatchObject(
      { status: 403 },
    );
    const stale = await setUp({ steppedUp: false });
    expect(await problemOf(createSsoProviderFor(stale.deps, stale.acting, body()))).toMatchObject({
      status: 403,
      code: 'step_up_required',
    });
    stale.clock.advance(1);
    expect(await listSsoProviderResources(stale.deps, stale.acting)).toEqual([]);
  });

  it('refuses a provider without the sign-in name, at the body’s root', async () => {
    const { deps, acting } = await setUp({ slug: false });
    expect(await problemOf(createSsoProviderFor(deps, acting, body()))).toMatchObject({
      status: 422,
      pointers: [''],
    });
  });

  it('refuses http in production, a multi-tenant issuer without its pin, and a forbidden or unknown role', async () => {
    const production = await setUp({ production: true });
    expect(
      (
        await problemOf(
          createSsoProviderFor(
            production.deps,
            production.acting,
            body({ issuer: 'http://idp.example.com' }),
          ),
        )
      ).pointers,
    ).toEqual(['/data/attributes/issuer']);
    const { deps, acting, writerRole, viewerRole } = await setUp();
    expect(
      (
        await problemOf(
          createSsoProviderFor(
            deps,
            acting,
            body({ issuer: 'https://idp.example.com/common/v2.0' }),
          ),
        )
      ).pointers,
    ).toEqual(['/data/attributes/tenant-pin']);
    await expect(
      createSsoProviderFor(
        deps,
        acting,
        body({
          issuer: 'https://idp.example.com/common/v2.0',
          'tenant-pin': { claim: 'tid', value: 'tenant-synthetic-0001' },
        }),
      ),
    ).resolves.toMatchObject({
      attributes: { 'tenant-pin': { claim: 'tid', value: 'tenant-synthetic-0001' } },
    });
    expect(
      (
        await problemOf(
          createSsoProviderFor(deps, acting, body({ 'default-role-ids': [writerRole?.id] })),
        )
      ).pointers,
    ).toEqual(['/data/attributes/default-role-ids']);
    expect(
      (
        await problemOf(
          createSsoProviderFor(deps, acting, body({ 'default-role-ids': [testId('role')] })),
        )
      ).pointers,
    ).toEqual(['/data/attributes/default-role-ids']);
    expect(
      (await problemOf(createSsoProviderFor(deps, acting, body({ 'jit-provisioning': true }))))
        .pointers,
    ).toEqual(['/data/attributes/default-role-ids']);
    // A change is held to the same rules over the provider as it stands.
    const ok = await createSsoProviderFor(
      deps,
      acting,
      body({ 'default-role-ids': [viewerRole?.id] }),
    );
    expect(
      (
        await problemOf(
          updateSsoProviderFor(deps, acting, ok.id, {
            data: {
              type: 'sso-provider',
              attributes: { 'default-role-ids': [writerRole?.id ?? ''] },
            },
          }),
        )
      ).pointers,
    ).toEqual(['/data/attributes/default-role-ids']);
  });
});
