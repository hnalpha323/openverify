/**
 * C53.2, C55: the one-time codes of phone and email verifications and each verification's send
 * and guess counts. The code is never stored: only `code_hmac` (HMAC-SHA-256 under the key of the
 * KEK `code_key_id` names, C55.3), cleared once the challenge leaves `sent`. The destination is
 * sealed to the row (`otp_challenges.destination#<id>`) and blind-indexed for the limits.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import { hexDigest, idFormat, timestamptz, updatedAt } from './columns.js';
import { environmentId } from './environment-id.js';
import { inquiries } from './inquiries.js';
import { verifications } from './verifications.js';

/** `bytea` read and written as a `Buffer`. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

export const OTP_CHANNEL_VALUES = ['sms', 'email'] as const;
export const OTP_CHALLENGE_STATUS_VALUES = [
  'sent',
  'confirmed',
  'superseded',
  'expired',
  'exhausted',
  'errored',
] as const;
export const OTP_LIMITED_REASON_VALUES = [
  'destination',
  'inquiry',
  'guess',
  'environment',
  'store_unavailable',
] as const;

export const otpChallenges = pgTable(
  'otp_challenges',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    verificationId: text('verification_id').notNull(),
    inquiryId: text('inquiry_id').notNull(),
    channel: text('channel').$type<(typeof OTP_CHANNEL_VALUES)[number]>().notNull(),
    /** E.164 or the address, sealed; `null` once redacted. */
    destinationSealed: sealedColumn('destination'),
    /** `openverify/otp-destination/v1` blind index; `null` once redacted. */
    destinationIndex: text('destination_index'),
    /** 32 bytes while `sent`; cleared when the challenge leaves `sent` (C53.5). */
    codeHmac: bytea('code_hmac'),
    codeKeyId: text('code_key_id'),
    status: text('status').$type<(typeof OTP_CHALLENGE_STATUS_VALUES)[number]>().notNull(),
    failedAttempts: smallint('failed_attempts').notNull().default(0),
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    sentAt: timestamptz('sent_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    confirmedAt: timestamptz('confirmed_at'),
    errorCode: text('error_code'),
    redactedAt: timestamptz('redacted_at'),
  },
  (table) => [
    foreignKey({
      name: 'otp_challenges_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'otp_challenges_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    unique('otp_challenges_environment_id_id_key').on(table.environmentId, table.id),
    // Newest first per verification (the attributes, the guidance, the job).
    index('otp_challenges_environment_id_verification_id_sent_at_idx').on(
      table.environmentId,
      table.verificationId,
      table.sentAt.desc().nullsFirst(),
    ),
    index('otp_challenges_environment_id_inquiry_id_idx').on(table.environmentId, table.inquiryId),
    // C55.7: the per-destination limits read sends by destination and time.
    index('otp_challenges_environment_id_destination_index_sent_at_idx')
      .on(table.environmentId, table.destinationIndex, table.sentAt)
      .where(sql`${table.destinationIndex} is not null`),
    // C55.4: a send to another destination supersedes the open code.
    uniqueIndex('otp_challenges_one_sent_per_verification_key')
      .on(table.environmentId, table.verificationId)
      .where(sql`${table.status} = 'sent'`),
    check('otp_challenges_channel_valid', sql`${table.channel} in (${listed(OTP_CHANNEL_VALUES)})`),
    check(
      'otp_challenges_status_valid',
      sql`${table.status} in (${listed(OTP_CHALLENGE_STATUS_VALUES)})`,
    ),
    check('otp_challenges_failed_attempts_range', sql`${table.failedAttempts} between 0 and 5`),
    check(
      'otp_challenges_code_hmac_length',
      sql`${table.codeHmac} is null or octet_length(${table.codeHmac}) = 32`,
    ),
    check(
      'otp_challenges_code_hmac_only_while_sent',
      sql`${table.status} = 'sent' or ${table.codeHmac} is null`,
    ),
    check('otp_challenges_error_code_format', sql`${table.errorCode} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    hexDigest('otp_challenges_destination_index_hex', table.destinationIndex),
    idFormat('otp_challenges', table.id, 'otpc'),
  ],
);

export const otpVerificationStates = pgTable(
  'otp_verification_states',
  {
    environmentId: environmentId(),
    verificationId: text('verification_id').primaryKey(),
    inquiryId: text('inquiry_id').notNull(),
    /** Accepted sends; an errored send does not count (C55.6). */
    sends: integer('sends').notNull().default(0),
    /** Wrong entries across the verification's codes (C55.5). */
    wrongEntries: integer('wrong_entries').notNull().default(0),
    limitedAt: timestamptz('limited_at'),
    limitedReason: text('limited_reason').$type<(typeof OTP_LIMITED_REASON_VALUES)[number]>(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'otp_verification_states_verification_fk',
      columns: [table.environmentId, table.verificationId],
      foreignColumns: [verifications.environmentId, verifications.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'otp_verification_states_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    unique('otp_verification_states_environment_id_verification_id_key').on(
      table.environmentId,
      table.verificationId,
    ),
    index('otp_verification_states_environment_id_inquiry_id_idx').on(
      table.environmentId,
      table.inquiryId,
    ),
    // C55.5, C55.6: at most 5 accepted sends and 10 wrong entries.
    check('otp_verification_states_sends_range', sql`${table.sends} between 0 and 5`),
    check(
      'otp_verification_states_wrong_entries_range',
      sql`${table.wrongEntries} between 0 and 10`,
    ),
    check(
      'otp_verification_states_limited_reason_valid',
      sql`${table.limitedReason} is null or ${table.limitedReason} in (${listed(OTP_LIMITED_REASON_VALUES)})`,
    ),
    check(
      'otp_verification_states_limited_reason_iff_limited',
      sql`(${table.limitedAt} is null) = (${table.limitedReason} is null)`,
    ),
  ],
);

export type OtpChallengeRow = typeof otpChallenges.$inferSelect;
export type OtpVerificationStateRow = typeof otpVerificationStates.$inferSelect;
