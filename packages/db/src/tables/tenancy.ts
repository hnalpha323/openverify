/** Organizations, their sandbox and production environments, and API keys. */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  cidr,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  API_VERSION_DEFAULT,
  apiVersionFormat,
  createdAt,
  hexDigest,
  idFormat,
  timestamptz,
  updatedAt,
} from './columns.js';
import { environmentKind } from './enums.js';

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /**
     * C15: users without a factor get sessions that can only enrol one. C168.2 (Workflow 9B Stage 1b
     * (U); decision 45): an organisation created from Phase 9 on starts with it; one created before
     * keeps its value. `seed:dev` and the test tenant pass `false` explicitly.
     */
    requireMfa: boolean('require_mfa').notNull().default(true),
    /**
     * C231.10 (Phase 11, Workflow 11A; decision 71): the organisation receives Connect connections
     * only while this is on (`connect-inbound`, organisation-level). Off for every organisation,
     * earlier ones included, until its admin turns it on.
     */
    connectInbound: boolean('connect_inbound').notNull().default(false),
    /**
     * C248.4, C248.8 (Workflow 11B Stage 1b (A); Stage 1a amendment 10): the organisation's sign-in
     * name (`organization-slug`, the console's words), which the SSO start and the login hint name.
     * `NULL` until its admin sets one; unique across the install; lowercase letters, digits and
     * hyphens, 3 to 63 characters, starting and ending with a letter or digit.
     */
    slug: text('slug'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    idFormat('organizations', table.id, 'org'),
    uniqueIndex('organizations_slug_key').on(table.slug),
    check(
      'organizations_slug_format',
      sql`${table.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$'`,
    ),
  ],
);

/**
 * C16 environment settings, stored with the API's kebab-case keys. Absent keys take the
 * defaults in `DEFAULT_RETENTION` (`repositories/retention.ts`), applied in code.
 */
