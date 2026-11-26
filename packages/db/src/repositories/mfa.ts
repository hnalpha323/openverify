import { and, asc, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import {
  mfaChallenges,
  mfaFactors,
  mfaRecoveryCodes,
  webauthnRegistrationChallenges,
  type MfaChallenge,
  type MfaFactorRow,
  type WebauthnRegistrationChallenge,
} from '../schema.js';
import { openValue, sealValue } from '../sealed.js';
import { firstOrNull, inserted } from './rows.js';

/** An MFA factor as the repositories return it: never with its TOTP secret. */
export type MfaFactor = Omit<MfaFactorRow, 'totpSecretSealed'>;

/** C15: five wrong codes revoke the `mfa-token`. */
export const MAX_MFA_CHALLENGE_FAILURES = 5;

export interface NewTotpFactorInput {
  id: string;
  userId: string;
  name: string;
  /** The base32 shared secret; sealed for the factor. */
  secret: string;
}

export interface NewWebauthnFactorInput {
  id: string;
  userId: string;
  name: string;
  /** base64url credential id. */
  credentialId: string;
  /** base64url COSE public key. */
  publicKey: string;
  counter: number;
  transports: readonly string[];
  /** Defaults to now: a WebAuthn factor is verified when it is registered. */
  confirmedAt?: Date;
}

export interface NewMfaChallengeInput {
  userId: string;
  /** `hashSessionToken(token)` of the `ovm_...` token. */
  tokenHash: string;
  /** C9: five minutes. */
  expiresAt: Date;
}

export interface MfaChallengeFailure {
  failedAttempts: number;
  /** The challenge reached the limit with this failure and no longer works. */
  revoked: boolean;
}

export interface NewRegistrationChallengeInput {
  userId: string;
  /** SHA-256 hex of the challenge sent to the authenticator. */
  challengeHash: string;
  expiresAt: Date;
}

const factorColumns = {
  id: mfaFactors.id,
  organizationId: mfaFactors.organizationId,
  userId: mfaFactors.userId,
  type: mfaFactors.type,
  name: mfaFactors.name,
  lastUsedStep: mfaFactors.lastUsedStep,
  webauthnCredentialId: mfaFactors.webauthnCredentialId,
  webauthnPublicKey: mfaFactors.webauthnPublicKey,
  webauthnCounter: mfaFactors.webauthnCounter,
  webauthnTransports: mfaFactors.webauthnTransports,
  confirmedAt: mfaFactors.confirmedAt,
  lastUsedAt: mfaFactors.lastUsedAt,
  createdAt: mfaFactors.createdAt,
  updatedAt: mfaFactors.updatedAt,
};

const factorInOrganization = (organizationId: string, id: string) =>
  and(eq(mfaFactors.id, id), eq(mfaFactors.organizationId, organizationId));

// ---------------------------------------------------------------------------------------
// Factors

/** C15 `POST /me/mfa-factors/totp`: an unconfirmed factor with its sealed secret. */
export async function createTotpFactor(
  db: Db,
  organizationId: string,
  input: NewTotpFactorInput,
): Promise<MfaFactor> {
  const rows = await db
    .insert(mfaFactors)
    .values({
      id: input.id,
      organizationId,
      userId: input.userId,
      type: 'totp',
      name: input.name,
      totpSecretSealed: sealValue(SEALED.mfaTotpSecret, input.id, input.secret),
    })
    .returning(factorColumns);
  return inserted(rows, 'createTotpFactor');
}

/**
 * C15 `POST /me/mfa-factors/totp/confirm`: activates an unconfirmed factor after a valid
 * code, recording that code's step. `null` when it is not here or already confirmed.
 */
export async function confirmMfaFactor(
  db: Db,
  organizationId: string,
  id: string,
  confirmation: { at?: Date; step?: number },
): Promise<MfaFactor | null> {
  return firstOrNull(
    await db
      .update(mfaFactors)
      .set({
        confirmedAt: confirmation.at ?? sql`now()`,
        ...(confirmation.step === undefined ? {} : { lastUsedStep: confirmation.step }),
      })
      .where(and(factorInOrganization(organizationId, id), isNull(mfaFactors.confirmedAt)))
      .returning(factorColumns),
  );
}

/** The opened TOTP secret and the last accepted step, for verification only. */
export async function getTotpSecret(
  db: Db,
  organizationId: string,
  id: string,
): Promise<{ secret: string; lastUsedStep: number | null } | null> {
  const row = firstOrNull(
    await db
      .select({ sealed: mfaFactors.totpSecretSealed, lastUsedStep: mfaFactors.lastUsedStep })
      .from(mfaFactors)
      .where(and(factorInOrganization(organizationId, id), eq(mfaFactors.type, 'totp')))
      .limit(1),
  );
  if (row?.sealed == null) {
    return null;
  }
  return {
    secret: openValue(SEALED.mfaTotpSecret, id, row.sealed),
    lastUsedStep: row.lastUsedStep,
  };
}

/**
 * Accepts a TOTP code's time step once (C15 replay protection): `false` when the step is
 * not after the last accepted one, or the factor is not here.
 */
export async function recordTotpUse(
  db: Db,
  organizationId: string,
  id: string,
  step: number,
  at: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(mfaFactors)
    .set({ lastUsedStep: step, lastUsedAt: at })
    .where(
      and(
        factorInOrganization(organizationId, id),
        eq(mfaFactors.type, 'totp'),
        or(isNull(mfaFactors.lastUsedStep), lt(mfaFactors.lastUsedStep, step)),
      ),
    )
    .returning({ id: mfaFactors.id });
  return rows.length > 0;
}

/** C15 WebAuthn registration: a confirmed factor with the credential's public key. */
export async function createWebauthnFactor(
  db: Db,
  organizationId: string,
  input: NewWebauthnFactorInput,
): Promise<MfaFactor> {
  const rows = await db
    .insert(mfaFactors)
    .values({
      id: input.id,
      organizationId,
      userId: input.userId,
      type: 'webauthn',
      name: input.name,
      webauthnCredentialId: input.credentialId,
      webauthnPublicKey: input.publicKey,
      webauthnCounter: input.counter,
      webauthnTransports: [...input.transports],
      confirmedAt: input.confirmedAt ?? sql`now()`,
    })
    .returning(factorColumns);
  return inserted(rows, 'createWebauthnFactor');
}

/** The user's WebAuthn factor with this credential id, for an assertion. */
export async function findWebauthnFactor(
  db: Db,
  organizationId: string,
  userId: string,
  credentialId: string,
): Promise<MfaFactor | null> {
  return firstOrNull(
    await db
      .select(factorColumns)
      .from(mfaFactors)
      .where(
        and(
          eq(mfaFactors.organizationId, organizationId),
          eq(mfaFactors.userId, userId),
          eq(mfaFactors.webauthnCredentialId, credentialId),
          isNotNull(mfaFactors.confirmedAt),
        ),
      )
      .limit(1),
  );
}

/**
 * Records a WebAuthn assertion's signature counter, which must move forward (C15 "counter
 * checked"); authenticators without a counter report 0 every time, which is accepted while
 * the stored counter is 0 too. `false` means a possibly cloned authenticator.
 */
export async function recordWebauthnUse(
  db: Db,
  organizationId: string,
  id: string,
  counter: number,
  at: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(mfaFactors)
    .set({ webauthnCounter: counter, lastUsedAt: at })
    .where(
      and(
        factorInOrganization(organizationId, id),
        eq(mfaFactors.type, 'webauthn'),
        or(
          lt(mfaFactors.webauthnCounter, counter),
          and(eq(mfaFactors.webauthnCounter, 0), sql`${counter} = 0`),
        ),
      ),
    )
    .returning({ id: mfaFactors.id });
  return rows.length > 0;
}

/** C15 `GET /me/mfa-factors`: the user's factors, oldest first. */
export async function listMfaFactors(
  db: Db,
  organizationId: string,
  userId: string,
  options: { confirmedOnly?: boolean } = {},
): Promise<MfaFactor[]> {
  return db
    .select(factorColumns)
    .from(mfaFactors)
    .where(
      and(
        eq(mfaFactors.organizationId, organizationId),
        eq(mfaFactors.userId, userId),
        options.confirmedOnly === true ? isNotNull(mfaFactors.confirmedAt) : undefined,
      ),
    )
    .orderBy(asc(mfaFactors.createdAt), asc(mfaFactors.id));
}

/** C15 `DELETE /me/mfa-factors/:id`. */
export async function deleteMfaFactor(
  db: Db,
  organizationId: string,
  userId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(mfaFactors)
    .where(and(factorInOrganization(organizationId, id), eq(mfaFactors.userId, userId)))
    .returning({ id: mfaFactors.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------------------
// Recovery codes

/** C15 `POST /me/recovery-codes`: the new Argon2id hashes replace every previous code. */
export async function replaceRecoveryCodes(
  db: Db,
  organizationId: string,
  userId: string,
  codeHashes: readonly string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(mfaRecoveryCodes)
      .where(
        and(
          eq(mfaRecoveryCodes.organizationId, organizationId),
          eq(mfaRecoveryCodes.userId, userId),
        ),
      );
    if (codeHashes.length > 0) {
      await tx
        .insert(mfaRecoveryCodes)
        .values(codeHashes.map((codeHash) => ({ organizationId, userId, codeHash })));
    }
  });
}

/** The user's unused codes; the caller verifies a code against each hash. */
export async function listUnusedRecoveryCodes(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<{ id: number; codeHash: string }[]> {
  return db
    .select({ id: mfaRecoveryCodes.id, codeHash: mfaRecoveryCodes.codeHash })
    .from(mfaRecoveryCodes)
    .where(
      and(
        eq(mfaRecoveryCodes.organizationId, organizationId),
        eq(mfaRecoveryCodes.userId, userId),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    )
    .orderBy(asc(mfaRecoveryCodes.id));
}

/** Uses a recovery code once; `false` when it was already used or is not the user's. */
export async function useRecoveryCode(
  db: Db,
  organizationId: string,
  userId: string,
  id: number,
  at: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(mfaRecoveryCodes)
    .set({ usedAt: at })
    .where(
      and(
        eq(mfaRecoveryCodes.id, id),
        eq(mfaRecoveryCodes.organizationId, organizationId),
        eq(mfaRecoveryCodes.userId, userId),
        isNull(mfaRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: mfaRecoveryCodes.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------------------
// Login challenges

/** C9 `ovm_...` challenge issued after a correct password when MFA is on. */
export async function createMfaChallenge(
  db: Db,
  organizationId: string,
  input: NewMfaChallengeInput,
): Promise<MfaChallenge> {
  const rows = await db
    .insert(mfaChallenges)
    .values({ organizationId, ...input })
    .returning();
  return inserted(rows, 'createMfaChallenge');
}

/**
 * An unexpired, unused and unrevoked challenge by token hash, across organizations (the
 * token is what tells the organization), or `null`.
 */
export async function findActiveMfaChallenge(
  db: Db,
  tokenHash: string,
  now: Date = new Date(),
): Promise<MfaChallenge | null> {
  return firstOrNull(
    await db
      .select()
      .from(mfaChallenges)
      .where(
        and(
          eq(mfaChallenges.tokenHash, tokenHash),
          isNull(mfaChallenges.consumedAt),
          isNull(mfaChallenges.revokedAt),
          gt(mfaChallenges.expiresAt, now),
        ),
      )
      .limit(1),
  );
}

const usable = and(isNull(mfaChallenges.consumedAt), isNull(mfaChallenges.revokedAt));

/**
 * Counts one wrong code, atomically; the failure that reaches `maxAttempts` (five, C15)
 * revokes the challenge. `null` when the challenge is already used or revoked.
 */
export async function recordMfaChallengeFailure(
  db: Db,
  id: number,
  options: { maxAttempts?: number; at?: Date } = {},
): Promise<MfaChallengeFailure | null> {
  const max = options.maxAttempts ?? MAX_MFA_CHALLENGE_FAILURES;
  const at = (options.at ?? new Date()).toISOString();
  const row = firstOrNull(
    await db
      .update(mfaChallenges)
      .set({
        failedAttempts: sql`${mfaChallenges.failedAttempts} + 1`,
        revokedAt: sql`case when ${mfaChallenges.failedAttempts} + 1 >= ${max} then ${at}::timestamptz end`,
      })
      .where(and(eq(mfaChallenges.id, id), usable))
      .returning({
        failedAttempts: mfaChallenges.failedAttempts,
        revokedAt: mfaChallenges.revokedAt,
      }),
  );
  return row === null
    ? null
    : { failedAttempts: row.failedAttempts, revoked: row.revokedAt !== null };
}

/**
 * Takes one of the challenge's attempts before a second factor is checked, atomically:
 * `failed_attempts` then counts attempts taken, and only `maxAttempts` (five, C15) are ever
 * handed out, so parallel guesses cannot all pass a check made before any failure was counted
 * (Workflow 2B F004). Taking an attempt revokes nothing, so the last one may still be the right
 * code. `false` when none is left, or the challenge is used, revoked or expired.
 */
export async function reserveMfaChallengeAttempt(
  db: Db,
  id: number,
  options: { maxAttempts?: number; now?: Date } = {},
): Promise<boolean> {
  const max = options.maxAttempts ?? MAX_MFA_CHALLENGE_FAILURES;
  const rows = await db
    .update(mfaChallenges)
    .set({ failedAttempts: sql`${mfaChallenges.failedAttempts} + 1` })
    .where(
      and(
        eq(mfaChallenges.id, id),
        usable,
        lt(mfaChallenges.failedAttempts, max),
        gt(mfaChallenges.expiresAt, options.now ?? new Date()),
      ),
    )
    .returning({ id: mfaChallenges.id });
  return rows.length > 0;
}

/**
 * After a wrong factor checked under {@link reserveMfaChallengeAttempt}: revokes the challenge
 * once all its attempts are taken. `null` when it is already used or revoked.
 */
export async function revokeExhaustedMfaChallenge(
  db: Db,
  id: number,
  options: { maxAttempts?: number; at?: Date } = {},
): Promise<MfaChallengeFailure | null> {
  const max = options.maxAttempts ?? MAX_MFA_CHALLENGE_FAILURES;
  const at = (options.at ?? new Date()).toISOString();
  const row = firstOrNull(
    await db
      .update(mfaChallenges)
      .set({
        revokedAt: sql`case when ${mfaChallenges.failedAttempts} >= ${max} then ${at}::timestamptz end`,
      })
      .where(and(eq(mfaChallenges.id, id), usable))
      .returning({
        failedAttempts: mfaChallenges.failedAttempts,
        revokedAt: mfaChallenges.revokedAt,
      }),
  );
  return row === null
    ? null
    : { failedAttempts: row.failedAttempts, revoked: row.revokedAt !== null };
}

/** Uses the challenge once, after a correct factor; `false` if it is spent or expired. */
export async function consumeMfaChallenge(
  db: Db,
  id: number,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(mfaChallenges)
    .set({ consumedAt: now })
    .where(and(eq(mfaChallenges.id, id), usable, gt(mfaChallenges.expiresAt, now)))
    .returning({ id: mfaChallenges.id });
  return rows.length > 0;
}

/** Stores the SHA-256 of the WebAuthn challenge sent for this login. */
export async function setMfaChallengeWebauthnChallenge(
  db: Db,
  id: number,
  challengeHash: string,
): Promise<boolean> {
  const rows = await db
    .update(mfaChallenges)
    .set({ webauthnChallengeHash: challengeHash })
    .where(and(eq(mfaChallenges.id, id), usable))
    .returning({ id: mfaChallenges.id });
  return rows.length > 0;
}

/** Stores a pending WebAuthn registration challenge (hashed, 5 minutes). */
export async function createWebauthnRegistrationChallenge(
  db: Db,
  organizationId: string,
  input: NewRegistrationChallengeInput,
): Promise<WebauthnRegistrationChallenge> {
  const rows = await db
    .insert(webauthnRegistrationChallenges)
    .values({ organizationId, ...input })
    .returning();
  return inserted(rows, 'createWebauthnRegistrationChallenge');
}

/** Uses a registration challenge of this user once, before it expires. */
export async function consumeWebauthnRegistrationChallenge(
  db: Db,
  organizationId: string,
  userId: string,
  challengeHash: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .delete(webauthnRegistrationChallenges)
    .where(
      and(
        eq(webauthnRegistrationChallenges.organizationId, organizationId),
        eq(webauthnRegistrationChallenges.userId, userId),
        eq(webauthnRegistrationChallenges.challengeHash, challengeHash),
        gt(webauthnRegistrationChallenges.expiresAt, now),
      ),
    )
    .returning({ id: webauthnRegistrationChallenges.id });
  return rows.length > 0;
}
