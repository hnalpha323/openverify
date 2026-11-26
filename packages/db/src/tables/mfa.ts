/** Operator MFA (C15): TOTP and WebAuthn factors, recovery codes and login challenges. */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import { createdAt, hexDigest, idFormat, timestamptz, updatedAt } from './columns.js';
import { mfaFactorType } from './enums.js';
import { organizations } from './tenancy.js';
import { users } from './users.js';

const organizationId = () =>
  text('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

/**
 * A user's MFA factor. A TOTP factor is active only once `confirmed_at` is set (C15
 * enrolment). `totp_secret` is sealed for this row (`mfa_factors.totp_secret#<id>`), and
 * `last_used_step` stops a code from being used twice. WebAuthn factors keep the public
 * key and the signature counter; the credential id is unique across all users.
 */
export const mfaFactors = pgTable(
  'mfa_factors',
  {
    id: text('id').primaryKey(),
    organizationId: organizationId(),
    userId: text('user_id').notNull(),
    type: mfaFactorType('type').notNull(),
    name: text('name').notNull(),
    totpSecretSealed: sealedColumn('totp_secret'),
    /** The RFC 6238 time step of the last accepted code. */
    lastUsedStep: bigint('last_used_step', { mode: 'number' }),
    /** base64url credential id. */
    webauthnCredentialId: text('webauthn_credential_id'),
    /** base64url COSE public key. */
    webauthnPublicKey: text('webauthn_public_key'),
    webauthnCounter: bigint('webauthn_counter', { mode: 'number' }),
    webauthnTransports: text('webauthn_transports').array(),
    confirmedAt: timestamptz('confirmed_at'),
    lastUsedAt: timestamptz('last_used_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'mfa_factors_user_fk',
      columns: [table.organizationId, table.userId],
      foreignColumns: [users.organizationId, users.id],
    }).onDelete('cascade'),
    index('mfa_factors_user_id_idx').on(table.userId),
    uniqueIndex('mfa_factors_webauthn_credential_id_key').on(table.webauthnCredentialId),
    check(
      'mfa_factors_totp_has_secret',
      sql`${table.type} <> 'totp' OR (${table.totpSecretSealed} IS NOT NULL AND ${table.webauthnCredentialId} IS NULL)`,
    ),
    check(
      'mfa_factors_webauthn_has_credential',
      sql`${table.type} <> 'webauthn' OR (${table.webauthnCredentialId} IS NOT NULL AND ${table.webauthnPublicKey} IS NOT NULL AND ${table.webauthnCounter} IS NOT NULL AND ${table.totpSecretSealed} IS NULL)`,
    ),
    check('mfa_factors_name_not_blank', sql`btrim(${table.name}) <> ''`),
    idFormat('mfa_factors', table.id, 'mfa'),
  ],
);

/** C9 recovery codes: Argon2id hashes, each usable once. Regenerating replaces them all. */
export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: organizationId(),
    userId: text('user_id').notNull(),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamptz('used_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'mfa_recovery_codes_user_fk',
      columns: [table.organizationId, table.userId],
      foreignColumns: [users.organizationId, users.id],
    }).onDelete('cascade'),
    index('mfa_recovery_codes_user_id_idx').on(table.userId),
    check('mfa_recovery_codes_code_hash_argon2id', sql`${table.codeHash} LIKE '$argon2id$%'`),
  ],
);

/**
 * C9 `ovm_...` MFA challenge, issued after a correct password: single use, 5 minutes, and
 * revoked after five wrong codes. For a WebAuthn assertion it also holds the SHA-256 of
 * the challenge it sent.
 */
export const mfaChallenges = pgTable(
  'mfa_challenges',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: organizationId(),
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    webauthnChallengeHash: text('webauthn_challenge_hash'),
    consumedAt: timestamptz('consumed_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'mfa_challenges_user_fk',
      columns: [table.organizationId, table.userId],
      foreignColumns: [users.organizationId, users.id],
    }).onDelete('cascade'),
    uniqueIndex('mfa_challenges_token_hash_key').on(table.tokenHash),
    index('mfa_challenges_expires_at_idx').on(table.expiresAt),
    hexDigest('mfa_challenges_token_hash_hex', table.tokenHash),
    hexDigest('mfa_challenges_webauthn_challenge_hash_hex', table.webauthnChallengeHash),
    check('mfa_challenges_failed_attempts_non_negative', sql`${table.failedAttempts} >= 0`),
  ],
);

/** A pending WebAuthn registration: the SHA-256 of the challenge, 5 minutes, single use. */
export const webauthnRegistrationChallenges = pgTable(
  'webauthn_registration_challenges',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: organizationId(),
    userId: text('user_id').notNull(),
    challengeHash: text('challenge_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'webauthn_registration_challenges_user_fk',
      columns: [table.organizationId, table.userId],
      foreignColumns: [users.organizationId, users.id],
    }).onDelete('cascade'),
    index('webauthn_registration_challenges_user_id_idx').on(table.userId),
    index('webauthn_registration_challenges_expires_at_idx').on(table.expiresAt),
    hexDigest('webauthn_registration_challenges_challenge_hash_hex', table.challengeHash),
  ],
);

export type MfaFactorRow = typeof mfaFactors.$inferSelect;
export type MfaRecoveryCode = typeof mfaRecoveryCodes.$inferSelect;
export type MfaChallenge = typeof mfaChallenges.$inferSelect;
export type WebauthnRegistrationChallenge = typeof webauthnRegistrationChallenges.$inferSelect;
