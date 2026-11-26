/**
 * Dashboard API (contracts C4 and C15), called server-side by `apps/dashboard` with a user
 * session token. Login failures always return the same generic 401. Bodies of the session,
 * MFA and invitation endpoints are plain objects; resource endpoints use JSON:API documents.
 */
import { GRAPH_LIMITS, TRANSACTION_LIMITS, permissionSchema } from '@openverify/core';
import { z } from 'zod';
import { environmentKindSchema } from './environments.js';
import { fileResourceSchema } from './files.js';
import { idSchema } from './ids.js';
import { MAX_ORIGIN_ENTRIES } from './origin-pattern.js';
import {
  inquiryListDocumentSchema,
  inquiryResourceSchema,
  listInquiriesQuerySchema,
} from './inquiries.js';
import { hasDistinctValues, timestampSchema } from './json-api.js';
import {
  mfaFactorKindSchema,
  totpCodeSchema,
  webauthnAuthenticationResponseSchema,
  webauthnRequestOptionsSchema,
} from './mfa.js';
import { OTP_SMS_MAX_PER_HOUR, otpSmsMaxPerHourSchema } from './otp.js';
import { recoveryCodeInputSchema } from './recovery-codes.js';
import { DEFAULT_SIGNAL_COLLECTION, signalCollectionSettingSchema } from './flow-signals.js';
import { organizationDisplayNameSchema } from './handoffs.js';
import { retentionDaysSchema } from './template-settings.js';
import { invitationTokenSchema, mfaTokenSchema, userSessionTokenSchema } from './tokens.js';
import { userNameSchema, userResourceSchema } from './users.js';
import { VERIFICATION_RESOURCE_SCHEMAS } from './verifications.js';
import {
  FACE_SEARCH_MAX_TEMPLATES,
  FACE_TEMPLATE_RETENTION_DAYS,
  faceSearchMaxTemplatesSchema,
  faceTemplateRetentionDaysSchema,
  selfieCaptureResourceSchema,
} from './selfie-captures.js';

/** `POST /api/v1/dashboard/sessions` body. The password length is bounded for Argon2id. */
/**
 * C248.8 (Phase 11, Workflow 11B Stage 1a amendment 10): an organisation's sign-in name, 3 to 63
 * characters of lowercase letters, digits and inner hyphens, unique on the install (409
 * `organization_slug_taken`); the SSO start path names it, and the C4 login may.
 */
export const organizationSlugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/, 'must be a sign-in name: a-z, 0-9 and inner -');

export const dashboardLoginBodySchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(1024),
  /**
   * C248.8 (Workflow 11B): an optional sign-in name that narrows the accounts checked to one
   * organisation's; an unknown name answers the same generic 401 as wrong credentials, in the same
   * time. Without it every account with the email is checked, as before.
   */
  organization: organizationSlugSchema.optional(),
});
export type DashboardLoginBody = z.infer<typeof dashboardLoginBodySchema>;

export const dashboardSessionResponseSchema = z.strictObject({
  token: userSessionTokenSchema,
  'expires-at': timestampSchema,
  user: userResourceSchema,
});
export type DashboardSessionResponse = z.infer<typeof dashboardSessionResponseSchema>;

/** The session's environment. */
export const dashboardEnvironmentSchema = z.strictObject({
  id: idSchema('env'),
  kind: environmentKindSchema,
});

/**
 * What the session may do where it is (C15); `mfa-satisfied` is false until MFA is passed.
 * `environments` lists every environment of the organization, oldest first, so the dashboard's
 * switcher knows where it can go (Workflow 2C; optional, since earlier servers did not send it).
 * Listing one is not permission to enter it: production still needs `environments:production`.
 */
export const dashboardSessionContextSchema = z.strictObject({
  environment: dashboardEnvironmentSchema,
  environments: z.array(dashboardEnvironmentSchema).min(1).optional(),
  permissions: z.array(permissionSchema),
  'mfa-satisfied': z.boolean(),
});

/** `GET /api/v1/dashboard/me`: the user and, since Phase 2, the session context. */
export const dashboardMeDocumentSchema = z.strictObject({
  data: userResourceSchema,
  meta: dashboardSessionContextSchema.optional(),
});

/**
 * `POST /api/v1/dashboard/sessions` answers 202 with this when the user has MFA: present one
 * factor with the token (5 minutes, single use; five wrong codes revoke it).
 */
export const dashboardMfaChallengeResponseSchema = z.strictObject({
  'mfa-token': mfaTokenSchema,
  factors: z.array(z.strictObject({ id: idSchema('mfa'), type: mfaFactorKindSchema })),
});
export type DashboardMfaChallengeResponse = z.infer<typeof dashboardMfaChallengeResponseSchema>;

/** `POST /api/v1/dashboard/sessions/mfa`: a TOTP code or a recovery code; answers 201 with a session. */
export const dashboardMfaLoginBodySchema = z.union([
  z.strictObject({ 'mfa-token': mfaTokenSchema, 'totp-code': totpCodeSchema }),
  z.strictObject({ 'mfa-token': mfaTokenSchema, 'recovery-code': recoveryCodeInputSchema }),
]);
export type DashboardMfaLoginBody = z.infer<typeof dashboardMfaLoginBodySchema>;

