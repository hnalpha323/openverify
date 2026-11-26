/**
 * `pnpm --filter @openverify/api retention:run` (`scripts/retention-run.ts`): one C16 retention
 * run on demand, optionally evaluated as of another time (`--now`), which is how the e2e suite
 * runs the retention job with an injected clock. Vitest runs `src/**` tests, so the script's
 * tests live here. Every value is synthetic.
 */
import { newId } from '@openverify/contracts';
import {
  createAccount,
  createInquiry,
  createInquiryTemplate,
  getInquiry,
  transitionInquiryStatus,
  type Db,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RETENTION_BATCH_SIZE,
  parseRetentionRunArgs,
  RetentionRunUsageError,
  runRetentionCommand,
} from '../scripts/retention-run.js';
import { createEventPublisher } from './events/index.js';
import type { RedactionService } from './ports.js';
import { createRedactionService } from './services/redaction.js';
import { isRetentionIncomplete } from './services/retention.js';
import { createInMemoryFileStorage, type InMemoryFileStorage } from './storage/index.js';
import { fixedClock } from './test-support/fakes.js';
import { createWebhookDeliveryScheduler } from './webhooks/queue.js';

const DAY = 86_400_000;

describe('parseRetentionRunArgs', () => {
  it('runs as of now, in batches of 500, printing text by default', () => {
    expect(parseRetentionRunArgs([])).toEqual({
      now: null,
      batchSize: DEFAULT_RETENTION_BATCH_SIZE,
      json: false,
    });
    expect(DEFAULT_RETENTION_BATCH_SIZE).toBe(500);
  });

  it('reads --now, --batch-size and --json, with = or a separate value', () => {
    expect(
      parseRetentionRunArgs(['--now=2027-01-02T03:04:05Z', '--batch-size', '10', '--json']),
    ).toEqual({ now: new Date('2027-01-02T03:04:05.000Z'), batchSize: 10, json: true });
  });

  it.each([
    [['--now=yesterday'], '--now must be an ISO-8601 time such as 2027-01-01T00:00:00Z.'],
    [
      ['--now=2027-13-45T00:00:00Z'],
      '--now must be an ISO-8601 time such as 2027-01-01T00:00:00Z.',
    ],
    [['--now'], '--now needs a value.'],
    [['--batch-size=0'], '--batch-size must be 1 to 10000.'],
    [['--batch-size=1.5'], '--batch-size must be 1 to 10000.'],
    [['--wipe'], 'Unknown argument --wipe.'],
  ])('refuses %j', (argv, message) => {
    expect(() => parseRetentionRunArgs(argv)).toThrow(RetentionRunUsageError);
    expect(() => parseRetentionRunArgs(argv)).toThrow(message);
  });
});

