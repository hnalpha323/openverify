/**
 * Phase 7, Workflow 7A (C90.5, C91.2, C94.2, C94.4): the flow signal bodies, the signals outbox,
 * devices and the sessions that link to them.
 *
 * - `inquiry_session_signals`: one row per body `POST /flow/signals` stored (C94.2), at most 200 per
 *   session (P23), unique per `(session, sequence)` so a retry is ignored. The collector's
 *   `integrity` and `recognition` members are sealed together in `components` and its `behaviour`
 *   member in `behaviour`, each for its row (`inquiry_session_signals.<column>#<session id>/<sequence>`,
 *   {@link sessionSignalRowKey}), so the C91.7 retention step can null the components alone and
 *   keep the aggregates with the inquiry (P19). The key is the session and sequence, because the
 *   identity id is not known before the insert.
 * - `inquiry_signal_computations`: the outbox (F02, F03, V17). `createSignalComputationInTx` writes
 *   one row on the inquiry's first move into `completed`, `failed` or `expired`, inside the
 *   transition's transaction; the `inquiry-signals-sweep` enqueues the pending rows and the
 *   `inquiry-signals` job computes and freezes the values.
 * - `devices`: a device exists only when the device-recognition tier recorded an identifier
 *   (C91.2). Its HMACs are plain 64-hex values under the environment's blind-index subkey, with the
 *   key id they were made under (C94.4, P09), so a rotated key never matches.
 * - `session_devices`: the session's device link (to-one), deleted with the session or the device.
 */
import { DECISION_ACTOR_TYPES, type DecisionActorType } from '@openverify/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { sealedColumn } from '../sealed.js';
import {
  createdAt,
  deciderIdFormat,
  hexDigest,
  idFormat,
  oneOf,
  timestamptz,
  updatedAt,
} from './columns.js';
import { environmentId } from './environment-id.js';
import { inquiries, inquirySessions } from './inquiries.js';

/** C94.2: the platforms that send signal bodies and own devices. */
export const SIGNAL_PLATFORM_VALUES = ['web', 'android'] as const;
/** C90.5: the first terminal or decided moves that write the outbox row. */
export const SIGNAL_COMPUTATION_TRIGGER_VALUES = ['completed', 'failed', 'expired'] as const;
/**
 * C90.5: `pending` until the `inquiry-signals` job froze the values (`computed`), or found the
 * inquiry redacted after the row was written and computed nothing (`skipped`).
 */
export const SIGNAL_COMPUTATION_STATE_VALUES = ['pending', 'computed', 'skipped'] as const;

/** The row key a signal body's sealed columns are bound to: its session and sequence. */
export const sessionSignalRowKey = (inquirySessionId: string, sequence: number): string =>
  `${inquirySessionId}/${String(sequence)}`;

export const inquirySessionSignals = pgTable(
  'inquiry_session_signals',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    environmentId: environmentId(),
    inquirySessionId: text('inquiry_session_id').notNull(),
    /** The client's sequence; a repeated one is ignored with 202 (V15). */
    sequence: integer('sequence').notNull(),
    /** The flow-spec step id the body describes. */
    screen: text('screen').notNull(),
    platform: text('platform').$type<(typeof SIGNAL_PLATFORM_VALUES)[number]>().notNull(),
    collectorVersion: integer('collector_version').notNull(),
    /**
     * The `integrity` and `recognition` members (Android's own too) and the route's bounded request
     * facts (V13), sealed for the row; nulled by the C91.7 component retention and by redaction.
     */
    componentsSealed: sealedColumn('components'),
    /** The `behaviour` member, sealed for the row; kept with the inquiry, nulled by redaction. */
    behaviourSealed: sealedColumn('behaviour'),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'inquiry_session_signals_session_fk',
      columns: [table.environmentId, table.inquirySessionId],
      foreignColumns: [inquirySessions.environmentId, inquirySessions.id],
    }).onDelete('cascade'),
    uniqueIndex('inquiry_session_signals_session_sequence_key').on(
      table.inquirySessionId,
      table.sequence,
    ),
    // C91.7: the component retention step walks an environment's bodies by age.
    index('inquiry_session_signals_environment_id_created_at_idx').on(
      table.environmentId,
      table.createdAt,
    ),
    check('inquiry_session_signals_sequence_non_negative', sql`${table.sequence} >= 0`),
    check('inquiry_session_signals_platform_valid', oneOf(table.platform, SIGNAL_PLATFORM_VALUES)),
    check(
      'inquiry_session_signals_collector_version_positive',
      sql`${table.collectorVersion} >= 1`,
    ),
    check(
      'inquiry_session_signals_screen_format',
      sql`${table.screen} ~ '^[a-z][a-z0-9_-]{0,63}$'`,
    ),
  ],
);

