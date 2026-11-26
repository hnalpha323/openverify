/**
 * C74.1, C75.8, C84.2, C84.3 (Workflow 6A Stage 3, `api-reports`): the run framework: claims,
 * the match state machine applied to a run's findings, the report's columns and events, waits,
 * releases, final failures, the claim cap, lost claims, redaction during a run, the completion
 * report's account link and `on-report-match`, and `pause-on-match`. The type jobs are fakes; the
 * real ones have their own tests. Synthetic values only.
 */
import {
  createAccount,
  createReport,
  getReport,
  getReportRun,
  listReportMatches,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedReportTemplate,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PHASE6_DEFAULTS } from '../../config.js';
import { useWatchlistReads } from '../../services/reports/reports.js';
import {
  createInMemoryWatchlists,
  createRecordingEventPublisher,
  fixedClock,
  type RecordingEventPublisher,
  type TestClock,
} from '../../test-support/fakes.js';
import { createWorkerLogger } from '../logger.js';
import {
  ReportTypeNotBuiltError,
  type FoundReportMatch,
  type ReportRunResult,
  type RunOutcome,
} from '../report-types/index.js';
import { createReportRunProcessor, type ReportRunProcessorDeps } from './run.js';

let database: TestDatabase;
let environmentId: string;
let events: RecordingEventPublisher;
let clock: TestClock;
let restore: () => void;
const reads = createInMemoryWatchlists();
const BLIND_INDEX_KEY = new Uint8Array(32).fill(0x2c);

const SOURCE = {
  sourceId: 'openverify-sandbox',
  syncId: '1',
  publishedAt: new Date('2026-01-01T00:00:00.000Z'),
  checkedAt: new Date('2026-10-20T00:00:00.000Z'),
  sha256: 'a'.repeat(64),
  origin: 'import' as const,
  attribution: 'Synthetic attribution',
};

beforeAll(async () => {
  database = await createTestDatabase();
  environmentId = (await createTestTenant(database.db)).environment.id;
  restore = useWatchlistReads(reads);
}, 60_000);

afterAll(async () => {
  restore();
  await database.close();
});

beforeEach(() => {
  events = createRecordingEventPublisher();
  clock = fixedClock();
  reads.entries.length = 0;
});

function deps(): ReportRunProcessorDeps {
  return {
    db: database.db,
    clock,
    logger: createWorkerLogger({ level: 'silent' }),
    events,
    keyring: database.keyring,
    blindIndexKey: BLIND_INDEX_KEY,
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
    limits: {
      perMinute: 600,
      maxRecurringPerEnvironment: 250_000,
      maxMediaRunsPerDay: 8_640,
    },
  };
}

interface NewReport {
  type?: 'watchlist' | 'adverse-media';
  config?: Record<string, unknown>;
  origin?: 'api' | 'inquiry_completion';
  inquiryId?: string | null;
  recurrence?: number | null;
}

async function newReport(options: NewReport = {}) {
  const type = options.type ?? 'watchlist';
  const { templateId, versionId } = await seedReportTemplate(database.db, environmentId, {
    reportType: type,
    config: {
      ...(type === 'watchlist' ? { 'search-lists': ['openverify-sandbox'] } : {}),
      ...options.config,
    },
  });
  const runId = testId('rpr');
  const report = await createReport(database.db, environmentId, {
    id: testId('rep'),
    reportType: type,
    reportTemplateId: templateId,
    reportTemplateVersionId: versionId,
    origin: options.origin ?? 'api',
    query: { 'name-first': 'Avery', 'name-last': 'Synthetic' },
    querySources: { 'name-first': 'request', 'name-last': 'request' },
    inquiryId: options.inquiryId ?? null,
    accountId: null,
    recurrenceIntervalDays: options.recurrence ?? null,
    nextRunAt:
      options.recurrence == null
        ? null
        : new Date(clock.now().getTime() + options.recurrence * 86_400_000),
    createdAt: clock.now(),
    initialRun: { id: runId, scheduledFor: clock.now() },
  });
  return { reportId: report.id, runId, job: { environmentId, reportId: report.id, runId } };
}