describe('runRetentionCommand (C16)', () => {
  let database: TestDatabase;
  let db: Db;
  let storage: InMemoryFileStorage;
  let redaction: RedactionService;
  let lines: string[];
  const out = (line: string) => {
    lines.push(line);
  };

  beforeEach(async () => {
    database = await createTestDatabase();
    db = database.db;
    storage = createInMemoryFileStorage();
    lines = [];
    redaction = createRedactionService({
      db,
      storage,
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

  /** A completed inquiry, updated just now, whose template keeps inquiries for one day. */
  async function completedInquiry(): Promise<{ environmentId: string; id: string }> {
    const { environment } = await createTestTenant(db);
    const template = await createInquiryTemplate(db, environment.id, {
      id: newId('itmpl'),
      name: 'Synthetic one-day retention',
      version: {
        id: newId('itmplv'),
        flow: {},
        verificationConfig: {},
        settings: { 'retention-days': 1 },
      },
    });
    const account = await createAccount(db, environment.id, { id: newId('acc') });
    const inquiry = await createInquiry(db, environment.id, {
      id: newId('inq'),
      inquiryTemplateId: template.id,
      inquiryTemplateVersionId: template.currentVersion.id,
      accountId: account.id,
      fields: { name_first: 'Synthetic' },
    });
    await transitionInquiryStatus(db, environment.id, inquiry.id, {
      from: 'created',
      to: 'pending',
    });
    await transitionInquiryStatus(db, environment.id, inquiry.id, {
      from: 'pending',
      to: 'completed',
    });
    return { environmentId: environment.id, id: inquiry.id };
  }

  it('says the run is incomplete when an inquiry could not be redacted, for a failing exit code (2B F031)', async () => {
    await completedInquiry();
    const later = new Date(Date.now() + 2 * DAY);

    const report = await runRetentionCommand({
      db,
      storage,
      redaction: {
        redactInquiry: () => Promise.reject(new Error('synthetic failure')),
        redactAccount: () => Promise.reject(new Error('synthetic failure')),
        redactReport: () => Promise.reject(new Error('synthetic failure')),
        redactTransaction: () => Promise.reject(new Error('synthetic failure')),
        redactCase: () => Promise.reject(new Error('synthetic failure')),
      },
      args: { now: later, batchSize: 500, json: false },
      out,
    });

    expect(report.failedRedactions).toBe(1);
    expect(isRetentionIncomplete(report)).toBe(true);
    expect(lines).toContain(
      'retention:run: incomplete: 1 inquiries could not be redacted and 0 files could not be deleted',
    );
  });

  it('keeps an inquiry still inside its retention when run as of now', async () => {
    const inquiry = await completedInquiry();

    const report = await runRetentionCommand({
      db,
      storage,
      redaction,
      args: parseRetentionRunArgs([]),
      out,
    });

    expect(report.redactedInquiries).toBe(0);
    expect((await getInquiry(db, inquiry.environmentId, inquiry.id))?.redactedAt).toBeNull();
  });

  it('redacts it when evaluated as of a later time, stamping the real redaction time', async () => {
    const inquiry = await completedInquiry();
    const realNow = new Date();
    const later = new Date(realNow.getTime() + 2 * DAY);

    const report = await runRetentionCommand({
      db,
      storage,
      redaction,
      args: { now: later, batchSize: 10, json: false },
      out,
      clock: fixedClock(realNow),
    });

    expect(report.redactedInquiries).toBe(1);
    const stored = await getInquiry(db, inquiry.environmentId, inquiry.id);
    expect(stored?.redactedAt).not.toBeNull();
    expect(stored?.redactedAt?.getTime()).toBeLessThan(later.getTime());
    expect(lines[0]).toBe(`retention:run: as of ${later.toISOString()}`);
    expect(lines).toContain('retention:run: redactedInquiries 1');
    expect(lines.at(-1)).toBe('retention:run: done');
  });

  it('prints the report as one JSON line with --json, counts only', async () => {
    await completedInquiry();
    const later = new Date(Date.now() + 2 * DAY);

    await runRetentionCommand({
      db,
      storage,
      redaction,
      args: { now: later, batchSize: 500, json: true },
      out,
    });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      now: later.toISOString(),
      report: {
        redactedInquiries: 1,
        redactedListItems: 0,
        redactedTransactions: 0,
        failedTransactionRedactions: 0,
        purgedTransactionFiles: 0,
        redactedGraphQueries: 0,
        purgedWorkflowRunValues: 0,
        deletedWorkflowRunSkeletons: 0,
        expiredWorkflowDeliveries: 0,
        purgedWorkflowRunFiles: 0,
        redactedCases: 0,
        failedCaseRedactions: 0,
        deletedUserNotifications: 0,
        redactedBiometricAttachments: 0,
        purgedRenditionPages: 0,
        expiredCaseExports: 0,
        failedCaseExportDeletes: 0,
        failedRedactions: 0,
        redactedReports: 0,
        failedReportRedactions: 0,
        purgedFiles: 0,
        purgedImportObjects: 0,
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
        deletedAnalyticsRollupRows: 0,
        deletedAnalyticsAssigneeRows: 0,
        deletedAuditLogs: 0,
        expiredExports: 0,
        failedExportDeletes: 0,
        deletedReportBulkFiles: 0,
        failedReportBulkFileDeletes: 0,
      },
    });
  });
});
