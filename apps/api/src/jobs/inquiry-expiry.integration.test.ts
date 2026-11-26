/**
 * The C10 `inquiry-expiry` job against Postgres 17 (Testcontainers): several runs at once take
 * disjoint batches (`FOR UPDATE SKIP LOCKED`), so every overdue inquiry and session is expired
 * exactly once, with its events written once.
 */
import { randomBytes } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { newId } from '@openverify/contracts';
import {
  createDatabase,
  createInquirySession,
  createKeyring,
  hashSessionToken,
  listEvents,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  startIntegrationPostgres,
} from '@openverify/db/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from '../webhooks/queue.js';
import { runInquiryExpiry } from './inquiry-expiry.js';
import { createCapturingLogger, createMemoryStorage, createRecordingQueue } from './testing.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');

let postgres: StartedPostgreSqlContainer | undefined;
let pool: Pool | undefined;
let db: Database;
let environmentId: string;

beforeAll(async () => {
  postgres = await startIntegrationPostgres();
  pool = createIntegrationPool(postgres.getConnectionUri(), { max: 12 });
  db = createDatabase(pool);
  setDefaultKeyring(createKeyring(randomBytes(32)));
  await runMigrations(db);
  environmentId = (await createTestTenant(db)).environment.id;
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await postgres?.stop();
  setDefaultKeyring(undefined);
});

function run(batchSize: number) {
  const logger = createCapturingLogger();
  const events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue<WebhookDeliveryJob>()),
    logger,
  });
  return runInquiryExpiry({
    db,
    storage: createMemoryStorage(),
    events,
    clock: { now: () => NOW },
    logger,
    batchSize,
  });
}

async function countEvents(name: string): Promise<number> {
  let count = 0;
  let after: string | undefined;
  for (;;) {
    const page = await listEvents(db, environmentId, { size: 100, after });
    count += page.items.filter((event) => event.name === name).length;
    if (page.next === null) {
      return count;
    }
    after = page.next;
  }
}

describe('runInquiryExpiry on Postgres', () => {
  it('expires every overdue inquiry and session exactly once across concurrent runs', async () => {
    const inquiries: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      const { inquiry } = await createTestInquiry(db, environmentId);
      inquiries.push(inquiry.id);
      await pool?.query('update inquiries set expires_at = $2 where id = $1', [
        inquiry.id,
        new Date(NOW.getTime() - (index + 1) * 1000),
      ]);
    }
    const open = (await createTestInquiry(db, environmentId)).inquiry.id;
    for (let index = 0; index < 12; index += 1) {
      await createInquirySession(db, environmentId, {
        id: newId('iqse'),
        inquiryId: open,
        tokenHash: hashSessionToken(randomBytes(16).toString('hex')),
        expiresAt: new Date(NOW.getTime() - 1000),
      });
    }

    const results = await Promise.all([run(4), run(4), run(4), run(4)]);

    const total = (key: 'expiredInquiries' | 'expiredSessions' | 'failedInquiries') =>
      results.reduce((sum, result) => sum + result[key], 0);
    expect(total('expiredInquiries')).toBe(30);
    expect(total('expiredSessions')).toBe(12);
    expect(total('failedInquiries')).toBe(0);
    const statuses = await pool?.query<{ status: string; count: number }>(
      'select status, count(*)::int as count from inquiries where id = any($1) group by status',
      [inquiries],
    );
    expect(statuses?.rows).toEqual([{ status: 'expired', count: 30 }]);
    expect(await countEvents('inquiry.expired')).toBe(30);
    expect(await countEvents('inquiry.transitioned')).toBe(30);
    expect(await countEvents('inquiry-session.expired')).toBe(12);
  });
});
