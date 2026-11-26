import {
  MFA_TOKEN_TTL_SECONDS,
  USER_SESSION_TOKEN_TTL_SECONDS,
  mfaTokenSchema,
  newId,
  userSessionTokenSchema,
} from '@openverify/contracts';
import { BUILTIN_ROLES } from '@openverify/core';
import {
  createEnvironment,
  createOrganization,
  createRole,
  createUser,
  hashSessionToken,
  setOrganizationRequireMfa,
  setUserRoleAssignments,
  setUserRoles,
  setUserSessionEnvironment,
  syncBuiltinRoles,
  updateUser,
  userSessions,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Clock } from '../ports.js';
import { createMfaService, type MfaService } from '../services/mfa.js';
import { BFF_CLIENT_IP_HEADER, BFF_TOKEN_HEADER } from './client-address.js';
import { createLoginRateLimiter } from './login-rate-limiter.js';
import {
  InvalidCredentialsError,
  InvalidMfaCodeError,
  InvalidMfaTokenError,
  TooManyLoginAttemptsError,
  createOperatorAuth,
  type LoginOutcome,
  type OperatorAuthOptions,
} from './operator-auth.js';
import type { PasswordHasher } from './password-hasher.js';
import type { WebauthnSettings } from './settings.js';
import { createSoftwareAuthenticator } from './testing/software-authenticator.js';
import { totpCode } from './totp.js';

// Synthetic operators and credentials only.
const PASSWORD = 'correct horse battery staple';
const START = Date.parse('2026-10-20T12:00:00.000Z');
const IP = '203.0.113.10';

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