function found(entryId: string, overrides: Partial<FoundReportMatch> = {}): FoundReportMatch {
  return {
    sourceId: 'openverify-sandbox',
    entryKey: `openverify-sandbox:${entryId}`,
    contentHash: 'c1',
    riskDataHash: 'r1',
    matchedName: 'Avery Synthetic',
    score: 0.92,
    snapshot: {
      entity: {
        'entity-id': `openverify-sandbox:${entryId}`,
        name: 'Avery Synthetic',
        'alias-type': 'primary_name',
        'match-types': ['name_exact'],
        birthdates: [],
        countries: ['GB'],
        programs: ['SYNTHETIC-ALPHA'],
      },
      list: {
        'source-id': 'openverify-sandbox',
        name: 'Synthetic sanctions list',
        url: null,
        'list-type': 'sanction',
        'list-types': ['sanction'],
        slug: 'openverify-sandbox',
        'flag-code': 'ZZ',
      },
      'match-types': ['name_exact'],
      qualifiers: [],
      components: {
        'subject-name': 'Avery Synthetic',
        'list-name': 'Avery Synthetic',
        'name-level': 'full',
        methods: ['equal'],
        preset: 'tolerant',
        'min-score': 0.8,
      },
    },
    ...overrides,
  };
}

function result(
  matches: FoundReportMatch[],
  extra: Partial<ReportRunResult> = {},
): ReportRunResult {
  return {
    errors: [],
    sources: [SOURCE],
    coverage: { complete: true, limits: [] },
    result: {},
    unavailableFields: [],
    provider: null,
    thresholds: { preset: 'tolerant', 'min-score': 0.8 },
    notices: [],
    matcherVersion: 'scorer-1',
    matches,
    ...extra,
  };
}

let tokens = 0;
function processor(run: () => Promise<RunOutcome>) {
  return createReportRunProcessor({
    jobs: (type) => ({ type, run }),
    token: () => `synthetic-worker:${String((tokens += 1))}`,
  });
}

const completed = (value: ReportRunResult) => () =>
  Promise.resolve<RunOutcome>({ kind: 'completed', result: value });

/** A later run of the report, claimable now. */
async function laterRun(reportId: string) {
  const { insertReportRun } = await import('@openverify/db');
  const runId = testId('rpr');
  await insertReportRun(database.db, environmentId, {
    id: runId,
    reportId,
    runType: 'manual',
    scheduledFor: clock.now(),
  });
  return { environmentId, reportId, runId };
}

const LAST = { lastAttempt: true } as const;
const NOT_LAST = { lastAttempt: false } as const;