/** `POST /api/v1/dashboard/sessions/mfa/webauthn/options`. */
export const dashboardWebauthnLoginOptionsBodySchema = z.strictObject({
  'mfa-token': mfaTokenSchema,
});
export const dashboardWebauthnLoginOptionsResponseSchema = z.strictObject({
  options: webauthnRequestOptionsSchema,
});

/** `POST /api/v1/dashboard/sessions/mfa/webauthn/verify`; answers 201 with a session. */
export const dashboardWebauthnLoginVerifyBodySchema = z.strictObject({
  'mfa-token': mfaTokenSchema,
  credential: webauthnAuthenticationResponseSchema,
});

/**
 * `PUT /api/v1/dashboard/sessions/current/environment`. Production needs the permission
 * `environments:production`; every switch writes an audit entry.
 */
export const dashboardSwitchEnvironmentBodySchema = z.strictObject({
  'environment-id': idSchema('env'),
});
export const dashboardSwitchEnvironmentResponseSchema = z.strictObject({
  environment: dashboardEnvironmentSchema,
});

/**
 * `POST /api/v1/dashboard/users/invitations` (permission `users:write`): emails a link with an
 * `ovi_` token valid 7 days. The token is never returned.
 */
export const dashboardInviteUserBodySchema = z.strictObject({
  email: z.email().max(254),
  'role-ids': z
    .array(idSchema('role'))
    .min(1)
    .refine(hasDistinctValues, 'must not contain duplicates'),
});
export const dashboardInvitationResponseSchema = z.strictObject({
  email: z.email().max(254),
  'role-ids': z.array(idSchema('role')).min(1),
  'expires-at': timestampSchema,
});

/** Length bounds of a new password; the upper bound keeps Argon2id cheap to refuse. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

/** `POST /api/v1/dashboard/invitations/accept`. */
export const dashboardAcceptInvitationBodySchema = z.strictObject({
  token: invitationTokenSchema,
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  name: userNameSchema,
});
export type DashboardAcceptInvitationBody = z.infer<typeof dashboardAcceptInvitationBodySchema>;

/** C73.6 (P14): the bounds of `report-retention-days`; `null` keeps reports (the default). */
export const REPORT_RETENTION_DAYS = Object.freeze({ min: 1, max: 3650, default: null });
export const reportRetentionDaysSchema = z
  .int()
  .min(REPORT_RETENTION_DAYS.min)
  .max(REPORT_RETENTION_DAYS.max);

/** C105.5 (Workflow 7B): the bounds of `transaction-retention-days`; `null` keeps them. */
export const TRANSACTION_RETENTION_DAYS = Object.freeze({
  min: 1,
  max: TRANSACTION_LIMITS.retentionDays,
  default: null,
});
export const transactionRetentionDaysSchema = z
  .int()
  .min(TRANSACTION_RETENTION_DAYS.min)
  .max(TRANSACTION_RETENTION_DAYS.max);

/**
 * C102.7 (Workflow 7B; decision 19): stored graph query results are redacted this many days after
 * the query; 30 by default.
 */
export const GRAPH_QUERY_RETENTION_DAYS = Object.freeze({
  min: 1,
  max: GRAPH_LIMITS.retentionDays,
  default: GRAPH_LIMITS.defaultRetentionDays,
});
export const graphQueryRetentionDaysSchema = z
  .int()
  .min(GRAPH_QUERY_RETENTION_DAYS.min)
  .max(GRAPH_QUERY_RETENTION_DAYS.max);

/**
 * C101.3, C101.2, C101.6 (Workflow 7B; P26, decision 50): the graph switches, `settings:privacy`.
 * Indexing is on; weak kinds and components are off.
 */
/** C143.7 (Workflow 8A): each list's cap (ours, provisional). */
export const WORKFLOW_SETTING_LIMITS = Object.freeze({
  ports: 16,
  hosts: 100,
  cidrs: 32,
  recipients: 100,
  countries: 250,
});

/** C120.8: the bounds of the two run retention windows (decision 14). */
export const WORKFLOW_RUN_RETENTION_DAYS = Object.freeze({ min: 1, max: 3650, default: 30 });
export const WORKFLOW_RUN_HISTORY_RETENTION_DAYS = Object.freeze({
  min: 1,
  max: 3650,
  default: 365,
});
/** C117.8 (decision 10): the steps of an environment in flight at once. */
export const WORKFLOW_IN_FLIGHT_CAP = Object.freeze({ min: 1, max: 10_000, default: 50 });
/** C139.3: the bounds of `case-retention-days`; `null` keeps cases (the default). */
export const CASE_RETENTION_DAYS = Object.freeze({ min: 1, max: 3650, default: null });

const retentionWindow = (bounds: { min: number; max: number }) =>
  z.int().min(bounds.min).max(bounds.max);

/** A lower-case host name, never a URL: an allowlist compares it with a parsed host (C124.3). */
const hostNameSchema = z
  .string()
  .max(253)
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u, {
    message: 'must be a lower-case host name',
  });
const hostNameListSchema = z.array(hostNameSchema).max(WORKFLOW_SETTING_LIMITS.hosts);
/** C126.1: an address, or a whole domain. */
const emailRecipientSchema = z.union([z.email().max(254), hostNameSchema]);
/** C126.2: E.164. */
const smsRecipientSchema = z.string().regex(/^\+[1-9]\d{6,14}$/u, 'must be an E.164 number');
const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/u, 'must be an ISO 3166-1 alpha-2 code');
/** C124.3: the shape alone: the route's egress check judges which blocks it may lie in. */
const cidrSchema = z.union([z.cidrv4(), z.cidrv6()]);

