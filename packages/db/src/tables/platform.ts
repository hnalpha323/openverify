/** Server API platform records (C12): idempotency keys and API logs. */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sealedColumn } from '../sealed.js';
import { createdAt, hexDigest, idFormat, timestamptz, updatedAt } from './columns.js';
import { idempotencyKeyState, principalType } from './enums.js';
import { environmentId } from './environment-id.js';

/** Response headers an idempotent replay restores (C12: `content-type`, `location`). */
export type StoredResponseHeaders = Record<string, string>;

/**
 * C12 idempotency keys, one per (environment, principal, key). A request claims its key
 * (`in_progress`, leased until `locked_until`), then completes it with the response, whose
 * body is sealed for this row (`idempotency_keys.response_body#<id>`), or releases it on a
 * 5xx. Kept 24 hours (`expires_at`), then deleted by the retention job.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    environmentId: environmentId(),
    principalType: principalType('principal_type').notNull(),
    /** `key_...` or `usr_...`. */
    principalId: text('principal_id').notNull(),
    key: text('key').notNull(),
    /** SHA-256 (hex) of method, route and canonical body. */
    fingerprint: text('fingerprint').notNull(),
    state: idempotencyKeyState('state').notNull().default('in_progress'),
    /** While `in_progress`: another request may take the key over after this time. */
    lockedUntil: timestamptz('locked_until'),
    responseStatus: integer('response_status'),
    responseHeaders: jsonb('response_headers').$type<StoredResponseHeaders>(),
    responseBodySealed: sealedColumn('response_body'),
    /** The resource the response is about, so C16 redaction can drop stored copies. */
    resourceId: text('resource_id'),
    /**
     * Every redaction subject id (inquiry, verification, session, account) the stored body
     * mentions, so C16 redaction drops copies that embed a subject they are not about.
     */
    subjectIds: text('subject_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('idempotency_keys_scope_key').on(
      table.environmentId,
      table.principalType,
      table.principalId,
      table.key,
    ),
    index('idempotency_keys_expires_at_idx').on(table.expiresAt),
    index('idempotency_keys_environment_id_resource_id_idx').on(
      table.environmentId,
      table.resourceId,
    ),
    index('idempotency_keys_subject_ids_idx').using('gin', table.subjectIds),
    hexDigest('idempotency_keys_fingerprint_hex', table.fingerprint),
    // 1-255 printable ASCII characters (C12).
    check('idempotency_keys_key_format', sql`${table.key} ~ '^[ -~]{1,255}$'`),
    check(
      'idempotency_keys_completed_has_status',
      sql`${table.state} <> 'completed' OR ${table.responseStatus} IS NOT NULL`,
    ),
  ],
);

/**
 * C12 API logs: one row per server API request, written after the response. The client
 * address, user agent, query and bodies are personal data, so each is sealed for this row
 * (`api_logs.<column>#alog_...`). Bodies are stored already redacted and truncated by the
 * API. `resource_id` names the resource the request was about and `subject_ids` every
 * redaction subject the stored text mentions, so C16 redaction can clear the copies of its PII.
 */
export const apiLogs = pgTable(
  'api_logs',
  {
    id: text('id').primaryKey(),
    environmentId: environmentId(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    /** The route template, e.g. `/api/v1/inquiries/:id`; `NULL` when no route matched. */
    route: text('route'),
    status: integer('status').notNull(),
    durationMs: integer('duration_ms').notNull(),
    requestId: text('request_id'),
    idempotencyKey: text('idempotency_key'),
    apiKeyId: text('api_key_id'),
    userId: text('user_id'),
    resourceId: text('resource_id'),
    /**
     * Every redaction subject id the path, query or bodies mention, so C16 redaction clears
     * list answers and embeddings too, not only the entry about `resource_id`.
     */
    subjectIds: text('subject_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ipSealed: sealedColumn('ip'),
    userAgentSealed: sealedColumn('user_agent'),
    querySealed: sealedColumn('query'),
    requestBodySealed: sealedColumn('request_body'),
    responseBodySealed: sealedColumn('response_body'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('api_logs_environment_id_created_at_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('api_logs_environment_id_api_key_id_created_at_id_idx').on(
      table.environmentId,
      table.apiKeyId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    // C25.9 (Workflow 2E): `GET /api-logs?filter[user-id]=`, newest first. `NULLS FIRST` is what
    // `ORDER BY ... DESC` means, so a page is read in index order and the scan stops after it.
    index('api_logs_environment_id_user_id_created_at_id_idx').on(
      table.environmentId,
      table.userId,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('api_logs_environment_id_route_created_at_id_idx').on(
      table.environmentId,
      table.route,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('api_logs_environment_id_status_created_at_id_idx').on(
      table.environmentId,
      table.status,
      table.createdAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('api_logs_environment_id_resource_id_idx').on(table.environmentId, table.resourceId),
    index('api_logs_subject_ids_idx').using('gin', table.subjectIds),
    // C16 retention walks API logs oldest first across environments (Workflow 2B F019).
    index('api_logs_created_at_idx').on(table.createdAt),
    check('api_logs_status_range', sql`${table.status} BETWEEN 100 AND 599`),
    check('api_logs_duration_non_negative', sql`${table.durationMs} >= 0`),
    check('api_logs_method_format', sql`${table.method} ~ '^[A-Z]+$'`),
    idFormat('api_logs', table.id, 'alog'),
  ],
);

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type ApiLogRow = typeof apiLogs.$inferSelect;

/** An API log entry as the repositories return it: the sealed columns opened. */
export type ApiLog = Omit<
  ApiLogRow,
  'ipSealed' | 'userAgentSealed' | 'querySealed' | 'requestBodySealed' | 'responseBodySealed'
> & {
  ip: string | null;
  userAgent: string | null;
  query: unknown;
  requestBody: unknown;
  responseBody: unknown;
};
