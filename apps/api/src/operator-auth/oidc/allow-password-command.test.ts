/**
 * C248.6 (Workflow 11B, `sso-oidc`; review F11): the break-glass command on PGlite. It grants one
 * password sign-in within 24 hours to one active user of an organisation that enforces SSO, writes
 * `user.password-login-allowed` in every environment, prints ids only, and refuses everything else
 * without writing. Every value is synthetic.
 */
import { createHash } from 'node:crypto';
import {
  auditLogs,
  createSsoProvider,
  createUser,
  listEnvironments,
  users,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test-support/fakes.js';
import { ALLOW_PASSWORD_USAGE, runAllowPassword } from './allow-password-command.js';

let database: TestDatabase;
beforeAll(async () => {
  database = await createTestDatabase();
});
afterAll(async () => {
  await database.close();
});

const T0 = new Date('2026-11-13T12:00:00Z');
const PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$synthetic$synthetic';

async function organisation(enforced: boolean) {
  const db: Db = database.db;
  const { organization } = await createTestTenant(db);
  await createSsoProvider(db, {
    id: testId('ssop'),
    organizationId: organization.id,
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
    enforced,
    at: T0,
  });
  return organization.id;
}

async function user(organizationId: string, email: string) {
  return createUser(database.db, {
    id: testId('usr'),
    organizationId,
    email,
    passwordHash: PASSWORD_HASH,
  });
}

async function run(argv: readonly string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runAllowPassword({
    db: database.db,
    argv,
    stdout: { write: (chunk: string) => out.push(chunk) },
    stderr: { write: (chunk: string) => err.push(chunk) },
    clock: fixedClock(T0),
  });
  return { code, out: out.join(''), err: err.join('') };
}

const unique = (name: string) =>
  `${name}-${createHash('sha256').update(testId('usr')).digest('hex').slice(0, 8)}@example.com`;

describe('user:allow-password (C248.6, F11)', () => {
  it('grants one password sign-in for 24 hours, audited in every environment, printing ids only', async () => {
    const organizationId = await organisation(true);
    const email = unique('ada');
    const ada = await user(organizationId, email);
    const result = await run([email]);
    expect(result).toEqual({
      code: 0,
      out: `Allowed one password sign-in for ${ada.id} in ${organizationId} until 2026-11-14T12:00:00.000Z.\n`,
      err: '',
    });
    expect(result.out).not.toContain(email);
    const [row] = await database.db.select().from(users).where(eq(users.id, ada.id));
    expect(row?.passwordLoginAllowedUntil).toEqual(new Date('2026-11-14T12:00:00Z'));
    const environments = await listEnvironments(database.db, organizationId);
    const entries = await database.db
      .select()
      .from(auditLogs)
      .where(
        inArray(
          auditLogs.environmentId,
          environments.map((environment) => environment.id),
        ),
      );
    expect(entries).toHaveLength(environments.length);
    expect(
      entries.every(
        (entry) => entry.action === 'user.password-login-allowed' && entry.actorType === 'system',
      ),
    ).toBe(true);
    expect(entries[0]?.metadata).toEqual({
      via: 'cli',
      'allowed-until': '2026-11-14T12:00:00.000Z',
    });
  });

  it('prints the usage and answers 2 for arguments it cannot use', async () => {
    for (const argv of [
      [],
      ['not-an-email'],
      ['a@example.com', 'b@example.com'],
      ['a@example.com', '--organization', 'org_nope'],
      ['--force'],
    ]) {
      const result = await run(argv);
      expect(result.code).toBe(2);
      expect(result.err).toBe(ALLOW_PASSWORD_USAGE);
    }
    expect(ALLOW_PASSWORD_USAGE).toContain(
      'Usage: pnpm --filter @openverify/api user:allow-password <email>',
    );
  });

  it('refuses an unknown email, several organisations, a deactivated user, and an organisation that does not enforce SSO', async () => {
    expect((await run([unique('nobody')])).code).toBe(1);
    const shared = unique('shared');
    const first = await organisation(true);
    const second = await organisation(true);
    await user(first, shared);
    const theirs = await user(second, shared);
    const several = await run([shared]);
    expect(several.code).toBe(1);
    expect(several.err).toContain('--organization');
    expect((await run([shared, '--organization', second])).out).toContain(theirs.id);
    const open = await organisation(false);
    const grace = await user(open, unique('grace'));
    const notEnforced = await run([grace.email]);
    expect(notEnforced.code).toBe(1);
    expect(notEnforced.err).toContain('does not enforce single sign-on');
    const gone = await user(first, unique('gone'));
    await database.db.update(users).set({ status: 'deactivated' }).where(eq(users.id, gone.id));
    expect((await run([gone.email])).code).toBe(1);
    const [left] = await database.db.select().from(users).where(eq(users.id, grace.id));
    expect(left?.passwordLoginAllowedUntil).toBeNull();
  });
});
