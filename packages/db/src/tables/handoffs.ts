/**
 * Phase 7, Workflow 7A (C96.2, C96.3; V05): device handoff, which moves a desktop flow to a phone.
 *
 * - `handoff_tokens`: one row per `ovh_` token (`hnd_` names the row, never the token). The token
 *   is stored as its SHA-256 only and compared in constant time, like every C1/C9 token. It is bound
 *   to the inquiry, the `device_handoff` step and the issuing session (`iqse_`), single use, and
 *   lives for its method's TTL; issuing a new one revokes the session's previous live one, which
 *   `handoff_tokens_live_per_session_key` enforces. A confirmation code (C96.5) is kept only as
 *   SHA-256 over the token and the code (`confirmation_code_hash`), so the row alone does not reveal
 *   it; `code_attempts` counts the wrong ones (5 revoke the token). `destination_confirmed` is
 *   `false` only for an email or SMS sent to a destination the inquiry never confirmed, which needs
 *   the code (V16); the destination itself is never stored. The C16 pass deletes tokens 30 days
 *   after use or expiry (P27).
 * - `inquiry_handoff_steps`: the state of each handoff step per inquiry, not per session, so a
 *   resumed desktop keeps it (V05).
 *
 * `flow-handoff` (Workflow 7A Stage 3) writes both through `repositories/handoff-tokens.ts`.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAt, hexDigest, idFormat, oneOf, timestamptz, updatedAt } from './columns.js';
import { environmentId } from './environment-id.js';
import { HANDOFF_METHOD_VALUES, inquiries, inquirySessions } from './inquiries.js';

/** C96.3 (V05): the state of an inquiry's handoff step (`@openverify/contracts` `HANDOFF_STATES`). */
export const HANDOFF_STATE_VALUES = [
  'pending',
  'issued',
  'redeemed',
  'continued_here',
  'skipped',
  'rejected',
  'declined',
] as const;

/** A flow-spec step id (`stepIdSchema`). */
const stepIdFormat = (name: string, column: AnyPgColumn) =>
  check(name, sql`${column} ~ '^[a-z][a-z0-9_-]{0,63}$'`);

export const handoffTokens = pgTable(
  'handoff_tokens',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    inquiryId: text('inquiry_id').notNull(),
    issuingSessionId: text('issuing_session_id').notNull(),
    /** The `device_handoff` step the token was issued for. */
    stepId: text('step_id').notNull(),
    method: text('method').$type<(typeof HANDOFF_METHOD_VALUES)[number]>().notNull(),
    /** SHA-256 of the `ovh_` token, lowercase hex. */
    tokenHash: text('token_hash').notNull(),
    /** C96.5: SHA-256 over the token and the six-digit code; `null` without a code. */
    confirmationCodeHash: text('confirmation_code_hash'),
    /** C96.5: wrong codes so far; the fifth revokes the token. */
    codeAttempts: integer('code_attempts').notNull().default(0),
    /** V16: `false` only for an email or SMS to a destination the inquiry never confirmed. */
    destinationConfirmed: boolean('destination_confirmed').notNull().default(true),
    /** The method's TTL, never past the inquiry's `expires-at` (C96.2). */
    expiresAt: timestamptz('expires_at').notNull(),
    redeemedAt: timestamptz('redeemed_at'),
    /** The phone's session the redemption created. */
    redeemedSessionId: text('redeemed_session_id'),
    /** A newer token, a decline, the fifth wrong code, or the inquiry leaving its open states. */
    revokedAt: timestamptz('revoked_at'),
    /** V04: the phone declined on its context screen, before redemption (also revokes). */
    declinedAt: timestamptz('declined_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'handoff_tokens_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'handoff_tokens_issuing_session_fk',
      columns: [table.environmentId, table.issuingSessionId],
      foreignColumns: [inquirySessions.environmentId, inquirySessions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'handoff_tokens_redeemed_session_fk',
      columns: [table.environmentId, table.redeemedSessionId],
      foreignColumns: [inquirySessions.environmentId, inquirySessions.id],
    }).onDelete('cascade'),
    unique('handoff_tokens_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('handoff_tokens_token_hash_key').on(table.tokenHash),
    // C96.2: issuing a new token revokes the session's previous live one.
    uniqueIndex('handoff_tokens_live_per_session_key')
      .on(table.issuingSessionId)
      .where(sql`${table.redeemedAt} is null and ${table.revokedAt} is null`),
    index('handoff_tokens_environment_id_inquiry_id_idx').on(table.environmentId, table.inquiryId),
    // C96.2 (P27): the C16 pass deletes tokens 30 days after use or expiry.
    index('handoff_tokens_expires_at_idx').on(table.expiresAt),
    idFormat('handoff_tokens', table.id, 'hnd'),
    stepIdFormat('handoff_tokens_step_id_format', table.stepId),
    check('handoff_tokens_method_valid', oneOf(table.method, HANDOFF_METHOD_VALUES)),
    hexDigest('handoff_tokens_token_hash_hex', table.tokenHash),
    hexDigest('handoff_tokens_confirmation_code_hash_hex', table.confirmationCodeHash),
    check('handoff_tokens_code_attempts_non_negative', sql`${table.codeAttempts} >= 0`),
    check(
      'handoff_tokens_redeemed_session',
      sql`(${table.redeemedAt} is null) = (${table.redeemedSessionId} is null)`,
    ),
    check(
      'handoff_tokens_redeemed_or_revoked',
      sql`${table.redeemedAt} is null or ${table.revokedAt} is null`,
    ),
    check(
      'handoff_tokens_declined_revokes',
      sql`${table.declinedAt} is null or ${table.revokedAt} is not null`,
    ),
    // V16: only an email or SMS handoff sends to an unconfirmed destination, and only with a code.
    check(
      'handoff_tokens_unconfirmed_needs_code',
      sql`${table.destinationConfirmed}
        or (${table.method} <> 'qr' and ${table.confirmationCodeHash} is not null)`,
    ),
  ],
);

export const inquiryHandoffSteps = pgTable(
  'inquiry_handoff_steps',
  {
    environmentId: environmentId(),
    inquiryId: text('inquiry_id').notNull(),
    stepId: text('step_id').notNull(),
    state: text('state').$type<(typeof HANDOFF_STATE_VALUES)[number]>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: 'inquiry_handoff_steps_pkey',
      columns: [table.environmentId, table.inquiryId, table.stepId],
    }),
    foreignKey({
      name: 'inquiry_handoff_steps_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    check('inquiry_handoff_steps_state_valid', oneOf(table.state, HANDOFF_STATE_VALUES)),
    stepIdFormat('inquiry_handoff_steps_step_id_format', table.stepId),
  ],
);

export type HandoffTokenRow = typeof handoffTokens.$inferSelect;
export type InquiryHandoffStepRow = typeof inquiryHandoffSteps.$inferSelect;
