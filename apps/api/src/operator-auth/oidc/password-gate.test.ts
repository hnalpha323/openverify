/**
 * C248.6 and C248.8 (Workflow 11B, `sso-oidc`) on PGlite: what the C4 password sign-in asks of
 * SSO, through `createOperatorAuth` (operator-auth.ts, a named borrowed edit).
 *
 * - The sign-in name narrows the accounts checked; an unknown name is the generic 401 after one
 *   dummy verification.
 * - An organisation whose provider is enforced refuses a right password with 403
 *   `sso_password_disabled`, a wrong one with the generic 401; the break-glass grant is used once,
 *   before its time, and cleared.
 * - The SSO callback's session and local-factor challenge go through operator-auth's own rules.
 *
 * Every value is synthetic.
 */
import { BUILTIN_ROLES } from '@openverify/core';
import {
  createSsoProvider,
  createUser,
  grantPasswordLogin,
  setOrganizationSlug,
  setUserRoles,
  syncBuiltinRoles,
  users,
  type User,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMfaService } from '../../services/mfa.js';
import { fixedClock } from '../../test-support/fakes.js';
import {
  InvalidCredentialsError,
  createOperatorAuth,
  type LoginOutcome,
} from '../operator-auth.js';
import type { PasswordHasher } from '../password-hasher.js';
import { totpCode } from '../totp.js';
import { SsoPasswordDisabledError } from './password-gate.js';

const PASSWORD = 'synthetic correct horse battery staple';
const T0 = new Date('2026-11-13T12:00:00Z');
const IP = '203.0.113.20';

let database: TestDatabase;
let counter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

/** A fast stand-in for Argon2id, so these tests exercise the login logic, not the KDF. */
function fakeHasher() {
  const encode = (password: string) =>
    `$argon2id$fake$${Buffer.from(password, 'utf8').toString('base64url')}`;
  const hasher = {
    hash: vi.fn((password: string) => Promise.resolve(encode(password))),
    verify: vi.fn((stored: string, password: string) =>
      Promise.resolve(stored === encode(password)),
    ),
  } satisfies PasswordHasher;
  return { hasher, encode };
}

function setup() {
  const { hasher } = fakeHasher();
  const clock = fixedClock(T0);
  const mfa = createMfaService({ db: database.db, hasher, clock });
  const auth = createOperatorAuth({ db: database.db, hasher, clock, mfa });
  return { auth, hasher, clock, mfa };
}

/** An organisation with a sign-in name and one operator holding the built-in admin role. */
async function organisation(options: { enforced?: boolean; email?: string } = {}) {
  const db = database.db;
  const { organization, environment } = await createTestTenant(db);
  counter += 1;
  const slug = `synthetic-org-${String(counter)}`;
  expect(await setOrganizationSlug(db, organization.id, slug)).toBe('set');
  const roles = await syncBuiltinRoles(db, organization.id, Object.values(BUILTIN_ROLES), () =>
    testId('role'),
  );
  const user = await createUser(db, {
    id: testId('usr'),
    organizationId: organization.id,
    email: options.email ?? `operator-${String(counter)}@example.com`,
    passwordHash: fakeHasher().encode(PASSWORD),
  });
  await setUserRoles(
    db,
    organization.id,
    user.id,
    roles.filter((role) => role.key === BUILTIN_ROLES.admin.key).map(({ id }) => id),
  );
  if (options.enforced !== undefined) {
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
      enforced: options.enforced,
      at: T0,
    });
  }
  return { organization, environment, user, slug };
}

function sessionOf(outcome: LoginOutcome) {
  if (outcome.kind !== 'session') {
    throw new Error('expected a session');
  }
  return outcome;
}

async function grantOf(user: User): Promise<Date | null> {
  const [row] = await database.db
    .select({ until: users.passwordLoginAllowedUntil })
    .from(users)
    .where(eq(users.id, user.id));
  return row?.until ?? null;
}

