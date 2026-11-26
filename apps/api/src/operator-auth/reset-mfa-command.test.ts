import { newId, newUserSessionToken } from '@openverify/contracts';
import {
  createEnvironment,
  createUser,
  createUserSession,
  hashSessionToken,
  listAuditLogs,
  listMfaFactors,
  userSessions,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMfaService } from '../services/mfa.js';
import { fixedClock } from '../test-support/fakes.js';
import type { PasswordHasher } from './password-hasher.js';
import { RESET_MFA_USAGE, parseResetMfaArgs, runResetMfa } from './reset-mfa-command.js';
import { totpCode } from './totp.js';

// Synthetic operators only.
let database: TestDatabase;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

const hasher: PasswordHasher = {
  hash: (value) => Promise.resolve(`$argon2id$fake$${Buffer.from(value).toString('base64url')}`),
  verify: () => Promise.resolve(false),
};

function output() {
  const lines: string[] = [];
  return { lines, write: (chunk: string) => lines.push(chunk) };
}

/** An operator with an active TOTP factor and an open session, in an org with two environments. */
async function lockedOutOperator(email?: string) {
  const clock = fixedClock();
  const { organization, environment } = await createTestTenant(database.db);
  const production = await createEnvironment(database.db, {
    id: newId('env'),
    organizationId: organization.id,
    kind: 'production',
  });
  counter += 1;
  const user = await createUser(database.db, {
    id: newId('usr'),
    organizationId: organization.id,
    email: email ?? `locked-${String(counter)}@example.test`,
    passwordHash: '$argon2id$fake$unused',
  });
  const mfa = createMfaService({ db: database.db, hasher, clock });
  const enrolment = await mfa.enrollTotp(organization.id, user);
  await mfa.confirmTotp(
    organization.id,
    user.id,
    enrolment.factor.id,
    totpCode(enrolment.secret, clock.now()),
  );
  await createUserSession(database.db, {
    id: newId('uss'),
    organizationId: organization.id,
    userId: user.id,
    environmentId: environment.id,
    tokenHash: hashSessionToken(newUserSessionToken()),
    expiresAt: new Date(clock.now().getTime() + 3_600_000),
    mfaSatisfied: true,
  });
  return { organization, environment, production, user };
}

describe('parseResetMfaArgs', () => {
  it('takes an email and an optional --organization', () => {
    expect(parseResetMfaArgs(['admin@example.test'])).toEqual({ email: 'admin@example.test' });
    const organizationId = newId('org');
    expect(parseResetMfaArgs(['--organization', organizationId, 'admin@example.test'])).toEqual({
      email: 'admin@example.test',
      organizationId,
    });
  });

  it.each([
    [[]],
    [['--help']],
    [['a@example.test', 'b@example.test']],
    [['--organization']],
    [['--organization', 'nope', 'a@example.test']],
    [['not-an-email']],
    [['--unknown', 'a@example.test']],
  ])('refuses %j with the usage', (argv) => {
    expect(parseResetMfaArgs(argv)).toBeNull();
  });

  it('documents the command', () => {
    expect(RESET_MFA_USAGE).toContain('pnpm --filter @openverify/api user:reset-mfa <email>');
  });
});

describe('runResetMfa', () => {
  it('removes the user’s factors and codes, ends their sessions, and audits it in every environment', async () => {
    const { organization, environment, production, user } = await lockedOutOperator();
    const stdout = output();
    const stderr = output();

    const code = await runResetMfa({
      db: database.db,
      argv: [user.email.toUpperCase()],
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.lines).toEqual([]);
    expect(stdout.lines.join('')).toContain(`Reset MFA for ${user.id}`);
    expect(await listMfaFactors(database.db, organization.id, user.id)).toEqual([]);
    const sessions = await database.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, user.id));
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
    for (const environmentId of [environment.id, production.id]) {
      const [entry] = await listAuditLogs(database.db, environmentId);
      expect(entry).toMatchObject({
        actorType: 'system',
        action: 'user.mfa-reset',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { via: 'cli', 'factors-removed': 1, 'sessions-revoked': 1 },
      });
    }
  });

  it('asks for --organization when organizations share the email, then resets only that user', async () => {
    const email = `shared-${String(Date.now())}@example.test`;
    const first = await lockedOutOperator(email);
    const second = await lockedOutOperator(email);
    const stderr = output();

    const ambiguous = await runResetMfa({
      db: database.db,
      argv: [email],
      stdout: output(),
      stderr,
    });
    const chosen = await runResetMfa({
      db: database.db,
      argv: ['--organization', second.organization.id, email],
      stdout: output(),
      stderr: output(),
    });

    expect(ambiguous).toBe(1);
    expect(stderr.lines.join('')).toContain('--organization');
    expect(stderr.lines.join('')).toContain(first.organization.id);
    expect(chosen).toBe(0);
    expect(await listMfaFactors(database.db, first.organization.id, first.user.id)).toHaveLength(1);
    expect(await listMfaFactors(database.db, second.organization.id, second.user.id)).toEqual([]);
  });

  it('fails with exit code 1 for an unknown email, and 2 with the usage for bad arguments', async () => {
    const stderr = output();

    expect(
      await runResetMfa({
        db: database.db,
        argv: ['nobody@example.test'],
        stdout: output(),
        stderr,
      }),
    ).toBe(1);
    expect(stderr.lines.join('')).toContain('No user has the email nobody@example.test');
    const usage = output();
    expect(await runResetMfa({ db: database.db, argv: [], stdout: output(), stderr: usage })).toBe(
      2,
    );
    expect(usage.lines.join('')).toContain('Usage:');
  });
});
