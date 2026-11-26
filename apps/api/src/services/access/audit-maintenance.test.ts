/**
 * C168.6, C16 (Phase 9, Workflow 9B; review P23): the audit log's retention step and the rebuild of
 * its address index.
 *
 * - `runAuditLogRetention` deletes, per environment, the entries older than its
 *   `audit-log-retention-days`, with their index rows; an environment without the setting keeps
 *   every entry, as before Phase 9.
 * - `rebuildAuditLogIpIndex` writes the index from each entry's encrypted address under the key it
 *   is given, never updating `audit_logs`, and counts what it scanned and rewrote.
 *
 * Every address is from the documentation ranges; every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { appendAuditLog, auditIpHmac, environments, useAuditIpIndexKey } from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rebuildAuditLogIpIndex } from './audit-ip-index.js';
import { runAuditLogRetention } from './audit-retention.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  useAuditIpIndexKey(null);
  await database.close();
});

const count = async (table: string, environmentId: string) =>
  (
    await database.db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)} where environment_id = ${environmentId}`,
    )
  ).rows[0]?.n;

const entry = (ip: string | null) => ({
  actorType: 'system' as const,
  action: 'inquiry.viewed',
  resourceType: 'inquiry',
  resourceId: 'inq_01M5CN00000000000000009B10',
  ip,
});

describe('runAuditLogRetention (C168.6)', () => {
  it('deletes entries past audit-log-retention-days with their index rows, and keeps them where it is absent', async () => {
    useAuditIpIndexKey(new Uint8Array(randomBytes(32)));
    const kept = await createTestTenant(database.db);
    const pruned = await createTestTenant(database.db);
    await database.db
      .update(environments)
      .set({ settings: { 'audit-log-retention-days': 30 } })
      .where(eq(environments.id, pruned.environment.id));
    for (const environmentId of [kept.environment.id, pruned.environment.id]) {
      for (let index = 0; index < 3; index += 1) {
        await appendAuditLog(database.db, environmentId, entry('192.0.2.70'));
      }
    }

    const early = await runAuditLogRetention(
      { db: database.db },
      { now: new Date(Date.now() + 29 * 86_400_000), limit: 2 },
    );
    const late = await runAuditLogRetention(
      { db: database.db },
      { now: new Date(Date.now() + 31 * 86_400_000), limit: 2 },
    );

    expect(early).toEqual({ deletedAuditLogs: 0 });
    expect(late).toEqual({ deletedAuditLogs: 3 });
    expect(await count('audit_logs', pruned.environment.id)).toBe(0);
    expect(await count('audit_log_ip_index', pruned.environment.id)).toBe(0);
    expect(await count('audit_logs', kept.environment.id)).toBe(3);
  });
});

describe('rebuildAuditLogIpIndex (blind-index:rebuild, C168.6)', () => {
  it('writes every entry’s address under the given key, in batches, then rewrites nothing', async () => {
    useAuditIpIndexKey(null);
    const { environment } = await createTestTenant(database.db);
    await appendAuditLog(database.db, environment.id, entry('192.0.2.80'));
    await appendAuditLog(database.db, environment.id, entry('192.0.2.81'));
    await appendAuditLog(database.db, environment.id, entry(null));
    const key = new Uint8Array(randomBytes(32));

    const first = await rebuildAuditLogIpIndex(database.db, key, { batchSize: 1 });
    const second = await rebuildAuditLogIpIndex(database.db, key, { batchSize: 1 });

    expect(first.updated).toBeGreaterThanOrEqual(2);
    expect(first.scanned).toBeGreaterThanOrEqual(first.updated);
    expect(second.updated).toBe(0);
    const rows = (
      await database.db.execute<{ ip_hmac: string }>(
        sql`select ip_hmac from audit_log_ip_index where environment_id = ${environment.id}
            order by ip_hmac`,
      )
    ).rows.map((row) => row.ip_hmac);
    expect(rows).toEqual(
      [
        auditIpHmac(key, environment.id, '192.0.2.80'),
        auditIpHmac(key, environment.id, '192.0.2.81'),
      ].sort(),
    );
  });
});
