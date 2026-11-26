import { isIPv6 } from 'node:net';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lt, sql, type SQL } from 'drizzle-orm';
import { blindIndexKeyFromEnv, identifierKey } from '../blind-index.js';
import type { Db } from '../client.js';
import { SEALED } from '../encrypted-columns.js';
import { generateId } from '../ids.js';
import {
  auditLogIpIndex,
  auditLogs,
  type AuditActorType,
  type AuditLog,
  type AuditLogRow,
} from '../schema.js';
import { openOptional, sealOptional } from '../sealed.js';
import {
  newestFirst,
  paginate,
  type CursorTable,
  type Page,
  type PageRequest,
} from './pagination.js';
import {
  allFilters,
  createdAtRange,
  equalsAny,
  firstOrNull,
  inserted,
  type CreatedAtRange,
  type OneOrMany,
} from './rows.js';

export interface AuditLogEntry {
  /** C9 public id (`aud_...`); generated when omitted. */
  id?: string;
  actorType: AuditActorType;
  /** `usr_...` or `key_...`; omit for the system. */
  actorId?: string | null;
  /** Dotted name, e.g. `file.viewed`. */
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  /** The request's `x-request-id`. */
  requestId?: string | null;
  /** Encrypted at rest. */
  ip?: string | null;
  /** Encrypted at rest, bound to the entry's public id. */
  userAgent?: string | null;
  /** Non-PII details only. */
  metadata?: Record<string, unknown>;
}

export interface ListAuditLogsOptions {
  resourceType?: string;
  resourceId?: string;
  /** Defaults to 100. */
  limit?: number;
}

/** Opens the sealed user agent and drops the ciphertext. */
export function toAuditLog(row: AuditLogRow): AuditLog {
  const { userAgentSealed, ...entry } = row;
  return {
    ...entry,
    userAgent: openOptional(SEALED.auditLogUserAgent, row.publicId, userAgentSealed),
  };
}

/** Appends an entry. Entries are never updated (a database trigger enforces it). */
export async function appendAuditLog(
  db: Db,
  environmentId: string,
  entry: AuditLogEntry,
): Promise<AuditLog> {
  const publicId = entry.id ?? generateId('aud');
  const rows = await db
    .insert(auditLogs)
    .values({
      publicId,
      environmentId,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      requestId: entry.requestId ?? null,
      ip: entry.ip ?? null,
      userAgentSealed: sealOptional(SEALED.auditLogUserAgent, publicId, entry.userAgent),
      metadata: entry.metadata ?? {},
    })
    .returning();
  const appended = toAuditLog(inserted(rows, 'appendAuditLog'));
  // C168.6 (Workflow 9B; review P23): the address's HMAC beside the entry, for `filter[ip]`.
  const key = entry.ip === null || entry.ip === undefined ? null : auditIpIndexKey();
  if (key !== null && appended.ip !== null) {
    await writeIpIndexRow(db, key, { id: appended.id, environmentId, ip: appended.ip });
  }
  return appended;
}

/** Entries newest first, optionally for one resource. */
export async function listAuditLogs(
  db: Db,
  environmentId: string,
  options: ListAuditLogsOptions = {},
): Promise<AuditLog[]> {
  const conditions: (SQL | undefined)[] = [
    eq(auditLogs.environmentId, environmentId),
    options.resourceType === undefined
      ? undefined
      : eq(auditLogs.resourceType, options.resourceType),
    options.resourceId === undefined ? undefined : eq(auditLogs.resourceId, options.resourceId),
  ];
  const rows = await db
    .select()
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.id))
    .limit(options.limit ?? 100);
  return rows.map(toAuditLog);
}

/**
 * When the environment's newest entry with `action` was written, or `null` when it has none (the
 * C55.7 `environment.otp-sms-budget-tripped` time the settings serve).
 */
export async function latestAuditLogAt(
  db: Db,
  environmentId: string,
  action: string,
): Promise<Date | null> {
  const row = firstOrNull(
    await db
      .select({ createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.environmentId, environmentId), eq(auditLogs.action, action)))
      .orderBy(desc(auditLogs.id))
      .limit(1),
  );
  return row?.createdAt ?? null;
}

/** C15 list filters. `page[after]` is an entry's public id (`aud_...`). */
export interface ListUserAuditLogsOptions extends PageRequest, CreatedAtRange {
  action?: OneOrMany<string> | undefined;
  actorId?: OneOrMany<string> | undefined;
  resourceType?: OneOrMany<string> | undefined;
  resourceId?: OneOrMany<string> | undefined;
  /** C168.6 (Workflow 9B): actions starting with this, in the served (kebab-case) spelling. */
  actionPrefix?: string | undefined;
  /** C168.6: entries from this instant (included). */
  from?: Date | undefined;
  /** C168.6: entries before this instant (excluded). */
  to?: Date | undefined;
  /** C168.6: entries whose address has this `audit-ip` HMAC (`audit_log_ip_index`). */
  ipHmac?: string | undefined;
}

const auditCursor: CursorTable = {
  table: auditLogs,
  id: auditLogs.publicId,
  scope: auditLogs.environmentId,
  createdAt: auditLogs.createdAt,
};

