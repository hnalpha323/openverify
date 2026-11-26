/**
 * C53.2, C57.2, C57.3: the challenges a wallet signs. The address (as the user claimed it, so
 * the job still sees whether an EVM address carried its EIP-55 checksum), the message, the
 * signature and the signed message are sealed to the row (`crypto_challenges.<column>#<id>`);
 * the address is blind-indexed too, in its canonical form (`canonicalCryptoAddress`).
 */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import { createdAt, hexDigest, idFormat, timestamptz } from './columns.js';
import { environmentId } from './environment-id.js';
import { inquiries } from './inquiries.js';
import { verifications } from './verifications.js';

export const CRYPTO_CHALLENGE_STATUS_VALUES = [
  'initiated',
  'submitted',
  'processed',
  'expired',
  'superseded',
] as const;

export const cryptoChallenges = pgTable(
  'crypto_challenges',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    verificationId: text('verification_id').notNull(),
    inquiryId: text('inquiry_id').notNull(),
    /** CAIP-2 (C57.1). */
    chainId: text('chain_id').notNull(),
    /** Sealed as the user claimed it, not canonicalised (see the file header). */
    walletAddressSealed: sealedColumn('wallet_address'),
    /** `openverify/crypto-address/v1` blind index of the canonical address; `null` once redacted. */
    addressIndex: text('address_index'),
    messageSealed: sealedColumn('message'),
    status: text('status').$type<(typeof CRYPTO_CHALLENGE_STATUS_VALUES)[number]>().notNull(),
    signatureSealed: sealedColumn('signature'),
    signedMessageSealed: sealedColumn('signed_message'),
    scheme: text('scheme'),
    createdAt: createdAt(),
    expiresAt: timestamptz('expires_at').notNull(),
    submittedAt: timestamptz('submitted_at'),
    redactedAt: timestamptz('redacted_at'),
  },
  (table) => [
    foreignKey({
      name: 'crypto_challenges_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'crypto_challenges_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    unique('crypto_challenges_environment_id_id_key').on(table.environmentId, table.id),
    index('crypto_challenges_environment_id_verification_id_created_at_idx').on(
      table.environmentId,
      table.verificationId,
      table.createdAt.desc().nullsFirst(),
    ),
    index('crypto_challenges_environment_id_inquiry_id_idx').on(
      table.environmentId,
      table.inquiryId,
    ),
    index('crypto_challenges_environment_id_address_index_idx')
      .on(table.environmentId, table.addressIndex)
      .where(sql`${table.addressIndex} is not null`),
    // C57.2: a new challenge supersedes the open one.
    uniqueIndex('crypto_challenges_one_initiated_per_verification_key')
      .on(table.environmentId, table.verificationId)
      .where(sql`${table.status} = 'initiated'`),
    check(
      'crypto_challenges_status_valid',
      sql`${table.status} in (${sql.raw(CRYPTO_CHALLENGE_STATUS_VALUES.map((value) => `'${value}'`).join(', '))})`,
    ),
    // CAIP-2: namespace 3-8 [-a-z0-9], reference 1-32 [-_a-zA-Z0-9].
    check(
      'crypto_challenges_chain_id_format',
      sql`${table.chainId} ~ '^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$'`,
    ),
    check('crypto_challenges_scheme_format', sql`${table.scheme} ~ '^[a-z0-9][a-z0-9-]{0,31}$'`),
    hexDigest('crypto_challenges_address_index_hex', table.addressIndex),
    idFormat('crypto_challenges', table.id, 'cwc'),
  ],
);

export type CryptoChallengeRow = typeof cryptoChallenges.$inferSelect;
