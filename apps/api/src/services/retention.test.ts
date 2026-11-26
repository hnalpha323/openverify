/**
 * The C16 retention run against PGlite with an injected clock: terminal inquiries past their
 * retention are redacted, and API logs, webhook deliveries, idempotency keys and events past
 * their windows are deleted, in batches and idempotently. Every value is synthetic.
 */
import { createHash } from 'node:crypto';
import { newId, newOneTimeLinkToken, newUserSessionToken } from '@openverify/contracts';
import {
  apiLogs,
  claimIdempotencyKey,
  createAccount,
  createApiLog,
  createEvent,
  createInquiry,
  createInquirySession,
  createInquiryTemplate,
  createMfaChallenge,
  createOneTimeLink,
  createUser,
  createUserSession,
  createWebauthnRegistrationChallenge,
  createWebhook,
  createWebhookDelivery,
  createVerification,
  events,
  faceTemplates,
  getApiLog,
  getEvent,
  getInquirySession,
  getWebhookDelivery,
  hashSessionToken,
  idempotencyKeys,
  inquiries,
  inquirySessions,
  markInquirySessionStarted,
  mfaChallenges,
  oneTimeLinks,
  redactInquiryRecords,
  transitionInquiryStatus,
  updateEnvironmentSettings,
  userSessions,
  webauthnRegistrationChallenges,
  webhookDeliveries,
  writeFaceData,
  type Db,
  type EnvironmentSettings,
  type InquiryStatus,
  handoffTokens,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  openSessionSignalBodies,
  seedDevice,
  seedReport,
  seedReportTemplate,
  seedSessionSignalBody,
  type TestDatabase,
} from '@openverify/db/testing';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventPublisher } from '../events/index.js';
import type { FileStorage, RedactionService } from '../ports.js';
import { createInMemoryFileStorage, type InMemoryFileStorage } from '../storage/index.js';
import {
  createRecordingRedactionService,
  fixedClock,
  type TestClock,
} from '../test-support/fakes.js';
import { createWebhookDeliveryScheduler } from '../webhooks/queue.js';
import { createRedactionService, isInquiryRedacted } from './redaction.js';
import { seedPiiSubject } from './redaction.test-support.js';
import type { ExportRetentionReport } from './exports/retention.js';
import { isRetentionIncomplete, runRetention, type RetentionReport } from './retention.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

let database: TestDatabase;
let db: Db;
let storage: InMemoryFileStorage;
let clock: TestClock;
let redaction: RedactionService;
let logged: { level: string; object: Record<string, unknown>; message: string }[];

const logger = {
  info: (object: Record<string, unknown>, message: string) =>
    logged.push({ level: 'info', object, message }),
  warn: (object: Record<string, unknown>, message: string) =>
    logged.push({ level: 'warn', object, message }),
  error: (object: Record<string, unknown>, message: string) =>
    logged.push({ level: 'error', object, message }),
};

beforeEach(async () => {
  database = await createTestDatabase();
  db = database.db;
  storage = createInMemoryFileStorage();
  clock = fixedClock(NOW);
  logged = [];
  redaction = createRedactionService({
    db,
    storage,
    clock,
    events: createEventPublisher({
      db,
      deliveries: createWebhookDeliveryScheduler({
        add: () => Promise.resolve(),
        close: () => Promise.resolve(),
      }),
    }),
  });
});

afterEach(async () => {
  await database.close();
});

const run = (
  overrides: { batchSize?: number; redaction?: RedactionService; storage?: FileStorage } = {},
) => runRetention({ db, storage, clock, logger, redaction, ...overrides });

async function tenant(settings: EnvironmentSettings = {}) {
  const { environment } = await createTestTenant(db);
  await updateEnvironmentSettings(db, environment.id, settings);
  return environment.id;
}

const PATHS: Record<InquiryStatus, InquiryStatus[]> = {
  created: [],
  pending: ['pending'],
  completed: ['pending', 'completed'],
  failed: ['pending', 'failed'],
  expired: ['expired'],
  needs_review: ['pending', 'completed', 'needs_review'],
  approved: ['pending', 'completed', 'approved'],
  declined: ['pending', 'completed', 'declined'],
};