function fakeClock() {
  let now = START;
  const clock: Clock = { now: () => new Date(now) };
  return {
    clock,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

let database: TestDatabase;
let emailCounter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

/**
 * C167.2 (Workflow 9B): signing in needs a role in an environment, so each operator holds one
 * organisation-wide (with `environments:production`, so a production session can open).
 */
async function grantEverywhere(organizationId: string, userId: string): Promise<void> {
  const role = await createRole(database.db, organizationId, {
    id: testId('role'),
    name: `Synthetic operator ${testId('role')}`,
    permissions: ['inquiries:read', 'environments:production'],
  });
  await setUserRoles(database.db, organizationId, userId, [role.id]);
}

/** A sandbox organization with one operator whose email is unique to the test. */
async function operator(options: { password?: string; email?: string } = {}) {
  const { encode } = fakeHasher();
  const { organization, environment } = await createTestTenant(database.db);
  emailCounter += 1;
  const user = await createUser(database.db, {
    id: testId('usr'),
    organizationId: organization.id,
    email: options.email ?? `operator-${String(emailCounter)}@example.test`,
    passwordHash: encode(options.password ?? PASSWORD),
  });
  await grantEverywhere(organization.id, user.id);
  return { organization, environment, user };
}

function setup(overrides: Partial<OperatorAuthOptions> = {}) {
  const { hasher } = fakeHasher();
  const time = fakeClock();
  const auth = createOperatorAuth({ db: database.db, hasher, clock: time.clock, ...overrides });
  return { auth, hasher, ...time };
}

/** The session of a login that needed no second factor (C15 adds the MFA challenge outcome). */
function sessionOf(outcome: LoginOutcome) {
  if (outcome.kind !== 'session') {
    throw new Error('expected a session, got an MFA challenge');
  }
  return outcome;
}

describe('login', () => {
  it('opens a 12 hour session in the sandbox and stores only the token hash', async () => {
    const { environment, user } = await operator();
    const { auth } = setup();

    const result = sessionOf(await auth.login({ email: user.email, password: PASSWORD, ip: IP }));

    expect(userSessionTokenSchema.safeParse(result.token).success).toBe(true);
    expect(result.expiresAt).toEqual(new Date(START + USER_SESSION_TOKEN_TTL_SECONDS * 1000));
    expect(result.user.id).toBe(user.id);
    expect(result.session).toMatchObject({
      userId: user.id,
      environmentId: environment.id,
      tokenHash: hashSessionToken(result.token),
      expiresAt: result.expiresAt,
      revokedAt: null,
    });
    expect(result.session.id).toMatch(/^uss_/);

    const stored = await database.db.select().from(userSessions);
    expect(JSON.stringify(stored)).not.toContain(result.token);
  });

  it('matches the email regardless of case and surrounding spaces', async () => {
    const { user } = await operator();
    const { auth } = setup();

    const result = sessionOf(
      await auth.login({
        email: `  ${user.email.toUpperCase()} `,
        password: PASSWORD,
        ip: IP,
      }),
    );

    expect(result.user.id).toBe(user.id);
  });

  it('rejects a wrong password with the generic error', async () => {
    const { user } = await operator();
    const { auth } = setup();

    const failure = auth.login({ email: user.email, password: 'wrong password', ip: IP });

    await expect(failure).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(failure).rejects.toMatchObject({
      status: 401,
      message: 'The email or password is incorrect.',
    });
  });

  it('rejects an unknown email with the same error, after verifying against a dummy hash', async () => {
    const { auth, hasher } = setup();

    await expect(
      auth.login({ email: 'nobody@example.test', password: PASSWORD, ip: IP }),
    ).rejects.toThrow(new InvalidCredentialsError());

    // The password is still run through the KDF, so an unknown email takes as long as a known one.
    expect(hasher.verify).toHaveBeenCalledOnce();
    expect(hasher.verify.mock.calls[0]?.[0]).toMatch(/^\$argon2id\$/);
    expect(hasher.verify.mock.calls[0]?.[1]).toBe(PASSWORD);
  });

  it('computes the dummy hash once and reuses it', async () => {
    const { auth, hasher } = setup();

    await expect(
      auth.login({ email: 'nobody-1@example.test', password: PASSWORD, ip: IP }),
    ).rejects.toThrow(InvalidCredentialsError);
    await expect(
      auth.login({ email: 'nobody-2@example.test', password: PASSWORD, ip: IP }),
    ).rejects.toThrow(InvalidCredentialsError);

    expect(hasher.hash).toHaveBeenCalledOnce();
  });

  it('logs into the account whose password matches when organizations share an email', async () => {
    const first = await operator({ password: 'first organization password' });
    const second = await operator({ email: first.user.email, password: PASSWORD });
    const { auth } = setup();

    const result = sessionOf(
      await auth.login({ email: first.user.email, password: PASSWORD, ip: IP }),
    );

    expect(result.user.id).toBe(second.user.id);
    expect(result.session.environmentId).toBe(second.environment.id);
  });

  it('prefers the configured environment kind', async () => {
    const { organization, user } = await operator();
    const production = await createEnvironment(database.db, {
      id: testId('env'),
      organizationId: organization.id,
      kind: 'production',
    });
    const { auth } = setup({ environmentKind: 'production' });

    const result = sessionOf(await auth.login({ email: user.email, password: PASSWORD, ip: IP }));

    expect(result.session.environmentId).toBe(production.id);
  });

  it('falls back to the other environment when the preferred one does not exist', async () => {
    const { organization, environment, user } = await operator();
    const { auth } = setup({ environmentKind: 'production' });

    const result = sessionOf(await auth.login({ email: user.email, password: PASSWORD, ip: IP }));

    expect(organization.id).toBe(user.organizationId);
    expect(result.session.environmentId).toBe(environment.id);
  });

  it('refuses an operator whose organization has no environment, without saying why', async () => {
    const { encode } = fakeHasher();
    const organization = await createOrganization(database.db, {
      id: testId('org'),
      name: 'Example Empty Org',
    });
    const user = await createUser(database.db, {
      id: testId('usr'),
      organizationId: organization.id,
      email: 'no-environment@example.test',
      passwordHash: encode(PASSWORD),
    });
    const { auth } = setup();

    await expect(auth.login({ email: user.email, password: PASSWORD, ip: IP })).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  it('rate-limits before verifying the password', async () => {
    const { user } = await operator();
    const time = fakeClock();
    const rateLimiter = createLoginRateLimiter({
      perEmail: { max: 2, windowMs: 60_000 },
      clock: time.clock,
    });
    const { auth, hasher } = setup({ rateLimiter, clock: time.clock });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        auth.login({ email: user.email, password: 'wrong', ip: IP }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    hasher.verify.mockClear();

    const limited = auth.login({ email: user.email, password: PASSWORD, ip: IP });

    await expect(limited).rejects.toBeInstanceOf(TooManyLoginAttemptsError);
    await expect(limited).rejects.toMatchObject({
      status: 429,
      headers: { 'retry-after': '60' },
    });
    expect(hasher.verify).not.toHaveBeenCalled();
  });

  it('clears the email counter after a successful login', async () => {
    const { user } = await operator();
    const rateLimiter = createLoginRateLimiter({ perEmail: { max: 2, windowMs: 60_000 } });
    const { auth } = setup({ rateLimiter });

    await expect(auth.login({ email: user.email, password: 'wrong', ip: IP })).rejects.toThrow(
      InvalidCredentialsError,
    );
    await auth.login({ email: user.email, password: PASSWORD, ip: IP });

    await expect(auth.login({ email: user.email, password: 'wrong', ip: IP })).rejects.toThrow(
      InvalidCredentialsError,
    );
    await expect(
      auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    ).resolves.toMatchObject({ user: { id: user.id } });
  });
});

describe('authenticate', () => {
  it('resolves a live session token to the operator and their environment', async () => {
    const { environment, organization, user } = await operator();
    const { auth } = setup();
    const { token, session } = sessionOf(
      await auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );

    await expect(auth.authenticate(token)).resolves.toEqual({
      sessionId: session.id,
      organizationId: organization.id,
      environmentId: environment.id,
      environmentKind: 'sandbox',
      user: expect.objectContaining({ id: user.id, email: user.email }) as unknown,
      // The operator's organisation-wide role (C167.2: signing in needs one).
      permissions: new Set(['inquiries:read', 'environments:production']),
      mfaSatisfied: true,
    });
  });

  it('rejects a session once it has expired', async () => {
    const { user } = await operator();
    const { auth, advance } = setup();
    const { token } = sessionOf(
      await auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );

    // C245.1 (Workflow 11B): a request every 20 minutes keeps it inside the idle limit, so it ends at
    // its absolute limit, as 401 session_expired (C245.2).
    const step = 20 * 60 * 1000;
    for (let elapsed = step; elapsed < USER_SESSION_TOKEN_TTL_SECONDS * 1000; elapsed += step) {
      advance(step);
      await expect(auth.authenticate(token)).resolves.not.toBeNull();
    }
    advance(step - 1);
    await expect(auth.authenticate(token)).resolves.not.toBeNull();
    advance(1);
    await expect(auth.authenticate(token)).rejects.toMatchObject({
      code: 'session_expired',
      reason: 'absolute',
    });
  });

  it('rejects unknown and malformed tokens', async () => {
    const { auth } = setup();

    await expect(auth.authenticate(`ovu_${'A'.repeat(43)}`)).resolves.toBeNull();
    await expect(auth.authenticate('not-a-token')).resolves.toBeNull();
    await expect(auth.authenticate(`ovs_${'A'.repeat(43)}`)).resolves.toBeNull();
  });
});

describe('logout', () => {
  it('revokes the session, so its token stops working', async () => {
    const { user } = await operator();
    const { auth } = setup();
    const { token, session } = sessionOf(
      await auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );

    await expect(auth.logout(session.id)).resolves.toBe(true);

    await expect(auth.authenticate(token)).resolves.toBeNull();
    await expect(auth.logout(session.id)).resolves.toBe(false);
  });
});

describe('a failing password hasher', () => {
  it('fails the login of an unknown email instead of answering early', async () => {
    const failure = new Error('synthetic hasher failure');
    const { hasher } = fakeHasher();
    hasher.hash.mockRejectedValue(failure);
    const auth = createOperatorAuth({ db: database.db, hasher });

    await expect(
      auth.login({ email: 'nobody-3@example.test', password: PASSWORD, ip: IP }),
    ).rejects.toBe(failure);
  });
});

describe('defaults', () => {
  it('uses the real Argon2id hasher, the system clock and ULIDs when not injected', async () => {
    const { hashPassword } = await import('./password-hasher.js');
    const { organization } = await createTestTenant(database.db);
    const user = await createUser(database.db, {
      id: testId('usr'),
      organizationId: organization.id,
      email: 'defaults@example.test',
      passwordHash: await hashPassword(PASSWORD),
    });
    await grantEverywhere(organization.id, user.id);
    const auth = createOperatorAuth({ db: database.db });
    const before = Date.now();

    const result = sessionOf(await auth.login({ email: user.email, password: PASSWORD, ip: IP }));

    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + USER_SESSION_TOKEN_TTL_SECONDS * 1000,
    );
    await expect(auth.authenticate(result.token)).resolves.toMatchObject({
      user: { id: user.id },
    });
  });
});

// C15 ----------------------------------------------------------------------------------

/** An operator holding the given built-in roles of its organization. */
async function operatorWithRoles(keys: (keyof typeof BUILTIN_ROLES)[]) {
  const context = await operator();
  const roles = await syncBuiltinRoles(
    database.db,
    context.organization.id,
    Object.values(BUILTIN_ROLES),
    () => newId('role'),
  );
  await setUserRoles(
    database.db,
    context.organization.id,
    context.user.id,
    roles
      .filter((role) => keys.includes(role.key as keyof typeof BUILTIN_ROLES))
      .map(({ id }) => id),
  );
  return context;
}

/** Sets up auth with an MFA service over the same clock and hasher. */
const WEBAUTHN: WebauthnSettings = {
  rpId: 'localhost',
  rpName: 'OpenVerify',
  origin: 'http://localhost:3001',
};

function setupWithMfa(overrides: Partial<OperatorAuthOptions> = {}) {
  const context = setup({ webauthn: WEBAUTHN, ...overrides });
  const clock = overrides.clock ?? context.clock;
  const mfa = createMfaService({
    db: database.db,
    hasher: context.hasher,
    clock,
    webauthn: WEBAUTHN,
  });
  return { ...context, clock, mfa };
}

/** An operator with a confirmed TOTP factor and recovery codes. */
async function operatorWithTotp(context: ReturnType<typeof setupWithMfa>) {
  const owner = await operator();
  const enrolment = await context.mfa.enrollTotp(owner.organization.id, owner.user);
  const confirmed = await context.mfa.confirmTotp(
    owner.organization.id,
    owner.user.id,
    enrolment.factor.id,
    totpCode(enrolment.secret, context.clock.now()),
  );
  // The next code is a new time step: the enrolment's step is spent.
  context.advance(30_000);
  return {
    ...owner,
    factor: confirmed.factor,
    secret: enrolment.secret,
    codes: confirmed.recoveryCodes ?? [],
  };
}

function mfaOf(outcome: LoginOutcome) {
  if (outcome.kind !== 'mfa') {
    throw new Error('expected an MFA challenge, got a session');
  }
  return outcome;
}

describe('authenticate: the C15 session context', () => {
  it('grants the union of the user’s role permissions', async () => {
    const { user } = await operatorWithRoles(['reviewer', 'viewer']);
    const { auth } = setup();
    const { token } = sessionOf(
      await auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );

    const operatorContext = await auth.authenticate(token);

    expect(operatorContext?.permissions).toEqual(
      new Set([...BUILTIN_ROLES.reviewer.permissions, ...BUILTIN_ROLES.viewer.permissions]),
    );
  });

  it('reports the kind of the session’s environment', async () => {
    // Only a user who may enter production keeps a production session (2B F003).
    const { organization, user } = await operatorWithRoles(['developer']);
    await createEnvironment(database.db, {
      id: newId('env'),
      organizationId: organization.id,
      kind: 'production',
    });
    const { auth } = setup({ environmentKind: 'production' });
    const { token } = sessionOf(
      await auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );

    await expect(auth.authenticate(token)).resolves.toMatchObject({
      environmentKind: 'production',
    });
  });

  it('refuses a production session to a user without environments:production (2B F003)', async () => {
    const { organization, user } = await operatorWithRoles(['viewer']);
    const production = await createEnvironment(database.db, {
      id: newId('env'),
      organizationId: organization.id,
      kind: 'production',
    });
    const { auth } = setup({ environmentKind: 'production' });
    const { token, session } = sessionOf(
      await auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );
    // C167.2 (Workflow 9B): sign-in no longer opens production without the right, so the session
    // is moved there as a demotion while in production would leave it.
    await setUserSessionEnvironment(database.db, session.id, production.id);

    await expect(auth.authenticate(token)).resolves.toBeNull();
  });

  it('is not MFA-satisfied while the organization requires MFA and the session has not passed it', async () => {
    const { organization, user } = await operator();
    const { auth } = setup();
    const { token } = sessionOf(
      await auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );
    await expect(auth.authenticate(token)).resolves.toMatchObject({ mfaSatisfied: true });

    await setOrganizationRequireMfa(database.db, organization.id, true);

    await expect(auth.authenticate(token)).resolves.toMatchObject({ mfaSatisfied: false });
  });

  it('stops resolving a deactivated user’s session', async () => {
    const { organization, user } = await operator();
    const { auth } = setup();
    const { token } = sessionOf(
      await auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );

    await updateUser(database.db, organization.id, user.id, { status: 'deactivated' });

    await expect(auth.authenticate(token)).resolves.toBeNull();
  });
});

describe('login with MFA (C15)', () => {
  it('answers a correct password with a 5 minute ovm_ challenge listing the active factors', async () => {
    const context = setupWithMfa();
    const { user, factor, organization } = await operatorWithTotp(context);
    await context.mfa.enrollTotp(organization.id, user, 'Pending factor');

    const challenge = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );

    expect(mfaTokenSchema.safeParse(challenge.mfaToken).success).toBe(true);
    expect(challenge.expiresAt).toEqual(
      new Date(context.clock.now().getTime() + MFA_TOKEN_TTL_SECONDS * 1000),
    );
    expect(challenge.factors).toEqual([{ id: factor.id, type: 'totp' }]);
    expect(challenge.user.id).toBe(user.id);
    const sessions = await database.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, user.id));
    expect(sessions).toEqual([]);
    expect(
      JSON.stringify(await database.client.query('select * from mfa_challenges')),
    ).not.toContain(challenge.mfaToken);
  });

  it('still refuses a wrong password with the generic error', async () => {
    const context = setupWithMfa();
    const { user } = await operatorWithTotp(context);

    await expect(
      context.auth.login({ email: user.email, password: 'wrong', ip: IP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('opens an MFA-satisfied session with a valid TOTP code, once', async () => {
    const context = setupWithMfa();
    const { user, secret, organization } = await operatorWithTotp(context);
    await setOrganizationRequireMfa(database.db, organization.id, true);
    const { mfaToken } = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );

    const result = await context.auth.completeMfa({
      mfaToken,
      totpCode: totpCode(secret, context.clock.now()),
    });

    expect(result.method).toBe('totp');
    expect(result.user.id).toBe(user.id);
    expect(result.session).toMatchObject({ userId: user.id, mfaSatisfied: true, revokedAt: null });
    await expect(context.auth.authenticate(result.token)).resolves.toMatchObject({
      mfaSatisfied: true,
    });
    await expect(
      context.auth.completeMfa({ mfaToken, totpCode: totpCode(secret, context.clock.now()) }),
    ).rejects.toBeInstanceOf(InvalidMfaTokenError);
  });

  it('refuses a replayed code: a time step is accepted once', async () => {
    const context = setupWithMfa();
    const { user, secret } = await operatorWithTotp(context);
    const code = totpCode(secret, context.clock.now());
    const first = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );
    await context.auth.completeMfa({ mfaToken: first.mfaToken, totpCode: code });
    const second = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );

    await expect(
      context.auth.completeMfa({ mfaToken: second.mfaToken, totpCode: code }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);
  });

  it('revokes the mfa-token after five wrong codes', async () => {
    const context = setupWithMfa();
    const { user, secret } = await operatorWithTotp(context);
    const { mfaToken } = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );
    const wrong = totpCode(secret, new Date(context.clock.now().getTime() + 600_000));

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(context.auth.completeMfa({ mfaToken, totpCode: wrong })).rejects.toBeInstanceOf(
        InvalidMfaCodeError,
      );
    }
    // Four failures leave the token usable...
    const fourth = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await context.auth
        .completeMfa({ mfaToken: fourth.mfaToken, totpCode: wrong })
        .catch(() => undefined);
    }
    await expect(
      context.auth.completeMfa({
        mfaToken: fourth.mfaToken,
        totpCode: totpCode(secret, context.clock.now()),
      }),
    ).resolves.toMatchObject({ method: 'totp' });

    // ...the fifth revokes it, so even the right code no longer works.
    await expect(context.auth.completeMfa({ mfaToken, totpCode: wrong })).rejects.toBeInstanceOf(
      InvalidMfaCodeError,
    );
    context.advance(30_000);
    await expect(
      context.auth.completeMfa({ mfaToken, totpCode: totpCode(secret, context.clock.now()) }),
    ).rejects.toBeInstanceOf(InvalidMfaTokenError);
  });

  it('counts parallel guesses against the five-attempt limit before checking them (2B F004)', async () => {
    const context = setupWithMfa();
    const { user, secret } = await operatorWithTotp(context);
    let checked = 0;
    const slow: MfaService = {
      ...context.mfa,
      async verifyTotp(organizationId, userId, code) {
        checked += 1;
        // A slow check, as an Argon2 recovery code is: every guess sent meanwhile races it.
        await new Promise((resolve) => setTimeout(resolve, 20));
        return context.mfa.verifyTotp(organizationId, userId, code);
      },
    };
    const { auth } = setup({ clock: context.clock, mfa: slow });
    const { mfaToken } = mfaOf(await auth.login({ email: user.email, password: PASSWORD, ip: IP }));
    const wrong = totpCode(secret, new Date(context.clock.now().getTime() + 600_000));

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => auth.completeMfa({ mfaToken, totpCode: wrong })),
    );

    const reasons = results.map((result) =>
      result.status === 'rejected' ? (result.reason as Error).name : 'fulfilled',
    );
    expect(checked).toBe(5);
    // C25.1 (Workflow 2E): the wrong guess that revoked the token answers exhausted; a wrong guess
    // checked before it still answers a wrong code, one checked after it an invalid token.
    expect(reasons.filter((name) => name === 'MfaAttemptsExhaustedError')).toHaveLength(1);
    expect(
      reasons.filter((name) => name === 'InvalidMfaCodeError' || name === 'InvalidMfaTokenError'),
    ).toHaveLength(11);
    expect(reasons.filter((name) => name === 'InvalidMfaTokenError').length).toBeGreaterThanOrEqual(
      7,
    );
    await expect(
      auth.completeMfa({ mfaToken, totpCode: totpCode(secret, context.clock.now()) }),
    ).rejects.toBeInstanceOf(InvalidMfaTokenError);
  });

  it('accepts a recovery code once instead of a TOTP code', async () => {
    const context = setupWithMfa();
    const { user, codes } = await operatorWithTotp(context);
    const [code = ''] = codes;
    const first = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );

    await expect(
      context.auth.completeMfa({ mfaToken: first.mfaToken, recoveryCode: code.toLowerCase() }),
    ).resolves.toMatchObject({ method: 'recovery-code', session: { mfaSatisfied: true } });

    const second = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );
    await expect(
      context.auth.completeMfa({ mfaToken: second.mfaToken, recoveryCode: code }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);
  });

  it('refuses an expired, unknown or malformed mfa-token, and a token whose user was deactivated', async () => {
    const context = setupWithMfa();
    const { user, secret, organization } = await operatorWithTotp(context);
    const expiring = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );
    context.advance(MFA_TOKEN_TTL_SECONDS * 1000);

    await expect(
      context.auth.completeMfa({
        mfaToken: expiring.mfaToken,
        totpCode: totpCode(secret, context.clock.now()),
      }),
    ).rejects.toBeInstanceOf(InvalidMfaTokenError);
    await expect(
      context.auth.completeMfa({ mfaToken: `ovm_${'A'.repeat(43)}`, totpCode: '123456' }),
    ).rejects.toBeInstanceOf(InvalidMfaTokenError);
    await expect(
      context.auth.completeMfa({ mfaToken: 'not-a-token', totpCode: '123456' }),
    ).rejects.toBeInstanceOf(InvalidMfaTokenError);

    const live = mfaOf(await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }));
    await updateUser(database.db, organization.id, user.id, { status: 'deactivated' });
    await expect(
      context.auth.completeMfa({
        mfaToken: live.mfaToken,
        totpCode: totpCode(secret, context.clock.now()),
      }),
    ).rejects.toBeInstanceOf(InvalidMfaTokenError);
  });

  it('keeps counting the email until the second factor passes, then forgets it', async () => {
    const time = fakeClock();
    const rateLimiter = createLoginRateLimiter({
      perEmail: { max: 2, windowMs: 60_000 },
      clock: time.clock,
    });
    const context = setupWithMfa({ rateLimiter, clock: time.clock });
    const { user, secret } = await operatorWithTotp({
      ...context,
      clock: time.clock,
      advance: time.advance,
    });

    const first = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );
    await context.auth.completeMfa({
      mfaToken: first.mfaToken,
      totpCode: totpCode(secret, time.clock.now()),
    });
    mfaOf(await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }));
    mfaOf(await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }));

    // Two correct passwords without a second factor used the email's allowance.
    await expect(
      context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    ).rejects.toBeInstanceOf(TooManyLoginAttemptsError);
  });

  it('opens a session that is not MFA-satisfied for a user without a factor when MFA is required', async () => {
    const { organization, user } = await operator();
    await setOrganizationRequireMfa(database.db, organization.id, true);
    const { auth } = setup();

    const result = sessionOf(await auth.login({ email: user.email, password: PASSWORD, ip: IP }));

    expect(result.session.mfaSatisfied).toBe(false);
    await expect(auth.authenticate(result.token)).resolves.toMatchObject({ mfaSatisfied: false });
  });
});

