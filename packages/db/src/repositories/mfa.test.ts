/** C15 MFA: TOTP and WebAuthn factors, recovery codes, login challenges. */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '../testing.js';
import { hashSessionToken } from '../tokens.js';
import {
  confirmMfaFactor,
  consumeMfaChallenge,
  consumeWebauthnRegistrationChallenge,
  createMfaChallenge,
  createTotpFactor,
  createUser,
  createWebauthnFactor,
  createWebauthnRegistrationChallenge,
  deleteMfaFactor,
  findActiveMfaChallenge,
  findWebauthnFactor,
  getTotpSecret,
  listMfaFactors,
  listUnusedRecoveryCodes,
  recordMfaChallengeFailure,
  recordTotpUse,
  recordWebauthnUse,
  replaceRecoveryCodes,
  reserveMfaChallengeAttempt,
  revokeExhaustedMfaChallenge,
  setMfaChallengeWebauthnChallenge,
  useRecoveryCode,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const ARGON2 = (salt: string) => `$argon2id$v=19$m=19456,t=2,p=1$${salt}$c3ludGhldGljaGFzaA`;

async function setup() {
  const { organization } = await createTestTenant(database.db);
  const user = await createUser(database.db, {
    id: testId('usr'),
    organizationId: organization.id,
    email: `${testId('usr').toLowerCase()}@example.test`,
    passwordHash: ARGON2('c2FsdA'),
  });
  return { org: organization.id, userId: user.id };
}

describe('TOTP factors', () => {
  it('seal the secret, activate on confirmation, and refuse a reused step', async () => {
    const { org, userId } = await setup();
    const factor = await createTotpFactor(database.db, org, {
      id: testId('mfa'),
      userId,
      name: 'Phone',
      secret: 'JBSWY3DPEHPK3PXP',
    });
    const raw = await database.db.execute(
      sql`select totp_secret from mfa_factors where id = ${factor.id}`,
    );

    const unconfirmed = await listMfaFactors(database.db, org, userId, { confirmedOnly: true });
    const confirmed = await confirmMfaFactor(database.db, org, factor.id, { step: 100 });
    const replay = await recordTotpUse(database.db, org, factor.id, 100);
    const next = await recordTotpUse(database.db, org, factor.id, 101);

    expect(factor).toMatchObject({ type: 'totp', name: 'Phone', confirmedAt: null });
    expect(JSON.stringify(factor)).not.toContain('JBSWY3DPEHPK3PXP');
    expect(JSON.stringify(raw.rows)).not.toContain('JBSWY3DPEHPK3PXP');
    expect(unconfirmed).toEqual([]);
    expect(confirmed).toMatchObject({ confirmedAt: expect.any(Date) as Date, lastUsedStep: 100 });
    expect(replay).toBe(false);
    expect(next).toBe(true);
    expect(await getTotpSecret(database.db, org, factor.id)).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      lastUsedStep: 101,
    });
    expect(await getTotpSecret(database.db, testId('org'), factor.id)).toBeNull();
    expect(await confirmMfaFactor(database.db, org, factor.id, {})).toBeNull();
  });
});

describe('WebAuthn factors', () => {
  it('store the credential, find it for the user, and move the counter forward only', async () => {
    const { org, userId } = await setup();
    const factor = await createWebauthnFactor(database.db, org, {
      id: testId('mfa'),
      userId,
      name: 'Security key',
      credentialId: 'Y3JlZGVudGlhbC0x',
      publicKey: 'cHVibGljLWtleQ',
      counter: 5,
      transports: ['usb'],
    });

    expect(factor).toMatchObject({
      type: 'webauthn',
      confirmedAt: expect.any(Date) as Date,
      webauthnCounter: 5,
    });
    expect(await findWebauthnFactor(database.db, org, userId, 'Y3JlZGVudGlhbC0x')).toEqual(factor);
    expect(
      await findWebauthnFactor(database.db, org, testId('usr'), 'Y3JlZGVudGlhbC0x'),
    ).toBeNull();
    expect(await recordWebauthnUse(database.db, org, factor.id, 4)).toBe(false);
    expect(await recordWebauthnUse(database.db, org, factor.id, 6)).toBe(true);
    expect((await listMfaFactors(database.db, org, userId)).map((entry) => entry.id)).toEqual([
      factor.id,
    ]);
    expect(await deleteMfaFactor(database.db, org, userId, factor.id)).toBe(true);
    expect(await deleteMfaFactor(database.db, org, userId, factor.id)).toBe(false);
  });

  it('accept a zero counter from authenticators without one', async () => {
    const { org, userId } = await setup();
    const factor = await createWebauthnFactor(database.db, org, {
      id: testId('mfa'),
      userId,
      name: 'Platform',
      credentialId: 'Y3JlZGVudGlhbC0y',
      publicKey: 'cHVibGljLWtleQ',
      counter: 0,
      transports: [],
    });

    expect(await recordWebauthnUse(database.db, org, factor.id, 0)).toBe(true);
  });
});

describe('recovery codes', () => {
  it('replace the whole set and work once each', async () => {
    const { org, userId } = await setup();
    await replaceRecoveryCodes(database.db, org, userId, [ARGON2('b2xk')]);

    await replaceRecoveryCodes(database.db, org, userId, [ARGON2('YQ'), ARGON2('Yg')]);
    const codes = await listUnusedRecoveryCodes(database.db, org, userId);
    const first = codes[0];

    expect(codes.map((code) => code.codeHash)).toEqual([ARGON2('YQ'), ARGON2('Yg')]);
    expect(await useRecoveryCode(database.db, org, userId, first?.id ?? -1)).toBe(true);
    expect(await useRecoveryCode(database.db, org, userId, first?.id ?? -1)).toBe(false);
    expect(await listUnusedRecoveryCodes(database.db, org, userId)).toHaveLength(1);
  });
});