export interface EnvironmentSettings {
  /** `null` keeps inquiries forever (the default). */
  'inquiry-retention-days'?: number | null;
  'api-log-retention-days'?: number;
  'webhook-delivery-retention-days'?: number;
  'event-retention-days'?: number;
  /** C42.6: face template and background rows are deleted after this many days (1-1,095). */
  'face-template-retention-days'?: number;
  /** C42.4: the most templates one repeat search decrypts and scores (1,000-200,000). */
  'face-search-max-templates'?: number;
  /** C55.7: the most OTP text messages the environment sends per hour (1 to the install ceiling). */
  'otp-sms-max-per-hour'?: number;
  /** C73.6 (P14): reports are redacted this many days after creation (1-3,650); `null` keeps them. */
  'report-retention-days'?: number | null;
  /**
   * C90.8 (Workflow 7A; `settings:privacy`): the collection tiers. `device-recognition-basis` is
   * the recorded basis of `exempt`.
   */
  'signal-collection'?: {
    'session-integrity': 'on' | 'off';
    'device-recognition': 'off' | 'consent' | 'exempt';
    'device-recognition-basis': string | null;
  };
  /** C90.8: when `false`, the API and webhooks serve `signals` as `[]` (default `true`). */
  'expose-signals'?: boolean;
  /** C91.7 (P19): sealed collector components are nulled after this many days (1-365, default 30). */
  'signal-component-retention-days'?: number;
  /** C91.7: addresses are nulled after this many days (1-3,650); `null` keeps them with the inquiry. */
  'ip-retention-days'?: number | null;
  /** C91.7: devices unseen for this many days are deleted (1-1,095, default 365). */
  'device-retention-days'?: number;
  /** C107.7 (Workflow 7A): the name the handoff context screen shows (1-100 characters). */
  'organization-display-name'?: string | null;
  /** C97.4 (Workflow 7B): the recorded basis for face and background lists. */
  'biometric-lists-basis'?: string | null;
  /** C105.5 (Workflow 7B): transactions are redacted this many days after creation (1-3,650). */
  'transaction-retention-days'?: number | null;
  /** C101.3 (Workflow 7B; P26): the graph is indexed (default on); `settings:privacy`. */
  'graph-indexing'?: boolean;
  /** C101.2 (decision 34): the weak kinds are written (default off); `settings:privacy`. */
  'graph-weak-kinds'?: boolean;
  /** C101.6: the nightly components over strong kinds (default off); `settings:privacy`. */
  'graph-components'?: boolean;
  /** C102.7 (decision 19): stored graph query results are redacted after this many days (1-365). */
  'graph-query-retention-days'?: number;
  /** C120.8 (Workflow 8A): a run's values go this many days after it ends (1-3,650, default 30). */
  'workflow-run-retention-days'?: number;
  /** C120.8: a run's skeleton goes this many days after it ends (1-3,650, default 365). */
  'workflow-run-history-retention-days'?: number;
  /** C117.8: steps running or enqueued at once (default 50; `OPENVERIFY_WORKFLOW_IN_FLIGHT_CAP`). */
  'workflow-in-flight-cap'?: number;
  /** C124.3: ports beside 443, never a Fetch bad port. */
  'workflow-http-ports'?: number[];
  /** C124.3: the host allowlist; `null` (the default) keeps it off. */
  'workflow-http-hosts'?: string[] | null;
  /** C124.3 (`settings:privacy`): internal CIDRs, only inside a private or CGNAT block. */
  'workflow-http-private-cidrs'?: string[];
  /** C126.1: addresses or domains a literal recipient must be on. */
  'workflow-email-recipients'?: string[];
  /** C126.2: E.164 numbers a literal recipient must be on. */
  'workflow-sms-recipients'?: string[];
  /** C126.2: destination countries; `null` (the default) follows the inquiry template's. */
  'workflow-sms-countries'?: string[] | null;
  /** C126, C128.3: hosts a message or a contest route may link to, beside the flow's own. */
  'workflow-link-hosts'?: string[];
  /** C139.3: cases are redacted this many days after resolution (1-3,650, default none). */
  'case-retention-days'?: number | null;
  /**
   * C158.1 (Workflow 9A Stage 1b (F)): the origins that may frame the embedded flow (at most 50,
   * each in the grammar of `@openverify/contracts/origin-pattern`); absent, none may.
   */
  'allowed-embed-origins'?: string[];
  /** C158.4: the redirect origins, in the same grammar; `null` or absent, the embed origins. */
  'allowed-redirect-origins'?: string[] | null;
  /** C160.7 (Workflow 9A Stage 1b (H)): the environment's default theme set; `null` or absent, none. */
  'default-theme-set-id'?: string | null;
  /**
   * C174.6 (Workflow 9B Stage 1a): the platform settings, with the bounds and defaults of
   * `PLATFORM_SETTING_DEFAULTS` (`@openverify/contracts`), applied in code when absent. C163.2: the
   * reporting time zone (an IANA name; `UTC`).
   */
  'analytics-time-zone'?: string;
  /** C164.7: the suppression threshold (11 to 100; 11). */
  'analytics-suppression-threshold'?: number;
  /** C163.6: rollups are kept this many months (13 to 60; 13). */
  'analytics-retention-months'?: number;
  /** C163.4: a local day is recomputed for this many days, then frozen (1 to 90; 30). */
  'analytics-settle-days'?: number;
  /** C163.3: the per-reviewer rollup is kept this many months (1 to 60; 13). */
  'analytics-assignee-retention-months'?: number;
  /** C169.2: keys older than this many days are marked (1 to 3,650; 90). */
  'api-key-age-warning-days'?: number;
  /** C169.8: the display name of the environment's mail; `null` or absent, the install's. */
  'mail-sender-name'?: string | null;
  /** C168.6: audit log entries are deleted after this many days (30 to 3,650); `null`, kept. */
  'audit-log-retention-days'?: number | null;
  /**
   * C232.1 (Phase 11, Workflow 11A): the longest a share token of the environment may live, in
   * seconds (60 to 1,814,400; 1,814,400, the public maximum of 21 days).
   */
  'share-token-max-seconds'?: number;
  /**
   * C241.3 (decision 29): a consent record's bare fact is kept this many days after the data it
   * covers is gone (0 to 3,650; 0, which keeps none).
   */
  'consent-proof-retention-days'?: number;
  /**
   * C251.2 (Phase 11, Workflow 11B): each capped queue's in-flight cap in this environment (1 to
   * 1,000, never above the install ceiling); an absent queue takes the default.
   */
  'queue-in-flight-caps'?: Readonly<Record<string, number>>;
  /** C253.4: an access export is kept this many days after it is ready (1 to 30; 7). */
  'account-export-ttl-days'?: number;
  /** C254.2: a conditional source is fully checked at least this often, in hours (1 to 168; 24). */
  'watchlist-full-check-hours'?: number;
  /**
   * C254.1 (Q10; `settings:write` and `settings:privacy`, the step-up): the environment's recorded
   * acceptance of the UN list's terms (`watchlistOptInSchema`), `null` once withdrawn. Written only
   * while `OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED` is true (`apps/api/src/watchlists/un-opt-in.ts`).
   */
  'watchlist-un-opt-in'?: {
    'source-id': 'un-sc';
    'terms-url': string;
    'accepted-at': string;
    'accepted-by': string;
  } | null;
}