describe('clientAddress', () => {
  const BFF_TOKEN = 'synthetic-bff-token-0123456789abcdef-0123';
  const request = (headers: Record<string, string>) =>
    ({ ip: '10.0.0.5', headers }) as unknown as FastifyRequest;

  it('believes the BFF’s client address only with the configured token', () => {
    const { auth } = setup({ bffToken: BFF_TOKEN });
    const { auth: withoutToken } = setup();
    const headers = { [BFF_CLIENT_IP_HEADER]: '203.0.113.5', [BFF_TOKEN_HEADER]: BFF_TOKEN };

    expect(auth.clientAddress(request(headers))).toBe('203.0.113.5');
    expect(withoutToken.clientAddress(request(headers))).toBe('10.0.0.5');
  });
});

describe('login with a WebAuthn second factor (C15)', () => {
  async function operatorWithKey(context: ReturnType<typeof setupWithMfa>) {
    const owner = await operator();
    const authenticator = createSoftwareAuthenticator({ origin: WEBAUTHN.origin });
    const options = await context.mfa.webauthnRegistrationOptions(
      owner.organization.id,
      owner.user,
    );
    const { factor } = await context.mfa.verifyWebauthnRegistration(
      owner.organization.id,
      owner.user.id,
      authenticator.register(options),
    );
    return { ...owner, authenticator, factor };
  }

  it('lists the key in the challenge and opens a session for a signed assertion', async () => {
    const context = setupWithMfa();
    const { user, authenticator, factor } = await operatorWithKey(context);
    const challenge = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );
    expect(challenge.factors).toEqual([{ id: factor.id, type: 'webauthn' }]);

    const options = await context.auth.webauthnLoginOptions(challenge.mfaToken);
    const result = await context.auth.completeWebauthnMfa({
      mfaToken: challenge.mfaToken,
      credential: authenticator.authenticate(options),
    });

    expect(options.allowCredentials?.map(({ id }) => id)).toEqual([authenticator.credentialId]);
    expect(result).toMatchObject({ method: 'webauthn', session: { mfaSatisfied: true } });
  });

  it('counts a bad assertion against the mfa-token, and revokes it at the fifth', async () => {
    const context = setupWithMfa();
    const { user, authenticator } = await operatorWithKey(context);
    const { mfaToken } = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );
    const options = await context.auth.webauthnLoginOptions(mfaToken);
    const stranger = createSoftwareAuthenticator({ origin: WEBAUTHN.origin });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        context.auth.completeWebauthnMfa({ mfaToken, credential: stranger.authenticate(options) }),
      ).rejects.toBeInstanceOf(InvalidMfaCodeError);
    }

    await expect(
      context.auth.completeWebauthnMfa({
        mfaToken,
        credential: authenticator.authenticate(options),
      }),
    ).rejects.toBeInstanceOf(InvalidMfaTokenError);
  });

  it('refuses an assertion for a challenge this mfa-token was not given', async () => {
    const context = setupWithMfa();
    const { user, authenticator } = await operatorWithKey(context);
    const first = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );
    const second = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );
    const options = await context.auth.webauthnLoginOptions(first.mfaToken);

    await expect(
      context.auth.completeWebauthnMfa({
        mfaToken: second.mfaToken,
        credential: authenticator.authenticate(options),
      }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);
    await expect(
      context.auth.completeWebauthnMfa({
        mfaToken: first.mfaToken,
        credential: {
          ...authenticator.authenticate(options),
          response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
        },
      }),
    ).rejects.toBeInstanceOf(InvalidMfaCodeError);
  });

  it('refuses options for a user without a WebAuthn factor (409) and for an unusable token', async () => {
    const context = setupWithMfa();
    const { user } = await operatorWithTotp(context);
    const { mfaToken } = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );

    await expect(context.auth.webauthnLoginOptions(mfaToken)).rejects.toMatchObject({
      status: 409,
    });
    await expect(context.auth.webauthnLoginOptions('not-a-token')).rejects.toBeInstanceOf(
      InvalidMfaTokenError,
    );
  });
});

