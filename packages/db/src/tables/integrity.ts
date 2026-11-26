/**
 * Workflow 10B Stage 1b (I) (C211.3, C211.4, C221.3): Play Integrity on the server.
 *
 * - `inquiry_integrity_challenges`: one row per `POST /flow/integrity-challenges` (`ich_` ids), for
 *   the inquiry and the session that asked. `request_hash` is what the device binds its token to
 *   (base64url, 43 characters, computed by the server, C211.3); `expires_at` is ten minutes after the
 *   challenge (TTL 600 s). The token the device posts back (`POST /flow/integrity-tokens`) is kept,
 *   sealed for the challenge's row, only until the `integrity-decode` job reads it (`consumed_at`
 *   then marks the challenge used); ids are all the job carries.
 * - `inquiry_integrity_verdicts`: at most one per inquiry, the provider that decoded it and the
 *   verdict's fixed projection (C211.4: the device-recognition labels, app recognition, the boolean of
 *   each server check and `decoded-at`), sealed for the inquiry's row, never another member.
 *
 * Both are deleted with the inquiry's redaction, and the C16 pass deletes a challenge a day past its
 * expiry (`deleteExpiredIntegrityChallenges`) and any record a redacted inquiry still holds
 * (`deleteIntegrityRecordsOfRedactedInquiries`). Repository: `repositories/inquiry-integrity.ts`
 * (`api-integrity`).
 */
import { INTEGRITY_VERDICT_PROVIDERS, type IntegrityVerdictProvider } from '@openverify/core';
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import { createdAt, idFormat, oneOf, timestamptz, updatedAt } from './columns.js';
import { environmentId } from './environment-id.js';
import { inquiries, inquirySessions } from './inquiries.js';

export const inquiryIntegrityChallenges = pgTable(
  'inquiry_integrity_challenges',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    inquiryId: text('inquiry_id').notNull(),
    /** The session that asked for the challenge; only its token is taken for it. */
    sessionId: text('session_id').notNull(),
    /** C211.3: base64url (no padding) of the SHA-256 the device's token is bound to. */
    requestHash: text('request_hash').notNull(),
    /** The device's token, sealed for this row, from its post until the decode reads it; else null. */
    tokenSealed: sealedColumn('token'),
    /** C251.1 (Workflow 11B Stage 1b (P)): when the queue's cap admitted this row's job; `null` while held. */
    admittedAt: timestamptz('admitted_at'),
    createdAt: createdAt(),
    expiresAt: timestamptz('expires_at').notNull(),
    /** When a token was taken for it: a challenge is used once. */
    consumedAt: timestamptz('consumed_at'),
  },
  (table) => [
    foreignKey({
      name: 'inquiry_integrity_challenges_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'inquiry_integrity_challenges_session_fk',
      columns: [table.environmentId, table.sessionId],
      foreignColumns: [inquirySessions.environmentId, inquirySessions.id],
    }).onDelete('cascade'),
    unique('inquiry_integrity_challenges_environment_id_id_key').on(table.environmentId, table.id),
    index('inquiry_integrity_challenges_environment_id_inquiry_id_idx').on(
      table.environmentId,
      table.inquiryId,
    ),
    // The C16 pass finds the challenges past their expiry.
    index('inquiry_integrity_challenges_expires_at_idx').on(table.expiresAt),
    check(
      'inquiry_integrity_challenges_request_hash_format',
      sql`${table.requestHash} ~ '^[A-Za-z0-9_-]{43}$'`,
    ),
    check(
      'inquiry_integrity_challenges_expires_after_created',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'inquiry_integrity_challenges_token_consumed',
      sql`${table.tokenSealed} is null or ${table.consumedAt} is not null`,
    ),
    idFormat('inquiry_integrity_challenges', table.id, 'ich'),
  ],
);

export type InquiryIntegrityChallengeRow = typeof inquiryIntegrityChallenges.$inferSelect;

export const inquiryIntegrityVerdicts = pgTable(
  'inquiry_integrity_verdicts',
  {
    environmentId: environmentId(),
    /** One verdict per inquiry; also the row id the verdict is sealed to. */
    inquiryId: text('inquiry_id').primaryKey(),
    provider: text('provider').$type<IntegrityVerdictProvider>().notNull(),
    /** C211.4's projection only, sealed for the inquiry's row. */
    verdictSealed: sealedColumn('verdict').notNull(),
    decodedAt: timestamptz('decoded_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'inquiry_integrity_verdicts_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    check(
      'inquiry_integrity_verdicts_provider_valid',
      sql`${oneOf(table.provider, INTEGRITY_VERDICT_PROVIDERS)}`,
    ),
  ],
);

export type InquiryIntegrityVerdictRow = typeof inquiryIntegrityVerdicts.$inferSelect;
