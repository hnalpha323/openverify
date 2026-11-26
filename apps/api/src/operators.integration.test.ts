/**
 * C15 operators against Postgres 17 + pgvector (Testcontainers): a TOTP login end to end, a
 * WebAuthn security key driven by a software P-256 authenticator, and an invitation accepted
 * from a captured email. The dashboard and server APIs run on one app with the real operator
 * auth (Argon2id), the real audit logger and the real user-session principal resolver. Every
 * value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import {
  dashboardMeDocumentSchema,
  dashboardMfaChallengeResponseSchema,
  dashboardSessionResponseSchema,
  newId,
  userAuditLogListDocumentSchema,
} from '@openverify/contracts';
import {
  createDatabase,
  createEnvironment,
  createOrganization,
  createUser,
  keyringFromEnv,
  listAuditLogs,
  runMigrations,
  setDefaultKeyring,
  setUserRoles,
  type Database,
} from '@openverify/db';
import { createIntegrationPool, startIntegrationPostgres, ifSet } from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { LightMyRequestResponse } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { invitationTokenFromUrl } from './mail/index.js';
import {
  createOperatorAuth,
  createUserSessionPrincipalResolver,
  hashPassword,
  type WebauthnSettings,
} from './operator-auth/index.js';
import { createSoftwareAuthenticator } from './operator-auth/testing/software-authenticator.js';
import { totpCode } from './operator-auth/totp.js';
import { ulidIdGenerator } from './ports.js';
import { dashboardRoutes } from './routes/dashboard/index.js';
import { createAuditLogger } from './services/audit-log.js';
import type { ApiDependencies } from './services/context.js';
import { syncOrganizationRoles } from './services/roles.js';
import { createInMemoryFileStorage } from './storage/index.js';
import {
  createAllowAllRateLimiter,
  createCapturingMailer,
  createFakeAccountsService,
  createRecordingEventPublisher,
  createRecordingQueue,
  createRecordingRedactionService,
  fixedClock,
  phase5TestDependencies,
} from './test-support/fakes.js';

const PASSWORD = 'correct horse battery staple';
const DASHBOARD_URL = 'http://localhost:3001';
const WEBAUTHN: WebauthnSettings = {
  rpId: 'localhost',
  rpName: 'OpenVerify',
  origin: DASHBOARD_URL,
};

let postgres: StartedPostgreSqlContainer;
let pool: Pool;
let db: Database;
let app: ReturnType<typeof buildApp>;
const clock = fixedClock();
const mailer = createCapturingMailer();

beforeAll(async () => {
  postgres = await startIntegrationPostgres();
  pool = createIntegrationPool(postgres.getConnectionUri());
  db = createDatabase(pool);
  await runMigrations(db);
  const keyring = keyringFromEnv({ OPENVERIFY_KEK: randomBytes(32).toString('base64') });
  setDefaultKeyring(keyring);

  const resolveUserSession = createUserSessionPrincipalResolver({ db, clock });
  const deps: ApiDependencies = {
    db,
    keyring,
    storage: createInMemoryFileStorage(),
    events: createRecordingEventPublisher(),
    queue: createRecordingQueue(),
    clock,
    ids: ulidIdGenerator,
    flowPublicUrl: 'https://flow.example.test',
    flowCorsOrigins: ['https://flow.example.test'],
    accounts: createFakeAccountsService(),
    redaction: createRecordingRedactionService(clock),
    audit: createAuditLogger(),
    rateLimiter: createAllowAllRateLimiter(clock),
    mailer,
    ...phase5TestDependencies(clock),
    resolveUserSession,
  };
  app = buildApp({
    lookupApiKey: () => Promise.resolve(null),
    logger: false,
    mode: 'test',
    api: deps,
  });
  await app.register(dashboardRoutes, {
    prefix: '/api/v1/dashboard',
    db,
    storage: deps.storage,
    operatorAuth: createOperatorAuth({ db, clock, webauthn: WEBAUTHN }),
    admin: { api: deps, dashboardPublicUrl: DASHBOARD_URL, syncBuiltinRolesOnReady: true },
  });
  await app.ready();
});

afterAll(async () => {
  await ifSet(app)?.close();
  await ifSet(pool)?.end();
  await ifSet(postgres)?.stop();
});

function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: { token?: string; payload?: unknown } = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url: path.startsWith('/api/') ? path : `/api/v1/dashboard${path}`,
    headers: options.token === undefined ? {} : { authorization: `Bearer ${options.token}` },
    ...(options.payload === undefined ? {} : { payload: options.payload as never }),
  });
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the shape it reads
function json<T>(response: LightMyRequestResponse, status: number): T {
  if (response.statusCode !== status) {
    throw new Error(
      `expected ${String(status)}, got ${String(response.statusCode)}: ${response.body}`,
    );
  }
  return response.json<T>();
}

let emailCounter = 0;

/** An organization with its built-in roles and an admin whose password is Argon2id. */
async function organizationWithAdmin() {
  // C168.2 (Workflow 9B): new organisations require MFA by default; these flows sign in an admin
  // without a factor first, as before.
  const organization = await createOrganization(db, {
    id: newId('org'),
    name: 'Example Synthetic Org',
    requireMfa: false,
  });
  const environment = await createEnvironment(db, {
    id: newId('env'),
    organizationId: organization.id,
    kind: 'sandbox',
  });
  const roles = await syncOrganizationRoles(db, organization.id, ulidIdGenerator);
  emailCounter += 1;
  const admin = await createUser(db, {
    id: newId('usr'),
    organizationId: organization.id,
    email: `integration-admin-${String(emailCounter)}@example.test`,
    passwordHash: await hashPassword(PASSWORD),
  });
  const roleId = (key: string) => roles.find((role) => role.key === key)?.id ?? '';
  await setUserRoles(db, organization.id, admin.id, [roleId('admin')]);
  return { organization, environment, admin, roleId };
}