describe('a completed run (C74.1, C75.8)', () => {
  it('creates an open, pending match, completes the run and the report, and fires matched then ready', async () => {
    const { reportId, runId, job } = await newReport();
    const outcome = await processor(completed(result([found('SBX-1001')])))(job, deps(), NOT_LAST);
    expect(outcome).toEqual({ outcome: 'completed', status: 'ready' });
    const report = await getReport(database.db, environmentId, reportId);
    expect(report).toMatchObject({ status: 'ready', hasMatch: true, matcherVersion: 'scorer-1' });
    expect(report?.sources).toEqual([
      expect.objectContaining({
        'source-id': 'openverify-sandbox',
        origin: 'import',
        'sync-id': '1',
      }),
    ]);
    const [match] = await listReportMatches(database.db, environmentId, reportId);
    expect(match).toMatchObject({
      status: 'open',
      reviewStatus: 'pending',
      presentInLastRun: true,
    });
    expect(match?.entryIndex).toMatch(/^[0-9a-f]{64}$/);
    expect(match?.snapshot).toMatchObject({
      'entry-key': 'openverify-sandbox:SBX-1001',
      'content-hash': 'c1',
      'risk-data-hash': 'r1',
    });
    expect(await getReportRun(database.db, environmentId, runId)).toMatchObject({
      status: 'ready',
      matchCount: 1,
      newMatchCount: 1,
    });
    expect(events.events.map((event) => event.name)).toEqual([
      'report/watchlist.matched',
      'report/watchlist.ready',
    ]);
    const payload = events.events[0]?.payload.data as { attributes: Record<string, unknown> };
    expect(payload.attributes['matched-lists']).toEqual([
      expect.objectContaining({
        'source-id': 'openverify-sandbox',
        'match-types': ['name_exact'],
        entities: [expect.objectContaining({ 'match-id': match?.id, score: 0.92 })],
      }),
    ]);
    expect(await processor(completed(result([])))(job, deps(), NOT_LAST)).toEqual({
      outcome: 'not_claimed',
    });
  });

  it('keeps the same evidence unchanged, records a risk-data change, and leaves an entry it no longer finds open', async () => {
    const { reportId, job } = await newReport();
    await processor(completed(result([found('SBX-1')])))(job, deps(), NOT_LAST);
    events = createRecordingEventPublisher();
    const second = await laterRun(reportId);
    await processor(completed(result([found('SBX-1')])))(second, deps(), NOT_LAST);
    expect(events.events.map((event) => event.name)).toEqual(['report/watchlist.ready']);
    const third = await laterRun(reportId);
    await processor(completed(result([found('SBX-1', { riskDataHash: 'r2' })])))(
      third,
      deps(),
      NOT_LAST,
    );
    expect((await getReportRun(database.db, environmentId, third.runId))?.notes).toEqual([
      'risk_data_changed',
    ]);
    reads.entries.push({
      sourceId: 'openverify-sandbox',
      entryId: 'SBX-1',
      kind: 'individual',
      contentHash: 'c1',
      riskDataHash: 'r2',
      data: {},
      removedAt: null,
    });
    const fourth = await laterRun(reportId);
    await processor(completed(result([])))(fourth, deps(), NOT_LAST);
    expect((await getReportRun(database.db, environmentId, fourth.runId))?.notes).toEqual([
      'match_not_found_in_run',
    ]);
    const [match] = await listReportMatches(database.db, environmentId, reportId);
    expect(match).toMatchObject({ status: 'open', presentInLastRun: false });
    expect((await getReport(database.db, environmentId, reportId))?.hasMatch).toBe(true);
  });

  it('delists a match whose entry left the source, and opens it again when listed again', async () => {
    const { reportId, job } = await newReport();
    await processor(completed(result([found('SBX-2')])))(job, deps(), NOT_LAST);
    reads.entries.push({
      sourceId: 'openverify-sandbox',
      entryId: 'SBX-2',
      kind: 'individual',
      contentHash: 'c1',
      riskDataHash: 'r1',
      data: {},
      removedAt: clock.now(),
    });
    await processor(completed(result([])))(await laterRun(reportId), deps(), NOT_LAST);
    const [delisted] = await listReportMatches(database.db, environmentId, reportId);
    expect(delisted?.status).toBe('delisted');
    expect(delisted?.delistedAt).toBeInstanceOf(Date);
    expect((await getReport(database.db, environmentId, reportId))?.hasMatch).toBe(false);
    events = createRecordingEventPublisher();
    await processor(completed(result([found('SBX-2')])))(
      await laterRun(reportId),
      deps(),
      NOT_LAST,
    );
    const [again] = await listReportMatches(database.db, environmentId, reportId);
    expect(again?.status).toBe('open');
    expect(events.events.map((event) => event.name)).toContain('report/watchlist.matched');
  });

  it('suppresses a dismissed match while its evidence holds, and lapses it into a new open match when it changes', async () => {
    const { reportId, job } = await newReport();
    await processor(completed(result([found('SBX-3')])))(job, deps(), NOT_LAST);
    const [first] = await listReportMatches(database.db, environmentId, reportId);
    await database.client.query(
      `update report_matches set status = 'dismissed', review_status = 'false_positive' where id = $1`,
      [first?.id],
    );
    await database.client.query(`update reports set has_match = false where id = $1`, [reportId]);
    events = createRecordingEventPublisher();
    await processor(completed(result([found('SBX-3', { riskDataHash: 'r9' })])))(
      await laterRun(reportId),
      deps(),
      NOT_LAST,
    );
    expect(events.events.map((event) => event.name)).toEqual(['report/watchlist.ready']);
    expect((await getReport(database.db, environmentId, reportId))?.hasMatch).toBe(false);
    await processor(completed(result([found('SBX-3', { contentHash: 'c2' })])))(
      await laterRun(reportId),
      deps(),
      NOT_LAST,
    );
    const matches = await listReportMatches(database.db, environmentId, reportId);
    expect(matches.map((match) => [match.status, match.lapsedFrom])).toEqual([
      ['open', first?.id],
      ['dismissed', null],
    ]);
    expect(events.events.map((event) => event.name)).toContain('report/watchlist.matched');
  });

  it('errors a run that could not screen a source but keeps and alerts its matches (C69.4)', async () => {
    const { reportId, job } = await newReport();
    const outcome = await processor(
      completed(result([found('SBX-4')], { errors: [{ code: 'list_stale', source: 'eu-fsf' }] })),
    )(job, deps(), NOT_LAST);
    expect(outcome).toEqual({ outcome: 'completed', status: 'errored' });
    expect(await getReport(database.db, environmentId, reportId)).toMatchObject({
      status: 'errored',
      hasMatch: true,
      errors: [{ code: 'list_stale', source: 'eu-fsf' }],
    });
    expect(events.events.map((event) => event.name)).toEqual([
      'report/watchlist.matched',
      'report/watchlist.errored',
    ]);
  });

  it('indexes the canonical crypto address a run reports', async () => {
    const { reportId, job } = await newReport();
    await processor(completed(result([], { cryptoAddress: '0xabc' })))(job, deps(), NOT_LAST);
    const report = await getReport(database.db, environmentId, reportId);
    expect(report?.cryptoAddressIndex).toMatch(/^[0-9a-f]{64}$/);
    expect(report?.result).toMatchObject({ 'canonical-address': '0xabc' });
  });
});

