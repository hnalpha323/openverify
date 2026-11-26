/** C14 webhooks: status, API version, custom headers, filters, blocklist, rotation, replay. */
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
import {
  createEvent,
  createWebhook,
  createWebhookDelivery,
  getWebhook,
  getWebhookDeliveryWithEvent,
  getWebhookDispatchConfig,
  getWebhookSigningSecret,
  listReplayableEvents,
  listWebhookDeliveries,
  listWebhooksForEvent,
  lockWebhook,
  recordWebhookDeliveryAttempt,
  rotateWebhookSecret,
  updateWebhook,
  type NewWebhookInput,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

async function setup() {
  const env = (await createTestTenant(database.db)).environment.id;
  const webhook = (overrides: Partial<NewWebhookInput> = {}) =>
    createWebhook(database.db, env, {
      id: testId('wbh'),
      url: 'https://hooks.example.test/c14',
      enabledEvents: ['*'],
      secret: 'wbhsec_synthetic_current_abcd',
      ...overrides,
    });
  const event = (name = 'inquiry.created', createdAt?: Date) =>
    createEvent(database.db, env, {
      id: testId('evt'),
      name,
      payload: { data: { type: 'inquiry', id: testId('inq') } },
    }).then(async (created) => {
      if (createdAt !== undefined) {
        await database.db.execute(
          sql`update events set created_at = ${createdAt.toISOString()}::timestamptz where id = ${created.id}`,
        );
      }
      return created;
    });
  return { env, webhook, event };
}

describe('webhook configuration (C14)', () => {
  it('stores the API version, filters, blocklist and sealed custom headers, showing header names only', async () => {
    const { env, webhook } = await setup();

    const created = await webhook({
      apiVersion: '2026-10-01',
      customHeaders: { 'X-Customer-Auth': 'synthetic-header-value', 'X-Trace': 'abc' },
      filters: { 'inquiry-template-ids': ['itmpl_A'] },
      attributeBlocklist: ['fields', 'name-first'],
    });
    const raw = await database.db.execute(
      sql`select custom_headers from webhooks where id = ${created.id}`,
    );

    expect(created).toMatchObject({
      apiVersion: '2026-10-01',
      customHeaderNames: ['X-Customer-Auth', 'X-Trace'],
      filters: { 'inquiry-template-ids': ['itmpl_A'] },
      attributeBlocklist: ['fields', 'name-first'],
      previousSecretExpiresAt: null,
    });
    expect(JSON.stringify(created)).not.toContain('synthetic-header-value');
    expect(JSON.stringify(raw.rows)).not.toContain('synthetic-header-value');
    expect(await getWebhook(database.db, env, created.id)).toEqual(created);
  });

  it('updates the C14 attributes, archives, and can lock the row', async () => {
    const { env, webhook } = await setup();
    const created = await webhook({ customHeaders: { 'X-A': '1' } });

    const updated = await updateWebhook(database.db, env, created.id, {
      apiVersion: '2026-10-01',
      customHeaders: null,
      filters: { 'account-type-ids': ['acctp_A'] },
      attributeBlocklist: ['fields'],
      status: 'archived',
    });
    const locked = await database.db.transaction((tx) => lockWebhook(tx, env, created.id));

    expect(updated).toMatchObject({
      customHeaderNames: [],
      filters: { 'account-type-ids': ['acctp_A'] },
      attributeBlocklist: ['fields'],
      status: 'archived',
    });
    expect(locked).toEqual(updated);
    expect(await lockWebhook(database.db, testId('env'), created.id)).toBeNull();
  });

  it('rotates the secret, signing with both while the previous one is valid', async () => {
    const { env, webhook } = await setup();
    const created = await webhook();
    const now = new Date('2026-10-20T10:00:00.000Z');

    const rotated = await rotateWebhookSecret(database.db, env, created.id, {
      secret: 'wbhsec_synthetic_rotated_wxyz',
      previousSecretExpiresAt: new Date(now.getTime() + 86_400_000),
    });
    const during = await getWebhookDispatchConfig(database.db, env, created.id, now);
    const after = await getWebhookDispatchConfig(
      database.db,
      env,
      created.id,
      new Date(now.getTime() + 2 * 86_400_000),
    );
    const dropped = await rotateWebhookSecret(database.db, env, created.id, {
      secret: 'wbhsec_synthetic_third_mnop',
      previousSecretExpiresAt: null,
    });

    expect(rotated).toMatchObject({ secretLast4: 'wxyz' });
    expect(during?.secrets).toEqual([
      'wbhsec_synthetic_rotated_wxyz',
      'wbhsec_synthetic_current_abcd',
    ]);
    expect(after?.secrets).toEqual(['wbhsec_synthetic_rotated_wxyz']);
    expect(dropped?.previousSecretExpiresAt).toBeNull();
    expect(await getWebhookSigningSecret(database.db, env, created.id)).toBe(
      'wbhsec_synthetic_third_mnop',
    );
    expect(
      await rotateWebhookSecret(database.db, testId('env'), created.id, {
        secret: 'x',
        previousSecretExpiresAt: null,
      }),
    ).toBeNull();
  });

  it('gives the dispatcher the URL, version, headers and blocklist', async () => {
    const { env, webhook } = await setup();
    const created = await webhook({
      customHeaders: { 'X-A': '1' },
      attributeBlocklist: ['fields'],
    });

    expect(await getWebhookDispatchConfig(database.db, env, created.id)).toEqual({
      webhook: created,
      secrets: ['wbhsec_synthetic_current_abcd'],
      customHeaders: { 'X-A': '1' },
    });
    expect(await getWebhookDispatchConfig(database.db, testId('env'), created.id)).toBeNull();
  });
});

describe('webhook selection with C14 filters', () => {
  it('delivers only to enabled webhooks whose present filters all match the subject', async () => {
    onTestFinished(wallClockStepsBack());
    const { env, webhook } = await setup();
    const clock = createdAtClock(database.db);
    const open = await clock.stamp('webhooks', await webhook());
    const byTemplate = await clock.stamp(
      'webhooks',
      await webhook({
        filters: { 'inquiry-template-ids': ['itmpl_A', 'itmpl_B'] },
      }),
    );
    const byBoth = await clock.stamp(
      'webhooks',
      await webhook({
        filters: { 'inquiry-template-ids': ['itmpl_A'], 'account-type-ids': ['acctp_U'] },
      }),
    );
    await webhook({ status: 'disabled' });
    const archived = await webhook();
    await updateWebhook(database.db, env, archived.id, { status: 'archived' });
    const ids = async (subject?: Parameters<typeof listWebhooksForEvent>[3]) =>
      (await listWebhooksForEvent(database.db, env, 'inquiry.created', subject)).map(
        (hook) => hook.id,
      );

    expect(await ids()).toEqual([open.id, byTemplate.id, byBoth.id]);
    expect(await ids({ inquiryTemplateId: 'itmpl_B' })).toEqual([open.id, byTemplate.id]);
    expect(await ids({ inquiryTemplateId: 'itmpl_A', accountTypeId: 'acctp_U' })).toEqual([
      open.id,
      byTemplate.id,
      byBoth.id,
    ]);
    expect(await ids({ inquiryTemplateId: 'itmpl_A', accountTypeId: 'acctp_X' })).toEqual([
      open.id,
      byTemplate.id,
    ]);
  });
});

describe('webhook deliveries (C14)', () => {
  it('lists deliveries with their event name, filtered by webhook, event and status', async () => {
    onTestFinished(wallClockStepsBack());
    const { env, webhook, event } = await setup();
    const hook = await webhook();
    const other = await webhook();
    const first = await event('inquiry.created');
    const second = await event('inquiry.approved');
    const clock = createdAtClock(database.db);
    const d1 = await createWebhookDelivery(database.db, env, {
      id: testId('whd'),
      webhookId: hook.id,
      eventId: first.id,
    });
    await clock.at('webhook_deliveries', d1?.id ?? '');
    const d2 = await createWebhookDelivery(database.db, env, {
      id: testId('whd'),
      webhookId: hook.id,
      eventId: second.id,
    });
    await clock.at('webhook_deliveries', d2?.id ?? '');
    const d3 = await createWebhookDelivery(database.db, env, {
      id: testId('whd'),
      webhookId: other.id,
      eventId: first.id,
    });
    await clock.at('webhook_deliveries', d3?.id ?? '');
    await recordWebhookDeliveryAttempt(database.db, env, d1?.id ?? '', {
      outcome: 'failed',
      attemptedAt: new Date(),
      responseStatus: 500,
    });
    const ids = async (options: Parameters<typeof listWebhookDeliveries>[2]) =>
      (await listWebhookDeliveries(database.db, env, options)).items.map((delivery) => delivery.id);

    expect(await ids({})).toEqual([d3?.id, d2?.id, d1?.id]);
    expect(await ids({ webhookId: hook.id })).toEqual([d2?.id, d1?.id]);
    expect(await ids({ eventId: first.id })).toEqual([d3?.id, d1?.id]);
    expect(await ids({ status: 'failed' })).toEqual([d1?.id]);
    expect(await ids({ status: [] })).toEqual([]);
    expect(await getWebhookDeliveryWithEvent(database.db, env, d2?.id ?? '')).toMatchObject({
      eventName: 'inquiry.approved',
      maxAttempts: 8,
      isReplay: false,
    });
    await expect(listWebhookDeliveries(database.db, env, { after: testId('whd') })).rejects.toThrow(
      InvalidCursorError,
    );
  });

  it('records the first attempt time once, for the C14 schedule', async () => {
    const { env, webhook, event } = await setup();
    const hook = await webhook();
    const delivery = await createWebhookDelivery(database.db, env, {
      id: testId('whd'),
      webhookId: hook.id,
      eventId: (await event()).id,
    });
    const first = new Date('2026-10-20T10:00:00.000Z');

    await recordWebhookDeliveryAttempt(database.db, env, delivery?.id ?? '', {
      outcome: 'retry',
      attemptedAt: first,
      nextAttemptAt: new Date(first.getTime() + 60_000),
    });
    const second = await recordWebhookDeliveryAttempt(database.db, env, delivery?.id ?? '', {
      outcome: 'succeeded',
      attemptedAt: new Date(first.getTime() + 60_000),
    });

    expect(second).toMatchObject({ firstAttemptedAt: first, attemptCount: 2, status: 'succeeded' });
  });

  it('records a numbered attempt only once, so a duplicate worker cannot count it twice (2B F021)', async () => {
    const { env, webhook, event } = await setup();
    const hook = await webhook();
    const delivery = await createWebhookDelivery(database.db, env, {
      id: testId('whd'),
      webhookId: hook.id,
      eventId: (await event()).id,
    });
    const at = new Date('2026-10-20T10:00:00.000Z');
    const retry = {
      attempt: 1,
      outcome: 'retry' as const,
      attemptedAt: at,
      nextAttemptAt: new Date(at.getTime() + 60_000),
    };

    const first = await recordWebhookDeliveryAttempt(database.db, env, delivery?.id ?? '', retry);
    const duplicate = await recordWebhookDeliveryAttempt(
      database.db,
      env,
      delivery?.id ?? '',
      retry,
    );

    expect(first).toMatchObject({ attemptCount: 1, status: 'pending' });
    expect(duplicate).toBeNull();
    expect(
      await recordWebhookDeliveryAttempt(database.db, env, delivery?.id ?? '', {
        ...retry,
        attempt: 2,
      }),
    ).toMatchObject({ attemptCount: 2 });
  });

  it('creates replays next to the original delivery, and selects events to replay', async () => {
    const { env, webhook, event } = await setup();
    const hook = await webhook({ enabledEvents: ['inquiry.created'] });
    const delivered = await event('inquiry.created', new Date('2026-10-01T00:00:00.000Z'));
    const failed = await event('inquiry.created', new Date('2026-10-02T00:00:00.000Z'));
    const unsubscribed = await event('inquiry.approved', new Date('2026-10-03T00:00:00.000Z'));
    const original = await createWebhookDelivery(database.db, env, {
      id: testId('whd'),
      webhookId: hook.id,
      eventId: delivered.id,
    });
    const failing = await createWebhookDelivery(database.db, env, {
      id: testId('whd'),
      webhookId: hook.id,
      eventId: failed.id,
    });
    await recordWebhookDeliveryAttempt(database.db, env, failing?.id ?? '', {
      outcome: 'failed',
      attemptedAt: new Date(),
    });

    const replay = await createWebhookDelivery(database.db, env, {
      id: testId('whd'),
      webhookId: hook.id,
      eventId: delivered.id,
      isReplay: true,
    });
    const duplicate = await createWebhookDelivery(database.db, env, {
      id: testId('whd'),
      webhookId: hook.id,
      eventId: delivered.id,
    });
    const range = {
      createdAtStart: new Date('2026-09-30T00:00:00.000Z'),
      createdAtEnd: new Date('2026-10-05T00:00:00.000Z'),
    };

    expect(original).not.toBeNull();
    expect(replay).toMatchObject({ isReplay: true, status: 'pending' });
    expect(duplicate).toBeNull();
    expect((await listReplayableEvents(database.db, env, hook.id, range)).map((e) => e.id)).toEqual(
      [delivered.id, failed.id],
    );
    expect(
      (await listReplayableEvents(database.db, env, hook.id, { ...range, onlyFailed: true })).map(
        (e) => e.id,
      ),
    ).toEqual([failed.id]);
    expect(
      (
        await listReplayableEvents(database.db, env, hook.id, {
          eventIds: [unsubscribed.id, failed.id],
        })
      ).map((e) => e.id),
    ).toEqual([failed.id]);
    expect(await listReplayableEvents(database.db, env, hook.id, { eventIds: [] })).toEqual([]);
    expect(await listReplayableEvents(database.db, testId('env'), hook.id, range)).toEqual([]);
  });
});