/** C15 `GET /audit-logs/:id` by public id (`aud_...`), or `null` when it is not here. */
export async function getAuditLog(
  db: Db,
  environmentId: string,
  publicId: string,
): Promise<AuditLog | null> {
  const row = firstOrNull(
    await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.publicId, publicId), eq(auditLogs.environmentId, environmentId)))
      .limit(1),
  );
  return row === null ? null : toAuditLog(row);
}

/**
 * C15 `GET /audit-logs` and `GET /user-audit-logs`: newest first, paged by public id, with
 * action, actor, resource and date filters.
 */
export async function listUserAuditLogs(
  db: Db,
  environmentId: string,
  options: ListUserAuditLogsOptions = {},
): Promise<Page<AuditLog>> {
  const filters = allFilters([
    eq(auditLogs.environmentId, environmentId),
    equalsAny(auditLogs.action, options.action),
    equalsAny(auditLogs.actorId, options.actorId),
    equalsAny(auditLogs.resourceType, options.resourceType),
    equalsAny(auditLogs.resourceId, options.resourceId),
    ...createdAtRange(auditLogs.createdAt, options),
    // C168.6 (Workflow 9B): the explorer's filters. Phase 1 stored snake_case resource names
    // (`user_session.created`), which the contract serves in kebab-case.
    options.actionPrefix === undefined
      ? undefined
      : sql`starts_with(replace(${auditLogs.action}, '_', '-'), ${options.actionPrefix})`,
    options.from === undefined ? undefined : gte(auditLogs.createdAt, options.from),
    options.to === undefined ? undefined : lt(auditLogs.createdAt, options.to),
    options.ipHmac === undefined
      ? undefined
      : sql`exists (select 1 from ${auditLogIpIndex}
                    where ${auditLogIpIndex.auditLogId} = ${auditLogs.id}
                      and ${auditLogIpIndex.environmentId} = ${environmentId}
                      and ${auditLogIpIndex.ipHmac} = ${options.ipHmac})`,
  ]);
  if (filters === null) {
    return { items: [], next: null };
  }
  return paginate(
    db,
    auditCursor,
    environmentId,
    options,
    async (after, limit) =>
      (
        await db
          .select()
          .from(auditLogs)
          .where(and(...filters, after))
          .orderBy(...newestFirst(auditCursor))
          .limit(limit)
      ).map(toAuditLog),
    (entry) => entry.publicId,
  );
}

/** The actions of a dashboard sign-in: C15's, and Phase 1's snake_case spelling. */
const SIGN_IN_ACTIONS = ['user-session.created', 'user_session.created'];

/**
 * C168.4 (Workflow 9B): the user agent each session signed in with, read from its
 * `user-session.created` entry (sealed at rest, opened here); a session whose entry is gone, or
 * that recorded none, is left out.
 */
export async function sessionSignInAgents(
  db: Db,
  environmentIds: readonly string[],
  sessionIds: readonly string[],
): Promise<Map<string, string>> {
  const agents = new Map<string, string>();
  if (environmentIds.length === 0 || sessionIds.length === 0) {
    return agents;
  }
  const rows = await db
    .select()
    .from(auditLogs)
    .where(
      and(
        inArray(auditLogs.environmentId, [...environmentIds]),
        inArray(auditLogs.action, SIGN_IN_ACTIONS),
        inArray(auditLogs.resourceId, [...sessionIds]),
      ),
    );
  for (const entry of rows.map(toAuditLog)) {
    if (entry.resourceId !== null && entry.userAgent !== null) {
      agents.set(entry.resourceId, entry.userAgent);
    }
  }
  return agents;
}

/**
 * C168.5 (Workflow 9B): each user's last sign-in, the newest `user-session.created` entry it wrote
 * in the organisation's environments; a user with none (never, or past `audit-log-retention-days`)
 * is left out.
 */
export async function lastSignIns(
  db: Db,
  environmentIds: readonly string[],
  userIds: readonly string[],
): Promise<Map<string, Date>> {
  const signIns = new Map<string, Date>();
  if (environmentIds.length === 0 || userIds.length === 0) {
    return signIns;
  }
  const rows = await db
    .select({
      actorId: auditLogs.actorId,
      at: sql<Date>`max(${auditLogs.createdAt})`.mapWith(auditLogs.createdAt),
    })
    .from(auditLogs)
    .where(
      and(
        inArray(auditLogs.environmentId, [...environmentIds]),
        inArray(auditLogs.actorId, [...userIds]),
        inArray(auditLogs.action, SIGN_IN_ACTIONS),
      ),
    )
    .groupBy(auditLogs.actorId);
  for (const row of rows) {
    if (row.actorId !== null) {
      signIns.set(row.actorId, row.at);
    }
  }
  return signIns;
}

/**
 * C168.6 (Workflow 9B; review P23): the blind-index key the audit IP index is written with. The
 * process sets it at start (`useAuditIpIndexKey`); left unset, it is read once from
 * `OPENVERIFY_BLIND_INDEX_KEY`, and without one no index row is written (the rebuild fills them
 * later) and `filter[ip]` cannot be answered.
 */