/** An inquiry in `status`, last updated `age` days before {@link NOW}. */
async function inquiryOf(
  environmentId: string,
  status: InquiryStatus,
  age: number,
  templateRetentionDays?: number,
): Promise<string> {
  const template = await createInquiryTemplate(db, environmentId, {
    id: newId('itmpl'),
    name: 'Synthetic template',
    version: {
      id: newId('itmplv'),
      flow: {},
      verificationConfig: {},
      ...(templateRetentionDays === undefined
        ? {}
        : { settings: { 'retention-days': templateRetentionDays } }),
    },
  });
  const account = await createAccount(db, environmentId, { id: newId('acc') });
  const inquiry = await createInquiry(db, environmentId, {
    id: newId('inq'),
    inquiryTemplateId: template.id,
    inquiryTemplateVersionId: template.currentVersion.id,
    accountId: account.id,
    fields: { name_first: 'Synthetic' },
  });
  let from: InquiryStatus = 'created';
  for (const to of PATHS[status]) {
    await transitionInquiryStatus(db, environmentId, inquiry.id, { from, to });
    from = to;
  }
  await db
    .update(inquiries)
    .set({ updatedAt: daysAgo(age) })
    .where(eq(inquiries.id, inquiry.id));
  return inquiry.id;
}

const redacted = (environmentId: string, id: string) => isInquiryRedacted(db, environmentId, id);

const EMPTY: RetentionReport & ExportRetentionReport = {
  redactedInquiries: 0,
  failedRedactions: 0,
  redactedReports: 0,
  failedReportRedactions: 0,
  purgedFiles: 0,
  failedPurges: 0,
  deletedApiLogs: 0,
  deletedWebhookDeliveries: 0,
  deletedIdempotencyKeys: 0,
  deletedEvents: 0,
  deletedUserSessions: 0,
  deletedOneTimeLinks: 0,
  deletedAuthChallenges: 0,
  deletedFaceTemplates: 0,
  deletedSelfieBackgrounds: 0,
  nulledSignalComponents: 0,
  nulledAddresses: 0,
  deletedDevices: 0,
  purgedWorkflowRunValues: 0,
  deletedWorkflowRunSkeletons: 0,
  expiredWorkflowDeliveries: 0,
  purgedWorkflowRunFiles: 0,
  redactedListItems: 0,
  purgedImportObjects: 0,
  redactedTransactions: 0,
  failedTransactionRedactions: 0,
  purgedTransactionFiles: 0,
  deletedHandoffTokens: 0,
  cleanedFlowRecordInquiries: 0,
  // C221.3 (Workflow 10B Stage 1b (I)).
  deletedIntegrityChallenges: 0,
  // C248.4 (Workflow 11B, sso-oidc): the SSO sign-in attempts a day past their expiry.
  deletedSsoLoginStates: 0,
  // Workflow 11A Stage 1b (K) (C241.3, C241.4): the Connect pass, a stub until api-consent's.
  deletedShareTokens: 0,
  deletedConsentRecords: 0,
  deletedConsentTexts: 0,
  // Workflow 11B Stage 1b (D) (C253.4): the access exports' pass, a stub until dsar-export's.
  expiredAccountExports: 0,
  cleanedIntegrityRecordInquiries: 0,
  redactedGraphQueries: 0,
  redactedCases: 0,
  failedCaseRedactions: 0,
  deletedUserNotifications: 0,
  redactedBiometricAttachments: 0,
  // Workflow 8B (F): the rendition pages purged and the export files expired.
  purgedRenditionPages: 0,
  expiredCaseExports: 0,
  failedCaseExportDeletes: 0,
  // Workflow 9B Stage 1b (A) (C163.6): the analytics steps, `api-analytics`'.
  deletedAnalyticsRollupRows: 0,
  deletedAnalyticsAssigneeRows: 0,
  // Workflow 9B Stage 1b (U) (C168.6): the audit-log step, `api-access`'.
  deletedAuditLogs: 0,
  // Workflow 9B Stage 1b (X) (C166.1, C166.5): the export files and bulk CSVs, `api-exports`'.
  expiredExports: 0,
  failedExportDeletes: 0,
  deletedReportBulkFiles: 0,
  failedReportBulkFileDeletes: 0,
};

