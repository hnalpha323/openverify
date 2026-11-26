import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '../testing.js';
import { appendAuditLog, latestAuditLogAt, listAuditLogs } from './audit-logs.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

describe('audit logs', () => {
  it('appends an entry with the operator IP encrypted', async () => {
    const { environment } = await createTestTenant(database.db);
    const userId = testId('usr');
    const fileId = testId('file');

    const entry = await appendAuditLog(database.db, environment.id, {
      actorType: 'user',
      actorId: userId,
      action: 'file.viewed',
      resourceType: 'file',
      resourceId: fileId,
      requestId: 'req-synthetic-1',
      ip: '198.51.100.23',
      metadata: { kind: 'front' },
    });
    const raw = await database.db.execute<{ ip: string }>(
      sql`select ip from audit_logs where id = ${entry.id}`,
    );

    expect(entry).toMatchObject({
      environmentId: environment.id,
      actorType: 'user',
      actorId: userId,
      action: 'file.viewed',
      resourceType: 'file',
      resourceId: fileId,
      requestId: 'req-synthetic-1',
      ip: '198.51.100.23',
      metadata: { kind: 'front' },
    });
    expect(entry.id).toBeGreaterThan(0);
    expect(raw.rows[0]?.ip).toMatch(/^ov1\./);
  });

  it('defaults the optional fields', async () => {
    const { environment } = await createTestTenant(database.db);

    const entry = await appendAuditLog(database.db, environment.id, {
      actorType: 'system',
      action: 'webhook.disabled',
    });

    expect(entry).toMatchObject({
      actorId: null,
      resourceType: null,
      resourceId: null,
      requestId: null,
      ip: null,
      metadata: {},
    });
  });

  it('lists entries newest first, optionally for one resource, within the environment', async () => {
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const fileId = testId('file');
    const viewed = await appendAuditLog(database.db, environment.id, {
      actorType: 'user',
      action: 'file.viewed',
      resourceType: 'file',
      resourceId: fileId,
    });
    const login = await appendAuditLog(database.db, environment.id, {
      actorType: 'user',
      action: 'session.created',
    });

    expect((await listAuditLogs(database.db, environment.id)).map((entry) => entry.id)).toEqual([
      login.id,
      viewed.id,
    ]);
    expect(
      await listAuditLogs(database.db, environment.id, {
        resourceType: 'file',
        resourceId: fileId,
      }),
    ).toEqual([viewed]);
    expect(await listAuditLogs(database.db, environment.id, { limit: 1 })).toEqual([login]);
    expect(await listAuditLogs(database.db, other.environment.id)).toEqual([]);
  });
});

describe('latestAuditLogAt (C55.7)', () => {
  it('answers when the newest entry of an action was written, in its environment only', async () => {
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const action = 'environment.otp-sms-budget-tripped';

    expect(await latestAuditLogAt(database.db, environment.id, action)).toBeNull();
    await appendAuditLog(database.db, environment.id, { actorType: 'system', action });
    const newest = await appendAuditLog(database.db, environment.id, {
      actorType: 'system',
      action,
    });
    await appendAuditLog(database.db, environment.id, {
      actorType: 'system',
      action: 'settings.updated',
    });

    expect(await latestAuditLogAt(database.db, environment.id, action)).toEqual(newest.createdAt);
    expect(await latestAuditLogAt(database.db, other.environment.id, action)).toBeNull();
  });
});