describe('claims, waits and failures (C74.1)', () => {
  it('defers a budget wait without counting the claim', async () => {
    const { runId, job } = await newReport();
    const notBefore = new Date(clock.now().getTime() + 60_000);
    const outcome = await processor(() => Promise.resolve({ kind: 'wait', notBefore }))(
      job,
      deps(),
      NOT_LAST,
    );
    expect(outcome).toEqual({ outcome: 'waiting', notBefore });
    expect(await getReportRun(database.db, environmentId, runId)).toMatchObject({
      status: 'pending',
      attempt: 0,
      notBefore,
    });
    expect(await processor(completed(result([])))(job, deps(), NOT_LAST)).toEqual({
      outcome: 'not_claimed',
    });
  });

  it('gives a retryable failure back and ends the last attempt errored', async () => {
    const { reportId, runId, job } = await newReport();
    const failing = processor(() => Promise.reject(new Error('synthetic outage')));
    await expect(failing(job, deps(), NOT_LAST)).rejects.toThrow('synthetic outage');
    expect(await getReportRun(database.db, environmentId, runId)).toMatchObject({
      status: 'pending',
      claimedBy: null,
      attempt: 1,
    });
    expect(await failing(job, deps(), LAST)).toEqual({ outcome: 'completed', status: 'errored' });
    expect(await getReportRun(database.db, environmentId, runId)).toMatchObject({
      status: 'errored',
      errors: [{ code: 'execution_error' }],
    });
    expect(await getReport(database.db, environmentId, reportId)).toMatchObject({
      status: 'errored',
      errors: [{ code: 'execution_error' }],
    });
    expect(events.events.map((event) => event.name)).toEqual(['report/watchlist.errored']);
  });

  it('ends a run of a type not built yet errored at once', async () => {
    const { job } = await newReport();
    const outcome = await processor(() => Promise.reject(new ReportTypeNotBuiltError('watchlist')))(
      job,
      deps(),
      NOT_LAST,
    );
    expect(outcome).toEqual({ outcome: 'completed', status: 'errored' });
  });

  it('ends a run errored instead of claiming it an eleventh time', async () => {
    const { runId, job } = await newReport();
    await database.client.query(`update report_runs set attempt = 10 where id = $1`, [runId]);
    let ran = false;
    const outcome = await processor(() => {
      ran = true;
      return Promise.resolve<RunOutcome>({ kind: 'completed', result: result([]) });
    })(job, deps(), NOT_LAST);
    expect(ran).toBe(false);
    expect(outcome).toEqual({ outcome: 'completed', status: 'errored' });
    expect((await getReportRun(database.db, environmentId, runId))?.attempt).toBe(11);
  });

  it('discards the whole result of a run whose claim another worker took (P11)', async () => {
    const { reportId, runId, job } = await newReport();
    const outcome = await processor(async () => {
      await database.client.query(
        `update report_runs set claimed_by = 'another-worker' where id = $1`,
        [runId],
      );
      return { kind: 'completed', result: result([found('SBX-5')]) };
    })(job, deps(), NOT_LAST);
    expect(outcome).toEqual({ outcome: 'not_claimed' });
    expect(await listReportMatches(database.db, environmentId, reportId)).toEqual([]);
    expect((await getReport(database.db, environmentId, reportId))?.status).toBe('pending');
    expect(events.events).toEqual([]);
  });

  it('discards the result of a run whose report was redacted while it ran (C73.5)', async () => {
    const { reportId, runId, job } = await newReport();
    const outcome = await processor(async () => {
      await database.client.query(`update reports set redacted_at = now() where id = $1`, [
        reportId,
      ]);
      return { kind: 'completed', result: result([found('SBX-6')]) };
    })(job, deps(), NOT_LAST);
    expect(outcome).toEqual({ outcome: 'completed', status: 'errored' });
    expect(await listReportMatches(database.db, environmentId, reportId)).toEqual([]);
    expect((await getReportRun(database.db, environmentId, runId))?.status).toBe('errored');
  });
});