describe('MFA login challenges', () => {
  it('are single use and revoked after five wrong codes', async () => {
    const { org, userId } = await setup();
    const tokenHash = hashSessionToken(`ovm_${testId('usr')}`);
    const challenge = await createMfaChallenge(database.db, org, {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 300_000),
    });

    const failures = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      failures.push(await recordMfaChallengeFailure(database.db, challenge.id));
    }

    expect(await findActiveMfaChallenge(database.db, hashSessionToken('ovm_unknown'))).toBeNull();
    expect(failures.map((failure) => failure?.revoked)).toEqual([false, false, false, false, true]);
    expect(failures[4]?.failedAttempts).toBe(5);
    expect(await findActiveMfaChallenge(database.db, tokenHash)).toBeNull();
    expect(await recordMfaChallengeFailure(database.db, challenge.id)).toBeNull();
    expect(await consumeMfaChallenge(database.db, challenge.id)).toBe(false);
  });

  it('hand out at most five attempts, taken before a factor is checked, even in parallel (2B F004)', async () => {
    const { org, userId } = await setup();
    const tokenHash = hashSessionToken(`ovm_${testId('usr')}`);
    const challenge = await createMfaChallenge(database.db, org, {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 300_000),
    });

    const taken = await Promise.all(
      Array.from({ length: 8 }, () => reserveMfaChallengeAttempt(database.db, challenge.id)),
    );

    expect(taken.filter(Boolean)).toHaveLength(5);
    // Taking attempts revokes nothing: the fifth may still be the right code.
    expect(await findActiveMfaChallenge(database.db, tokenHash)).not.toBeNull();
    expect(await revokeExhaustedMfaChallenge(database.db, challenge.id)).toEqual({
      failedAttempts: 5,
      revoked: true,
    });
    expect(await findActiveMfaChallenge(database.db, tokenHash)).toBeNull();
    expect(await reserveMfaChallengeAttempt(database.db, challenge.id)).toBe(false);
  });

  it('keep a challenge with attempts left after a failure, and refuse expired ones (2B F004)', async () => {
    const { org, userId } = await setup();
    const live = await createMfaChallenge(database.db, org, {
      userId,
      tokenHash: hashSessionToken(`ovm_${testId('usr')}`),
      expiresAt: new Date(Date.now() + 300_000),
    });
    const expired = await createMfaChallenge(database.db, org, {
      userId,
      tokenHash: hashSessionToken(`ovm_${testId('usr')}`),
      expiresAt: new Date(Date.now() - 1_000),
    });

    expect(await reserveMfaChallengeAttempt(database.db, live.id)).toBe(true);
    expect(await revokeExhaustedMfaChallenge(database.db, live.id)).toEqual({
      failedAttempts: 1,
      revoked: false,
    });
    expect(await consumeMfaChallenge(database.db, live.id)).toBe(true);
    expect(await revokeExhaustedMfaChallenge(database.db, live.id)).toBeNull();
    expect(await reserveMfaChallengeAttempt(database.db, expired.id)).toBe(false);
  });

  it('carry the hashed WebAuthn challenge and are consumed once', async () => {
    const { org, userId } = await setup();
    const tokenHash = hashSessionToken(`ovm_${testId('usr')}`);
    const challenge = await createMfaChallenge(database.db, org, {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 300_000),
    });
    const webauthn = hashSessionToken('synthetic-webauthn-challenge');

    await setMfaChallengeWebauthnChallenge(database.db, challenge.id, webauthn);
    const active = await findActiveMfaChallenge(database.db, tokenHash);

    expect(active).toMatchObject({
      userId,
      organizationId: org,
      webauthnChallengeHash: webauthn,
      failedAttempts: 0,
    });
    expect(await consumeMfaChallenge(database.db, challenge.id)).toBe(true);
    expect(await consumeMfaChallenge(database.db, challenge.id)).toBe(false);
    expect(await findActiveMfaChallenge(database.db, tokenHash)).toBeNull();
  });

  it('expire', async () => {
    const { org, userId } = await setup();
    const tokenHash = hashSessionToken(`ovm_${testId('usr')}`);
    await createMfaChallenge(database.db, org, {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await findActiveMfaChallenge(database.db, tokenHash)).toBeNull();
  });
});

describe('WebAuthn registration challenges', () => {
  it('are consumed once, for their user, before they expire', async () => {
    const { org, userId } = await setup();
    const challenge = hashSessionToken('synthetic-registration');
    const stale = hashSessionToken('synthetic-stale');
    await createWebauthnRegistrationChallenge(database.db, org, {
      userId,
      challengeHash: challenge,
      expiresAt: new Date(Date.now() + 300_000),
    });
    await createWebauthnRegistrationChallenge(database.db, org, {
      userId,
      challengeHash: stale,
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(
      await consumeWebauthnRegistrationChallenge(database.db, org, testId('usr'), challenge),
    ).toBe(false);
    expect(await consumeWebauthnRegistrationChallenge(database.db, org, userId, challenge)).toBe(
      true,
    );
    expect(await consumeWebauthnRegistrationChallenge(database.db, org, userId, challenge)).toBe(
      false,
    );
    expect(await consumeWebauthnRegistrationChallenge(database.db, org, userId, stale)).toBe(false);
  });
});