export const inquirySignalComputations = pgTable(
  'inquiry_signal_computations',
  {
    environmentId: environmentId(),
    inquiryId: text('inquiry_id').notNull(),
    /** The status the inquiry moved into when the row was written. */
    triggerStatus: text('trigger_status')
      .$type<(typeof SIGNAL_COMPUTATION_TRIGGER_VALUES)[number]>()
      .notNull(),
    state: text('state')
      .$type<(typeof SIGNAL_COMPUTATION_STATE_VALUES)[number]>()
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** The last failure's code (a snake-case name, never a value). */
    lastErrorCode: text('last_error_code'),
    /** When the sweep last enqueued the row. */
    enqueuedAt: timestamptz('enqueued_at'),
    computedAt: timestamptz('computed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({
      name: 'inquiry_signal_computations_pkey',
      columns: [table.environmentId, table.inquiryId],
    }),
    foreignKey({
      name: 'inquiry_signal_computations_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    // The 15 s sweep: pending rows, oldest first.
    index('inquiry_signal_computations_pending_idx')
      .on(table.createdAt)
      .where(sql`${table.state} = 'pending'`),
    check(
      'inquiry_signal_computations_trigger_valid',
      oneOf(table.triggerStatus, SIGNAL_COMPUTATION_TRIGGER_VALUES),
    ),
    check(
      'inquiry_signal_computations_state_valid',
      oneOf(table.state, SIGNAL_COMPUTATION_STATE_VALUES),
    ),
    check('inquiry_signal_computations_attempts_non_negative', sql`${table.attempts} >= 0`),
    check(
      'inquiry_signal_computations_computed_at',
      sql`${table.state} <> 'computed' or ${table.computedAt} is not null`,
    ),
    check(
      'inquiry_signal_computations_last_error_code_format',
      sql`${table.lastErrorCode} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    platform: text('platform').$type<(typeof SIGNAL_PLATFORM_VALUES)[number]>().notNull(),
    collectorVersion: integer('collector_version').notNull(),
    /** The strict browser HMAC (`openverify/browser-fingerprint/v1`); web only. */
    browserFingerprint: text('browser_fingerprint'),
    /** The `ANDROID_ID` HMAC (`openverify/android-id/v1`); Android only (V10). */
    deviceFingerprint: text('device_fingerprint'),
    /** Ours: the web device-class HMAC (`openverify/device-class/v1`), shared by many people. */
    deviceClass: text('device_class'),
    /** C94.4: canvas noise was detected, so the strict HMAC was dropped. */
    fingerprintRandomised: boolean('fingerprint_randomised').notNull().default(false),
    /** C94.4 (P09): the blind-index key id the HMACs were made under. */
    keyId: text('key_id').notNull(),
    firstSeenAt: timestamptz('first_seen_at').notNull(),
    lastSeenAt: timestamptz('last_seen_at').notNull(),
    /** C127.9: read by workflow conditions alone; no signal or check reads it. */
    trustedAt: timestamptz('trusted_at'),
    trustedByType: text('trusted_by_type').$type<DecisionActorType>(),
    trustedById: text('trusted_by_id'),
    /** A code, never free text. */
    trustReason: text('trust_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      'devices_trust_is_whole',
      sql`(${table.trustedAt} is null) = (${table.trustedByType} is null)
        and (${table.trustedAt} is null) = (${table.trustedById} is null)
        and (${table.trustedAt} is null) = (${table.trustReason} is null)`,
    ),
    check('devices_trusted_by_type_valid', oneOf(table.trustedByType, DECISION_ACTOR_TYPES)),
    deciderIdFormat('devices_trusted_by_id_format', table.trustedByType, table.trustedById),
    check('devices_trust_reason_format', sql`${table.trustReason} ~ '^[a-z][a-z0-9_]{0,63}$'`),
    unique('devices_environment_id_id_key').on(table.environmentId, table.id),
    uniqueIndex('devices_browser_fingerprint_key')
      .on(table.environmentId, table.browserFingerprint, table.keyId)
      .where(sql`${table.browserFingerprint} is not null`),
    uniqueIndex('devices_device_fingerprint_key')
      .on(table.environmentId, table.deviceFingerprint, table.keyId)
      .where(sql`${table.deviceFingerprint} is not null`),
    // C91.7: `device-retention-days` deletes devices by `last-seen-at`.
    index('devices_environment_id_last_seen_at_idx').on(table.environmentId, table.lastSeenAt),
    idFormat('devices', table.id, 'dev'),
    check('devices_platform_valid', oneOf(table.platform, SIGNAL_PLATFORM_VALUES)),
    check('devices_collector_version_positive', sql`${table.collectorVersion} >= 1`),
    hexDigest('devices_browser_fingerprint_hex', table.browserFingerprint),
    hexDigest('devices_device_fingerprint_hex', table.deviceFingerprint),
    hexDigest('devices_device_class_hex', table.deviceClass),
    check('devices_key_id_format', sql`${table.keyId} ~ '^[A-Za-z0-9_-]{11}$'`),
    // C91.2 (V10): each identifier comes from its own platform.
    check(
      'devices_identifiers_fit_platform',
      sql`(${table.platform} <> 'web' or ${table.deviceFingerprint} is null)
        and (${table.platform} <> 'android'
             or (${table.browserFingerprint} is null and ${table.deviceClass} is null))`,
    ),
    // C94.4: canvas noise drops the strict HMAC and keeps the device class.
    check(
      'devices_randomised_drops_strict',
      sql`not ${table.fingerprintRandomised} or ${table.browserFingerprint} is null`,
    ),
    // C91.2: a device exists only when an identifier was recorded.
    check(
      'devices_has_identifier',
      sql`num_nonnulls(${table.browserFingerprint}, ${table.deviceFingerprint}, ${table.deviceClass}) > 0`,
    ),
  ],
);

export const sessionDevices = pgTable(
  'session_devices',
  {
    environmentId: environmentId(),
    inquirySessionId: text('inquiry_session_id').notNull(),
    deviceId: text('device_id').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({
      name: 'session_devices_pkey',
      columns: [table.environmentId, table.inquirySessionId],
    }),
    foreignKey({
      name: 'session_devices_session_fk',
      columns: [table.environmentId, table.inquirySessionId],
      foreignColumns: [inquirySessions.environmentId, inquirySessions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'session_devices_device_fk',
      columns: [table.environmentId, table.deviceId],
      foreignColumns: [devices.environmentId, devices.id],
    }).onDelete('cascade'),
    index('session_devices_environment_id_device_id_idx').on(table.environmentId, table.deviceId),
  ],
);

export type InquirySessionSignalRow = typeof inquirySessionSignals.$inferSelect;
export type InquirySignalComputationRow = typeof inquirySignalComputations.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type SessionDeviceRow = typeof sessionDevices.$inferSelect;