describe('completion reports (C84.2, C84.3)', () => {
  async function completedInquiry(onReportMatch: 'none' | 'needs_review', status = 'completed') {
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    const account = await createAccount(database.db, environmentId, { id: testId('acc') });
    await database.client.query(
      `update inquiry_template_versions set report_config = $1::jsonb where id = $2`,
      [JSON.stringify({ 'on-report-match': onReportMatch }), inquiry.inquiryTemplateVersionId],
    );
    await database.client.query(`update inquiries set status = $1, account_id = $2 where id = $3`, [
      status,
      account.id,
      inquiry.id,
    ]);
    return { inquiryId: inquiry.id, accountId: account.id };
  }

  it('links the inquiry account and sends a completed inquiry to review on a first match', async () => {
    const { inquiryId, accountId } = await completedInquiry('needs_review');
    const { reportId, runId, job } = await newReport({ origin: 'inquiry_completion', inquiryId });
    await processor(completed(result([found('SBX-7')])))(job, deps(), NOT_LAST);
    expect(await getReport(database.db, environmentId, reportId)).toMatchObject({
      accountId,
      accountIds: [accountId],
    });
    expect((await getReportRun(database.db, environmentId, runId))?.notes).toEqual([
      'report_match',
    ]);
    const inquiry = await database.client.query<{ status: string }>(
      `select status from inquiries where id = $1`,
      [inquiryId],
    );
    expect(inquiry.rows[0]?.status).toBe('needs_review');
    expect(events.events.map((event) => event.name)).toContain('inquiry.marked-for-review');
  });

  it('sends an inquiry whose initial report errored to review, and records an inquiry decided before', async () => {
    const errored = await completedInquiry('needs_review');
    const first = await newReport({ origin: 'inquiry_completion', inquiryId: errored.inquiryId });
    await processor(completed(result([], { errors: [{ code: 'insufficient_input' }] })))(
      first.job,
      deps(),
      NOT_LAST,
    );
    expect((await getReportRun(database.db, environmentId, first.runId))?.notes).toEqual([
      'report_errored',
    ]);
    const approved = await completedInquiry('none', 'approved');
    const second = await newReport({ origin: 'inquiry_completion', inquiryId: approved.inquiryId });
    await processor(completed(result([found('SBX-8')])))(second.job, deps(), NOT_LAST);
    expect((await getReportRun(database.db, environmentId, second.runId))?.notes).toEqual([
      'inquiry_already_decided',
    ]);
    const state = await database.client.query<{ status: string }>(
      `select status from inquiries where id = $1`,
      [approved.inquiryId],
    );
    expect(state.rows[0]?.status).toBe('approved');
  });

  it('leaves the inquiry alone with on-report-match none (C69.4)', async () => {
    const { inquiryId } = await completedInquiry('none');
    const { job } = await newReport({ origin: 'inquiry_completion', inquiryId });
    await processor(completed(result([found('SBX-9')])))(job, deps(), NOT_LAST);
    const state = await database.client.query<{ status: string }>(
      `select status from inquiries where id = $1`,
      [inquiryId],
    );
    expect(state.rows[0]?.status).toBe('completed');
  });
});

