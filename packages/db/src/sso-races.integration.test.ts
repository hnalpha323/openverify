/**
 * C248.4 and C248.6 (Workflow 11B, `sso-oidc`) on Postgres 17: the races the SSO repositories
 * settle in one statement, with the callers on separate connections at once (rule 6: every lock and
 * race has its Testcontainers test).
 *
 * - One sign-in attempt (`sso_login_states`) is consumed by exactly one of many callbacks carrying
 *   the same binding, and by none at or after its 10-minute expiry.
 * - One break-glass grant (`users.password_login_allowed_until`) is used by exactly one of many
 *   password sign-ins.
 * - One identity is linked to exactly one user, and one user to a provider once.
 *
 * Every value is synthetic.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { createKeyring, setDefaultKeyring } from './crypto.js';
import { runMigrations } from './migrate.js';
import {
  consumeSsoLoginState,
  createEnvironment,
  createOrganization,
  createSsoProvider,
  createUser,
  grantPasswordLogin,
  insertSsoLoginState,
  linkSsoIdentity,
  takePasswordLoginGrant,
} from './repositories/index.js';
import { createIntegrationPool, ifSet, startIntegrationPostgres, testId } from './testing.js';

const keyring = createKeyring(randomBytes(32));
const T0 = new Date('2026-11-13T12:00:00Z');
const CONTENDERS = 8;

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let organizationId: string;
let providerId: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: CONTENDERS + 2 });
  db = createDatabase(pool);
  await runMigrations(db);
  setDefaultKeyring(keyring);
  organizationId = (await createOrganization(db, { id: testId('org'), name: 'Example Org' })).id;
  await createEnvironment(db, { id: testId('env'), organizationId, kind: 'sandbox' });
  providerId = testId('ssop');
  await createSsoProvider(db, {
    id: providerId,
    organizationId,
    displayName: 'Workforce',
    issuer: 'https://idp.example.com/oauth2/default',
    clientId: 'synthetic-client-id',
    clientSecret: 'synthetic-client-secret-canary',
    allowedEmailDomains: ['example.com'],
    tenantPinClaim: null,
    tenantPinValue: null,
    requiredAmr: [],
    requiredAcr: [],
    jitProvisioning: false,
    defaultRoleIds: [],
    enforced: true,
    at: T0,
  });
});

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function attempt(expiresAt: Date): Promise<string> {
  const bindingSha256 = digest(`ovsb_${randomBytes(32).toString('base64url')}`);
  await insertSsoLoginState(db, {
    bindingSha256,
    organizationId,
    providerId,
    purpose: 'sign-in',
    sessionId: null,
    stateSha256: digest('synthetic-state'),
    nonce: 'synthetic-nonce',
    codeVerifier: 'synthetic-code-verifier',
    returnTo: null,
    createdAt: T0,
    expiresAt,
  });
  return bindingSha256;
}

async function user(email: string) {
  return createUser(db, {
    id: testId('usr'),
    organizationId,
    email,
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic',
  });
}

const all = <T>(make: () => Promise<T>) =>
  Promise.all(Array.from({ length: CONTENDERS }, () => make()));

describe('the SSO repositories under contention (C248.4, C248.6)', () => {
  it('lets exactly one of many callbacks consume an attempt, opened for it alone', async () => {
    const binding = await attempt(new Date(T0.getTime() + 600_000));

    const results = await all(() => consumeSsoLoginState(db, binding, T0));

    const won = results.filter((result) => result !== null);
    expect(won).toHaveLength(1);
    expect(won[0]).toMatchObject({
      nonce: 'synthetic-nonce',
      codeVerifier: 'synthetic-code-verifier',
    });
  });

  it('lets no callback consume an attempt at or after its expiry', async () => {
    const expiresAt = new Date(T0.getTime() + 600_000);
    const binding = await attempt(expiresAt);

    expect(await consumeSsoLoginState(db, binding, expiresAt)).toBeNull();
    expect(await consumeSsoLoginState(db, binding, new Date(expiresAt.getTime() + 1))).toBeNull();
    expect(
      await consumeSsoLoginState(db, binding, new Date(expiresAt.getTime() - 1)),
    ).not.toBeNull();
  });

  it('lets exactly one of many password sign-ins use a break-glass grant', async () => {
    const operator = await user('break-glass@example.com');
    await grantPasswordLogin(db, organizationId, operator.id, new Date(T0.getTime() + 86_400_000));

    const used = await all(() => takePasswordLoginGrant(db, organizationId, operator.id, T0));

    expect(used.filter(Boolean)).toHaveLength(1);
  });

  it('links one identity to one user, and a user to the provider once, whoever races', async () => {
    const people = await Promise.all(
      Array.from({ length: CONTENDERS }, (_, index) =>
        user(`contender-${String(index)}@example.com`),
      ),
    );
    const subject = 'synthetic-subject-raced';

    const linked = await Promise.all(
      people.map((person) =>
        linkSsoIdentity(db, {
          organizationId,
          userId: person.id,
          providerId,
          issuer: 'https://idp.example.com/oauth2/default',
          subject,
          linkedAt: T0,
        }),
      ),
    );
    expect(linked.filter(Boolean)).toHaveLength(1);

    const fresh = await user('linked-once@example.com');
    const twice = await all(() =>
      linkSsoIdentity(db, {
        organizationId,
        userId: fresh.id,
        providerId,
        issuer: 'https://idp.example.com/oauth2/default',
        subject: `synthetic-subject-${randomBytes(4).toString('hex')}`,
        linkedAt: T0,
      }),
    );
    expect(twice.filter(Boolean)).toHaveLength(1);
  });
});
