/** Events, webhook subscriptions and delivery attempts (C5). */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { encrypted, encryptedJson } from '../crypto.js';
import { sealedColumn } from '../sealed.js';
import {
  API_VERSION_DEFAULT,
  apiVersionFormat,
  createdAt,
  dottedName,
  idFormat,
  timestamptz,
  updatedAt,
} from './columns.js';
import { webhookDeliveryStatus, webhookStatus } from './enums.js';
import { environmentId } from './environment-id.js';
import { users } from './users.js';

/** C5 event `payload`: `{ data: <resource>, included? }`. */
export type EventPayload = Record<string, unknown>;

/**
 * `payload` embeds full resources, including inquiry `fields`, so it is encrypted at rest
 * like the columns it copies.
 *
 * Schema v2: `object_id` and `object_type` name the resource in `payload.data` (C12
 * `filter[object-id]`, and how C16 redaction finds the payloads that embed an object);
 * `simulated` marks C14 webhook simulations; `redacted_at` is set when the payload was
 * replaced by the C16 stub. Events written before v2 have no `object_id`.
 */
export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    name: text('name').notNull(),
    payload: encryptedJson('payload', { context: 'events.payload' })
      .$type<EventPayload>()
      .notNull(),
    objectId: text('object_id'),
    objectType: text('object_type'),
    simulated: boolean('simulated').notNull().default(false),
    redactedAt: timestamptz('redacted_at'),
    // C118.8, C121.3 (Workflow 8A): the internal cause, never in a payload. A run staged it, a
    // request's principal did, a test run or a bulk job did, or nothing did (the flow, system jobs).
    causedByRunId: text('caused_by_run_id'),
    causedByPrincipal: text('caused_by_principal'),
    causedByTestRunId: text('caused_by_test_run_id'),
    causedByBulkId: text('caused_by_bulk_id'),
    /** C119.3, C128.2: whether that principal held `inquiries:write` when it staged the event. */
    causedByPrincipalHeldInquiriesWrite: boolean('caused_by_principal_held_inquiries_write'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('events_environment_id_id_key').on(table.environmentId, table.id),
    index('events_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('events_environment_id_name_created_at_id_idx').on(
      table.environmentId,
      table.name,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('events_environment_id_object_id_idx').on(table.environmentId, table.objectId),
    // C16 retention walks events oldest first across environments (Workflow 2B F019).
    index('events_created_at_idx').on(table.createdAt),
    dottedName('events_name_format', table.name),
    idFormat('events', table.id, 'evt'),
    check(
      'events_caused_by_run_id_format',
      sql`${table.causedByRunId} is null
        or ${table.causedByRunId} ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'`,
    ),
    check(
      'events_caused_by_principal_format',
      sql`${table.causedByPrincipal} is null
        or ${table.causedByPrincipal} ~ '^(usr|key)_[0-9A-HJKMNP-TV-Z]{26}$'`,
    ),
    check(
      'events_caused_by_test_run_id_format',
      sql`${table.causedByTestRunId} is null
        or ${table.causedByTestRunId} ~ '^wfr_[0-9A-HJKMNP-TV-Z]{26}$'`,
    ),
    // C121.3 (Workflow 8B (C)): a case bulk action's id, `cblk_` (Stage 1a amendment 5).
    check(
      'events_caused_by_bulk_id_format',
      sql`${table.causedByBulkId} is null
        or ${table.causedByBulkId} ~ '^cblk_[0-9A-HJKMNP-TV-Z]{26}$'`,
    ),
  ],
);

/** C14 `filters`, stored with the API's kebab-case keys. */
export interface WebhookFilters {
  'inquiry-template-ids'?: string[];
  'account-type-ids'?: string[];
  /** C143.4 (Workflow 8A): a workflow, version or run event, by its workflow. */
  'workflow-ids'?: string[];
  /** C143.4 (Workflow 8A): a list event, by its list. */
  'list-ids'?: string[];
  /** C143.4 (Workflow 8B): a case or case-comment event, by its case's template. */
  'case-template-ids'?: string[];
}

/**
 * C14 webhook. `secret` keeps its Phase 1 static context; the schema v2 columns
 * `previous_secret` (valid until `previous_secret_expires_at`, for dual signing during a
 * rotation) and `custom_headers` (a JSON object of header name to value) are sealed for
 * the webhook's id. Repositories never return either secret or header values except
 * through the dispatcher's lookups.
 */
