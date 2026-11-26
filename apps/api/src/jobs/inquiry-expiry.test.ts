import { randomBytes } from 'node:crypto';
import { eventPayloadSchema, newId } from '@openverify/contracts';
import {
  createAccount,
  createInquiry,
  createInquirySession,
  createOneTimeLink,
  createVerification,
  DEFAULT_SWEEP_LIMIT,
  getInquiry,
  getInquirySession,
  getVerification,
  hashSessionToken,
  listEvents,
  listOverdueInquiries,
  transitionInquiryStatus,
  type Db,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import { createRecordingEventPublisher } from '../test-support/fakes.js';
import { createWebhookDeliveryScheduler, type WebhookDeliveryJob } from '../webhooks/queue.js';
import {
  INQUIRY_EXPIRY_INTERVAL_MS,
  INQUIRY_EXPIRY_QUEUE,
  runInquiryExpiry,
  type InquiryExpiryDeps,
} from './inquiry-expiry.js';
import { createCapturingLogger, createMemoryStorage, createRecordingQueue } from './testing.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const MINUTE = 60_000;

let database: TestDatabase;
let db: Db;
let environmentId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  db = database.db;
  environmentId = (await createTestTenant(db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

function deps(overrides: Partial<InquiryExpiryDeps> = {}) {
  const logger = createCapturingLogger();
  const events = createEventPublisher({
    db,
    deliveries: createWebhookDeliveryScheduler(createRecordingQueue<WebhookDeliveryJob>()),
    logger,
  });
  return {
    db,
    storage: createMemoryStorage(),
    events,
    clock: { now: () => NOW },
    logger,
    ...overrides,
  };
}

/** An inquiry in `status` whose `expires_at` is `expiresAt`. */
async function inquiry(expiresAt: Date, status: 'created' | 'pending' | 'completed' = 'created') {
  const { inquiry: row } = await createTestInquiry(db, environmentId);
  await database.client.query('update inquiries set expires_at = $2 where id = $1', [
    row.id,
    expiresAt,
  ]);
  if (status !== 'created') {
    await transitionInquiryStatus(db, environmentId, row.id, { from: 'created', to: 'pending' });
  }
  if (status === 'completed') {
    await transitionInquiryStatus(db, environmentId, row.id, {
      from: 'pending',
      to: 'completed',
    });
  }
  return row.id;
}

async function session(inquiryId: string, expiresAt: Date) {
  const id = newId('iqse');
  await createInquirySession(db, environmentId, {
    id,
    inquiryId,
    tokenHash: hashSessionToken(randomBytes(16).toString('hex')),
    expiresAt,
  });
  return id;
}

/** Event names about `resourceId`, oldest first, with their payload meta. */
async function eventsAbout(resourceId: string) {
  const page = await listEvents(db, environmentId, { size: 100 });
  return page.items
    .map((event) => ({ name: event.name, payload: eventPayloadSchema.parse(event.payload) }))
    .filter((event) => event.payload.data.id === resourceId)
    .reverse();
}

const statusOf = async (id: string) => (await getInquiry(db, environmentId, id))?.status;

describe('runInquiryExpiry (C10 inquiry-expiry)', () => {
  it('runs every 60 seconds on its own queue', () => {
    expect(INQUIRY_EXPIRY_QUEUE).toBe('inquiry-expiry');
    expect(INQUIRY_EXPIRY_INTERVAL_MS).toBe(60_000);
  });

  it('expires overdue created and pending inquiries with the effects of the expire action', async () => {
    const created = await inquiry(new Date(NOW.getTime() - MINUTE));
    const pending = await inquiry(NOW, 'pending');
    const sessionId = await session(pending, new Date(NOW.getTime() + 60 * MINUTE));
    const verificationId = newId('ver');
    await createVerification(db, environmentId, {
      id: verificationId,
      inquiryId: pending,
      type: 'selfie',
    });
    await createOneTimeLink(db, environmentId, {
      inquiryId: created,
      tokenHash: hashSessionToken('synthetic-one-time-token'),
      expiresAt: new Date(NOW.getTime() + MINUTE),
    });

    const result = await runInquiryExpiry(deps());

    expect(result).toEqual({ expiredInquiries: 2, expiredSessions: 0, failedInquiries: 0 });
    expect(await statusOf(created)).toBe('expired');
    expect(await statusOf(pending)).toBe('expired');
    expect((await getInquiry(db, environmentId, pending))?.expiredAt).toEqual(NOW);
    // Events of one transaction share their creation time, so their order is not fixed.
    const pendingEvents = await eventsAbout(pending);
    expect(pendingEvents.map((event) => event.name).sort()).toEqual([
      'inquiry.expired',
      'inquiry.transitioned',
    ]);
    expect(
      pendingEvents.find((event) => event.name === 'inquiry.transitioned')?.payload.meta,
    ).toEqual({ from: 'pending', to: 'expired' });
    expect(await getInquirySession(db, environmentId, sessionId)).toMatchObject({
      status: 'canceled',
    });
    expect((await eventsAbout(sessionId)).map((event) => event.name)).toEqual([
      'inquiry-session.canceled',
    ]);
    expect((await getVerification(db, environmentId, verificationId))?.status).toBe('canceled');
    expect((await eventsAbout(verificationId)).map((event) => event.name)).toEqual([
      'verification.canceled',
    ]);
    const { rows } = await database.client.query<{ revoked: boolean }>(
      'select revoked_at is not null as revoked from one_time_links where inquiry_id = $1',
      [created],
    );
    expect(rows).toEqual([{ revoked: true }]);
  });

  it('leaves inquiries that are not due yet or no longer open', async () => {
    const later = await inquiry(new Date(NOW.getTime() + MINUTE));
    const completed = await inquiry(new Date(NOW.getTime() - MINUTE), 'completed');

    expect(await runInquiryExpiry(deps())).toEqual({
      expiredInquiries: 0,
      expiredSessions: 0,
      failedInquiries: 0,
    });
    expect(await statusOf(later)).toBe('created');
    expect(await statusOf(completed)).toBe('completed');
  });

  it('expires the active sessions past their TTL with inquiry-session.expired', async () => {
    const open = await inquiry(new Date(NOW.getTime() + 60 * MINUTE));
    const overdue = await session(open, NOW);
    const current = await session(open, new Date(NOW.getTime() + MINUTE));

    expect(await runInquiryExpiry(deps())).toEqual({
      expiredInquiries: 0,
      expiredSessions: 1,
      failedInquiries: 0,
    });
    expect(await getInquirySession(db, environmentId, overdue)).toMatchObject({
      status: 'expired',
      expiredAt: NOW,
    });
    expect((await getInquirySession(db, environmentId, current))?.status).toBe('active');
    const [expired] = await eventsAbout(overdue);
    expect(expired).toMatchObject({
      name: 'inquiry-session.expired',
      payload: { data: { type: 'inquiry-session', attributes: { status: 'expired' } } },
    });
    expect(await statusOf(open)).toBe('created');
  });

  it('works through every overdue inquiry in batches', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      ids.push(await inquiry(new Date(NOW.getTime() - (index + 1) * MINUTE)));
    }

    expect(await runInquiryExpiry(deps({ batchSize: 2 }))).toMatchObject({
      expiredInquiries: 5,
    });
    for (const id of ids) {
      expect(await statusOf(id)).toBe('expired');
    }
  });

  it('skips an inquiry it cannot expire, logs its id only, and expires the others', async () => {
    const broken = await inquiry(new Date(NOW.getTime() - 2 * MINUTE));
    // Fields the contract refuses: the resource for its events cannot be built.
    await database.client.query(`update inquiries set reference_id = $2 where id = $1`, [
      broken,
      'x'.repeat(300),
    ]);
    const fine = await inquiry(new Date(NOW.getTime() - MINUTE));
    const logger = createCapturingLogger();

    const result = await runInquiryExpiry(deps({ logger }));

    expect(result).toEqual({ expiredInquiries: 1, expiredSessions: 0, failedInquiries: 1 });
    expect(await statusOf(broken)).toBe('created');
    expect(await statusOf(fine)).toBe('expired');
    expect(logger.entries).toContainEqual({
      level: 'error',
      object: { inquiryId: broken, environmentId, error: 'ZodError' },
      message: 'inquiry could not be expired',
    });
    expect(JSON.stringify(logger.entries)).not.toContain('x'.repeat(300));
    await database.client.query(`update inquiries set reference_id = null where id = $1`, [broken]);
  });

  it('expires a full batch + 1 of redacted overdue inquiries and the ordinary ones beside them in one run (owner decision 5 after Workflow 6C)', async () => {
    // A batch of a few rows proves what a batch of DEFAULT_SWEEP_LIMIT (the default) would: the
    // redacted ones fill the first batch, and the run must still go on to the rows behind them.
    // With the default batch the run expired 503 inquiries one savepoint each, which crossed the
    // test's 120 s under the full validation's load (Workflow 8D V8C-1).
    const batchSize = 4;
    expect(DEFAULT_SWEEP_LIMIT).toBeGreaterThan(batchSize);
    // Every inquiry already overdue leaves the sweep's selection first, so the run below counts
    // only the inquiries made here.
    await runInquiryExpiry(deps());
    const { inquiry: first } = await createTestInquiry(db, environmentId);
    const account = await createAccount(db, environmentId, { id: newId('acc') });
    const make = (expiresAt: Date) =>
      createInquiry(db, environmentId, {
        id: newId('inq'),
        inquiryTemplateId: first.inquiryTemplateId,
        inquiryTemplateVersionId: first.inquiryTemplateVersionId,
        accountId: account.id,
        fields: { name_first: 'Avery' },
        expiresAt,
      });
    // The redacted ones expired first, so a sweep that could not expire them would meet only them
    // in its first batch and stop there, leaving every inquiry behind them for good.
    const redacted: string[] = [];
    for (let index = 0; index <= batchSize; index += 1) {
      redacted.push((await make(new Date(NOW.getTime() - 60 * MINUTE - index * 1_000))).id);
    }
    const ordinary = [
      (await make(new Date(NOW.getTime() - 2 * MINUTE))).id,
      (await make(new Date(NOW.getTime() - MINUTE))).id,
    ];
    // Half of each are pending, half created. The redacted ones are stamped as
    // `redactInquiryRecords` stamps the row, the one column the transition and the sweep read
    // (`redaction-race.integration.test.ts` stamps it the same way).
    const pending = [...redacted, ...ordinary].filter((_, index) => index % 2 === 0);
    await database.client.query(`update inquiries set status = 'pending' where id = any($1)`, [
      pending,
    ]);
    await database.client.query('update inquiries set redacted_at = $2 where id = any($1)', [
      redacted,
      new Date(NOW.getTime() - 90 * MINUTE),
    ]);
    const events = createRecordingEventPublisher();

    const result = await runInquiryExpiry(deps({ events, batchSize }));

    expect(result).toEqual({
      expiredInquiries: batchSize + 3,
      expiredSessions: 0,
      failedInquiries: 0,
    });
    const { rows } = await database.client.query<{ status: string; count: string }>(
      'select status, count(*)::text as count from inquiries where id = any($1) group by status',
      [[...redacted, ...ordinary]],
    );
    expect(rows).toEqual([{ status: 'expired', count: String(batchSize + 3) }]);
    expect(events.named('inquiry.expired')).toHaveLength(batchSize + 3);
    expect(await listOverdueInquiries(db, { now: NOW })).toEqual([]);
  });
});
