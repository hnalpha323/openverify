/**
 * C248.4-C248.6 (Workflow 11B, `sso-oidc`): the SSO service over the Postgres store on PGlite, against
 * the in-process provider: a first link written with its audit entry in every environment, a
 * just-in-time user with its roles and link, a returning user by subject, an attempt consumed once,
 * and a step-up that sets the session's `mfa_verified_at`. Every value is synthetic.
 */
import {
  auditLogs,
  createSsoProvider,
  createUser,
  createUserSession,
  findSsoProvider,
  getUserSession,
  listEnvironments,
  listSsoIdentitiesOfUser,
  roles,
  setOrganizationSlug,
  ssoLoginStates,
  ssoProviders,
  userRoles,
  users,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createOutboundHttp, type OutboundHttp } from '../../http/index.js';
import { ulidIdGenerator } from '../../ports.js';
import { createAuditLogger } from '../../services/audit-log.js';
import { fixedClock } from '../../test-support/fakes.js';
import { startTestOidcProvider, type TestOidcProvider } from '../../test-support/oidc/provider.js';
import type { PasswordHasher } from '../password-hasher.js';
import { createOidcClient } from './client.js';
import { SsoFlowError } from './failures.js';
import { createSsoService, ssoRedirectUri, type SsoService } from './service.js';
import { createPostgresSsoStore, providerRecordOf } from './store.js';

let database: TestDatabase;
let outbound: OutboundHttp;
const providers: TestOidcProvider[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  outbound = createOutboundHttp();
});
afterAll(async () => {
  await outbound.close();
  await database.close();
});
afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

const CONSOLE = 'https://console.example.com';
const SECRET = 'synthetic-client-secret-canary';
const PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic';
const hasher: PasswordHasher = {
  hash: () => Promise.resolve(PASSWORD_HASH),
  verify: () => Promise.resolve(false),
};

async function setUp(jitProvisioning = false) {
  const db: Db = database.db;
  const clock = fixedClock(new Date('2026-11-13T12:00:00Z'));
  const { organization } = await createTestTenant(db);
  const slug = `org-${testId('org').slice(-10).toLowerCase()}`;
  await setOrganizationSlug(db, organization.id, slug);
  const [role] = await db
    .insert(roles)
    .values({
      id: testId('role'),
      organizationId: organization.id,
      name: 'Support',
      permissions: ['inquiries:read'],
    })
    .returning();
  const providerId = testId('ssop');
  const idp = await startTestOidcProvider({
    shape: 'okta',
    clients: [
      {
        clientId: 'synthetic-client-id',
        clientSecret: SECRET,
        redirectUris: [ssoRedirectUri(CONSOLE, providerId) ?? ''],
      },
    ],
    now: () => clock.now(),
  });
  providers.push(idp);
  await createSsoProvider(db, {
    id: providerId,
    organizationId: organization.id,
    displayName: 'Workforce',
    issuer: idp.issuer,
    clientId: 'synthetic-client-id',
    clientSecret: SECRET,
    allowedEmailDomains: ['example.com'],
    tenantPinClaim: null,
    tenantPinValue: null,
    requiredAmr: ['mfa'],
    requiredAcr: [],
    jitProvisioning,
    defaultRoleIds: role === undefined ? [] : [role.id],
    enforced: false,
    at: clock.now(),
  });
  const service: SsoService = createSsoService({
    store: createPostgresSsoStore({ db, audit: createAuditLogger(), ids: ulidIdGenerator, hasher }),
    oidc: createOidcClient({ outbound, policy: { production: false, privateIssuers: [] }, clock }),
    sessions: {
      requireMfa: () => Promise.resolve(false),
      openSession: (user, mfaPassed) =>
        Promise.resolve({
          token: `ovu_${'S'.repeat(43)}`,
          expiresAt: new Date(clock.now().getTime() + 3_600_000),
          session: { mfaSatisfied: mfaPassed } as never,
          user,
        }),
      startMfaChallenge: () => Promise.resolve(null),
    },
    clock,
    dashboardPublicUrl: CONSOLE,
  });
  return { db, clock, organization, slug, role, providerId, idp, service };
}

type Setup = Awaited<ReturnType<typeof setUp>>;

async function signIn(
  setup: Setup,
  user = {
    sub: 'subject-ada',
    email: 'ada@example.com',
    emailVerified: true,
    claims: { amr: ['mfa'] },
  },
) {
  const started = await setup.service.start(setup.slug, {});
  if (started.kind !== 'redirect') {
    throw new Error('expected a redirect');
  }
  const query = setup.idp.authorize(started['authorization-url'], user);
  return {
    started,
    query,
    result: await setup.service.callback(setup.providerId, query, started.binding),
  };
}

