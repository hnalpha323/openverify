/**
 * C168.6, C16 (Phase 9, Workflow 9B): the audit-log step of the C16 retention pass, which
 * `runRetention` (`services/retention.ts`) calls and whose count joins its report. Owner: `api-access`;
 * `foundation-9b` (Stage 1b (U)) froze the signature and placed the call.
 *
 * It deletes, per environment and in batches, the audit entries older than the environment's
 * `audit-log-retention-days` (absent: kept, as before Phase 9), each with its `audit_log_ip_index`
 * row (the foreign key cascades), so `audit_logs` is never updated (review P23). Counts only.
 */
import { deleteExpiredAuditLogs, environments, type Db } from '@openverify/db';
import { sql } from 'drizzle-orm';

/** What the audit-log step of one retention run deleted: a count only. */
export interface AuditLogRetentionReport {
  /** Audit entries past `audit-log-retention-days`, with their address index rows. */
  deletedAuditLogs: number;
}

export interface AuditLogRetentionDeps {
  db: Db;
}

/** One batch's bounds: the run's "now" and the batch size (`DeleteOptions`). */
export interface AuditLogRetentionBatch {
  now: Date;
  limit: number;
}

export type RunAuditLogRetention = (
  deps: AuditLogRetentionDeps,
  batch: AuditLogRetentionBatch,
) => Promise<AuditLogRetentionReport>;

export const runAuditLogRetention: RunAuditLogRetention = async ({ db }, { now, limit }) => {
  const windows = await db
    .select({
      id: environments.id,
      days: sql<number>`(${environments.settings} ->> 'audit-log-retention-days')::int`.mapWith(
        Number,
      ),
    })
    .from(environments)
    .where(sql`${environments.settings} ? 'audit-log-retention-days'`);
  let deletedAuditLogs = 0;
  for (const window of windows) {
    if (!Number.isSafeInteger(window.days) || window.days < 1) {
      continue;
    }
    // C249.3 (Workflow 11B Stage 1b (P), `foundation-11b`): through the migration role's function,
    // which deletes only past the setting, never under 30 days; the runtime role deletes no entry.
    for (;;) {
      const deleted = await deleteExpiredAuditLogs(db, window.id, now, limit);
      deletedAuditLogs += deleted;
      if (deleted < limit) {
        break;
      }
    }
  }
  return { deletedAuditLogs };
};