let configuredIpIndexKey: Uint8Array | null | undefined;

/** Sets the process's audit IP index key; `null` turns the index writes off. */
export function useAuditIpIndexKey(key: Uint8Array | null | undefined): void {
  configuredIpIndexKey = key;
}

/** The process's audit IP index key, or `null` when it has none. */
export function auditIpIndexKey(): Uint8Array | null {
  if (configuredIpIndexKey === undefined) {
    try {
      configuredIpIndexKey = blindIndexKeyFromEnv(process.env);
    } catch {
      configuredIpIndexKey = null;
    }
  }
  return configuredIpIndexKey;
}

/**
 * One spelling per address: IPv6 in its compressed lower-case form, so `2001:DB8:0:0::1` and
 * `2001:db8::1` are one address; anything else trimmed as it is.
 */
function canonicalAddress(ip: string): string {
  const trimmed = ip.trim();
  if (isIPv6(trimmed)) {
    return new URL(`http://[${trimmed}]/`).hostname.slice(1, -1);
  }
  return trimmed;
}

/**
 * The `audit-ip` HMAC of `ip` under the environment's blind-index subkey
 * (`IDENTIFIER_KEY_LABELS['audit-ip']`, `openverify/audit-ip/v1`). Never logged.
 */
export function auditIpHmac(key: Uint8Array, environmentId: string, ip: string): string {
  return identifierKey(key, { environmentId, kind: 'audit-ip', input: canonicalAddress(ip) });
}

/** Writes (or rewrites) the index row of one entry. Returns whether it changed. */
async function writeIpIndexRow(
  db: Db,
  key: Uint8Array,
  row: { id: number; environmentId: string; ip: string },
): Promise<boolean> {
  const ipHmac = auditIpHmac(key, row.environmentId, row.ip);
  const written = await db
    .insert(auditLogIpIndex)
    .values({ auditLogId: row.id, environmentId: row.environmentId, ipHmac })
    .onConflictDoUpdate({
      target: auditLogIpIndex.auditLogId,
      set: { ipHmac, environmentId: row.environmentId },
      setWhere: sql`${auditLogIpIndex.ipHmac} <> excluded.ip_hmac`,
    })
    .returning({ id: auditLogIpIndex.auditLogId });
  return written.length > 0;
}

/**
 * C168.6, C16: removes up to `limit` entries of the environment created before `before`, oldest
 * first; their index rows go with them (the foreign key cascades). Returns the count.
 */
export async function deleteAuditLogsBefore(
  db: Db,
  environmentId: string,
  before: Date,
  limit: number,
): Promise<number> {
  const oldest = db
    .select({ id: auditLogs.id })
    .from(auditLogs)
    .where(and(eq(auditLogs.environmentId, environmentId), lt(auditLogs.createdAt, before)))
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id))
    .limit(limit);
  const removed = await db
    .delete(auditLogs)
    .where(inArray(auditLogs.id, oldest))
    .returning({ id: auditLogs.id });
  return removed.length;
}

/**
 * C249.3 (Workflow 11B Stage 1b (P)): one batch of the audit log's retention through the migration
 * role's `openverify_delete_expired_audit_logs` (`SECURITY DEFINER`), so the runtime role deletes no
 * audit entry itself: at most `limit` entries of the environment older than its
 * `audit-log-retention-days` (absent: none), never under 30 days, from `now`; their address index
 * rows cascade. Answers how many went.
 */
export async function deleteExpiredAuditLogs(
  db: Db,
  environmentId: string,
  now: Date,
  limit: number,
): Promise<number> {
  const result = await db.execute<{ deleted: number }>(
    sql`select openverify_delete_expired_audit_logs(${environmentId}, ${now.toISOString()}::timestamptz, ${limit}::int) as deleted`,
  );
  return (result as { rows: { deleted: number }[] }).rows[0]?.deleted ?? 0;
}

/**
 * C168.6 (`blind-index:rebuild`): (re)writes the index rows of up to `limit` entries with an
 * address whose id is above `afterId`, from each entry's encrypted address, never updating
 * `audit_logs`. `lastId` is where the next batch starts, `null` when this one was the last.
 */
export async function indexAuditLogAddresses(
  db: Db,
  key: Uint8Array,
  options: { afterId: number; limit: number },
): Promise<{ scanned: number; updated: number; lastId: number | null }> {
  const rows = await db
    .select({ id: auditLogs.id, environmentId: auditLogs.environmentId, ip: auditLogs.ip })
    .from(auditLogs)
    .where(and(gt(auditLogs.id, options.afterId), isNotNull(auditLogs.ip)))
    .orderBy(asc(auditLogs.id))
    .limit(options.limit);
  let updated = 0;
  for (const row of rows) {
    if (row.ip !== null && (await writeIpIndexRow(db, key, { ...row, ip: row.ip }))) {
      updated += 1;
    }
  }
  return {
    scanned: rows.length,
    updated,
    lastId: rows.length < options.limit ? null : (rows.at(-1)?.id ?? null),
  };
}