export const webhooks = pgTable(
  'webhooks',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    url: text('url').notNull(),
    /** Event names, or `['*']` for every event. */
    enabledEvents: text('enabled_events').array().notNull(),
    status: webhookStatus('status').notNull().default('enabled'),
    /** HMAC signing secret (`wbhsec_...`), encrypted; shown to the customer once. */
    secret: encrypted('secret', { context: 'webhooks.secret' }).notNull(),
    /** Last four characters of the secret, the only part shown after creation. */
    secretLast4: text('secret_last4').notNull(),
    previousSecretSealed: sealedColumn('previous_secret'),
    previousSecretExpiresAt: timestamptz('previous_secret_expires_at'),
    /** C12 API version of the payloads; deliveries send it as `OpenVerify-Version`. */
    apiVersion: text('api_version').notNull().default(API_VERSION_DEFAULT),
    customHeadersSealed: sealedColumn('custom_headers'),
    filters: jsonb('filters').$type<WebhookFilters>().notNull().default({}),
    /** Kebab-case attribute names removed from payloads before signing. */
    attributeBlocklist: text('attribute_blocklist')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** C169.5 (Workflow 9B; public): the webhook's name (1 to 200) and description (at most 1,000). */
    name: text('name'),
    description: text('description'),
    /**
     * C169.6 (S6; Workflow 9B): the failure alert, all three set or none (`NULL`: no alert): alert when
     * at least `threshold` first attempts failed within `window_minutes`.
     */
    failureAlertEnabled: boolean('failure_alert_enabled'),
    failureAlertThreshold: integer('failure_alert_threshold'),
    failureAlertWindowMinutes: integer('failure_alert_window_minutes'),
    /**
     * C169.6: when the `webhook-failure-alerts` sweep last alerted about this webhook, so it alerts at
     * most once per window. Set by the sweep with `updated_at` kept as it was (an alert is not a change).
     */
    failureAlertNotifiedAt: timestamptz('failure_alert_notified_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique('webhooks_environment_id_id_key').on(table.environmentId, table.id),
    // C169.6: the sweep reads the webhooks whose alert is on, in every environment.
    index('webhooks_failure_alert_enabled_idx')
      .on(table.environmentId, table.id)
      .where(sql`${table.failureAlertEnabled}`),
    index('webhooks_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check('webhooks_enabled_events_not_empty', sql`cardinality(${table.enabledEvents}) > 0`),
    check('webhooks_secret_last4_length', sql`char_length(${table.secretLast4}) = 4`),
    check('webhooks_url_http', sql`${table.url} ~ '^https?://'`),
    check(
      'webhooks_previous_secret_expiry',
      sql`(${table.previousSecretSealed} IS NULL) = (${table.previousSecretExpiresAt} IS NULL)`,
    ),
    check(
      'webhooks_attribute_blocklist_size',
      sql`cardinality(${table.attributeBlocklist}) <= 100`,
    ),
    // C169.5, C169.6 (Workflow 9B Stage 1b (W)); the threshold's ceiling is ours (contracts B30).
    check('webhooks_name_length', sql`char_length(${table.name}) between 1 and 200`),
    check('webhooks_description_length', sql`char_length(${table.description}) <= 1000`),
    check(
      'webhooks_failure_alert_whole',
      sql`(${table.failureAlertEnabled} is null) = (${table.failureAlertThreshold} is null)
        and (${table.failureAlertEnabled} is null) = (${table.failureAlertWindowMinutes} is null)`,
    ),
    check(
      'webhooks_failure_alert_threshold_range',
      sql`${table.failureAlertThreshold} between 1 and 10000`,
    ),
    check(
      'webhooks_failure_alert_window_range',
      sql`${table.failureAlertWindowMinutes} between 5 and 1440`,
    ),
    apiVersionFormat('webhooks_api_version_format', table.apiVersion),
    idFormat('webhooks', table.id, 'wbh'),
  ],
);

/** One delivery attempt, as kept in `webhook_deliveries.attempts`. */
export interface WebhookAttemptLog {
  attempt: number;
  attempted_at: string;
  response_status: number | null;
  duration_ms: number | null;
  error: string | null;
}

/**
 * One row per (webhook, event), plus one per C14 replay (`is_replay`). Every attempt
 * updates the summary columns and appends to `attempts`, so the full history stays with
 * the delivery. Response bodies are never stored.
 *
 * C14 schedule: at most `max_attempts` (8) attempts, at fixed offsets from
 * `first_attempted_at`; the dispatcher computes `next_attempt_at` from them.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    webhookId: text('webhook_id').notNull(),
    eventId: text('event_id').notNull(),
    status: webhookDeliveryStatus('status').notNull().default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    /** When the next attempt is due; `NULL` once the delivery succeeded or failed. */
    nextAttemptAt: timestamptz('next_attempt_at').defaultNow(),
    lastAttemptAt: timestamptz('last_attempt_at'),
    lastResponseStatus: integer('last_response_status'),
    lastError: text('last_error'),
    deliveredAt: timestamptz('delivered_at'),
    attempts: jsonb('attempts')
      .$type<WebhookAttemptLog[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    firstAttemptedAt: timestamptz('first_attempted_at'),
    maxAttempts: integer('max_attempts').notNull().default(8),
    /** A C14 replay: a further delivery of an event this webhook already had one for. */
    isReplay: boolean('is_replay').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: 'webhook_deliveries_webhook_fk',
      columns: [table.environmentId, table.webhookId],
      foreignColumns: [webhooks.environmentId, webhooks.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'webhook_deliveries_event_fk',
      columns: [table.environmentId, table.eventId],
      foreignColumns: [events.environmentId, events.id],
    }).onDelete('cascade'),
    uniqueIndex('webhook_deliveries_webhook_id_event_id_key')
      .on(table.webhookId, table.eventId)
      .where(sql`NOT ${table.isReplay}`),
    index('webhook_deliveries_status_next_attempt_at_idx').on(table.status, table.nextAttemptAt),
    // C16 retention walks finished deliveries oldest first across environments (2B F019).
    index('webhook_deliveries_finished_created_at_idx')
      .on(table.createdAt)
      .where(sql`${table.status} <> 'pending'`),
    index('webhook_deliveries_environment_id_event_id_idx').on(table.environmentId, table.eventId),
    index('webhook_deliveries_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('webhook_deliveries_environment_id_webhook_id_created_at_id_idx').on(
      table.environmentId,
      table.webhookId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    check('webhook_deliveries_max_attempts_range', sql`${table.maxAttempts} BETWEEN 1 AND 20`),
    check(
      'webhook_deliveries_pending_has_next_attempt',
      sql`${table.status} <> 'pending' OR ${table.nextAttemptAt} IS NOT NULL`,
    ),
    check('webhook_deliveries_attempt_count_non_negative', sql`${table.attemptCount} >= 0`),
    idFormat('webhook_deliveries', table.id, 'whd'),
  ],
);