const login = (email: string) =>
  call('POST', '/sessions', { payload: { email, password: PASSWORD } });

describe('TOTP login end to end (Postgres)', () => {
  it('enrols a factor, then signs in with password and code, and uses the session on the server API', async () => {
    const { environment, admin } = await organizationWithAdmin();
    const first = dashboardSessionResponseSchema.parse(json(await login(admin.email), 201));
    const enrolment = json<{ data: { id: string }; meta: { secret: string } }>(
      await call('POST', '/me/mfa-factors/totp', {
        token: first.token,
        payload: { name: 'Phone' },
      }),
      201,
    );
    json(
      await call('POST', '/me/mfa-factors/totp/confirm', {
        token: first.token,
        payload: {
          'factor-id': enrolment.data.id,
          'totp-code': totpCode(enrolment.meta.secret, clock.now()),
        },
      }),
      200,
    );
    expect((await call('DELETE', '/sessions/current', { token: first.token })).statusCode).toBe(
      204,
    );
    clock.advance(30_000);

    const challenge = dashboardMfaChallengeResponseSchema.parse(
      json(await login(admin.email), 202),
    );
    const code = totpCode(enrolment.meta.secret, clock.now());
    const session = dashboardSessionResponseSchema.parse(
      json(
        await call('POST', '/sessions/mfa', {
          payload: { 'mfa-token': challenge['mfa-token'], 'totp-code': code },
        }),
        201,
      ),
    );

    const me = dashboardMeDocumentSchema.parse(
      json(await call('GET', '/me', { token: session.token }), 200),
    );
    expect(me.meta?.['mfa-satisfied']).toBe(true);
    // The same session token works on the server API (C12), with the admin's permissions.
    const log = userAuditLogListDocumentSchema.parse(
      json(
        await call('GET', '/api/v1/user-audit-logs?filter[action]=user-session.created', {
          token: session.token,
        }),
        200,
      ),
    );
    expect(log.data[0]?.attributes).toMatchObject({
      actor: { type: 'user', id: admin.id },
      metadata: { mfa: 'totp' },
    });
    // A code is accepted once: the replay fails even with a fresh challenge.
    const replay = dashboardMfaChallengeResponseSchema.parse(json(await login(admin.email), 202));
    expect(
      (
        await call('POST', '/sessions/mfa', {
          payload: { 'mfa-token': replay['mfa-token'], 'totp-code': code },
        })
      ).statusCode,
    ).toBe(401);
    // Tokens are stored as hashes only.
    const stored = await pool.query('select token_hash from user_sessions where user_id = $1', [
      admin.id,
    ]);
    expect(JSON.stringify(stored.rows)).not.toContain(session.token);
    expect((await listAuditLogs(db, environment.id)).map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        'mfa-factor.created',
        'mfa-factor.activated',
        'user-session.revoked',
      ]),
    );
  });
});

