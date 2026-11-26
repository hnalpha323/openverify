import {
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_PATTERN,
  newId,
  newUserSessionToken,
  otpauthUriSchema,
  totpSecretSchema,
} from '@openverify/contracts';
import {
  createUser,
  createUserSession,
  hashSessionToken,
  listMfaFactors,
  listUnusedRecoveryCodes,
  userSessions,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError, UnprocessableContentError } from '../errors.js';
import type { PasswordHasher } from '../operator-auth/password-hasher.js';
import { totpCode } from '../operator-auth/totp.js';
import { fixedClock } from '../test-support/fakes.js';
import { createMfaService, type MfaService } from './mfa.js';

// Synthetic operators and secrets only.
let database: TestDatabase;
let emailCounter = 0;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

/** A fast, deterministic stand-in for Argon2id that still produces `$argon2id$` strings. */
function fakeHasher(): PasswordHasher {
  const encode = (value: string) =>
    `$argon2id$fake$${Buffer.from(value, 'utf8').toString('base64url')}`;
  return {
    hash: vi.fn((value: string) => Promise.resolve(encode(value))),
    verify: vi.fn((stored: string, value: string) => Promise.resolve(stored === encode(value))),
  };
}

async function setup() {
  const clock = fixedClock();
  const { organization, environment } = await createTestTenant(database.db);
  emailCounter += 1;
  const user = await createUser(database.db, {
    id: newId('usr'),
    organizationId: organization.id,
    email: `mfa-${String(emailCounter)}@example.test`,
    passwordHash: '$argon2id$fake$unused',
  });
  const mfa: MfaService = createMfaService({ db: database.db, hasher: fakeHasher(), clock });
  return { clock, organization, environment, user, mfa };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Enrols and confirms a TOTP factor; returns the factor, its secret and the recovery codes. */
async function confirmedTotp({ mfa, organization, user, clock }: Setup) {
  const enrolment = await mfa.enrollTotp(organization.id, user, 'Phone');
  const confirmed = await mfa.confirmTotp(
    organization.id,
    user.id,
    enrolment.factor.id,
    totpCode(enrolment.secret, clock.now()),
  );
  return { factor: confirmed.factor, secret: enrolment.secret, codes: confirmed.recoveryCodes };
}

describe('enrollTotp', () => {
  it('creates a pending factor and returns its secret and otpauth URI once', async () => {
    const { mfa, organization, user } = await setup();

    const enrolment = await mfa.enrollTotp(organization.id, user, 'Phone');

    expect(enrolment.factor).toMatchObject({ type: 'totp', name: 'Phone', confirmedAt: null });
    expect(enrolment.factor.id).toMatch(/^mfa_/);
    expect(totpSecretSchema.safeParse(enrolment.secret).success).toBe(true);
    expect(otpauthUriSchema.safeParse(enrolment.otpauthUri).success).toBe(true);
    expect(enrolment.otpauthUri).toContain(`secret=${enrolment.secret}`);
    expect(enrolment.otpauthUri).toContain(encodeURIComponent(user.email));
    expect(enrolment.otpauthUri).toContain('issuer=OpenVerify');
    // The secret is stored sealed, never in the clear.
    const raw = await database.client.query('select totp_secret from mfa_factors where id = $1', [
      enrolment.factor.id,
    ]);
    expect(JSON.stringify(raw.rows)).not.toContain(enrolment.secret);
  });

  it('names the factor "Authenticator app" by default', async () => {
    const { mfa, organization, user } = await setup();

    const enrolment = await mfa.enrollTotp(organization.id, user);

    expect(enrolment.factor.name).toBe('Authenticator app');
  });
});

describe('confirmTotp', () => {
  it('activates the factor with a valid code and returns recovery codes for the first factor', async () => {
    const context = await setup();

    const { factor, codes } = await confirmedTotp(context);

    expect(factor.confirmedAt).toEqual(context.clock.now());
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    for (const code of codes ?? []) {
      expect(code).toMatch(RECOVERY_CODE_PATTERN);
    }
    expect(
      await listUnusedRecoveryCodes(database.db, context.organization.id, context.user.id),
    ).toHaveLength(RECOVERY_CODE_COUNT);
  });

  it('returns no recovery codes when the user already has some', async () => {
    const context = await setup();
    await confirmedTotp(context);

    const second = await confirmedTotp(context);

    expect(second.codes).toBeNull();
  });

  it('refuses a wrong code with 422 and leaves the factor pending', async () => {
    const { mfa, organization, user, clock } = await setup();
    const enrolment = await mfa.enrollTotp(organization.id, user);
    const wrong = totpCode(enrolment.secret, new Date(clock.now().getTime() + 10 * 60_000));

    await expect(
      mfa.confirmTotp(organization.id, user.id, enrolment.factor.id, wrong),
    ).rejects.toBeInstanceOf(UnprocessableContentError);
    const [factor] = await listMfaFactors(database.db, organization.id, user.id);
    expect(factor?.confirmedAt).toBeNull();
  });

  it('answers 409 for a factor already confirmed and 404 for another user’s factor', async () => {
    const context = await setup();
    const { factor, secret } = await confirmedTotp(context);
    const other = await setup();

    await expect(
      context.mfa.confirmTotp(
        context.organization.id,
        context.user.id,
        factor.id,
        totpCode(secret, context.clock.now()),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      other.mfa.confirmTotp(other.organization.id, other.user.id, factor.id, '123456'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('verifyTotp', () => {
  it('accepts a confirmed factor’s code once per time step (replay protection)', async () => {
    const context = await setup();
    const { factor, secret } = await confirmedTotp(context);
    const { mfa, organization, user, clock } = context;
    clock.advance(30_000);
    const code = totpCode(secret, clock.now());

    await expect(mfa.verifyTotp(organization.id, user.id, code)).resolves.toMatchObject({
      id: factor.id,
    });
    await expect(mfa.verifyTotp(organization.id, user.id, code)).resolves.toBeNull();
    clock.advance(30_000);
    await expect(
      mfa.verifyTotp(organization.id, user.id, totpCode(secret, clock.now())),
    ).resolves.toMatchObject({ id: factor.id });
  });

  it('ignores pending factors and wrong codes', async () => {
    const { mfa, organization, user, clock } = await setup();
    const pending = await mfa.enrollTotp(organization.id, user);

    await expect(
      mfa.verifyTotp(organization.id, user.id, totpCode(pending.secret, clock.now())),
    ).resolves.toBeNull();
    await expect(mfa.verifyTotp(organization.id, user.id, '000000')).resolves.toBeNull();
  });
});

describe('recovery codes', () => {
  it('each works once, in any case and with or without hyphens', async () => {
    const context = await setup();
    const { codes } = await confirmedTotp(context);
    const { mfa, organization, user } = context;
    const [first = '', second = ''] = codes ?? [];

    await expect(mfa.useRecoveryCode(organization.id, user.id, first)).resolves.toBe(true);
    await expect(mfa.useRecoveryCode(organization.id, user.id, first)).resolves.toBe(false);
    await expect(
      mfa.useRecoveryCode(organization.id, user.id, second.toLowerCase().replace(/-/g, '')),
    ).resolves.toBe(true);
    await expect(mfa.useRecoveryCode(organization.id, user.id, 'not a code')).resolves.toBe(false);
    await expect(
      mfa.useRecoveryCode(organization.id, user.id, '0000-0000-0000'),
    ).resolves.toBe(false);
  });

  it('regenerates a set that replaces the previous codes', async () => {
    const context = await setup();
    const { codes } = await confirmedTotp(context);
    const { mfa, organization, user } = context;

    const fresh = await mfa.regenerateRecoveryCodes(organization.id, user.id);

    expect(fresh).toHaveLength(RECOVERY_CODE_COUNT);
    expect(fresh).not.toEqual(codes);
    await expect(mfa.useRecoveryCode(organization.id, user.id, codes?.[0] ?? '')).resolves.toBe(
      false,
    );
    await expect(mfa.useRecoveryCode(organization.id, user.id, fresh[0] ?? '')).resolves.toBe(true);
  });

  it('refuses to regenerate codes for a user without an active factor (409)', async () => {
    const { mfa, organization, user } = await setup();

    await expect(mfa.regenerateRecoveryCodes(organization.id, user.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe('listFactors and deleteFactor', () => {
  it('lists the user’s factors, oldest first, active or pending', async () => {
    const context = await setup();
    const { factor } = await confirmedTotp(context);
    const pending = await context.mfa.enrollTotp(context.organization.id, context.user);

    const factors = await context.mfa.listFactors(context.organization.id, context.user.id);

    expect(factors.map(({ id }) => id)).toEqual([factor.id, pending.factor.id]);
  });

  it('removes a factor, and the recovery codes with the last active one', async () => {
    const context = await setup();
    const { factor } = await confirmedTotp(context);
    const { mfa, organization, user } = context;
    const second = await confirmedTotp(context);

    await mfa.deleteFactor(organization.id, user.id, factor.id);
    expect(await listUnusedRecoveryCodes(database.db, organization.id, user.id)).toHaveLength(
      RECOVERY_CODE_COUNT,
    );

    await mfa.deleteFactor(organization.id, user.id, second.factor.id);
    expect(await listMfaFactors(database.db, organization.id, user.id)).toEqual([]);
    expect(await listUnusedRecoveryCodes(database.db, organization.id, user.id)).toEqual([]);
  });

  it('answers 404 for a factor that is not the user’s', async () => {
    const context = await setup();
    const { factor } = await confirmedTotp(context);
    const other = await setup();

    await expect(
      other.mfa.deleteFactor(other.organization.id, other.user.id, factor.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      context.mfa.deleteFactor(context.organization.id, context.user.id, newId('mfa')),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('resetUserMfa', () => {
  it('removes every factor and recovery code and revokes the user’s sessions', async () => {
    const context = await setup();
    await confirmedTotp(context);
    const { mfa, organization, environment, user, clock } = context;
    const session = await createUserSession(database.db, {
      id: newId('uss'),
      organizationId: organization.id,
      userId: user.id,
      environmentId: environment.id,
      tokenHash: hashSessionToken(newUserSessionToken()),
      expiresAt: new Date(clock.now().getTime() + 3_600_000),
      mfaSatisfied: true,
    });

    await expect(mfa.resetUserMfa(organization.id, user.id)).resolves.toEqual({
      factorsRemoved: 1,
      sessionsRevoked: 1,
    });

    expect(await listMfaFactors(database.db, organization.id, user.id)).toEqual([]);
    expect(await listUnusedRecoveryCodes(database.db, organization.id, user.id)).toEqual([]);
    const [stored] = await database.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, session.id));
    expect(stored?.revokedAt).toEqual(clock.now());
  });
});