describe('the organisation hint on the password sign-in (C248.8)', () => {
  it('checks only the named organisation’s account when two organisations share the email', async () => {
    const email = `shared-${String(Date.now())}@example.com`;
    const first = await organisation({ email });
    const second = await organisation({ email });
    const { auth } = setup();

    const unnamed = sessionOf(await auth.login({ email, password: PASSWORD, ip: IP }));
    const named = sessionOf(
      await auth.login({ email, password: PASSWORD, ip: IP, organization: second.slug }),
    );
    const other = sessionOf(
      await auth.login({ email, password: PASSWORD, ip: IP, organization: first.slug }),
    );

    expect([first.user.id, second.user.id]).toContain(unnamed.user.id);
    expect(named.user.id).toBe(second.user.id);
    expect(other.user.id).toBe(first.user.id);
  });

  it('answers the generic 401 after one dummy verification for an unknown or another organisation’s name', async () => {
    const mine = await organisation();
    const elsewhere = await organisation();
    const { auth, hasher } = setup();

    for (const organization of ['synthetic-unknown-name', elsewhere.slug]) {
      hasher.verify.mockClear();
      await expect(
        auth.login({ email: mine.user.email, password: PASSWORD, ip: IP, organization }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
      expect(hasher.verify).toHaveBeenCalledTimes(1);
    }
  });
});

describe('password sign-in under an enforced provider (C248.6)', () => {
  it('refuses the right password with 403 sso_password_disabled and a wrong one with the generic 401', async () => {
    const { user } = await organisation({ enforced: true });
    const { auth } = setup();

    const right = auth.login({ email: user.email, password: PASSWORD, ip: IP });
    await expect(right).rejects.toBeInstanceOf(SsoPasswordDisabledError);
    await expect(right).rejects.toMatchObject({ status: 403, code: 'sso_password_disabled' });
    await expect(
      auth.login({ email: user.email, password: 'synthetic wrong password', ip: IP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('lets a password in where the provider is not enforced', async () => {
    const { user } = await organisation({ enforced: false });
    const { auth } = setup();

    expect(
      sessionOf(await auth.login({ email: user.email, password: PASSWORD, ip: IP })).user.id,
    ).toBe(user.id);
  });

  it('uses the break-glass grant once, before its time, and clears it', async () => {
    const { organization, user } = await organisation({ enforced: true });
    const { auth, clock } = setup();
    await grantPasswordLogin(
      database.db,
      organization.id,
      user.id,
      new Date(T0.getTime() + 3_600_000),
    );

    const once = sessionOf(await auth.login({ email: user.email, password: PASSWORD, ip: IP }));
    expect(once.user.id).toBe(user.id);
    expect(await grantOf(user)).toBeNull();
    await expect(
      auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    ).rejects.toBeInstanceOf(SsoPasswordDisabledError);

    // A grant past its time is not used.
    await grantPasswordLogin(
      database.db,
      organization.id,
      user.id,
      new Date(T0.getTime() + 60_000),
    );
    clock.advance(60_000);
    await expect(
      auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    ).rejects.toBeInstanceOf(SsoPasswordDisabledError);
  });
});

describe('the SSO callback’s session and challenge (C248.4-C248.6)', () => {
  it('opens a session in an environment the user may enter, starting the step-up window only when the token stood in for the factor', async () => {
    const { environment, user } = await organisation();
    const { auth } = setup();

    const passed = await auth.openSsoSession(user, true);
    const plain = await auth.openSsoSession(user, false);

    expect(passed.session).toMatchObject({
      userId: user.id,
      environmentId: environment.id,
      mfaSatisfied: true,
      mfaVerifiedAt: T0,
    });
    expect(plain.session).toMatchObject({ mfaSatisfied: false, mfaVerifiedAt: null });
    expect(await auth.authenticate(passed.token)).toMatchObject({ user: { id: user.id } });
  });

  it('starts the local factor’s challenge, or none for a user without a factor', async () => {
    const { organization, user } = await organisation();
    const bare = await organisation();
    const { auth, mfa, clock } = setup();
    const enrolment = await mfa.enrollTotp(organization.id, user);
    await mfa.confirmTotp(
      organization.id,
      user.id,
      enrolment.factor.id,
      totpCode(enrolment.secret, clock.now()),
    );

    const challenge = await auth.startSsoMfaChallenge(user);

    expect(challenge).toMatchObject({
      user: { id: user.id },
      factors: [{ id: enrolment.factor.id, type: 'totp' }],
    });
    expect(challenge?.mfaToken).toMatch(/^ovm_/);
    expect(await auth.startSsoMfaChallenge(bare.user)).toBeNull();
  });
});