/** C143.7 (Workflow 8A): served with their defaults; optional so earlier answers parse. */
const workflowSettingsShape = {
  'workflow-run-retention-days': retentionWindow(WORKFLOW_RUN_RETENTION_DAYS).optional(),
  'workflow-run-history-retention-days': retentionWindow(
    WORKFLOW_RUN_HISTORY_RETENTION_DAYS,
  ).optional(),
  'workflow-in-flight-cap': retentionWindow(WORKFLOW_IN_FLIGHT_CAP).optional(),
  /** C124.3: ports beside 443. */
  'workflow-http-ports': z
    .array(z.int().min(1).max(65_535))
    .max(WORKFLOW_SETTING_LIMITS.ports)
    .optional(),
  /** C124.3: `null` keeps the host allowlist off. */
  'workflow-http-hosts': hostNameListSchema.nullable().optional(),
  /** C124.3: also needs `settings:privacy`. */
  'workflow-http-private-cidrs': z.array(cidrSchema).max(WORKFLOW_SETTING_LIMITS.cidrs).optional(),
  /** C126.1. */
  'workflow-email-recipients': z
    .array(emailRecipientSchema)
    .max(WORKFLOW_SETTING_LIMITS.recipients)
    .optional(),
  /** C126.2. */
  'workflow-sms-recipients': z
    .array(smsRecipientSchema)
    .max(WORKFLOW_SETTING_LIMITS.recipients)
    .optional(),
  /** C126.2: `null` follows the inquiry template's phone step. */
  'workflow-sms-countries': z
    .array(countryCodeSchema)
    .max(WORKFLOW_SETTING_LIMITS.countries)
    .nullable()
    .optional(),
  /** C126, C128.3. */
  'workflow-link-hosts': hostNameListSchema.optional(),
  /** C139.3: `null` keeps cases. */
  'case-retention-days': retentionWindow(CASE_RETENTION_DAYS).nullable().optional(),
};

/**
 * C158.1, C158.4, C174.6 (Workflow 9A): the origins that may frame the embedded flow, the redirect
 * origins (`null`: the embed origins), and the environment's default theme set. Each origin follows
 * the grammar of `origin-pattern.ts`; the environment's kind decides `http:` and `localhost`, which
 * the route checks (`embed_origin_invalid`, and `embed_wildcard_unacknowledged` for a production
 * wildcard without `meta.acknowledge-wildcards`).
 */
const embeddingSettingsShape = {
  'allowed-embed-origins': z.array(z.string().min(1).max(300)).max(MAX_ORIGIN_ENTRIES).optional(),
  'allowed-redirect-origins': z
    .array(z.string().min(1).max(300))
    .max(MAX_ORIGIN_ENTRIES)
    .nullable()
    .optional(),
  'default-theme-set-id': idSchema('theset').nullable().optional(),
};

/**
 * C163.2 (Workflow 9B; decision 36): the environment's reporting time zone, an IANA name the runtime
 * knows (`Intl`), such as `Europe/Paris` or `UTC`. A UTC offset (`+05:30`) is refused, because
 * PostgreSQL reads a bare offset with the POSIX sign, the opposite of ISO 8601's.
 */
export const analyticsTimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
  .regex(/^(?:UTC|[A-Z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+){1,2})$/, 'must be an IANA time zone name')
  .refine(isKnownTimeZone, 'must be a time zone this runtime knows');

function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * C164.7 (decision 37): counts from 1 to the threshold minus one are suppressed. The floor is 11,
 * never lowered (the CMS cell-size rule: no cell from 1 to 10); the ceiling of 100 is ours.
 */
export const ANALYTICS_SUPPRESSION_THRESHOLD = Object.freeze({ min: 11, max: 100, default: 11 });
/** C163.6 (decision 38): rollups are kept this many months (13 by default, 13 to 60). */
export const ANALYTICS_RETENTION_MONTHS = Object.freeze({ min: 13, max: 60, default: 13 });
/** C163.4 (decision 72): a local day is recomputed for this many days after it, then frozen. */
export const ANALYTICS_SETTLE_DAYS = Object.freeze({ min: 1, max: 90, default: 30 });
/**
 * C163.3 (review P20): the per-reviewer rollup is personal data about employees, kept this many
 * months (13 by default, as the other rollups); the floor of 1 is ours, so an organisation may
 * keep less, and the ceiling is the rollups' own.
 */
export const ANALYTICS_ASSIGNEE_RETENTION_MONTHS = Object.freeze({ min: 1, max: 60, default: 13 });
/** C169.2 (decision 50): keys older than this many days are marked in the key list (ours). */
export const API_KEY_AGE_WARNING_DAYS = Object.freeze({ min: 1, max: 3650, default: 90 });
/** C168.6: audit log entries are deleted after this many days; `null` (the default) keeps them. */
export const AUDIT_LOG_RETENTION_DAYS = Object.freeze({ min: 30, max: 3650, default: null });
/** C169.8: the sender's display name per environment, at most this many characters. */
export const MAIL_SENDER_NAME_MAX_LENGTH = 100;