describe('the sign-in environment (C167.2; review F29)', () => {
  /** An organisation with a sandbox and a production, and an operator holding `assignments`. */
  async function tenantWith(
    assignments: (environments: { sandbox: string; production: string }) => {
      permissions: string[];
      environmentIds: string[] | null;
    }[],
  ) {
    const { organization, environment: sandbox, user } = await operator();
    const production = await createEnvironment(database.db, {
      id: testId('env'),
      organizationId: organization.id,
      kind: 'production',
    });
    const wanted = assignments({ sandbox: sandbox.id, production: production.id });
    const roles = [];
    for (const assignment of wanted) {
      const role = await createRole(database.db, organization.id, {
        id: testId('role'),
        name: `Synthetic assigned ${testId('role')}`,
        permissions: assignment.permissions,
      });
      roles.push({ roleId: role.id, environmentIds: assignment.environmentIds });
    }
    await setUserRoleAssignments(database.db, organization.id, user.id, roles);
    return { organization, sandbox, production, user };
  }

  it('opens production for a user who holds roles in production only (F29)', async () => {
    const { production, user } = await tenantWith(({ production }) => [
      { permissions: ['inquiries:read', 'environments:production'], environmentIds: [production] },
    ]);
    const { auth } = setup();

    const result = sessionOf(await auth.login({ email: user.email, password: PASSWORD, ip: IP }));

    expect(result.session.environmentId).toBe(production.id);
    await expect(auth.authenticate(result.token)).resolves.toMatchObject({
      environmentId: production.id,
      environmentKind: 'production',
    });
  });

  it('opens the sandbox first when the user holds a role in both', async () => {
    const { sandbox, user } = await tenantWith(({ sandbox, production }) => [
      { permissions: ['inquiries:read'], environmentIds: [sandbox] },
      { permissions: ['inquiries:read', 'environments:production'], environmentIds: [production] },
    ]);
    const { auth } = setup();

    const result = sessionOf(await auth.login({ email: user.email, password: PASSWORD, ip: IP }));

    expect(result.session.environmentId).toBe(sandbox.id);
  });

  it('answers 403 no_environment_role, and opens no session, when the user holds no role it may use', async () => {
    const roleless = await tenantWith(() => []);
    const productionWithoutRight = await tenantWith(({ production }) => [
      { permissions: ['inquiries:read'], environmentIds: [production] },
    ]);
    const { auth } = setup();

    for (const { user } of [roleless, productionWithoutRight]) {
      await expect(
        auth.login({ email: user.email, password: PASSWORD, ip: IP }),
      ).rejects.toMatchObject({ status: 403, code: 'no_environment_role' });
      const sessions = await database.db
        .select()
        .from(userSessions)
        .where(eq(userSessions.userId, user.id));
      expect(sessions).toEqual([]);
    }
  });

  it('checks the role only once the second factor passed, and sets mfa_verified_at on that session (C168.1)', async () => {
    const context = setupWithMfa();
    const { user, secret, organization } = await operatorWithTotp(context);
    const challenge = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );
    const verifiedAt = context.clock.now();
    const verified = await context.auth.completeMfa({
      mfaToken: challenge.mfaToken,
      totpCode: totpCode(secret, context.clock.now()),
    });
    context.advance(30_000);
    await setUserRoles(database.db, organization.id, user.id, []);
    const second = mfaOf(
      await context.auth.login({ email: user.email, password: PASSWORD, ip: IP }),
    );

    expect(verified.session.mfaVerifiedAt).toEqual(verifiedAt);
    await expect(
      context.auth.completeMfa({
        mfaToken: second.mfaToken,
        totpCode: totpCode(secret, context.clock.now()),
      }),
    ).rejects.toMatchObject({ status: 403, code: 'no_environment_role' });
  });

  it('leaves mfa_verified_at unset on a password-only session', async () => {
    const { user } = await operator();
    const { auth } = setup();

    const result = sessionOf(await auth.login({ email: user.email, password: PASSWORD, ip: IP }));

    expect(result.session.mfaVerifiedAt).toBeNull();
  });
});
