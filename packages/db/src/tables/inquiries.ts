/** Inquiries, the hosted-flow sessions that work on them, and one-time links. */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  FLOW_RECORD_DEVICE_KINDS,
  FLOW_RECORD_PLATFORMS,
  FLOW_RECORD_SPEC_VERSIONS,
  FLOW_RECORD_STATES,
  FLOW_RECORD_STEP_ID_PATTERN,
  INQUIRY_EXPIRY_OVERRIDE_COLUMNS,
  type FlowRecordDeviceKind,
  type FlowRecordPlatform,
  type FlowRecordSpecVersion,
  type FlowRecordState,
} from '@openverify/core';
import { decrypt, encrypt, encryptedJson, getDefaultKeyring } from '../crypto.js';
import { sealedColumn } from '../sealed.js';
import { accounts } from './accounts.js';
import {
  countryCodeFormat,
  createdAt,
  hexDigest,
  idFormat,
  lowerTags,
  oneOf,
  timestamptz,
  trueOrNull,
  updatedAt,
  validTags,
  workflowRunStepId,
  workflowRunStepKey,
} from './columns.js';
import { inquirySessionStatus, inquiryStatus } from './enums.js';
import { inquiryTemplateVersions } from './inquiry-templates.js';
import { themeSets } from './theme-sets.js';
import { environmentId } from './environment-id.js';
import {
  connectProvenanceColumn,
  hydratedFieldsColumn,
  hydratedFieldsList,
  provenanceKindValid,
} from './connect-columns.js';

/** C2 `fields`: free-form values such as names and birthdates, so encrypted at rest. */
export type InquiryFields = Record<string, unknown>;

/**
 * C151.13: the stored `flow-outcome`, PII-free (verification types, step ids of the fallbacks taken,
 * and flag codes); the API serves it in the contract's kebab-case form.
 */
export interface StoredFlowOutcome {
  verificationTypesOnPath: readonly string[];
  fallbacksTaken: readonly string[];
  flags: readonly string[];
}

/** C10 default inquiry lifetime when the template version sets none. */
export const DEFAULT_INQUIRY_EXPIRATION_SECONDS = 86_400;

/**
 * C151.10 (Workflow 9B Stage 1b (F)): the bounds of an inquiry's own expiry windows, C11's
 * (contracts' `MIN_EXPIRATION_SECONDS` and `MAX_EXPIRATION_SECONDS`, which this package cannot
 * import; an API test holds them equal).
 */
export const INQUIRY_EXPIRY_OVERRIDE_SECONDS = Object.freeze({ min: 300, max: 2_592_000 });