describe('WebAuthn with a software authenticator (Postgres)', () => {
  it('registers a P-256 key, signs in with an assertion, and refuses a replayed one', async () => {
    const { admin } = await organizationWithAdmin();
    const authenticator = createSoftwareAuthenticator({ origin: WEBAUTHN.origin });
    const first = dashboardSessionResponseSchema.parse(json(await login(admin.email), 201));
    const { options: creation } = json<{ options: Parameters<typeof authenticator.register>[0] }>(
      await call('POST', '/me/mfa-factors/webauthn/options', { token: first.token, payload: {} }),
      200,
    );
    json(
      await call('POST', '/me/mfa-factors/webauthn/verify', {
        token: first.token,
        payload: { credential: authenticator.register(creation), name: 'Synthetic key' },
      }),
      201,
    );

    const signIn = async () => {
      const challenge = dashboardMfaChallengeResponseSchema.parse(
        json(await login(admin.email), 202),
      );
      const { options } = json<{ options: Parameters<typeof authenticator.authenticate>[0] }>(
        await call('POST', '/sessions/mfa/webauthn/options', {
          payload: { 'mfa-token': challenge['mfa-token'] },
        }),
        200,
      );
      return { challenge, options };
    };
    const { challenge, options } = await signIn();
    const assertion = authenticator.authenticate(options);
    const session = dashboardSessionResponseSchema.parse(
      json(
        await call('POST', '/sessions/mfa/webauthn/verify', {
          payload: { 'mfa-token': challenge['mfa-token'], credential: assertion },
        }),
        201,
      ),
    );
    expect(session.user.id).toBe(admin.id);
    const counter = await pool.query<{ webauthn_counter: string }>(
      'select webauthn_counter from mfa_factors where user_id = $1',
      [admin.id],
    );
    expect(Number(counter.rows[0]?.webauthn_counter)).toBe(1);

    const again = await signIn();
    const replayed = await call('POST', '/sessions/mfa/webauthn/verify', {
      payload: { 'mfa-token': again.challenge['mfa-token'], credential: assertion },
    });
    expect(replayed.statusCode).toBe(401);
  });
});

describe('invitation acceptance via a captured email (Postgres)', () => {
  it('invites a reviewer, who accepts from the emailed link and signs in with those roles', async () => {
    const { environment, admin, roleId } = await organizationWithAdmin();
    const adminSession = dashboardSessionResponseSchema.parse(json(await login(admin.email), 201));

    json(
      await call('POST', '/users/invitations', {
        token: adminSession.token,
        payload: { email: 'Invitee.Integration@Example.test', 'role-ids': [roleId('reviewer')] },
      }),
      201,
    );
    const message = mailer.messages.at(-1);
    // C54.3, C55.8: the mailer takes a validated `{ address }`, never a raw string.
    expect(message?.to).toEqual({ address: 'invitee.integration@example.test' });
    const link =
      /http:\/\/localhost:3001\/accept-invitation#token=\S+/.exec(message?.text ?? '')?.[0] ?? '';
    const token = invitationTokenFromUrl(link) ?? '';
    json(
      await call('POST', '/invitations/accept', {
        payload: { token, password: PASSWORD, name: 'Synthetic Invitee' },
      }),
      200,
    );

    const invitee = dashboardSessionResponseSchema.parse(
      json(await login('invitee.integration@example.test'), 201),
    );
    const me = dashboardMeDocumentSchema.parse(
      json(await call('GET', '/me', { token: invitee.token }), 200),
    );
    expect(me.data.relationships?.roles.data).toEqual([{ type: 'role', id: roleId('reviewer') }]);
    expect(me.meta?.permissions).toContain('pii:view');
    expect(me.meta?.permissions).not.toContain('users:write');
    expect((await call('GET', '/users', { token: invitee.token })).statusCode).toBe(403);
    const stored = await pool.query<{
      password_hash: string;
      invitation_token_hash: string | null;
    }>('select password_hash, invitation_token_hash from users where id = $1', [invitee.user.id]);
    expect(stored.rows[0]?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(stored.rows[0]?.invitation_token_hash).toBeNull();
    expect((await listAuditLogs(db, environment.id)).map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['user.invited', 'user.invitation-accepted']),
    );
  });
});