/**
 * C169.8 (review P29): a display name only. Control characters, `<`, `>`, `@` and `"` are refused, so
 * `Bank Security <alerts@bank.example>` cannot be set and the From address stays the install's
 * (Phase 8 decision 37); every send encodes it with RFC 2047 when it is not ASCII and quotes it under
 * RFC 5322.
 */
export const mailSenderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAIL_SENDER_NAME_MAX_LENGTH)
  .regex(
    /^[^\p{Cc}\p{Cf}<>@"]+$/u,
    'must be a display name: no control or format character, <, >, @ or "',
  )
  .refine((name) => !name.includes('=?'), 'must not hold an encoded word (=?)');

const intIn = (bounds: { min: number; max: number }) => z.int().min(bounds.min).max(bounds.max);

/**
 * C174.6 (Workflow 9B Stage 1a, common): the platform settings of the environment, each under
 * `settings:write` and audited as every change is. Optional in the answer so earlier servers'
 * answers parse; servers since Workflow 9B send them, with the defaults of
 * `PLATFORM_SETTING_DEFAULTS`.
 */
const platformSettingsShape = {
  'analytics-time-zone': analyticsTimeZoneSchema.optional(),
  'analytics-suppression-threshold': intIn(ANALYTICS_SUPPRESSION_THRESHOLD).optional(),
  'analytics-retention-months': intIn(ANALYTICS_RETENTION_MONTHS).optional(),
  'analytics-settle-days': intIn(ANALYTICS_SETTLE_DAYS).optional(),
  'analytics-assignee-retention-months': intIn(ANALYTICS_ASSIGNEE_RETENTION_MONTHS).optional(),
  'api-key-age-warning-days': intIn(API_KEY_AGE_WARNING_DAYS).optional(),
  'mail-sender-name': mailSenderNameSchema.nullable().optional(),
  'audit-log-retention-days': intIn(AUDIT_LOG_RETENTION_DAYS).nullable().optional(),
};

/** C174.6: the defaults of the platform settings (each provisional, with its basis above). */
export const PLATFORM_SETTING_DEFAULTS = Object.freeze({
  'analytics-time-zone': 'UTC',
  'analytics-suppression-threshold': ANALYTICS_SUPPRESSION_THRESHOLD.default,
  'analytics-retention-months': ANALYTICS_RETENTION_MONTHS.default,
  'analytics-settle-days': ANALYTICS_SETTLE_DAYS.default,
  'analytics-assignee-retention-months': ANALYTICS_ASSIGNEE_RETENTION_MONTHS.default,
  'api-key-age-warning-days': API_KEY_AGE_WARNING_DAYS.default,
  'mail-sender-name': null,
  'audit-log-retention-days': AUDIT_LOG_RETENTION_DAYS.default,
} as const);
/** C174.6: the platform settings, resolved. */
export interface PlatformSettings {
  'analytics-time-zone': string;
  'analytics-suppression-threshold': number;
  'analytics-retention-months': number;
  'analytics-settle-days': number;
  'analytics-assignee-retention-months': number;
  'api-key-age-warning-days': number;
  'mail-sender-name': string | null;
  'audit-log-retention-days': number | null;
}

/** C174.6: an environment's stored platform settings, with the defaults for absent keys. */
export function resolvePlatformSettings(
  stored: Readonly<Partial<Record<keyof PlatformSettings, unknown>>>,
): PlatformSettings {
  // A stored `null` reads as the default, which is `null` for the two nullable settings.
  const value = <Key extends keyof PlatformSettings>(key: Key): PlatformSettings[Key] =>
    (stored[key] ?? PLATFORM_SETTING_DEFAULTS[key]) as PlatformSettings[Key];
  return {
    'analytics-time-zone': value('analytics-time-zone'),
    'analytics-suppression-threshold': value('analytics-suppression-threshold'),
    'analytics-retention-months': value('analytics-retention-months'),
    'analytics-settle-days': value('analytics-settle-days'),
    'analytics-assignee-retention-months': value('analytics-assignee-retention-months'),
    'api-key-age-warning-days': value('api-key-age-warning-days'),
    'mail-sender-name': value('mail-sender-name'),
    'audit-log-retention-days': value('audit-log-retention-days'),
  };
}

export const GRAPH_SETTING_DEFAULTS = Object.freeze({
  'graph-indexing': true,
  'graph-weak-kinds': false,
  'graph-components': false,
} as const);

/** C91.7 (P19, Workflow 7A): sealed collector components are nulled after this many days. */
export const SIGNAL_COMPONENT_RETENTION_DAYS = Object.freeze({ min: 1, max: 365, default: 30 });
export const signalComponentRetentionDaysSchema = z
  .int()
  .min(SIGNAL_COMPONENT_RETENTION_DAYS.min)
  .max(SIGNAL_COMPONENT_RETENTION_DAYS.max);
/** C91.7: addresses are nulled after this many days; `null` (the default) keeps the inquiry's. */
export const IP_RETENTION_DAYS = Object.freeze({ min: 1, max: 3650, default: null });
export const ipRetentionDaysSchema = z.int().min(IP_RETENTION_DAYS.min).max(IP_RETENTION_DAYS.max);
/** C91.7: devices unseen for this many days are deleted, with their HMACs. */
export const DEVICE_RETENTION_DAYS = Object.freeze({ min: 1, max: 1095, default: 365 });
export const deviceRetentionDaysSchema = z
  .int()
  .min(DEVICE_RETENTION_DAYS.min)
  .max(DEVICE_RETENTION_DAYS.max);
/** C90.8: `expose-signals` serves `signals` on the API and in webhooks by default. */
export const EXPOSE_SIGNALS_DEFAULT = true;

/**
 * C97.4 (`settings:privacy`; Workflow 7B): the operator's recorded basis for face and background
 * lists, at most 500 characters. Until it is set, such a list cannot be created; clearing it redacts
 * every such list and its items.
 */
export const biometricListsBasisSchema = z.string().trim().min(1).max(500);

/**
 * C90.8 (`settings:privacy`): the body member of `signal-collection`. The basis rule of `exempt`
 * is the server's (422 `basis_required`), not a schema refinement, so it answers with its code.
 */
export const signalCollectionSettingBodySchema = z.strictObject(
  signalCollectionSettingSchema.shape,
);

/**
 * C232.1 (Phase 11, Workflow 11A; decision 20): the longest a share token of the environment may
 * live, in the public range of `expires-in-seconds` (60 s to 21 days); 21 days by default, so the
 * setting only ever shortens a token's life.
 */
export const SHARE_TOKEN_MAX_SECONDS = Object.freeze({
  min: 60,
  max: 1_814_400,
  default: 1_814_400,
});
/**
 * C241.3 (Workflow 11A; decision 29): how many days a consent record's bare fact (time, side,
 * purpose, recipient, categories, text digest, method, withdrawal) is kept after the data it covers
 * is gone; 0, the default, keeps none.
 */
export const CONSENT_PROOF_RETENTION_DAYS = Object.freeze({ min: 0, max: 3650, default: 0 });

/** C232.1, C241.3 (Workflow 11A Stage 1a): Connect's environment settings, under `settings:write`. */
const connectSettingsShape = {
  'share-token-max-seconds': intIn(SHARE_TOKEN_MAX_SECONDS).optional(),
  'consent-proof-retention-days': intIn(CONSENT_PROOF_RETENTION_DAYS).optional(),
  /**
   * C231.10 (Workflow 11A Stage 1a (C); decision 71): the organisation receives connections only
   * while this is on. Organisation-level (`SETTING_LEVEL`), stored on the organisation as
   * `require-mfa` is, off by default and audited with every settings change.
   */
  'connect-inbound': z.boolean().optional(),
};

/** C231.10: no organisation receives a connection until its admin opts in. */
export const CONNECT_INBOUND_DEFAULT = false;

export const CONNECT_SETTING_DEFAULTS = Object.freeze({
  'share-token-max-seconds': SHARE_TOKEN_MAX_SECONDS.default,
  'consent-proof-retention-days': CONSENT_PROOF_RETENTION_DAYS.default,
} as const);
/** Connect's environment settings, resolved. */
export interface ConnectSettings {
  'share-token-max-seconds': number;
  'consent-proof-retention-days': number;
}

/** An environment's stored Connect settings, with the defaults for absent keys. */
export function resolveConnectSettings(
  stored: Readonly<Partial<Record<keyof ConnectSettings, unknown>>>,
): ConnectSettings {
  const value = (key: keyof ConnectSettings): number =>
    typeof stored[key] === 'number' ? stored[key] : CONNECT_SETTING_DEFAULTS[key];
  return {
    'share-token-max-seconds': value('share-token-max-seconds'),
    'consent-proof-retention-days': value('consent-proof-retention-days'),
  };
}

/**
 * C251.1, C251.2 (Phase 11, Workflow 11B Stage 1a, common; Stage 1a amendment 16): the queues whose
 * jobs hold one environment's work and are admitted under a per-environment cap, the keys of
 * `queue-in-flight-caps`. `workflow-step` is capped too, under Phase 8's own `workflow-in-flight-cap`
 * (amendment 17), so it is not a key here. Install-wide passes, sweeps and the queues an hour policy
 * already bounds (`export`, `report-bulk`, `case-export`) stay outside.
 */
export const QUEUE_IN_FLIGHT_CAP_QUEUES = Object.freeze([
  'process-verification',
  'report-run',
  'connect-redeem',
  'account-export',
  'list-screen',
  'list-import',
  'list-item-embed',
  'graph-index',
  'graph-query',
  'inquiry-signals',
  'list-rescreen',
  'integrity-decode',
  'case-rendition',
  'case-attachment-scan',
  'case-bulk',
] as const);
export const cappedQueueSchema = z.enum(QUEUE_IN_FLIGHT_CAP_QUEUES);
export type CappedQueue = z.infer<typeof cappedQueueSchema>;

/**
 * C251.2 (decision 38, review P15): a queue's in-flight cap per environment. 50 by default (ours,
 * provisional: Phase 8's step cap, C117.8), lowered per environment through `queue-in-flight-caps`
 * and never above the install ceiling `OPENVERIFY_QUEUE_IN_FLIGHT_CAP_MAX` (`ceilingDefault`, at most
 * `max`), which the server checks at write (C55.7's generic 422 with a pointer) and applies on read
 * (the lower of the stored value and the ceiling), so a tenant cannot raise its own share of the
 * worker on a multi-customer install.
 */
export const QUEUE_IN_FLIGHT_CAP = Object.freeze({
  min: 1,
  max: 1000,
  default: 50,
  ceilingDefault: 50,
});
/** C251.2: one cap per capped queue; an absent queue takes the default (or the ceiling, if lower). */
export const queueInFlightCapsSchema = z
  .partialRecord(
    cappedQueueSchema,
    z.int().min(QUEUE_IN_FLIGHT_CAP.min).max(QUEUE_IN_FLIGHT_CAP.max),
  )
  .refine(
    (caps) => Object.keys(caps).every((queue) => cappedQueueSchema.safeParse(queue).success),
    'names only capped queues',
  );
export type QueueInFlightCaps = z.infer<typeof queueInFlightCapsSchema>;

/** C253.4: an access export is kept this many days after it is ready (ours, provisional: a week). */
export const ACCOUNT_EXPORT_TTL_DAYS = Object.freeze({ min: 1, max: 30, default: 7 });
/**
 * C254.2 (decision 39): a full download and SHA-256 comparison of each conditional source runs at
 * least this often, whatever its 304s say (ours, provisional: daily, as the lists refresh).
 */
export const WATCHLIST_FULL_CHECK_HOURS = Object.freeze({ min: 1, max: 168, default: 24 });

/** Workflow 11B Stage 1a (common): the three environment settings, under `settings:write`. */
const hardeningSettingsShape = {
  'queue-in-flight-caps': queueInFlightCapsSchema.optional(),
  'account-export-ttl-days': intIn(ACCOUNT_EXPORT_TTL_DAYS).optional(),
  'watchlist-full-check-hours': intIn(WATCHLIST_FULL_CHECK_HOURS).optional(),
};

export const HARDENING_SETTING_DEFAULTS = Object.freeze({
  'queue-in-flight-caps': Object.freeze({}) as QueueInFlightCaps,
  'account-export-ttl-days': ACCOUNT_EXPORT_TTL_DAYS.default,
  'watchlist-full-check-hours': WATCHLIST_FULL_CHECK_HOURS.default,
});
/** The three settings, resolved. */
export interface HardeningSettings {
  'queue-in-flight-caps': QueueInFlightCaps;
  'account-export-ttl-days': number;
  'watchlist-full-check-hours': number;
}

/** An environment's stored 11B settings, with the defaults for absent keys. */
export function resolveHardeningSettings(
  stored: Readonly<Partial<Record<keyof HardeningSettings, unknown>>>,
): HardeningSettings {
  const caps = queueInFlightCapsSchema.safeParse(stored['queue-in-flight-caps']);
  const days = stored['account-export-ttl-days'];
  const hours = stored['watchlist-full-check-hours'];
  return {
    'queue-in-flight-caps': caps.success ? caps.data : {},
    'account-export-ttl-days':
      typeof days === 'number' ? days : HARDENING_SETTING_DEFAULTS['account-export-ttl-days'],
    'watchlist-full-check-hours':
      typeof hours === 'number' ? hours : HARDENING_SETTING_DEFAULTS['watchlist-full-check-hours'],
  };
}

/**
 * `GET /api/v1/dashboard/settings` (permission `settings:read`): the organization's
 * `require-mfa` and the environment's retention windows (C16). `inquiry-retention-days`
 * null keeps finished inquiries forever.
 */
export const dashboardSettingsSchema = z.strictObject({
  'require-mfa': z.boolean(),
  'inquiry-retention-days': retentionDaysSchema.nullable(),
  'api-log-retention-days': retentionDaysSchema,
  'webhook-delivery-retention-days': retentionDaysSchema,
  'event-retention-days': retentionDaysSchema,
  /**
   * C42.6: face template and background rows older than this are deleted, whatever the
   * inquiry's own retention. Optional so pre-Phase 4 answers parse; servers since send it.
   */
  'face-template-retention-days': faceTemplateRetentionDaysSchema.optional(),
  /** C42.4: the most templates one repeat search decrypts and scores. */
  'face-search-max-templates': faceSearchMaxTemplatesSchema.optional(),
  /**
   * C55.7 (V08): the most OTP text messages the environment sends per hour, up to the install
   * ceiling `OPENVERIFY_OTP_SMS_MAX_PER_HOUR_CEILING`. Optional so earlier answers parse.
   */
  'otp-sms-max-per-hour': otpSmsMaxPerHourSchema.optional(),
  /**
   * C55.7 (V08), read-only: when the budget last tripped, from the latest
   * `environment.otp-sms-budget-tripped` audit entry; `null` when it never has.
   */
  'otp-sms-budget-tripped-at': timestampSchema.nullable().optional(),
  /**
   * C73.6 (P14): reports are redacted this many days after creation; `null` (the default) keeps
   * them as long as inquiries are kept. Optional so earlier answers parse.
   */
  'report-retention-days': reportRetentionDaysSchema.nullable().optional(),
  /**
   * C90.8 (Workflow 7A): the collection tiers; changed only with `settings:privacy`. The members
   * below are optional so earlier answers parse; servers since send them.
   */
  'signal-collection': signalCollectionSettingSchema.optional(),
  /** C90.8: when `false`, the API and webhooks serve `signals` as `[]`. */
  'expose-signals': z.boolean().optional(),
  /** C91.7 (P19): sealed collector components are nulled after this many days. */
  'signal-component-retention-days': signalComponentRetentionDaysSchema.optional(),
  /** C91.7: addresses are nulled after this many days; `null` keeps the inquiry's retention. */
  'ip-retention-days': ipRetentionDaysSchema.nullable().optional(),
  /** C91.7: devices unseen for this many days are deleted. */
  'device-retention-days': deviceRetentionDaysSchema.optional(),
  /**
   * C107.7 (Workflow 7A; F30): the name the phone's handoff context screen shows the end user;
   * required to publish a `device_handoff` step. `null` until set.
   */
  'organization-display-name': organizationDisplayNameSchema.nullable().optional(),
  /** C97.4 (Workflow 7B): `null` until set; face and background lists need it. */
  'biometric-lists-basis': biometricListsBasisSchema.nullable().optional(),
  /** C105.5 (Workflow 7B): transactions are redacted this many days after creation. */
  'transaction-retention-days': transactionRetentionDaysSchema.nullable().optional(),
  /**
   * C101.3 (Workflow 7B; P26): off, nothing is indexed and every graph result says
   * `index-complete: false`. Changed only with `settings:privacy`, as the two below.
   */
  'graph-indexing': z.boolean().optional(),
  /** C101.2 (decision 34): the weak kinds (IP, browser fingerprint, ...) are written. */
  'graph-weak-kinds': z.boolean().optional(),
  /** C101.6: the nightly components over strong kinds (`beta`). */
  'graph-components': z.boolean().optional(),
  /** C102.7: stored graph query results are redacted this many days after the query. */
  'graph-query-retention-days': graphQueryRetentionDaysSchema.optional(),
  ...workflowSettingsShape,
  ...embeddingSettingsShape,
  // C174.6 (Workflow 9B).
  ...platformSettingsShape,
  // C232.1, C241.3 (Workflow 11A): optional, so earlier servers' answers parse.
  ...connectSettingsShape,
  // C251.2, C253.4, C254.2 (Workflow 11B): optional, so earlier servers' answers parse.
  ...hardeningSettingsShape,
  /**
   * C248.8 (Workflow 11B; amendment 10): the organisation's sign-in name, an organisation setting
   * (`SETTING_LEVEL`) stored on the organisation; `null` until set, and with it no SSO start.
   */
  'organization-slug': organizationSlugSchema.nullable().optional(),
});
export type DashboardSettings = z.infer<typeof dashboardSettingsSchema>;

export const DASHBOARD_SETTINGS_DEFAULTS: Readonly<DashboardSettings> = Object.freeze({
  'require-mfa': false,
  'inquiry-retention-days': null,
  'api-log-retention-days': 30,
  'webhook-delivery-retention-days': 30,
  'event-retention-days': 90,
  'face-template-retention-days': FACE_TEMPLATE_RETENTION_DAYS.default,
  'face-search-max-templates': FACE_SEARCH_MAX_TEMPLATES.default,
  'report-retention-days': REPORT_RETENTION_DAYS.default,
  'signal-collection': DEFAULT_SIGNAL_COLLECTION,
  'expose-signals': EXPOSE_SIGNALS_DEFAULT,
  'signal-component-retention-days': SIGNAL_COMPONENT_RETENTION_DAYS.default,
  'ip-retention-days': IP_RETENTION_DAYS.default,
  'device-retention-days': DEVICE_RETENTION_DAYS.default,
  'organization-display-name': null,
  'biometric-lists-basis': null,
  'transaction-retention-days': TRANSACTION_RETENTION_DAYS.default,
  ...GRAPH_SETTING_DEFAULTS,
  'graph-query-retention-days': GRAPH_QUERY_RETENTION_DAYS.default,
  'workflow-run-retention-days': WORKFLOW_RUN_RETENTION_DAYS.default,
  'workflow-run-history-retention-days': WORKFLOW_RUN_HISTORY_RETENTION_DAYS.default,
  'workflow-in-flight-cap': WORKFLOW_IN_FLIGHT_CAP.default,
  'workflow-http-ports': [],
  'workflow-http-hosts': null,
  'workflow-http-private-cidrs': [],
  'workflow-email-recipients': [],
  'workflow-sms-recipients': [],
  'workflow-sms-countries': null,
  'workflow-link-hosts': [],
  'case-retention-days': CASE_RETENTION_DAYS.default,
  // C158.1, C158.4, C160.7 (Workflow 9A Stage 1b (F), (H)): the embedding settings, served.
  'allowed-embed-origins': [],
  'allowed-redirect-origins': null,
  'default-theme-set-id': null,
  // C174.6 (Workflow 9B Stage 1a): the platform settings, served.
  ...PLATFORM_SETTING_DEFAULTS,
  // C232.1, C241.3 (Workflow 11A Stage 1a): Connect's settings, served.
  ...CONNECT_SETTING_DEFAULTS,
  // C231.10 (Workflow 11A Stage 1a (C)): the organisation's opt-in, served.
  'connect-inbound': CONNECT_INBOUND_DEFAULT,
  // C251.2, C253.4, C254.2 (Workflow 11B Stage 1a): served with their defaults.
  ...HARDENING_SETTING_DEFAULTS,
  // C248.8 (Workflow 11B Stage 1a (A)): no sign-in name until an admin sets one.
  'organization-slug': null,
});

/**
 * C158.1, C158.4, C160.7: the embedding settings' defaults. They stay out of
 * `DASHBOARD_SETTINGS_DEFAULTS` (and optional in `dashboardSettingsSchema`) until `foundation-9a`
 * serves them in Workflow 9A Stage 1b (F), which merges them in, as Phase 8 did with its workflow
 * settings. No allowed embed origin (framing refused), the install-wide redirect rule, no default
 * theme set.
 */
export const EMBEDDING_SETTINGS_DEFAULTS = Object.freeze({
  'allowed-embed-origins': [] as readonly string[],
  'allowed-redirect-origins': null,
  'default-theme-set-id': null,
} as const);

/** `PATCH /api/v1/dashboard/settings` (permission `settings:write`). */
export const dashboardUpdateSettingsBodySchema = z
  .strictObject({
    'require-mfa': z.boolean().optional(),
    'inquiry-retention-days': retentionDaysSchema.nullable().optional(),
    'api-log-retention-days': retentionDaysSchema.optional(),
    'webhook-delivery-retention-days': retentionDaysSchema.optional(),
    'event-retention-days': retentionDaysSchema.optional(),
    'face-template-retention-days': faceTemplateRetentionDaysSchema.optional(),
    'face-search-max-templates': faceSearchMaxTemplatesSchema.optional(),
    // C55.7 (V08); the server also refuses a value above the install ceiling.
    'otp-sms-max-per-hour': otpSmsMaxPerHourSchema.optional(),
    // C73.6 (P14).
    'report-retention-days': reportRetentionDaysSchema.nullable().optional(),
    // C90.8 (Workflow 7A): also needs `settings:privacy`.
    'signal-collection': signalCollectionSettingBodySchema.optional(),
    // C90.8, C91.7 (Workflow 7A).
    'expose-signals': z.boolean().optional(),
    'signal-component-retention-days': signalComponentRetentionDaysSchema.optional(),
    'ip-retention-days': ipRetentionDaysSchema.nullable().optional(),
    'device-retention-days': deviceRetentionDaysSchema.optional(),
    // C107.7 (Workflow 7A): `settings:write`.
    'organization-display-name': organizationDisplayNameSchema.nullable().optional(),
    'biometric-lists-basis': biometricListsBasisSchema.nullable().optional(),
    // C105.5, C107.7 (Workflow 7B).
    'transaction-retention-days': transactionRetentionDaysSchema.nullable().optional(),
    // C101, C102.7, C107.7 (Workflow 7B): the three switches also need `settings:privacy`.
    'graph-indexing': z.boolean().optional(),
    'graph-weak-kinds': z.boolean().optional(),
    'graph-components': z.boolean().optional(),
    'graph-query-retention-days': graphQueryRetentionDaysSchema.optional(),
    // C143.7 (Workflow 8A): `workflow-http-private-cidrs` also needs `settings:privacy`.
    ...workflowSettingsShape,
    // C158.1, C174.6 (Workflow 9A).
    ...embeddingSettingsShape,
    // C174.6 (Workflow 9B).
    ...platformSettingsShape,
    // C232.1, C241.3 (Workflow 11A).
    ...connectSettingsShape,
    // C251.2, C253.4, C254.2 (Workflow 11B); the server also refuses a cap above the ceiling.
    ...hardeningSettingsShape,
    // C248.8 (Workflow 11B): organisation-level; 409 `organization_slug_taken` when held elsewhere.
    'organization-slug': organizationSlugSchema.nullable().optional(),
    /** C158.1 (V17): a production wildcard origin is set only with this acknowledgement. */
    meta: z.strictObject({ 'acknowledge-wildcards': z.boolean().optional() }).optional(),
  })
  .refine((settings) => Object.keys(settings).some((key) => key !== 'meta'), 'nothing to update');
export type DashboardUpdateSettingsBody = z.infer<typeof dashboardUpdateSettingsBodySchema>;

/** `GET /api/v1/dashboard/inquiries`: the server API filters, scoped to the user's environment. */
export const dashboardListInquiriesQuerySchema = listInquiriesQuerySchema;
export const dashboardInquiryListDocumentSchema = inquiryListDocumentSchema;

/** `GET /api/v1/dashboard/inquiries/:id`: the inquiry with its verifications, checks and files. */
export const dashboardInquiryDocumentSchema = z.strictObject({
  data: inquiryResourceSchema,
  included: z.array(
    z.discriminatedUnion('type', [
      // C50.6: every verification type.
      ...VERIFICATION_RESOURCE_SCHEMAS,
      fileResourceSchema,
      // C40.1, C47: the inquiry's selfie captures.
      selfieCaptureResourceSchema,
    ]),
  ),
});
export type DashboardInquiryDocument = z.infer<typeof dashboardInquiryDocumentSchema>;

/** `Cache-Control` of `GET /api/v1/dashboard/files/:id/content`. */
export const FILE_CONTENT_CACHE_CONTROL = 'private, no-store';
/** Audit log action written for every file view. */
export const FILE_VIEWED_AUDIT_ACTION = 'file.viewed';

/**
 * C55.7 (V08): the defaults of the two OTP settings, which the settings service serves from
 * Workflow 5A Stage 1b (it then merges them into what `GET /dashboard/settings` answers).
 */
export const OTP_SETTINGS_DEFAULTS = Object.freeze({
  'otp-sms-max-per-hour': OTP_SMS_MAX_PER_HOUR.default,
  'otp-sms-budget-tripped-at': null,
} as const satisfies Partial<DashboardSettings>);