/** Each organization has at most one sandbox and one production environment. */
export const environments = pgTable(
  'environments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    kind: environmentKind('kind').notNull(),
    settings: jsonb('settings').$type<EnvironmentSettings>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('environments_organization_id_kind_key').on(table.organizationId, table.kind),
    // Target of user_sessions' composite key: a session's environment is in its user's org.
    unique('environments_organization_id_id_key').on(table.organizationId, table.id),
    idFormat('environments', table.id, 'env'),
  ],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    environmentId: text('environment_id')
      .notNull()
      .references(() => environments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Public token prefix naming the environment kind, e.g. `ov_sbx_`. */
    prefix: text('prefix').notNull(),
    /**
     * C12 `token-prefix`: the environment prefix plus the first 4 secret characters, e.g.
     * `ov_sbx_AbCd`. `NULL` for keys created before schema v2, whose tokens were never stored.
     */
    tokenPrefix: text('token_prefix'),
    /**
     * HMAC-SHA256(server pepper, full token) as lowercase hex; the token itself is never
     * stored. Chosen over argon2id on purpose: tokens carry 256 bits of randomness, so a
     * slow password hash adds no brute-force resistance, while a deterministic keyed hash
     * lets every request find its key with one indexed equality lookup instead of an
     * expensive argon2id verify (a CPU and memory DoS lever). The pepper lives outside the
     * database, so a database-only leak does not allow offline checking of candidate keys.
     */
    secretHash: text('secret_hash').notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** CIDR allowlist; `NULL` means any address. */
    allowedIps: cidr('allowed_ips').array(),
    /** C12: the API version requests with this key get when they send no header. */
    apiVersion: text('api_version').notNull().default(API_VERSION_DEFAULT),
    /** The principal that created the key (`usr_...` or `key_...`), when known. */
    createdById: text('created_by_id'),
    /**
     * C15 masking for this key: true when it was minted (or cloned) by a principal that could
     * not see PII, so the key cannot see more than its creator (Workflow 2B F001). Keys made
     * before this column default to `false` and keep seeing PII, as C15 first defined.
     */
    piiMasked: boolean('pii_masked').notNull().default(false),
    /**
     * C129.4 (P14; Workflow 8B (C)): the restricted case templates this key may see, set when it is
     * minted and never wider than its creator's visibility. `NULL` (every key before 0028, and a key
     * minted without the member) and an empty list both see no restricted template.
     */
    caseTemplateIds: text('case_template_ids').array(),
    /** C169.1 (Workflow 9B; the public `note`): what the key is for, at most 255; `NULL` for none. */
    note: text('note'),
    /**
     * C169.3 (S4; the public `api-attributes-blocklist`): kebab-case attribute names removed from every
     * document served to the key, at every exit (C14's grammar, at most 100). `{}` for every key
     * before 0031.
     */
    attributeBlocklist: text('attribute_blocklist')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    expiresAt: timestamptz('expires_at'),
    lastUsedAt: timestamptz('last_used_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revokedAt: timestamptz('revoked_at'),
    /**
     * C247.1 (Workflow 11B Stage 1b (A); Stage 1a amendment 9): which pepper made `secret_hash`, by
     * a non-secret identifier (the first 16 hex characters of HMAC-SHA-256(pepper,
     * `openverify/api-key-pepper-id/v1`)), so `api-keys:pepper-status` can count the keys still under
     * a previous pepper. `NULL` for a key made before 11B, until a lookup proves its pepper.
     */
    pepperKeyId: text('pepper_key_id'),
  },
  (table) => [
    uniqueIndex('api_keys_secret_hash_key').on(table.secretHash),
    check('api_keys_pepper_key_id_format', sql`${table.pepperKeyId} ~ '^[0-9a-f]{16}$'`),
    index('api_keys_environment_id_idx').on(table.environmentId),
    index('api_keys_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    hexDigest('api_keys_secret_hash_hex', table.secretHash),
    apiVersionFormat('api_keys_api_version_format', table.apiVersion),
    idFormat('api_keys', table.id, 'key'),
    check(
      'api_keys_case_template_ids_count',
      sql`${table.caseTemplateIds} is null or cardinality(${table.caseTemplateIds}) <= 100`,
    ),
    // C169.1, C169.3 (Workflow 9B Stage 1b (W)).
    check('api_keys_note_length', sql`char_length(${table.note}) <= 255`),
    check(
      'api_keys_attribute_blocklist_size',
      sql`cardinality(${table.attributeBlocklist}) <= 100`,
    ),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Environment = typeof environments.$inferSelect;
export type NewEnvironment = typeof environments.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