describe('runRetention: inquiries (C16)', () => {
  it("redacts terminal inquiries older than the environment's inquiry-retention-days", async () => {
    const env = await tenant({ 'inquiry-retention-days': 30 });
    const old = await Promise.all(
      (['completed', 'failed', 'expired', 'approved', 'declined'] as const).map((status) =>
        inquiryOf(env, status, 31),
      ),
    );
    const recent = await inquiryOf(env, 'completed', 29);
    const open = await inquiryOf(env, 'pending', 400);
    const reviewing = await inquiryOf(env, 'needs_review', 400);

    const report = await run();

    expect(report).toEqual({ ...EMPTY, redactedInquiries: 5 });
    for (const id of old) {
      expect(await redacted(env, id)).toBe(true);
    }
    expect(await redacted(env, recent)).toBe(false);
    expect(await redacted(env, open)).toBe(false);
    expect(await redacted(env, reviewing)).toBe(false);
  });

  it('keeps inquiries forever when the environment sets no retention', async () => {
    const env = await tenant();
    const ancient = await inquiryOf(env, 'completed', 3650);

    expect((await run()).redactedInquiries).toBe(0);
    expect(await redacted(env, ancient)).toBe(false);
  });

  it("lets the template version's retention-days override the environment's", async () => {
    const forever = await tenant();
    const monthly = await tenant({ 'inquiry-retention-days': 30 });
    const overridden = await inquiryOf(forever, 'completed', 6, 5);
    const longer = await inquiryOf(monthly, 'completed', 60, 90);
    const shorter = await inquiryOf(monthly, 'approved', 10, 5);

    await run();

    expect(await redacted(forever, overridden)).toBe(true);
    expect(await redacted(monthly, longer)).toBe(false);
    expect(await redacted(monthly, shorter)).toBe(true);
  });

  it('redacts through the redaction service: PII, files and events go', async () => {
    const env = await tenant({ 'inquiry-retention-days': 1 });
    const subject = await seedPiiSubject({
      db,
      storage,
      keyring: database.keyring,
      environmentId: env,
    });
    await transitionInquiryStatus(db, env, subject.inquiryId, { from: 'created', to: 'expired' });
    await db
      .update(inquiries)
      .set({ updatedAt: daysAgo(2) })
      .where(eq(inquiries.id, subject.inquiryId));

    await run();

    expect(await redacted(env, subject.inquiryId)).toBe(true);
    for (const key of subject.storageKeys) {
      expect(await storage.get(key)).toBeNull();
    }
  });

  it('works in batches and is idempotent', async () => {
    const env = await tenant({ 'inquiry-retention-days': 1 });
    const ids = await Promise.all([1, 2, 3, 4, 5].map(() => inquiryOf(env, 'completed', 2)));

    expect((await run({ batchSize: 2 })).redactedInquiries).toBe(5);
    for (const id of ids) {
      expect(await redacted(env, id)).toBe(true);
    }
    expect(await run({ batchSize: 2 })).toEqual(EMPTY);
  });

  it('goes on past an inquiry whose redaction fails, and reports it', async () => {
    const env = await tenant({ 'inquiry-retention-days': 1 });
    const stuck = await inquiryOf(env, 'completed', 9);
    const others = await Promise.all([3, 2].map((age) => inquiryOf(env, 'completed', age)));
    const flaky: RedactionService = {
      redactInquiry: (ctx, id, actor) =>
        id === stuck
          ? Promise.reject(new Error('storage unavailable'))
          : redaction.redactInquiry(ctx, id, actor),
      redactAccount: (ctx, id, actor) => redaction.redactAccount(ctx, id, actor),
      redactReport: (ctx, id, actor) => redaction.redactReport(ctx, id, actor),
      redactTransaction: (ctx, id, actor) => redaction.redactTransaction(ctx, id, actor),
      redactCase: (ctx, id, actor) => redaction.redactCase(ctx, id, actor),
    };

    const report = await run({ batchSize: 1, redaction: flaky });

    expect(report).toMatchObject({ redactedInquiries: 2, failedRedactions: 1 });
    expect(await redacted(env, stuck)).toBe(false);
    for (const id of others) {
      expect(await redacted(env, id)).toBe(true);
    }
    expect(logged.filter((entry) => entry.level === 'warn')).toEqual([
      expect.objectContaining({ object: { inquiryId: stuck, environmentId: env, error: 'Error' } }),
    ]);
  });

  it('redacts with no actor (no audit entry) in the inquiry environment and organization', async () => {
    const { organization, environment } = await createTestTenant(db);
    await updateEnvironmentSettings(db, environment.id, { 'inquiry-retention-days': 1 });
    const id = await inquiryOf(environment.id, 'declined', 2);
    const calls: unknown[][] = [];
    const recording: RedactionService = {
      redactInquiry: (...args) => {
        calls.push(args);
        return redaction.redactInquiry(...args);
      },
      redactAccount: (...args) => redaction.redactAccount(...args),
      redactReport: (...args) => redaction.redactReport(...args),
      redactTransaction: (...args) => redaction.redactTransaction(...args),
      redactCase: (...args) => redaction.redactCase(...args),
    };

    await run({ redaction: recording });

    expect(calls).toEqual([
      [{ organizationId: organization.id, environmentId: environment.id }, id, null],
    ]);
  });
});