/**
 * C169.6 (Workflow 9B Stage 1b (W); outcome 21: emails leave through an outbox): a link-only failure
 * alert email owed to a user about a webhook, written in the transaction that decided the alert and
 * deleted once the sweep sent it, skipped it or ran out of attempts, as Phase 8's
 * `case_notification_emails`. It holds ids only; the address is read at send.
 */
export const webhookAlertEmails = pgTable(
  'webhook_alert_emails',
  {
    /** Its order of writing, which the sweep follows (the primary key's index). */
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    environmentId: environmentId(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    webhookId: text('webhook_id').notNull(),
    /** Sends tried, at most 3; `claimed_at` holds a running try for its lease. */
    attempts: integer('attempts').notNull().default(0),
    claimedAt: timestamptz('claimed_at'),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      name: 'webhook_alert_emails_webhook_fk',
      columns: [table.environmentId, table.webhookId],
      foreignColumns: [webhooks.environmentId, webhooks.id],
    }).onDelete('cascade'),
    check(
      'webhook_alert_emails_attempts_range',
      sql`${table.attempts} between 0 and 3 and (${table.attempts} = 0) = (${table.claimedAt} is null)`,
    ),
  ],
);

export type EventRecord = typeof events.$inferSelect;
export type NewEventRecord = typeof events.$inferInsert;
export type WebhookRow = typeof webhooks.$inferSelect;
export type NewWebhookRow = typeof webhooks.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type WebhookAlertEmailRow = typeof webhookAlertEmails.$inferSelect;