describe('the recurring caps of completion reports (C72.5)', () => {
  async function completionReport(type: 'watchlist' | 'adverse-media') {
    const { inquiry } = await createTestInquiry(database.db, environmentId);
    return newReport({
      type,
      origin: 'inquiry_completion',
      inquiryId: inquiry.id,
      config: { 'recurrence-interval-days': 1 },
      recurrence: 1,
    });
  }

  it('runs one beyond the recurring cap once, without a schedule, recording recurring_limit', async () => {
    await newReport({ config: { 'recurrence-interval-days': 7 }, recurrence: 7 });
    const { reportId, runId, job } = await completionReport('watchlist');
    const capped = { ...deps(), limits: { ...deps().limits, maxRecurringPerEnvironment: 1 } };
    await processor(completed(result([])))(job, capped, NOT_LAST);
    expect(await getReport(database.db, environmentId, reportId)).toMatchObject({
      nextRunAt: null,
      recurrenceIntervalDays: null,
    });
    expect((await getReportRun(database.db, environmentId, runId))?.notes).toContain(
      'recurring_limit',
    );
  });

  it('runs a media one beyond the scheduled media runs once, without a schedule', async () => {
    await completionReport('adverse-media');
    const { reportId, runId, job } = await completionReport('adverse-media');
    const capped = { ...deps(), limits: { ...deps().limits, maxMediaRunsPerDay: 1 } };
    await processor(completed(result([], { sources: [] })))(job, capped, NOT_LAST);
    expect((await getReport(database.db, environmentId, reportId))?.nextRunAt).toBeNull();
    expect((await getReportRun(database.db, environmentId, runId))?.notes).toContain(
      'recurring_limit',
    );
  });

  it('keeps the schedule of one within the caps', async () => {
    const { reportId, job } = await completionReport('watchlist');
    await processor(completed(result([])))(job, deps(), NOT_LAST);
    expect((await getReport(database.db, environmentId, reportId))?.nextRunAt).not.toBeNull();
  });
});

describe('pause-on-match (C74.5)', () => {
  it('pauses on a new match and resumes after the delay once nothing is unreviewed', async () => {
    const { reportId, job } = await newReport({
      config: { 'recurrence-interval-days': 7, 'pause-on-match': true, 'resume-delay-minutes': 30 },
      recurrence: 7,
    });
    await processor(completed(result([found('SBX-10')])))(job, deps(), NOT_LAST);
    expect(await getReport(database.db, environmentId, reportId)).toMatchObject({
      pausedReason: 'match',
    });
    await database.client.query(
      `update report_matches set review_status = 'true_positive' where report_id = $1`,
      [reportId],
    );
    await processor(completed(result([found('SBX-10')])))(
      await laterRun(reportId),
      deps(),
      NOT_LAST,
    );
    const report = await getReport(database.db, environmentId, reportId);
    expect(report).toMatchObject({ pausedAt: null, pausedReason: null });
    expect(report?.nextRunAt?.getTime()).toBe(clock.now().getTime() + 30 * 60_000);
  });
});
