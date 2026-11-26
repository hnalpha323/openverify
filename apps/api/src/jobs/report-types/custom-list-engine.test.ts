/**
 * C106.2: a custom-list run through the framework: persisted, served and re-run, on the hooks of
 * persist.ts and resources.ts. Synthetic values.
 */
import { reportResourceSchema, newId } from '@openverify/contracts';
import {
  createList,
  createReport,
  getReport,
  insertListItems,
  archiveListItem,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  seedReportTemplate,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { PHASE6_DEFAULTS } from '../../config.js';
import { newListItem } from '../../services/lists/keys.js';
import { reportResourceOf } from '../../services/reports/reports.js';
import { createRecordingEventPublisher, fixedClock } from '../../test-support/fakes.js';
import { createWorkerLogger } from '../logger.js';
import { createReportRunProcessor, type ReportRunProcessorDeps } from '../reports/run.js';

let database: TestDatabase;
let environmentId: string;
const key = new Uint8Array(32).fill(0x3d);
const clock = fixedClock();

beforeAll(async () => {
  database = await createTestDatabase();
  environmentId = (await createTestTenant(database.db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
});

const deps = (): ReportRunProcessorDeps => ({
  db: database.db,
  clock,
  logger: createWorkerLogger({ level: 'silent' }),
  events: createRecordingEventPublisher(),
  keyring: database.keyring,
  blindIndexKey: key,
  watchlists: {
    sourcesDisabled: [],
    refresh: false,
    removedRetentionDays: 90,
    euFsfToken: null,
    wikidataUserAgent: null,
    wikidataSparqlUrl: PHASE6_DEFAULTS.wikidataSparqlUrl,
    pep: {
      openTenureMaxYears: 20,
      includeRelatives: false,
      retentionMonths: 12,
      headRetentionMonths: 60,
    },
  },
  limits: { perMinute: 600, maxRecurringPerEnvironment: 250_000, maxMediaRunsPerDay: 8_640 },
});

async function listOf(value: string) {
  const list = await createList(database.db, environmentId, {
    id: newId('lst'),
    type: 'email-address',
    name: 'Synthetic blocked emails',
  });
  const item = newListItem(key, environmentId, list, {
    id: newId('liea'),
    value: { value, 'match-type': 'email_address' },
    creator: { type: 'api-key', id: newId('key') },
  });
  await insertListItems(database.db, environmentId, list.id, [item]);
  return { list, itemId: item.id };
}

async function runOnce(reportId: string, runId: string) {
  await createReportRunProcessor()({ environmentId, reportId, runId }, deps(), {
    lastAttempt: false,
  });
  const stored = await getReport(database.db, environmentId, reportId);
  if (stored === null) {
    throw new Error('gone');
  }
  return reportResourceSchema.parse(await reportResourceOf(database.db, stored, UNMASKED));
}

describe('a custom-list run through the framework (C106.2)', () => {
  it('stores list provenance, serves matched-lists, and passes the contract', async () => {
    const { list, itemId } = await listOf('listed@example.com');
    const { templateId, versionId } = await seedReportTemplate(database.db, environmentId, {
      reportType: 'custom-list',
      config: { 'list-ids': [list.id] },
    });
    const runId = testId('rpr');
    const report = await createReport(database.db, environmentId, {
      id: testId('rep'),
      reportType: 'custom-list',
      reportTemplateId: templateId,
      reportTemplateVersionId: versionId,
      origin: 'api',
      query: { 'email-address': 'listed@example.com' },
      querySources: { 'email-address': 'request' },
      inquiryId: null,
      accountId: null,
      recurrenceIntervalDays: null,
      nextRunAt: null,
      createdAt: clock.now(),
      initialRun: { id: runId, scheduledFor: clock.now() },
    });

    const served = await runOnce(report.id, runId);

    expect(served.attributes).toMatchObject({
      status: 'ready',
      'has-match': true,
      'lists-searched': [list.id],
      sources: [{ 'list-id': list.id, version: 2, 'normaliser-version': 'lists-1' }],
      'matched-lists': [
        {
          'list-id': list.id,
          'list-type': 'list/email-address',
          items: [
            {
              'list-item': { type: 'list-item/email-address', id: itemId },
              method: 'exact',
              score: null,
              'matched-value': 'listed@example.com',
            },
          ],
        },
      ],
      matches: [{ 'source-id': list.id, 'match-types': ['identifier_exact'] }],
    });
    await archiveListItem(database.db, environmentId, itemId, new Date());
  });
});