export const inquiries = pgTable(
  'inquiries',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    inquiryTemplateId: text('inquiry_template_id').notNull(),
    inquiryTemplateVersionId: text('inquiry_template_version_id').notNull(),
    /** C13: every inquiry belongs to an account of its environment. */
    accountId: text('account_id').notNull(),
    status: inquiryStatus('status').notNull().default('created'),
    /** Customer-chosen reference. Not unique: several inquiries may share one. */
    referenceId: text('reference_id'),
    fields: encryptedJson('fields', { context: 'inquiries.fields' })
      .$type<InquiryFields>()
      .notNull(),
    /** C9 tags. */
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** C10 operator note (at most 2,000 characters), sealed for this row. */
    noteSealed: sealedColumn('note'),
    /** C10: creation time plus the version's `inquiry-expiration-seconds`. */
    expiresAt: timestamptz('expires_at')
      .notNull()
      .default(sql`now() + interval '86400 seconds'`),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    failedAt: timestamptz('failed_at'),
    expiredAt: timestamptz('expired_at'),
    decisionedAt: timestamptz('decisioned_at'),
    /** C16: set once the inquiry's PII was removed; irreversible. */
    redactedAt: timestamptz('redacted_at'),
    /**
     * C90.5 (Workflow 7A): the frozen public `signals` array (`[{ name, value }]` in registry
     * order), written once by the `inquiry-signals` job; `null` until then (served as `[]`). No
     * PII: counts, levels, a country code and distances.
     */
    signals: jsonb('signals').$type<{ name: string; value: unknown }[]>(),
    /** C90.5: our `signal-details` map, frozen with `signals`; `null` until then. */
    signalDetails: jsonb('signal_details').$type<Record<string, unknown>>(),
    /** C117.5: the run's step that created it; `null` for anything else. */
    workflowRunStepId: workflowRunStepId(),
    // C151.1, C151.14 (Workflow 9A Stage 1b (S)): the server flow engine's position, moved only by
    // `advanceFlowInTx` (`api-flow-engine`) under the inquiry's row lock. `null` until the position
    // starts (the `created -> pending` move, or the backfill of an inquiry positioned before 9A).
    /** The step the person is on: a step id of the pinned version's flow. */
    flowStepId: text('flow_step_id'),
    flowState: text('flow_state').$type<FlowRecordState>(),
    /** The person-visible step exited last (never a branch or an action); `null` before one. */
    flowPreviousStepId: text('flow_previous_step_id'),
    /** The flow-spec version of the pinned version's flow the position walks. */
    flowSpecVersion: smallint('flow_spec_version').$type<FlowRecordSpecVersion>(),
    /** Internal (reviews F14, H05): the device kind and platform of the session that served the first step. */
    firstDeviceKind: text('first_device_kind').$type<FlowRecordDeviceKind>(),
    firstPlatform: text('first_platform').$type<FlowRecordPlatform>(),
    /** C151.13: the PII-free `flow-outcome` (codes only), written once the flow ends. */
    flowOutcome: jsonb('flow_outcome').$type<StoredFlowOutcome>(),
    /**
     * C149.4: the `fields` set at creation, sealed for the row (`inquiries.initial_fields#<id>`) and
     * never changed; the two comparison checks read it. `null` when the inquiry was created without
     * fields, and after a redaction.
     */
    initialFieldsSealed: sealedColumn('initial_fields'),
    /**
     * C158.4 (Workflow 9A Stage 1b (F)): the `redirect-uri` the inquiry was created with, checked
     * at creation and again whenever the session answers against the environment's current
     * `allowed-redirect-origins` (`services/embed-origins.ts`); `null` when none.
     */
    redirectUri: text('redirect_uri'),
    /**
     * C160.7 (Workflow 9A Stage 1b (H)): the theme set the inquiry was created with, an active set
     * of its environment (checked by `api-themes` in 9B); `null` when none.
     */
    themeSetId: text('theme_set_id'),
    // C151.10 (Workflow 9B Stage 1b (F); contracts B44): the windows `POST /inquiries`' `meta` sets for
    // this inquiry beyond creation, in seconds; `null` when the pinned version's setting decides.
    // `api-flow-expiry` writes them on create and applies them at the start, on a resume and when a
    // one-time link is made.
    expirationAfterStartSeconds: integer(
      INQUIRY_EXPIRY_OVERRIDE_COLUMNS['expiration-after-start-interval-seconds'],
    ),
    expirationAfterResumeSeconds: integer(
      INQUIRY_EXPIRY_OVERRIDE_COLUMNS['expiration-after-resume-interval-seconds'],
    ),
    oneTimeLinkExpirationSeconds: integer(
      INQUIRY_EXPIRY_OVERRIDE_COLUMNS['one-time-link-expiration-seconds'],
    ),
    /** C230.5, C235.1 (Workflow 11A): a copy's Connect provenance; `null` on every row not copied. */
    provenance: connectProvenanceColumn(),
    /** C230.5, C235.1 (Workflow 11A): the keys hydrated from a share, with their token; never a value. */
    hydratedFields: hydratedFieldsColumn(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    provenanceKindValid('inquiries_provenance_kind_valid', table.provenance),
    hydratedFieldsList('inquiries_hydrated_fields_list', table.hydratedFields),
    ...workflowRunStepKey('inquiries', table.environmentId, table.workflowRunStepId),
    check(
      'inquiries_expiry_overrides_range',
      sql.join(
        [
          table.expirationAfterStartSeconds,
          table.expirationAfterResumeSeconds,
          table.oneTimeLinkExpirationSeconds,
        ].map(
          (column) =>
            sql`(${column} is null or ${column} between ${sql.raw(String(INQUIRY_EXPIRY_OVERRIDE_SECONDS.min))} and ${sql.raw(String(INQUIRY_EXPIRY_OVERRIDE_SECONDS.max))})`,
        ),
        sql` and `,
      ),
    ),
    check(
      'inquiries_flow_state_valid',
      sql`${table.flowState} is null or ${oneOf(table.flowState, FLOW_RECORD_STATES)}`,
    ),
    check(
      'inquiries_flow_spec_version_valid',
      sql`${table.flowSpecVersion} is null or ${table.flowSpecVersion} in (${sql.raw(FLOW_RECORD_SPEC_VERSIONS.join(', '))})`,
    ),
    check(
      'inquiries_flow_step_id_format',
      sql`(${table.flowStepId} is null or ${table.flowStepId} ~ ${sql.raw(`'${FLOW_RECORD_STEP_ID_PATTERN}'`)})
        and (${table.flowPreviousStepId} is null or ${table.flowPreviousStepId} ~ ${sql.raw(`'${FLOW_RECORD_STEP_ID_PATTERN}'`)})`,
    ),
    check(
      'inquiries_first_device_kind_valid',
      sql`${table.firstDeviceKind} is null or ${oneOf(table.firstDeviceKind, FLOW_RECORD_DEVICE_KINDS)}`,
    ),
    check(
      'inquiries_first_platform_valid',
      sql`${table.firstPlatform} is null or ${oneOf(table.firstPlatform, FLOW_RECORD_PLATFORMS)}`,
    ),
    foreignKey({
      name: 'inquiries_theme_set_fk',
      columns: [table.environmentId, table.themeSetId],
      foreignColumns: [themeSets.environmentId, themeSets.id],
    }),
    check(
      'inquiries_redirect_uri_length',
      sql`${table.redirectUri} is null or char_length(${table.redirectUri}) <= 2048`,
    ),
    // C151.2: the flow sweep's waits (`flow-action-sweep`, which also ends expired branch waits).
    index('inquiries_flow_waiting_idx')
      .on(table.environmentId, table.id)
      .where(sql`${table.flowState} = 'waiting'`),
    // NO ACTION (not RESTRICT): an environment delete cascades to inquiries and template
    // versions in one statement, and the check runs once both are gone.
    foreignKey({
      name: 'inquiries_template_version_fk',
      columns: [table.environmentId, table.inquiryTemplateId, table.inquiryTemplateVersionId],
      foreignColumns: [
        inquiryTemplateVersions.environmentId,
        inquiryTemplateVersions.inquiryTemplateId,
        inquiryTemplateVersions.id,
      ],
    }),
    foreignKey({
      name: 'inquiries_account_fk',
      columns: [table.environmentId, table.accountId],
      foreignColumns: [accounts.environmentId, accounts.id],
    }),
    unique('inquiries_environment_id_id_key').on(table.environmentId, table.id),
    index('inquiries_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('inquiries_environment_id_status_created_at_id_idx').on(
      table.environmentId,
      table.status,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('inquiries_environment_id_reference_id_idx').on(table.environmentId, table.referenceId),
    index('inquiries_environment_id_account_id_created_at_id_idx').on(
      table.environmentId,
      table.accountId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('inquiries_environment_id_template_id_created_at_id_idx').on(
      table.environmentId,
      table.inquiryTemplateId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('inquiries_lower_tags_idx').using('gin', lowerTags(table.tags)),
    // The C10 expiry sweep: open inquiries by expiry.
    index('inquiries_open_expires_at_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} IN ('created', 'pending')`),
    // The C16 retention sweep: unredacted inquiries in a terminal status by age.
    index('inquiries_retention_updated_at_idx')
      .on(table.updatedAt)
      .where(
        sql`${table.redactedAt} IS NULL AND ${table.status} IN ('completed', 'failed', 'expired', 'approved', 'declined')`,
      ),
    // C163.4 (Workflow 9B Stage 1b (A), B2): the analytics rollup's dirty-day scan, the inquiries an
    // environment changed since the watermark.
    index('inquiries_environment_id_updated_at_idx').on(table.environmentId, table.updatedAt),
    validTags('inquiries_tags_valid', table.tags),
    idFormat('inquiries', table.id, 'inq'),
  ],
);

/** Consent captured by `POST /flow/consent` (C3). */
export interface ConsentRecord {
  acceptedAt: Date;
  /** Translation keys of the consent texts shown, e.g. `consent.biometric`. */
  textKeys: string[];
  /**
   * C42.3: the optional consent texts the user ticked, such as `consent.biometric-matching`.
   * Absent from a consent recorded before Phase 4 (none could be ticked then).
   */
  optionalTextKeys?: string[];
  locale: string;
  /** Client IP; encrypted inside the jsonb. */
  ip: string | null;
  /** Client user agent; encrypted inside the jsonb. */
  userAgent: string | null;
}

interface StoredConsent {
  accepted_at: string;
  text_keys: string[];
  /** C42.3; absent from a consent recorded before Phase 4. */
  optional_text_keys?: string[];
  locale: string;
  ip: string | null;
  user_agent: string | null;
}

const CONSENT_IP = { context: 'inquiry_sessions.consent.ip' };
const CONSENT_USER_AGENT = { context: 'inquiry_sessions.consent.user_agent' };

const sealOptional = (value: string | null, options: { context: string }): string | null =>
  value === null ? null : encrypt(value, getDefaultKeyring(), options);
const openOptional = (value: string | null, options: { context: string }): string | null =>
  value === null ? null : decrypt(value, getDefaultKeyring(), options);

/**
 * jsonb consent record `{ accepted_at, text_keys, optional_text_keys?, locale, ip, user_agent }`
 * (`optional_text_keys` since Phase 4, C42.3). The IP and
 * user agent are personal data, so they are envelope-encrypted inside the document; the
 * rest stays queryable. Encryption uses the default keyring (see `setDefaultKeyring`).
 */
const consentRecord = customType<{ data: ConsentRecord; driverData: string | StoredConsent }>({
  dataType: () => 'jsonb',
  toDriver: (value) =>
    JSON.stringify({
      accepted_at: value.acceptedAt.toISOString(),
      text_keys: value.textKeys,
      ...(value.optionalTextKeys === undefined
        ? {}
        : { optional_text_keys: value.optionalTextKeys }),
      locale: value.locale,
      ip: sealOptional(value.ip, CONSENT_IP),
      user_agent: sealOptional(value.userAgent, CONSENT_USER_AGENT),
    } satisfies StoredConsent),
  fromDriver: (value) => {
    const stored = typeof value === 'string' ? (JSON.parse(value) as StoredConsent) : value;
    return {
      acceptedAt: new Date(stored.accepted_at),
      textKeys: stored.text_keys,
      ...(stored.optional_text_keys === undefined
        ? {}
        : { optionalTextKeys: stored.optional_text_keys }),
      locale: stored.locale,
      ip: openOptional(stored.ip, CONSENT_IP),
      userAgent: openOptional(stored.user_agent, CONSENT_USER_AGENT),
    };
  },
});

/** C96.1: how a handoff reaches the phone (`@openverify/contracts` `HANDOFF_METHODS`). */
export const HANDOFF_METHOD_VALUES = ['qr', 'email', 'sms'] as const;
/** C91.1, C94.5: the device types the user agent or the SDK's signal body gives. */
export const SESSION_DEVICE_TYPE_VALUES = ['desktop', 'smartphone', 'tablet', 'tv'] as const;
/** C94.5: the SDKs that name themselves in their `User-Agent`. */
export const MOBILE_SDK_NAME_VALUES = ['openverify-android', 'openverify-ios'] as const;
/** C94.6: the collection tiers a session's `signals-collected` may name. */
export const COLLECTION_TIER_VALUES = ['session-integrity', 'device-recognition'] as const;

/** C93.4: the session's threat levels (`SESSION_THREAT_LEVELS`); `null` where it is not evaluated. */
export const SESSION_THREAT_LEVEL_VALUES = ['low', 'medium', 'high'] as const;

/**
 * C91.1, C93.3: an IP location from DB-IP City Lite (approximate: a coarse city point), sealed for
 * its row as JSON; `null` without City Lite. Each member may be `null` on its own.
 */
export interface NetworkLocation {
  regionCode: string | null;
  regionName: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Hosted-flow and Android sessions (`ovs_...` tokens, C1). Only the SHA-256 is stored.
 *
 * C10 status: `active` until the TTL passes or the session is expired explicitly
 * (`expired`), or until the inquiry leaves `created`/`pending` (`canceled`). `revoked_at`
 * (Phase 1) is set with either, so older checks keep refusing the token. `ip` and
 * `user_agent` are those of the first flow call, sealed for this row.
 */
export const inquirySessions = pgTable(
  'inquiry_sessions',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    inquiryId: text('inquiry_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
    status: inquirySessionStatus('status').notNull().default('active'),
    /** The first successful flow API call (C10 `inquiry-session.started`). */
    startedAt: timestamptz('started_at'),
    expiredAt: timestamptz('expired_at'),
    canceledAt: timestamptz('canceled_at'),
    ipSealed: sealedColumn('ip'),
    userAgentSealed: sealedColumn('user_agent'),
    /** `NULL` until the end user consents; uploads are refused before that (C3). */
    consent: consentRecord('consent'),
    // C91.1, C93.2 (Workflow 7A): the network facts of the session's address, written once with its
    // `networks` row by `evaluateSessionNetworkInTx` (`api-network`) at the first flow call; never
    // re-evaluated. `null` until then, and each `null` fact's reason is on the network row.
    /** When the address was evaluated; `null` while it was not (`sessions_not_evaluated`, C90.4). */
    networkEvaluatedAt: timestamptz('network_evaluated_at'),
    /** `false` only for a public IPv4 address absent from a fresh exit list (C93.3). */
    isTor: boolean('is_tor'),
    /** `true` from an enabled provider's published ranges only, else `null` (H13). */
    isDatacenter: boolean('is_datacenter'),
    /** `true` from the VPN seed or the overrides, else `null`. */
    isVpn: boolean('is_vpn'),
    /** The `ipReputation` adapter's answer; `false` only when its file records a negative (C93.5). */
    isProxy: boolean('is_proxy'),
    /** Ours, H (`beta`): the ASN is in the hosting seeds less the overrides; `true` or `null`. */
    hostingAsn: boolean('hosting_asn'),
    threatLevel: text('threat_level').$type<(typeof SESSION_THREAT_LEVEL_VALUES)[number]>(),
    countryCode: text('country_code'),
    countryName: text('country_name'),
    /** {@link NetworkLocation}, sealed for the row (C91.6: region and point are PII). */
    locationSealed: sealedColumn('location'),
    /** `datacenter` from provider ranges only, an adapter's value, or `null`. */
    ipConnectionType: text('ip_connection_type'),
    /** The AS organisation (DB-IP ASN Lite): served as both `ip-isp` and `network-organization`. */
    networkOrganization: text('network_organization'),
    // C91.1, C94.5 (Workflow 7A): the parsed device fields, written by `recordSessionDeviceInTx`
    // (`api-signals`) at the first flow call from `signal-logic`'s mapper; each at most 64
    // characters. An SDK session's `device_type` comes from its first signal body.
    osName: text('os_name'),
    osFullVersion: text('os_full_version'),
    browserName: text('browser_name'),
    browserFullVersion: text('browser_full_version'),
    deviceType: text('device_type').$type<(typeof SESSION_DEVICE_TYPE_VALUES)[number]>(),
    deviceName: text('device_name'),
    mobileSdkName: text('mobile_sdk_name').$type<(typeof MOBILE_SDK_NAME_VALUES)[number]>(),
    mobileSdkFullVersion: text('mobile_sdk_full_version'),
    /** C94.6: the collection tiers that applied to the session; `{}` until one did. */
    signalsCollected: text('signals_collected')
      .array()
      .$type<(typeof COLLECTION_TIER_VALUES)[number][]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** C94.2 (P23, V15): signal bodies answered 202 beyond the 200 stored, counted only. */
    signalBodiesDropped: integer('signal_bodies_dropped').notNull().default(0),
    // C91.1, C96.4, C96.7 (Workflow 7A): the handoff fields of a session a redemption created,
    // written by `flow-handoff`; `null` on every other session.
    /** `qr` (the QR or its copied short link), `email` or `sms`. */
    deviceHandoffMethod:
      text('device_handoff_method').$type<(typeof HANDOFF_METHOD_VALUES)[number]>(),
    /** The issuing (desktop) session. */
    handoffFromSessionId: text('handoff_from_session_id'),
    handoffRedeemedAt: timestamptz('handoff_redeemed_at'),
    /** C95, C96.7: whole meters between the two sessions' IP points; `null` without City Lite. */
    handoffDistanceMeters: integer('handoff_distance_meters'),
    /** C96.7: `null` when either side's country is unknown. */
    handoffCountryChanged: boolean('handoff_country_changed'),
    /** C96.7: `null` when either side's ASN is unknown. */
    handoffAsnChanged: boolean('handoff_asn_changed'),
    /**
     * Ours (V02, V03): the issuing session said "this was not me". The session's consent then
     * authorises nothing (`getEffectiveConsent`).
     */
    handoffRejectedAt: timestamptz('handoff_rejected_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Phase 7: the session's own tables (`networks`, and Workflow 7A's later ones) reach it here.
    unique('inquiry_sessions_environment_id_id_key').on(table.environmentId, table.id),
    // C96.3, C96.4 (Workflow 7A): the issuing session of a handoff session, in its environment.
    foreignKey({
      name: 'inquiry_sessions_handoff_from_session_fk',
      columns: [table.environmentId, table.handoffFromSessionId],
      foreignColumns: [table.environmentId, table.id],
    }),
    // F13: `assertSessionNotHandedOff` finds an issuing session's redeemed sessions.
    index('inquiry_sessions_handoff_from_session_id_idx')
      .on(table.environmentId, table.handoffFromSessionId)
      .where(sql`${table.handoffFromSessionId} is not null`),
    foreignKey({
      name: 'inquiry_sessions_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    uniqueIndex('inquiry_sessions_token_hash_key').on(table.tokenHash),
    index('inquiry_sessions_environment_id_inquiry_id_idx').on(
      table.environmentId,
      table.inquiryId,
    ),
    index('inquiry_sessions_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // The C10 session expiry sweep.
    index('inquiry_sessions_active_expires_at_idx')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'active'`),
    hexDigest('inquiry_sessions_token_hash_hex', table.tokenHash),
    check(
      'inquiry_sessions_expired_at',
      sql`${table.status} <> 'expired' OR ${table.expiredAt} IS NOT NULL`,
    ),
    check(
      'inquiry_sessions_canceled_at',
      sql`${table.status} <> 'canceled' OR ${table.canceledAt} IS NOT NULL`,
    ),
    idFormat('inquiry_sessions', table.id, 'iqse'),
    // C90.3, C93.3 (H13): the flags whose lists are not exhaustive are never `false`.
    trueOrNull('inquiry_sessions_is_datacenter_true_or_null', table.isDatacenter),
    trueOrNull('inquiry_sessions_is_vpn_true_or_null', table.isVpn),
    trueOrNull('inquiry_sessions_hosting_asn_true_or_null', table.hostingAsn),
    check(
      'inquiry_sessions_threat_level_valid',
      oneOf(table.threatLevel, SESSION_THREAT_LEVEL_VALUES),
    ),
    countryCodeFormat('inquiry_sessions_country_code_format', table.countryCode),
    check(
      'inquiry_sessions_device_type_valid',
      oneOf(table.deviceType, SESSION_DEVICE_TYPE_VALUES),
    ),
    check(
      'inquiry_sessions_mobile_sdk_name_valid',
      oneOf(table.mobileSdkName, MOBILE_SDK_NAME_VALUES),
    ),
    check(
      'inquiry_sessions_signals_collected_valid',
      sql`${table.signalsCollected} <@ array[${sql.raw(COLLECTION_TIER_VALUES.map((value) => `'${value}'`).join(', '))}]::text[]`,
    ),
    check(
      'inquiry_sessions_signal_bodies_dropped_non_negative',
      sql`${table.signalBodiesDropped} >= 0`,
    ),
    check(
      'inquiry_sessions_device_handoff_method_valid',
      oneOf(table.deviceHandoffMethod, HANDOFF_METHOD_VALUES),
    ),
    // C96.4: a redemption records its method, its issuing session and its time together.
    check(
      'inquiry_sessions_handoff_fields_together',
      sql`num_nulls(${table.deviceHandoffMethod}, ${table.handoffFromSessionId},
        ${table.handoffRedeemedAt}) in (0, 3)`,
    ),
    // C96.7 (V03): the distance facts and a rejection exist only on a handoff session.
    check(
      'inquiry_sessions_handoff_facts_need_handoff',
      sql`${table.handoffFromSessionId} is not null
        or num_nonnulls(${table.handoffDistanceMeters}, ${table.handoffCountryChanged},
          ${table.handoffAsnChanged}, ${table.handoffRejectedAt}) = 0`,
    ),
    check(
      'inquiry_sessions_handoff_distance_non_negative',
      sql`${table.handoffDistanceMeters} >= 0`,
    ),
    check(
      'inquiry_sessions_device_fields_length',
      sql`greatest(char_length(${table.osName}), char_length(${table.osFullVersion}),
        char_length(${table.browserName}), char_length(${table.browserFullVersion}),
        char_length(${table.deviceName}), char_length(${table.mobileSdkFullVersion})) <= 64`,
    ),
  ],
);

/**
 * C10 single-use one-time links (`ovo_...` tokens). Only the SHA-256 is stored. A new
 * link revokes the inquiry's older unused ones.
 */
export const oneTimeLinks = pgTable(
  'one_time_links',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    environmentId: environmentId(),
    inquiryId: text('inquiry_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'one_time_links_inquiry_fk',
      columns: [table.environmentId, table.inquiryId],
      foreignColumns: [inquiries.environmentId, inquiries.id],
    }).onDelete('cascade'),
    uniqueIndex('one_time_links_token_hash_key').on(table.tokenHash),
    index('one_time_links_environment_id_inquiry_id_idx').on(table.environmentId, table.inquiryId),
    // C16 retention deletes links long past their expiry (Workflow 2B F022).
    index('one_time_links_expires_at_idx').on(table.expiresAt),
    hexDigest('one_time_links_token_hash_hex', table.tokenHash),
    check(
      'one_time_links_used_or_revoked',
      sql`${table.usedAt} IS NULL OR ${table.revokedAt} IS NULL`,
    ),
  ],
);

export type InquiryRow = typeof inquiries.$inferSelect;
export type NewInquiry = typeof inquiries.$inferInsert;
export type InquirySessionRow = typeof inquirySessions.$inferSelect;
export type NewInquirySession = typeof inquirySessions.$inferInsert;
export type OneTimeLink = typeof oneTimeLinks.$inferSelect;

/** An inquiry as the repositories return it: the note opened, the ciphertext dropped. */
/**
 * An inquiry as the repositories return it: the note opened; the initial fields (C149.4) left out,
 * read only through `getInquiryInitialFields`.
 */
export type Inquiry = Omit<InquiryRow, 'noteSealed' | 'initialFieldsSealed'> & {
  note: string | null;
};

/**
 * An inquiry session as the repositories return it: the first flow call's IP and user
 * agent opened, the ciphertexts dropped.
 */
export type InquirySession = Omit<
  InquirySessionRow,
  'ipSealed' | 'userAgentSealed' | 'locationSealed'
> & {
  ip: string | null;
  userAgent: string | null;
  /** C91.1: the IP location, opened; `null` without City Lite, before evaluation or after redaction. */
  location: NetworkLocation | null;
};