describe('runRetention: files left by failed redactions', () => {
  it('deletes the storage objects that redacted inquiries still have', async () => {
    const env = await tenant();
    const subject = await seedPiiSubject({
      db,
      storage,
      keyring: database.keyring,
      environmentId: env,
    });
    const failing = createRedactionService({
      db,
      clock,
      storage: { ...storage, delete: () => Promise.reject(new Error('storage unavailable')) },
      events: createEventPublisher({
        db,
        deliveries: createWebhookDeliveryScheduler({
          add: () => Promise.resolve(),
          close: () => Promise.resolve(),
        }),
      }),
    });
    await expect(
      failing.redactInquiry({ organizationId: 'org', environmentId: env }, subject.inquiryId, null),
    ).rejects.toThrow();

    expect((await run()).purgedFiles).toBe(2);
    for (const key of subject.storageKeys) {
      expect(await storage.get(key)).toBeNull();
    }
  });
});

describe('runRetention: logs, deliveries, idempotency keys and events (C16)', () => {
  async function apiLogAged(environmentId: string, age: number) {
    const log = await createApiLog(db, environmentId, {
      id: newId('alog'),
      method: 'GET',
      path: '/api/v1/inquiries',
      status: 200,
      durationMs: 1,
    });
    await db
      .update(apiLogs)
      .set({ createdAt: daysAgo(age) })
      .where(eq(apiLogs.id, log.id));
    return log.id;
  }

  async function eventAged(environmentId: string, age: number) {
    const event = await createEvent(db, environmentId, {
      id: newId('evt'),
      name: 'inquiry.completed',
      payload: { data: { type: 'inquiry', id: newId('inq'), attributes: {} } },
    });
    await db
      .update(events)
      .set({ createdAt: daysAgo(age) })
      .where(eq(events.id, event.id));
    return event.id;
  }

  async function deliveryAged(
    environmentId: string,
    webhookId: string,
    status: 'pending' | 'succeeded' | 'failed',
    age: number,
    eventAge = age,
  ) {
    const eventId = await eventAged(environmentId, eventAge);
    const delivery = await createWebhookDelivery(db, environmentId, {
      id: newId('whd'),
      webhookId,
      eventId,
    });
    if (delivery === null) {
      throw new Error('delivery not created');
    }
    await db
      .update(webhookDeliveries)
      .set({ status, createdAt: daysAgo(age) })
      .where(eq(webhookDeliveries.id, delivery.id));
    return { deliveryId: delivery.id, eventId };
  }

  it('deletes each record past its window and keeps the rest', async () => {
    const env = await tenant();
    const short = await tenant({
      'api-log-retention-days': 7,
      'webhook-delivery-retention-days': 7,
      'event-retention-days': 7,
    });
    const webhook = await createWebhook(db, env, {
      id: newId('wbh'),
      url: 'https://hooks.example.test/openverify',
      enabledEvents: ['*'],
      secret: `wbhsec_${'s'.repeat(43)}`,
    });
    const shortWebhook = await createWebhook(db, short, {
      id: newId('wbh'),
      url: 'https://hooks.example.test/openverify',
      enabledEvents: ['*'],
      secret: `wbhsec_${'t'.repeat(43)}`,
    });
    const oldLog = await apiLogAged(env, 31);
    const keptLog = await apiLogAged(env, 29);
    const shortLog = await apiLogAged(short, 8);
    const oldDelivery = await deliveryAged(env, webhook.id, 'succeeded', 31, 10);
    const keptDelivery = await deliveryAged(env, webhook.id, 'failed', 29);
    const pendingDelivery = await deliveryAged(env, webhook.id, 'pending', 120);
    const shortDelivery = await deliveryAged(short, shortWebhook.id, 'failed', 8, 1);
    const oldEvent = await eventAged(env, 91);
    const keptEvent = await eventAged(env, 89);
    const shortEvent = await eventAged(short, 8);
    const expiredKey = await claimIdempotencyKey(db, env, {
      principalType: 'api_key',
      principalId: newId('key'),
      key: 'expired',
      fingerprint: 'a'.repeat(64),
      now: daysAgo(2),
    });
    const liveKey = await claimIdempotencyKey(db, env, {
      principalType: 'api_key',
      principalId: newId('key'),
      key: 'live',
      fingerprint: 'b'.repeat(64),
      now: new Date(NOW.getTime() - 3_600_000),
    });

    const report = await run();

    expect(report).toEqual({
      ...EMPTY,
      deletedApiLogs: 2,
      deletedWebhookDeliveries: 2,
      deletedIdempotencyKeys: 1,
      deletedEvents: 2,
    });
    expect(await getApiLog(db, env, oldLog)).toBeNull();
    expect(await getApiLog(db, env, keptLog)).not.toBeNull();
    expect(await getApiLog(db, short, shortLog)).toBeNull();
    expect(await getWebhookDelivery(db, env, oldDelivery.deliveryId)).toBeNull();
    expect(await getWebhookDelivery(db, env, keptDelivery.deliveryId)).not.toBeNull();
    expect(await getWebhookDelivery(db, env, pendingDelivery.deliveryId)).not.toBeNull();
    expect(await getEvent(db, env, pendingDelivery.eventId)).not.toBeNull();
    expect(await getWebhookDelivery(db, short, shortDelivery.deliveryId)).toBeNull();
    expect(await getEvent(db, env, oldEvent)).toBeNull();
    expect(await getEvent(db, env, keptEvent)).not.toBeNull();
    expect(await getEvent(db, short, shortEvent)).toBeNull();
    const keys = await db.select({ key: idempotencyKeys.key }).from(idempotencyKeys);
    expect(keys.map((row) => row.key)).toEqual(['live']);
    expect(expiredKey.outcome).toBe('claimed');
    expect(liveKey.outcome).toBe('claimed');
  });

  /** A sealed template and its background row, created `age` days ago, of a selfie of `inquiryId`. */
  async function faceDataAged(environmentId: string, inquiryId: string, age: number) {
    const verificationId = newId('ver');
    await createVerification(db, environmentId, { id: verificationId, inquiryId, type: 'selfie' });
    const { templateId } = await writeFaceData(db, environmentId, {
      verificationId,
      inquiryId,
      model: 'sface-2021dec',
      // A synthetic unit vector: 128 equal values.
      embedding: Array.from({ length: 128 }, () => 1 / Math.sqrt(128)),
      background: {
        layout: Array.from({ length: 144 }, () => 50),
        validCells: '1'.repeat(48),
        coverage: 1,
      },
    });
    await db
      .update(faceTemplates)
      .set({ createdAt: daysAgo(age) })
      .where(eq(faceTemplates.id, templateId));
    return templateId;
  }

  async function templateIds() {
    return (await db.select({ id: faceTemplates.id }).from(faceTemplates)).map((row) => row.id);
  }

  it("deletes face templates and their backgrounds past face-template-retention-days, whatever the inquiry's retention (C42.6)", async () => {
    const env = await tenant();
    const strict = await tenant({ 'face-template-retention-days': 30 });
    // Kept forever by inquiry retention, and still pending: only the template setting applies.
    const open = await inquiryOf(env, 'pending', 0);
    const strictOpen = await inquiryOf(strict, 'completed', 0);
    const expired = await faceDataAged(env, open, 366);
    const kept = await faceDataAged(env, open, 300);
    const strictExpired = await faceDataAged(strict, strictOpen, 31);
    const strictKept = await faceDataAged(strict, strictOpen, 29);

    const report = await run();

    expect(report).toEqual({ ...EMPTY, deletedFaceTemplates: 2, deletedSelfieBackgrounds: 2 });
    const left = await templateIds();
    expect(left).toContain(kept);
    expect(left).toContain(strictKept);
    expect(left).not.toContain(expired);
    expect(left).not.toContain(strictExpired);
    expect(await run()).toEqual(EMPTY);
  });

  it('deletes user sessions and one-time links 30 days past their expiry (2B F022)', async () => {
    const { organization, environment } = await createTestTenant(db);
    const env = environment.id;
    const user = await createUser(db, {
      id: newId('usr'),
      organizationId: organization.id,
      email: `retention-${newId('usr').slice(-8).toLowerCase()}@example.test`,
      passwordHash: '$argon2id$fake$unused',
    });
    const session = (expiresAt: Date) =>
      createUserSession(db, {
        id: newId('uss'),
        organizationId: organization.id,
        userId: user.id,
        environmentId: env,
        tokenHash: hashSessionToken(newUserSessionToken()),
        expiresAt,
      });
    const link = async (expiresAt: Date) =>
      (
        await createOneTimeLink(db, env, {
          inquiryId: await inquiryOf(env, 'pending', 0),
          tokenHash: hashSessionToken(newOneTimeLinkToken()),
          expiresAt,
          at: new Date(expiresAt.getTime() - 3_600_000),
        })
      ).link.id;
    const oldSession = await session(daysAgo(31));
    const keptSessions = [await session(daysAgo(29)), await session(new Date(NOW.getTime() + DAY))];
    const oldLink = await link(daysAgo(31));
    const keptLinks = [await link(daysAgo(29)), await link(new Date(NOW.getTime() + DAY))];

    const report = await run();

    expect(report).toMatchObject({ deletedUserSessions: 1, deletedOneTimeLinks: 1 });
    const sessions = await db.select({ id: userSessions.id }).from(userSessions);
    expect(sessions.map((row) => row.id).sort()).toEqual(keptSessions.map((row) => row.id).sort());
    const links = await db.select({ id: oneTimeLinks.id }).from(oneTimeLinks);
    expect(links.map((row) => row.id)).not.toContain(oldLink);
    expect(links.map((row) => row.id).sort()).toEqual([...keptLinks].sort());
    expect(oldSession.id).toMatch(/^uss_/);
  });

  it('deletes integrity challenges a day past their expiry, and the records a redacted inquiry still holds (C221.3)', async () => {
    const env = await tenant();
    const inquiryId = await inquiryOf(env, 'pending', 0);
    const redacted = await inquiryOf(env, 'pending', 0);
    const sessionOf = async (inquiry: string) => {
      const id = newId('iqse');
      await db.execute(
        sql`insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at)
            values (${id}, ${env}, ${inquiry}, ${createHash('sha256').update(id).digest('hex')},
              ${NOW})`,
      );
      return id;
    };
    const challenge = async (inquiry: string, session: string, expiresAt: Date) => {
      const id = newId('ich');
      await db.execute(
        sql`insert into inquiry_integrity_challenges (id, environment_id, inquiry_id, session_id,
              request_hash, created_at, expires_at)
            values (${id}, ${env}, ${inquiry}, ${session}, ${'A'.repeat(43)},
              ${new Date(expiresAt.getTime() - 600_000)}, ${expiresAt})`,
      );
      return id;
    };
    const session = await sessionOf(inquiryId);
    const old = await challenge(inquiryId, session, new Date(NOW.getTime() - 25 * 3_600_000));
    const kept = await challenge(inquiryId, session, new Date(NOW.getTime() - 23 * 3_600_000));
    // A redacted inquiry's challenge and verdict, as a race with its redaction would leave them.
    await challenge(redacted, await sessionOf(redacted), new Date(NOW.getTime() + 600_000));
    await db.execute(
      sql`insert into inquiry_integrity_verdicts (environment_id, inquiry_id, provider, verdict,
            decoded_at)
          values (${env}, ${redacted}, 'sandbox', 'ov1.synthetic', ${NOW})`,
    );
    await db.execute(sql`update inquiries set redacted_at = ${NOW} where id = ${redacted}`);

    const report = await run();

    expect(report).toMatchObject({
      deletedIntegrityChallenges: 1,
      cleanedIntegrityRecordInquiries: 1,
    });
    const left = await database.client.query<{ id: string }>(
      'select id from inquiry_integrity_challenges where environment_id = $1',
      [env],
    );
    expect(left.rows.map((row) => row.id)).toEqual([kept]);
    expect(old).not.toBe(kept);
    const verdicts = await database.client.query(
      'select inquiry_id from inquiry_integrity_verdicts where environment_id = $1',
      [env],
    );
    expect(verdicts.rows).toEqual([]);
  });

  it('deletes handoff tokens 30 days past their expiry and keeps the younger ones (C96.2, P27)', async () => {
    const env = await tenant();
    const inquiryId = await inquiryOf(env, 'pending', 0);
    const sessionId = newId('iqse');
    await db.execute(
      sql`insert into inquiry_sessions (id, environment_id, inquiry_id, token_hash, expires_at)
          values (${sessionId}, ${env}, ${inquiryId}, ${'f'.repeat(64)}, ${NOW})`,
    );
    const token = async (expiresAt: Date) => {
      const id = newId('hnd');
      await db.execute(
        sql`insert into handoff_tokens (id, environment_id, inquiry_id, issuing_session_id,
              step_id, method, token_hash, expires_at, revoked_at)
            values (${id}, ${env}, ${inquiryId}, ${sessionId}, 'device_handoff', 'qr',
              ${createHash('sha256').update(id).digest('hex')}, ${expiresAt}, ${expiresAt})`,
      );
      return id;
    };
    const old = await token(daysAgo(31));
    const kept = [await token(daysAgo(29)), await token(daysAgo(1))];

    const report = await run();

    expect(report.deletedHandoffTokens).toBe(1);
    const left = await db
      .select({ id: handoffTokens.id })
      .from(handoffTokens)
      .where(eq(handoffTokens.inquiryId, inquiryId));
    expect(left.map((row) => row.id)).not.toContain(old);
    expect(left.map((row) => row.id).sort()).toEqual([...kept].sort());
  });

  it('deletes expired MFA login and WebAuthn registration challenges (2B F032)', async () => {
    const { organization } = await createTestTenant(db);
    const user = await createUser(db, {
      id: newId('usr'),
      organizationId: organization.id,
      email: `challenges-${newId('usr').slice(-8).toLowerCase()}@example.test`,
      passwordHash: '$argon2id$fake$unused',
    });
    const challenge = (expiresAt: Date) =>
      createMfaChallenge(db, organization.id, {
        userId: user.id,
        tokenHash: hashSessionToken(newUserSessionToken()),
        expiresAt,
      });
    const registration = (expiresAt: Date) =>
      createWebauthnRegistrationChallenge(db, organization.id, {
        userId: user.id,
        challengeHash: hashSessionToken(newUserSessionToken()),
        expiresAt,
      });
    await challenge(daysAgo(1));
    const live = await challenge(new Date(NOW.getTime() + 300_000));
    await registration(daysAgo(1));
    await registration(new Date(NOW.getTime() + 300_000));

    const report = await run();

    expect(report).toMatchObject({ deletedAuthChallenges: 2 });
    const left = await db.select({ id: mfaChallenges.id }).from(mfaChallenges);
    expect(left.map((row) => row.id)).toEqual([live.id]);
    expect(await db.$count(webauthnRegistrationChallenges)).toBe(1);
  });

  it('counts the files of redacted inquiries that storage could not delete (2B F031)', async () => {
    const env = await tenant();
    const subject = await seedPiiSubject({
      db,
      storage,
      keyring: database.keyring,
      environmentId: env,
    });
    await redactInquiryRecords(db, env, subject.inquiryId);

    const report = await run({
      storage: { ...storage, delete: () => Promise.reject(new Error('storage unavailable')) },
    });

    expect(report).toMatchObject({ purgedFiles: 0, failedPurges: 2 });
    expect(isRetentionIncomplete(report)).toBe(true);
    expect(isRetentionIncomplete(await run())).toBe(false);
  });

  it('deletes in batches until nothing is left', async () => {
    const env = await tenant();
    for (let index = 0; index < 5; index += 1) {
      await apiLogAged(env, 40);
      await eventAged(env, 100);
    }

    const report = await run({ batchSize: 2 });

    expect(report).toMatchObject({ deletedApiLogs: 5, deletedEvents: 5 });
    expect(await run({ batchSize: 2 })).toEqual(EMPTY);
  });

  it('logs a summary of counts, never data', async () => {
    const env = await tenant();
    await apiLogAged(env, 40);

    await run();

    expect(logged).toEqual([
      {
        level: 'info',
        message: 'retention run finished',
        object: { ...EMPTY, deletedApiLogs: 1 },
      },
    ]);
  });

  it('uses the injected clock', async () => {
    const env = await tenant();
    const log = await apiLogAged(env, 10);

    clock.set(new Date(NOW.getTime() + 25 * DAY));
    await run();

    expect(await getApiLog(db, env, log)).toBeNull();
  });
});

