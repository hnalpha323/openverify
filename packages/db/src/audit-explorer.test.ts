/**
 * C168.6 (Phase 9, Workflow 9B; review P23; `api-access`): the audit explorer in the repository.
 *
 * - Each entry with an address gets an `audit_log_ip_index` row, the address's HMAC under the
 *   environment's blind-index subkey (label `openverify/audit-ip/v1`), when the process has the key;
 *   `audit_logs` itself is never updated.
 * - The list filters by action prefix (in the served kebab-case spelling, Phase 1's snake_case rows
 *   included), by `from` (included) and `to` (excluded), and by an exact address through the index.
 * - The retention deletes an environment's entries before a cutoff, their index rows with them.
 * - The rebuild writes the index from each entry's encrypted address.
 *
 * Every address is from the documentation ranges; every value is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  appendAuditLog,
  auditIpHmac,
  auditIpIndexKey,
  deleteAuditLogsBefore,
  indexAuditLogAddresses,
  listUserAuditLogs,
  useAuditIpIndexKey,
} from './repositories/audit-logs.js';
import { createTestDatabase, createTestTenant, type TestDatabase } from './testing.js';

let database: TestDatabase;
const KEY = new Uint8Array(randomBytes(32));

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterEach(() => {
  useAuditIpIndexKey(null);
});

afterAll(async () => {
  await database.close();
});

const indexRows = async (environmentId: string) =>
  (
    await database.db.execute<{ audit_log_id: number; ip_hmac: string }>(
      sql`select audit_log_id, ip_hmac from audit_log_ip_index where environment_id = ${environmentId}
          order by audit_log_id`,
    )
  ).rows;

const entry = (action: string, ip: string | null) => ({
  actorType: 'system' as const,
  action,
  resourceType: 'environment',
  resourceId: 'env_01M5CN00000000000000009B10',
  ip,
});

describe('the audit IP index (C168.6)', () => {
  it('writes the HMAC of each address under the configured key, and nothing without one', async () => {
    const { environment } = await createTestTenant(database.db);
    useAuditIpIndexKey(null);
    await appendAuditLog(database.db, environment.id, entry('environment.viewed', '192.0.2.10'));
    useAuditIpIndexKey(KEY);
    const indexed = await appendAuditLog(
      database.db,
      environment.id,
      entry('environment.viewed', '192.0.2.10'),
    );
    await appendAuditLog(database.db, environment.id, entry('environment.viewed', null));

    expect(auditIpIndexKey()).toBe(KEY);
    expect(await indexRows(environment.id)).toEqual([
      { audit_log_id: indexed.id, ip_hmac: auditIpHmac(KEY, environment.id, '192.0.2.10') },
    ]);
    expect(auditIpHmac(KEY, environment.id, '192.0.2.10')).toMatch(/^[0-9a-f]{64}$/);
    expect(auditIpHmac(KEY, environment.id, '192.0.2.10')).not.toBe(
      auditIpHmac(KEY, 'env_01M5CN00000000000000009B99', '192.0.2.10'),
    );
    // One address, however it is written.
    expect(auditIpHmac(KEY, environment.id, '2001:DB8:0:0::1')).toBe(
      auditIpHmac(KEY, environment.id, '2001:db8::1'),
    );
  });
});

describe('listUserAuditLogs: the explorer filters (C168.6)', () => {
  it('filters by action prefix, Phase 1 spellings included, by from and to, and by an address', async () => {
    useAuditIpIndexKey(KEY);
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const a = await appendAuditLog(
      database.db,
      environment.id,
      entry('inquiry.created', '192.0.2.20'),
    );
    const b = await appendAuditLog(
      database.db,
      environment.id,
      entry('user_session.created', '198.51.100.7'),
    );
    const c = await appendAuditLog(
      database.db,
      environment.id,
      entry('inquiry.redacted', '192.0.2.20'),
    );
    await appendAuditLog(database.db, other.environment.id, entry('inquiry.created', '192.0.2.20'));
    const ids = async (options: Parameters<typeof listUserAuditLogs>[2]) =>
      (await listUserAuditLogs(database.db, environment.id, options)).items
        .map((item) => item.publicId)
        .sort();
    const at = (row: { createdAt: Date }) => row.createdAt;

    expect(await ids({ actionPrefix: 'inquiry.' })).toEqual([a.publicId, c.publicId].sort());
    expect(await ids({ actionPrefix: 'user-session.' })).toEqual([b.publicId]);
    expect(await ids({ ipHmac: auditIpHmac(KEY, environment.id, '192.0.2.20') })).toEqual(
      [a.publicId, c.publicId].sort(),
    );
    expect(await ids({ ipHmac: auditIpHmac(KEY, environment.id, '192.0.2.21') })).toEqual([]);
    expect(await ids({ from: at(a), to: new Date(at(a).getTime() + 1) })).toContain(a.publicId);
    expect(await ids({ to: at(a) })).not.toContain(a.publicId);
    expect(await ids({ from: new Date(at(c).getTime() + 1) })).toEqual([]);
  });
});

describe('deleteAuditLogsBefore (the C16 step, C168.6)', () => {
  it('deletes an environment’s entries before the cutoff, up to the limit, with their index rows', async () => {
    useAuditIpIndexKey(KEY);
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    for (let index = 0; index < 3; index += 1) {
      await appendAuditLog(database.db, environment.id, entry('inquiry.created', '192.0.2.30'));
    }
    await appendAuditLog(database.db, other.environment.id, entry('inquiry.created', '192.0.2.30'));
    const cutoff = new Date(Date.now() + 60_000);

    const first = await deleteAuditLogsBefore(database.db, environment.id, cutoff, 2);
    const second = await deleteAuditLogsBefore(database.db, environment.id, cutoff, 2);
    const none = await deleteAuditLogsBefore(database.db, environment.id, new Date(0), 2);

    expect([first, second, none]).toEqual([2, 1, 0]);
    expect(await indexRows(environment.id)).toEqual([]);
    expect(await indexRows(other.environment.id)).toHaveLength(1);
  });
});

describe('indexAuditLogAddresses (blind-index:rebuild, C168.6)', () => {
  it('writes and rewrites the index from each encrypted address, in batches after an id', async () => {
    const { environment } = await createTestTenant(database.db);
    useAuditIpIndexKey(null);
    const first = await appendAuditLog(
      database.db,
      environment.id,
      entry('inquiry.created', '192.0.2.40'),
    );
    await appendAuditLog(database.db, environment.id, entry('inquiry.created', null));
    const last = await appendAuditLog(
      database.db,
      environment.id,
      entry('inquiry.created', '2001:db8::40'),
    );
    const before = (await database.db.execute(sql`select count(*)::int as n from audit_logs`)).rows;

    const batch = await indexAuditLogAddresses(database.db, KEY, {
      afterId: first.id - 1,
      limit: 1000,
    });
    const again = await indexAuditLogAddresses(database.db, KEY, {
      afterId: first.id - 1,
      limit: 1000,
    });

    expect(batch.scanned).toBeGreaterThanOrEqual(2);
    expect(batch.updated).toBeGreaterThanOrEqual(2);
    expect(again.updated).toBe(0);
    // Fewer rows than the limit: the last batch.
    expect(batch.lastId).toBeNull();
    expect(await indexRows(environment.id)).toEqual([
      { audit_log_id: first.id, ip_hmac: auditIpHmac(KEY, environment.id, '192.0.2.40') },
      { audit_log_id: last.id, ip_hmac: auditIpHmac(KEY, environment.id, '2001:db8::40') },
    ]);
    expect(
      (await database.db.execute(sql`select count(*)::int as n from audit_logs`)).rows,
    ).toEqual(before);
  });
});