describe('the SSO service over Postgres (C248.4-C248.6)', () => {
  it('links an existing user, audited in every environment, and signs in by subject after', async () => {
    const setup = await setUp();
    const ada = await createUser(setup.db, {
      id: testId('usr'),
      organizationId: setup.organization.id,
      email: 'ada@example.com',
      passwordHash: PASSWORD_HASH,
    });
    const { result, started, query } = await signIn(setup);
    expect(result).toMatchObject({ kind: 'session', user: { id: ada.id } });
    expect(await listSsoIdentitiesOfUser(setup.db, ada.id)).toEqual([
      expect.objectContaining({
        providerId: setup.providerId,
        issuer: setup.idp.issuer,
        subject: 'subject-ada',
      }),
    ]);
    const environments = await listEnvironments(setup.db, setup.organization.id);
    const entries = await setup.db
      .select()
      .from(auditLogs)
      .where(
        and(
          inArray(
            auditLogs.environmentId,
            environments.map((environment) => environment.id),
          ),
          eq(auditLogs.action, 'user.sso-linked'),
        ),
      );
    expect(entries.map((entry) => entry.environmentId).sort()).toEqual(
      environments.map((environment) => environment.id).sort(),
    );
    // The attempt was consumed: the same callback again is refused.
    await expect(
      setup.service.callback(setup.providerId, query, started.binding),
    ).rejects.toBeInstanceOf(SsoFlowError);
    const again = await signIn(setup, {
      sub: 'subject-ada',
      email: 'ada@example.com',
      emailVerified: false,
      claims: { amr: ['mfa'] },
    });
    expect(again.result).toMatchObject({ kind: 'session', user: { id: ada.id } });
    const [state] = await setup.db
      .select({ consumedAt: ssoLoginStates.consumedAt })
      .from(ssoLoginStates)
      .where(eq(ssoLoginStates.providerId, setup.providerId))
      .limit(1);
    expect(state?.consumedAt).not.toBeNull();
  });

  it('provisions a just-in-time user with its role, and opens the provider’s secret only to call it', async () => {
    const setup = await setUp(true);
    const { result } = await signIn(setup, {
      sub: 'subject-new',
      email: 'grace@example.com',
      emailVerified: true,
      claims: { amr: ['mfa'] },
    });
    expect(result).toMatchObject({ kind: 'session', user: { email: 'grace@example.com' } });
    const [grace] = await setup.db.select().from(users).where(eq(users.email, 'grace@example.com'));
    expect(grace?.passwordHash).toBe(PASSWORD_HASH);
    const held = await setup.db
      .select()
      .from(userRoles)
      .where(eq(userRoles.userId, grace?.id ?? ''));
    expect(held.map((each) => each.roleId)).toEqual([setup.role?.id]);
    const [raw] = await setup.db
      .select({ secret: ssoProviders.clientSecret })
      .from(ssoProviders)
      .where(eq(ssoProviders.id, setup.providerId));
    expect(raw?.secret).not.toContain(SECRET);
    const row = await findSsoProvider(setup.db, setup.providerId);
    expect(row === null ? null : providerRecordOf(row).clientSecret).toBe(SECRET);
  });

  it('marks the session’s step-up on a fresh re-authentication of its own identity', async () => {
    const setup = await setUp();
    const ada = await createUser(setup.db, {
      id: testId('usr'),
      organizationId: setup.organization.id,
      email: 'ada@example.com',
      passwordHash: PASSWORD_HASH,
    });
    await signIn(setup);
    const [environment] = await listEnvironments(setup.db, setup.organization.id);
    const session = await createUserSession(setup.db, {
      id: testId('uss'),
      organizationId: setup.organization.id,
      userId: ada.id,
      environmentId: environment?.id ?? '',
      tokenHash: 'a'.repeat(64),
      expiresAt: new Date(setup.clock.now().getTime() + 3_600_000),
      mfaSatisfied: true,
      mfaVerifiedAt: null,
      at: setup.clock.now(),
    });
    const redirect = await setup.service.startStepUp({ sessionId: session.id, user: ada });
    const query = setup.idp.authorize(
      redirect.authorizationUrl,
      { sub: 'subject-ada', claims: { amr: ['mfa'] } },
      { authTime: setup.clock.now() },
    );
    await expect(
      setup.service.callback(setup.providerId, query, redirect.binding),
    ).resolves.toMatchObject({ kind: 'step-up' });
    expect((await getUserSession(setup.db, session.id))?.mfaVerifiedAt).toEqual(setup.clock.now());
  });
});