describe('the report retention step (C73.6, P14)', () => {
  const DAY = 86_400_000;

  async function reportsIn(settings: EnvironmentSettings) {
    const env = await tenant(settings);
    const template = await seedReportTemplate(db, env);
    const report = (ageDays: number, redactedAt: Date | null = null) =>
      seedReport(db, env, {
        ...template,
        createdAt: new Date(NOW.getTime() - ageDays * DAY),
        ...(redactedAt === null ? {} : { query: null, redactedAt }),
      });
    return { env, report };
  }

  it('redacts each report past report-retention-days through the redaction service', async () => {
    const recording = createRecordingRedactionService(clock);
    const { env, report } = await reportsIn({ 'report-retention-days': 30 });
    const old = await report(40);
    await report(10);
    await report(50, NOW);
    const kept = await reportsIn({});
    await kept.report(400);

    const result = await run({ redaction: recording });

    expect(recording.redactions.filter((call) => call.target === 'report')).toEqual([
      expect.objectContaining({ target: 'report', id: old, actor: null }),
    ]);
    expect(recording.redactions.find((call) => call.id === old)?.ctx.environmentId).toBe(env);
    expect(result).toMatchObject({ redactedReports: 1, failedReportRedactions: 0 });
  });

  it('goes on past a report whose redaction fails, and reports the run incomplete', async () => {
    const { report } = await reportsIn({ 'report-retention-days': 1 });
    await report(5);
    await report(6);
    const failing: RedactionService = {
      ...createRecordingRedactionService(clock),
      redactReport: () => Promise.reject(new Error('synthetic failure')),
    };

    const result = await run({ redaction: failing });

    expect(result).toMatchObject({ redactedReports: 0, failedReportRedactions: 2 });
    expect(isRetentionIncomplete(result)).toBe(true);
  });
});

