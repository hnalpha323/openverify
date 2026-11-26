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
import { createApiLog, getApiLog, listApiLogs, type NewApiLogInput } from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

async function setup() {
  const env = (await createTestTenant(database.db)).environment.id;
  const apiKeyId = testId('key');
  const log = (overrides: Partial<NewApiLogInput> = {}) =>
    createApiLog(database.db, env, {
      id: testId('alog'),
      method: 'POST',
      path: '/api/v1/inquiries',
      route: '/api/v1/inquiries',
      status: 201,
      durationMs: 12,
      requestId: 'req-1',
      apiKeyId,
      ip: '203.0.113.10',
      userAgent: 'SyntheticClient/1.0',
      query: { include: 'verifications' },
      requestBody: { data: { attributes: { fields: { 'name-first': 'Jane' } } } },
      responseBody: { data: { id: 'inq_X' } },
      ...overrides,
    });
  return { env, apiKeyId, log };
}

describe('API logs (C12)', () => {
  it('store the request with its PII sealed for the row', async () => {
    const { env, log } = await setup();

    const entry = await log({ idempotencyKey: 'order-1', resourceId: 'inq_X' });
    const raw = await database.db.execute(sql`select * from api_logs where id = ${entry.id}`);

    expect(entry).toMatchObject({
      method: 'POST',
      status: 201,
      ip: '203.0.113.10',
      userAgent: 'SyntheticClient/1.0',
      query: { include: 'verifications' },
      requestBody: { data: { attributes: { fields: { 'name-first': 'Jane' } } } },
      responseBody: { data: { id: 'inq_X' } },
      idempotencyKey: 'order-1',
      resourceId: 'inq_X',
    });
    expect(JSON.stringify(raw.rows)).not.toContain('Jane');
    expect(JSON.stringify(raw.rows)).not.toContain('203.0.113.10');
    expect(await getApiLog(database.db, env, entry.id)).toEqual(entry);
    expect(await getApiLog(database.db, testId('env'), entry.id)).toBeNull();
  });

  it('keep absent bodies as null', async () => {
    const { log } = await setup();

    const entry = await log({
      ip: null,
      userAgent: null,
      query: null,
      requestBody: null,
      responseBody: null,
    });

    expect(entry).toMatchObject({
      ip: null,
      userAgent: null,
      query: null,
      requestBody: null,
      responseBody: null,
    });
  });

  it('filter by method, status or status class, route, API key and time', async () => {
    onTestFinished(wallClockStepsBack());
    const { env, apiKeyId, log } = await setup();
    const clock = createdAtClock(database.db);
    const created = await log();
    await clock.at('api_logs', created.id);
    const notFound = await log({
      method: 'GET',
      path: '/api/v1/inquiries/inq_Y',
      route: '/api/v1/inquiries/:id',
      status: 404,
    });
    await clock.at('api_logs', notFound.id);
    const failed = await log({ method: 'GET', status: 503, apiKeyId: null, userId: testId('usr') });
    await clock.at('api_logs', failed.id);
    const ids = async (options: Parameters<typeof listApiLogs>[2]) =>
      (await listApiLogs(database.db, env, options)).items.map((entry) => entry.id);

    expect(await ids({})).toEqual([failed.id, notFound.id, created.id]);
    expect(await ids({ method: 'GET' })).toEqual([failed.id, notFound.id]);
    expect(await ids({ status: '4xx' })).toEqual([notFound.id]);
    expect(await ids({ status: ['201', '5xx'] })).toEqual([failed.id, created.id]);
    expect(await ids({ route: '/api/v1/inquiries/:id' })).toEqual([notFound.id]);
    expect(await ids({ apiKeyId })).toEqual([notFound.id, created.id]);
    expect(await ids({ createdAtStart: new Date(Date.now() + 60_000) })).toEqual([]);
    expect(await ids({ createdAtEnd: new Date(Date.now() + 60_000), size: 1 })).toEqual([
      failed.id,
    ]);
    expect(await ids({ method: [] })).toEqual([]);
    await expect(listApiLogs(database.db, env, { status: 'teapot' })).rejects.toThrow(RangeError);
    await expect(listApiLogs(database.db, env, { after: testId('alog') })).rejects.toThrow(
      InvalidCursorError,
    );
  });
});

describe('API logs by user (C25.9, Workflow 2E)', () => {
  it('filter by the users whose sessions made the requests, with the other filters', async () => {
    onTestFinished(wallClockStepsBack());
    const { env, log } = await setup();
    const clock = createdAtClock(database.db);
    const userId = testId('usr');
    const otherUserId = testId('usr');
    const stamped = async (written: Promise<{ id: string }>) => {
      const entry = await written;
      await clock.at('api_logs', entry.id);
      return entry;
    };
    const byKey = await stamped(log());
    const byUser = await stamped(log({ apiKeyId: null, userId }));
    const failedByUser = await stamped(log({ apiKeyId: null, userId, status: 404 }));
    const byOtherUser = await stamped(log({ apiKeyId: null, userId: otherUserId }));
    const ids = async (options: Parameters<typeof listApiLogs>[2]) =>
      (await listApiLogs(database.db, env, options)).items.map((entry) => entry.id);

    expect(await ids({ userId })).toEqual([failedByUser.id, byUser.id]);
    expect(await ids({ userId: [userId, otherUserId] })).toEqual([
      byOtherUser.id,
      failedByUser.id,
      byUser.id,
    ]);
    expect(await ids({ userId, status: '4xx' })).toEqual([failedByUser.id]);
    expect(await ids({ userId, size: 1 })).toEqual([failedByUser.id]);
    expect(await ids({ userId: testId('usr') })).toEqual([]);
    expect(await ids({ userId: [] })).toEqual([]);
    expect(await ids({})).toContain(byKey.id);
  });

  it('stay inside the environment', async () => {
    const { log } = await setup();
    const other = await setup();
    const userId = testId('usr');
    await log({ apiKeyId: null, userId });
    await other.log({ apiKeyId: null, userId: testId('usr') });

    expect((await listApiLogs(database.db, other.env, { userId })).items).toEqual([]);
  });
});
