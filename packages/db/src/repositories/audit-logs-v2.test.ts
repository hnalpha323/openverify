/** C15 user audit logs: public ids, sealed user agent, cursor pages and list filters. */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { InvalidCursorError } from '../errors.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import { appendAuditLog, getAuditLog, listUserAuditLogs } from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

describe('user audit logs (C15)', () => {
  it('keep a public aud_ id and seal the user agent for it', async () => {
    const env = (await createTestTenant(database.db)).environment.id;
    const id = testId('aud');

    const entry = await appendAuditLog(database.db, env, {
      id,
      actorType: 'api_key',
      actorId: testId('key'),
      action: 'webhook.secret-rotated',
      ip: '198.51.100.30',
      userAgent: 'SyntheticClient/9',
      metadata: { 'webhook-id': 'wbh_X' },
    });
    const raw = await database.db.execute(
      sql`select user_agent from audit_logs where public_id = ${id}`,
    );
    const generated = await appendAuditLog(database.db, env, {
      actorType: 'system',
      action: 'inquiry.expired',
    });

    expect(entry).toMatchObject({
      publicId: id,
      userAgent: 'SyntheticClient/9',
      ip: '198.51.100.30',
    });
    expect(JSON.stringify(raw.rows)).not.toContain('SyntheticClient');
    expect(generated.publicId).toMatch(/^aud_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(generated.userAgent).toBeNull();
    expect(await getAuditLog(database.db, env, id)).toEqual(entry);
    expect(await getAuditLog(database.db, testId('env'), id)).toBeNull();
  });

  it('list newest first by public id, with action, actor, resource and date filters', async () => {
    onTestFinished(wallClockStepsBack());
    const env = (await createTestTenant(database.db)).environment.id;
    const user = testId('usr');
    const append = (action: string, actorId: string | null, resourceId: string | null = null) =>
      appendAuditLog(database.db, env, {
        actorType: actorId === null ? 'system' : 'user',
        actorId,
        action,
        resourceType: resourceId === null ? null : 'inquiry',
        resourceId,
      });
    const clock = createdAtClock(database.db);
    const a = await append('inquiry.approved', user, 'inq_A');
    await clock.at('audit_logs', a.publicId, 'public_id');
    const b = await append('file.viewed', user);
    await clock.at('audit_logs', b.publicId, 'public_id');
    const c = await append('inquiry.approved', null, 'inq_B');
    await clock.at('audit_logs', c.publicId, 'public_id');
    const ids = async (options: Parameters<typeof listUserAuditLogs>[2]) =>
      (await listUserAuditLogs(database.db, env, options)).items.map((entry) => entry.publicId);

    expect(await ids({})).toEqual([c.publicId, b.publicId, a.publicId]);
    expect(await ids({ action: 'inquiry.approved' })).toEqual([c.publicId, a.publicId]);
    expect(await ids({ actorId: user })).toEqual([b.publicId, a.publicId]);
    expect(await ids({ resourceType: 'inquiry', resourceId: 'inq_B' })).toEqual([c.publicId]);
    expect(await ids({ createdAtStart: new Date(Date.now() + 60_000) })).toEqual([]);
    expect(await ids({ action: [] })).toEqual([]);
    const first = await listUserAuditLogs(database.db, env, { size: 2 });
    expect(first.next).toBe(b.publicId);
    expect(
      (await listUserAuditLogs(database.db, env, { after: first.next ?? '' })).items.map(
        (e) => e.publicId,
      ),
    ).toEqual([a.publicId]);
    await expect(listUserAuditLogs(database.db, env, { after: testId('aud') })).rejects.toThrow(
      InvalidCursorError,
    );
  });
});
