/** C16 retention: batch selectors and deleters, with environment and template windows. */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, createTestTenant, testId, type TestDatabase } from '../testing.js';
import {
  claimIdempotencyKey,
  createApiLog,
  createDraftInquiryTemplateVersion,
  createEvent,
  createInquiry,
  createInquiryTemplate,
  createMfaChallenge,
  createUser,
  createWebauthnRegistrationChallenge,
  createWebhook,
  createWebhookDelivery,
  DEFAULT_RETENTION,
  deleteExpiredApiLogs,
  deleteExpiredAuthChallenges,
  deleteExpiredEvents,
  deleteExpiredIdempotencyKeys,
  deleteExpiredWebhookDeliveries,
  getEvent,
  listInquiriesDueForRetention,
  publishInquiryTemplateVersion,
  recordWebhookDeliveryAttempt,
  resolveRetentionSettings,
  updateEnvironmentSettings,
} from './index.js';
import { hashSessionToken } from '../tokens.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const NOW = new Date('2027-01-01T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

/** Sets created_at and updated_at directly; the updated_at trigger keeps an explicit value. */
async function age(table: string, id: string | number, at: Date, column = 'created_at') {
  await database.db.execute(
    sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = ${at.toISOString()}::timestamptz,
          updated_at = ${at.toISOString()}::timestamptz where id = ${id}`,
  );
}

describe('retention settings', () => {
  it('apply the C16 defaults in code', () => {
    expect(DEFAULT_RETENTION).toEqual({
      'inquiry-retention-days': null,
      'api-log-retention-days': 30,
      'webhook-delivery-retention-days': 30,
      'event-retention-days': 90,
    });
    expect(resolveRetentionSettings({ 'event-retention-days': 7 })).toEqual({
      ...DEFAULT_RETENTION,
      'event-retention-days': 7,
    });
  });
});

describe('inquiries due for retention', () => {
  it('select terminal, unredacted inquiries older than their window, the template overriding the environment', async () => {
    const { environment } = await createTestTenant(database.db);
    const env = environment.id;
    await updateEnvironmentSettings(database.db, env, { 'inquiry-retention-days': 30 });
    const template = await createInquiryTemplate(database.db, env, {
      id: testId('itmpl'),
      name: 'KYC',
      version: { id: testId('itmplv'), flow: {}, verificationConfig: {} },
    });
    const short = await createDraftInquiryTemplateVersion(database.db, env, template.id, {
      id: testId('itmplv'),
      flow: {},
      verificationConfig: {},
      settings: { 'retention-days': 5 },
    });
    await publishInquiryTemplateVersion(database.db, env, short?.id ?? '');
    const inquiry = async (versionId: string, status: string, updatedDaysAgo: number) => {
      const created = await createInquiry(database.db, env, {
        id: testId('inq'),
        inquiryTemplateId: template.id,
        inquiryTemplateVersionId: versionId,
      });
      await database.db.execute(
        sql`update inquiries set status = ${status}::inquiry_status, updated_at = ${daysAgo(updatedDaysAgo).toISOString()}::timestamptz where id = ${created.id}`,
      );
      return created.id;
    };
    const oldCompleted = await inquiry(template.currentVersion.id, 'completed', 40);
    await inquiry(template.currentVersion.id, 'completed', 10);
    await inquiry(template.currentVersion.id, 'pending', 400);
    await inquiry(template.currentVersion.id, 'needs_review', 400);
    const shortWindow = await inquiry(short?.id ?? '', 'declined', 6);
    const redacted = await inquiry(template.currentVersion.id, 'approved', 400);
    await database.db.execute(sql`update inquiries set redacted_at = now() where id = ${redacted}`);
    const forever = (await createTestTenant(database.db)).environment.id;
    const keptTemplate = await createInquiryTemplate(database.db, forever, {
      id: testId('itmpl'),
      name: 'Kept',
      version: { id: testId('itmplv'), flow: {}, verificationConfig: {} },
    });
    const kept = await createInquiry(database.db, forever, {
      id: testId('inq'),
      inquiryTemplateId: keptTemplate.id,
      inquiryTemplateVersionId: keptTemplate.currentVersion.id,
    });
    await database.db.execute(
      sql`update inquiries set status = 'expired', updated_at = ${daysAgo(4000).toISOString()}::timestamptz where id = ${kept.id}`,
    );

    const due = await listInquiriesDueForRetention(database.db, { now: NOW });
    const locked = await database.db.transaction((tx) =>
      listInquiriesDueForRetention(tx, { now: NOW, limit: 1, lock: true }),
    );

    expect(due.map((row) => row.id).sort()).toEqual([oldCompleted, shortWindow].sort());
    expect(due.every((row) => row.environmentId === env)).toBe(true);
    expect(locked).toHaveLength(1);
  });
});

describe('deleting expired records', () => {
  it('deletes API logs past the environment window, in batches', async () => {
    const { environment } = await createTestTenant(database.db);
    const env = environment.id;
    await updateEnvironmentSettings(database.db, env, { 'api-log-retention-days': 7 });
    const log = async (days: number) => {
      const entry = await createApiLog(database.db, env, {
        id: testId('alog'),
        method: 'GET',
        path: '/api/v1/inquiries',
        route: '/api/v1/inquiries',
        status: 200,
        durationMs: 1,
      });
      await age('api_logs', entry.id, daysAgo(days));
      return entry.id;
    };
    await log(8);
    await log(9);
    await log(6);

    expect(await deleteExpiredApiLogs(database.db, { now: NOW, limit: 1 })).toBe(1);
    expect(await deleteExpiredApiLogs(database.db, { now: NOW })).toBe(1);
    expect(await deleteExpiredApiLogs(database.db, { now: NOW })).toBe(0);
  });

  it('deletes finished webhook deliveries and old events, keeping events a pending delivery needs', async () => {
    const { environment } = await createTestTenant(database.db);
    const env = environment.id;
    const webhook = await createWebhook(database.db, env, {
      id: testId('wbh'),
      url: 'https://hooks.example.test/r',
      enabledEvents: ['*'],
      secret: 'wbhsec_synthetic_retention_abcd',
    });
    const event = async (days: number) => {
      const created = await createEvent(database.db, env, {
        id: testId('evt'),
        name: 'inquiry.created',
        payload: {},
      });
      await age('events', created.id, daysAgo(days));
      return created.id;
    };
    const delivery = async (eventId: string, days: number, finished: boolean) => {
      const created = await createWebhookDelivery(database.db, env, {
        id: testId('whd'),
        webhookId: webhook.id,
        eventId,
      });
      if (finished) {
        await recordWebhookDeliveryAttempt(database.db, env, created?.id ?? '', {
          outcome: 'succeeded',
          attemptedAt: NOW,
        });
      }
      await age('webhook_deliveries', created?.id ?? '', daysAgo(days));
      return created?.id ?? '';
    };
    const oldEvent = await event(100);
    const pendingEvent = await event(100);
    const recentEvent = await event(10);
    await delivery(oldEvent, 40, true);
    await delivery(pendingEvent, 40, false);
    await delivery(recentEvent, 10, true);

    expect(await deleteExpiredWebhookDeliveries(database.db, { now: NOW })).toBe(1);
    expect(await deleteExpiredEvents(database.db, { now: NOW })).toBe(1);
    expect(await getEvent(database.db, env, oldEvent)).toBeNull();
    expect(await getEvent(database.db, env, pendingEvent)).not.toBeNull();
    expect(await getEvent(database.db, env, recentEvent)).not.toBeNull();
  });

  it('deletes expired idempotency keys and authentication challenges', async () => {
    const { organization, environment } = await createTestTenant(database.db);
    await claimIdempotencyKey(database.db, environment.id, {
      principalType: 'api_key',
      principalId: testId('key'),
      key: 'old',
      fingerprint: 'a'.repeat(64),
      now: daysAgo(2),
    });
    await claimIdempotencyKey(database.db, environment.id, {
      principalType: 'api_key',
      principalId: testId('key'),
      key: 'fresh',
      fingerprint: 'a'.repeat(64),
      now: NOW,
    });
    const user = await createUser(database.db, {
      id: testId('usr'),
      organizationId: organization.id,
      email: `${testId('usr').toLowerCase()}@example.test`,
      passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
    });
    await createMfaChallenge(database.db, organization.id, {
      userId: user.id,
      tokenHash: hashSessionToken('ovm_old'),
      expiresAt: daysAgo(1),
    });
    await createWebauthnRegistrationChallenge(database.db, organization.id, {
      userId: user.id,
      challengeHash: hashSessionToken('old-registration'),
      expiresAt: daysAgo(1),
    });
    await createMfaChallenge(database.db, organization.id, {
      userId: user.id,
      tokenHash: hashSessionToken('ovm_new'),
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    expect(await deleteExpiredIdempotencyKeys(database.db, { now: NOW })).toBe(1);
    expect(await deleteExpiredAuthChallenges(database.db, { now: NOW })).toBe(2);
  });
});