describe('runRetention: the Workflow 7A signal steps (C91.7, P19)', () => {
  /** A started session of a new inquiry, from 203.0.113.80, created `age` days before NOW. */
  async function sessionOf(environmentId: string, age: number) {
    const template = await createInquiryTemplate(db, environmentId, {
      id: newId('itmpl'),
      name: 'Synthetic signals',
      version: { id: newId('itmplv'), flow: {}, verificationConfig: {} },
    });
    const inquiry = await createInquiry(db, environmentId, {
      id: newId('inq'),
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.currentVersion.id,
      referenceId: null,
    });
    const session = await createInquirySession(db, environmentId, {
      id: newId('iqse'),
      inquiryId: inquiry.id,
      tokenHash: hashSessionToken(newId('iqse')),
      expiresAt: NOW,
    });
    await markInquirySessionStarted(db, environmentId, session.id, {
      ip: '203.0.113.80',
      userAgent: 'Synthetic/1.0',
    });
    await db
      .update(inquirySessions)
      .set({ createdAt: daysAgo(age) })
      .where(eq(inquirySessions.id, session.id));
    return session.id;
  }

  it('nulls old collector components and addresses, and deletes unseen devices, each by its window', async () => {
    const env = await tenant({ 'ip-retention-days': 10, 'device-retention-days': 20 });
    const old = await sessionOf(env, 11);
    const recent = await sessionOf(env, 9);
    await seedSessionSignalBody(db, env, { inquirySessionId: old, createdAt: daysAgo(31) });
    await seedSessionSignalBody(db, env, { inquirySessionId: recent, createdAt: daysAgo(29) });
    await seedDevice(db, env, { lastSeenAt: daysAgo(21), sessionIds: [old] });
    await seedDevice(db, env, { lastSeenAt: daysAgo(19), sessionIds: [recent] });

    const report = await run();

    expect(report).toEqual({
      ...EMPTY,
      nulledSignalComponents: 1,
      nulledAddresses: 1,
      deletedDevices: 1,
      redactedListItems: 0,
      purgedImportObjects: 0,
      redactedTransactions: 0,
      failedTransactionRedactions: 0,
      purgedTransactionFiles: 0,
    });
    expect(await getInquirySession(db, env, old)).toMatchObject({ ip: null });
    expect(await getInquirySession(db, env, recent)).toMatchObject({ ip: '203.0.113.80' });
    expect((await openSessionSignalBodies(db, env, old))[0]?.components).toBeNull();
    expect((await openSessionSignalBodies(db, env, recent))[0]?.components).not.toBeNull();
    expect(await run()).toEqual(EMPTY);
  });
});
