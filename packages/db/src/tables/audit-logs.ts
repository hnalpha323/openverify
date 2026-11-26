/** Append-only record of operator reads and writes (PLAN §3, C15 user audit logs). */
import { sql } from 'drizzle-orm';
import { bigint, foreignKey, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { encrypted } from '../crypto.js';
import { sealedColumn } from '../sealed.js';
import { createdAt, dottedName, hexDigest, idColumnFormat, updatedAt } from './columns.js';
import { auditActorType } from './enums.js';
import { environmentId } from './environment-id.js';

/**
 * A database trigger rejects every UPDATE; rows can only be deleted, by retention jobs
 * or with their environment. The one exception is the KEK rewrap (C16), which may rewrite
 * the encrypted columns inside a transaction that sets `openverify.kek_rewrap`.
 *
 * `id` is the internal identity key; the API addresses entries by `public_id` (`aud_...`,
 * C9). `ip` keeps its Phase 1 static context; `user_agent` (schema v2) is sealed for the
 * row's public id (`audit_logs.user_agent#aud_...`).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /**
     * Generated in SQL when an insert names none; `appendAuditLog` generates it itself,
     * because the sealed user agent is bound to it.
     */
    publicId: text('public_id')
      .notNull()
      .default(sql`openverify_new_id('aud')`),
    environmentId: environmentId(),
    actorType: auditActorType('actor_type').notNull(),
    /** `usr_...`, `key_...`, or `NULL` for the system. */
    actorId: text('actor_id'),
    /** Dotted action name, e.g. `file.viewed`. */
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    requestId: text('request_id'),
    /** Operator IP address; personal data, so encrypted. */
    ip: encrypted('ip', { context: 'audit_logs.ip' }),
    userAgentSealed: sealedColumn('user_agent'),
    /** Non-PII details only. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('audit_logs_public_id_key').on(table.publicId),
    index('audit_logs_environment_id_created_at_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
    ),
    index('audit_logs_environment_id_created_at_public_id_idx').on(
      table.environmentId,
      table.createdAt.desc().nullsFirst(),
      table.publicId.desc().nullsFirst(),
    ),
    index('audit_logs_environment_id_resource_idx').on(
      table.environmentId,
      table.resourceType,
      table.resourceId,
    ),
    index('audit_logs_environment_id_actor_id_created_at_idx').on(
      table.environmentId,
      table.actorId,
      table.createdAt.desc().nullsFirst(),
    ),
    index('audit_logs_environment_id_action_created_at_idx').on(
      table.environmentId,
      table.action,
      table.createdAt.desc().nullsFirst(),
    ),
    dottedName('audit_logs_action_format', table.action),
    idColumnFormat('audit_logs_public_id_format', table.publicId, 'aud'),
  ],
);

/**
 * C168.6 (Workflow 9B Stage 1b (U); review P23): `filter[ip]` of the audit explorer matches an
 * address exactly through this table, so `audit_logs` stays append-only: one row per entry with an
 * address, `ip_hmac` the HMAC of the address under the environment's blind-index subkey with the
 * label `openverify/audit-ip/v1` (`IDENTIFIER_KEY_LABELS['audit-ip']`). `api-access` writes it
 * beside each entry and reads it with `pii:view`; `blind-index:rebuild` backfills and rewrites it;
 * a row goes with its audit entry (the retention pass deletes the entry) and with its environment.
 */
export const auditLogIpIndex = pgTable(
  'audit_log_ip_index',
  {
    auditLogId: bigint('audit_log_id', { mode: 'number' }).primaryKey(),
    environmentId: environmentId(),
    ipHmac: text('ip_hmac').notNull(),
  },
  (table) => [
    foreignKey({
      name: 'audit_log_ip_index_audit_log_fk',
      columns: [table.auditLogId],
      foreignColumns: [auditLogs.id],
    }).onDelete('cascade'),
    index('audit_log_ip_index_lookup_idx').on(table.environmentId, table.ipHmac, table.auditLogId),
    hexDigest('audit_log_ip_index_ip_hmac_hex', table.ipHmac),
  ],
);

export type AuditLogIpIndexRow = typeof auditLogIpIndex.$inferSelect;

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

/** An audit entry as the repositories return it: the user agent opened. */
export type AuditLog = Omit<AuditLogRow, 'userAgentSealed'> & { userAgent: string | null };
