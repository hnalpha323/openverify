/**
 * C74.1, C74.3, C74.6, C73.7 (Workflow 6A Stage 3, `api-reports`) against Postgres 17 row locks
 * (Testcontainers, started without bind-parameter logging, C73.8): the report writers in pairs.
 *
 * - Run completion holds the report row from its first lock to its commit: a dismissal, a
 *   redaction or a pause that comes then waits for the commit and acts on what the run wrote.
 * - A dismissal, a redaction or a pause that commits while the type job runs (no lock is held
 *   then) is respected by the completion: a dismissed match stays suppressed, a redacted report
 *   gets nothing, a paused report stays paused.
 * - Two sweeps against one due report insert one scheduled run; two jobs of one run claim it once;
 *   a claim that expires under a live run lets a second worker complete it, and the first
 *   worker's result is discarded (P11).
 *
 * - Completion reports against consolidation and account redaction (owner decision 11, F04): the
 *   inquiry transition is held inside its transaction after its report hook created the report,
 *   and a consolidation or an account redaction inside theirs at their first staged event; either
 *   order ends with the report linked to the absorbing account, or redacted with its inquiry.
 *
 * The run's completion is held inside its transaction by pausing the event publisher's `stage`,
 * which it calls after its writes and before its commit. Synthetic values only.
 */
import { randomBytes } from 'node:crypto';
import {
  createAccount,
  createDatabase,
  createKeyring,
  createReport,
  getInquiry,
  getReport,
  getReportRun,
  insertListUpdateRuns,
  insertReportRun,
  listReportMatches,
  listReportRuns,
  runMigrations,
  setDefaultKeyring,
  type Database,
} from '@openverify/db';
import {
  createIntegrationPool,
  createTestInquiry,
  createTestTenant,
  seedReportTemplate,
  testId,
  startIntegrationPostgres,
  ifSet,
} from '@openverify/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UNMASKED } from '../../auth/pii.js';
import { PHASE6_DEFAULTS } from '../../config.js';
import type { AuditEntry, PublishEventInput } from '../../ports.js';
import type { CreateReportBody } from '@openverify/contracts';
import { consolidateAccounts } from '../../services/accounts.js';
import type { ApiDependencies } from '../../services/context.js';
import { transitionInquiryInTx, type Acting } from '../../services/inquiries.js';
import { createRedactionService } from '../../services/redaction.js';
import { changeReportMonitoring, createReportResource } from '../../services/reports/reports.js';
import { dismissReportMatches } from '../../services/reports/review.js';
import { createInMemoryFileStorage } from '../../storage/index.js';
import {
  createAllowAllRateLimiter,
  createRecordingAuditLogger,
  createRecordingEventPublisher,
  createRecordingReportRescreenQueue,
  createRecordingReportRunQueue,
} from '../../test-support/fakes.js';
import { createWorkerLogger } from '../logger.js';
import type { FoundReportMatch, ReportRunResult, RunOutcome } from '../report-types/index.js';
import { createReportRunProcessor, type ReportRunProcessorDeps } from './run.js';
import { createReportSweep } from './sweep.js';

const keyring = createKeyring(randomBytes(32));
const BLIND_INDEX_KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
/** Long enough for a statement that takes no lock to finish first. */
const WAIT_MS = 1_500;
const T0 = new Date('2026-10-27T12:00:00.000Z');

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let environmentId: string;
let organizationId: string;
let now = T0;
const clock = { now: () => now };
const silent = createWorkerLogger({ level: 'silent' });

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 12 });
  db = createDatabase(pool);
  setDefaultKeyring(keyring);
  await runMigrations(db);
  const tenant = await createTestTenant(db);
  environmentId = tenant.environment.id;
  organizationId = tenant.organization.id;
}, 180_000);

afterAll(async () => {
  setDefaultKeyring(undefined);
  await ifSet(pool)?.end();
  await container?.stop();
});

function deferred<T = void>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const sleep = (ms: number) =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

/** Settles to `'pending'` when `promise` has not settled within `ms`. */
const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise.then(() => 'settled' as const), sleep(ms).then(() => 'pending' as const)]);

/** An event publisher whose `stage` waits on `gate` (inside the caller's transaction) when set. */
function gatedEvents() {
  const recording = createRecordingEventPublisher();
  let gate: Promise<void> | null = null;
  const reached = deferred();
  return {
    recording,
    hold(until: Promise<void>) {
      gate = until;
    },
    reached: reached.promise,
    publisher: {
      ...recording,
      stage: async (tx: Database, input: PublishEventInput) => {
        if (gate !== null) {
          const waiting = gate;
          gate = null;
          reached.resolve();
          await waiting;
        }
        return recording.stage(tx, input);
      },
    },
  };
}

function runDeps(events: ReportRunProcessorDeps['events']): ReportRunProcessorDeps {
  return {
    db,
    clock,
    logger: silent,
    events,
    keyring,
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
    limits: { perMinute: 600, maxRecurringPerEnvironment: 250_000, maxMediaRunsPerDay: 8_640 },
  };
}

function apiDeps(): ApiDependencies {
  return {
    db,
    clock,
    ids: { newId: (prefix: string) => testId(prefix as 'ract') },
    events: createRecordingEventPublisher(),
    audit: createRecordingAuditLogger(),
  } as unknown as ApiDependencies;
}

const acting = (): Acting =>
  ({
    ctx: { organizationId, environmentId },
    actor: { type: 'api-key', id: testId('key') },
    mask: UNMASKED,
  }) as unknown as Acting;

function found(entryId: string, contentHash = 'c'.repeat(64)): FoundReportMatch {
  const entryKey = `openverify-sandbox:${entryId}`;
  return {
    sourceId: 'openverify-sandbox',
    entryKey,
    contentHash,
    riskDataHash: 'r'.repeat(64),
    matchedName: `Avery Synthetic ${entryId}`,
    score: 0.9,
    snapshot: {
      entity: {
        'entity-id': entryKey,
        name: `Avery Synthetic ${entryId}`,
        'alias-type': 'primary_name',
        'match-types': ['name_exact'],
        birthdates: [],
        countries: [],
        programs: [],
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
      components: {},
    },
  };
}

const result = (matches: FoundReportMatch[]): ReportRunResult => ({
  errors: [],
  sources: [
    {
      sourceId: 'openverify-sandbox',
      syncId: '1',
      publishedAt: T0,
      checkedAt: T0,
      sha256: 'a'.repeat(64),
      origin: 'import',
      attribution: 'Synthetic attribution',
    },
  ],
  coverage: { complete: true, limits: [] },
  result: {},
  unavailableFields: [],
  provider: null,
  thresholds: { preset: 'tolerant', 'min-score': 0.8 },
  notices: [],
  matcherVersion: 'scorer-1',
  matches,
});

/** A processor whose type job answers `run()`. */
const processorOf = (run: () => Promise<RunOutcome>) =>
  createReportRunProcessor({ jobs: (type) => ({ type, run }) });

const answer = (value: ReportRunResult) => () =>
  Promise.resolve<RunOutcome>({ kind: 'completed', result: value });

/** A recurring report whose initial run is pending. */
async function newReport(recurrence: number | null = 7) {
  const template = await seedReportTemplate(db, environmentId, {
    config: {
      'search-lists': ['openverify-sandbox'],
      ...(recurrence === null ? {} : { 'recurrence-interval-days': recurrence }),
    },
  });
  const runId = testId('rpr');
  const report = await createReport(db, environmentId, {
    id: testId('rep'),
    reportType: 'watchlist',
    reportTemplateId: template.templateId,
    reportTemplateVersionId: template.versionId,
    origin: 'api',
    query: { 'name-first': 'Avery', 'name-last': 'Synthetic' },
    querySources: { 'name-first': 'request', 'name-last': 'request' },
    inquiryId: null,
    accountId: null,
    recurrenceIntervalDays: recurrence,
    nextRunAt: recurrence === null ? null : new Date(now.getTime() + recurrence * 86_400_000),
    createdAt: now,
    initialRun: { id: runId, scheduledFor: now },
  });
  return { reportId: report.id, job: { environmentId, reportId: report.id, runId } };
}

async function laterRun(reportId: string) {
  const runId = testId('rpr');
  await insertReportRun(db, environmentId, {
    id: runId,
    reportId,
    runType: 'manual',
    scheduledFor: now,
  });
  return { environmentId, reportId, runId };
}

const NOT_LAST = { lastAttempt: false } as const;
const reason = { reason: 'Synthetic: a different person' };

describe('run completion against the report writers (C74.6, C73.7)', () => {
  it('a dismissal during the completion waits for its commit and dismisses what the run found', async () => {
    const { reportId, job } = await newReport();
    const events = gatedEvents();
    const release = deferred();
    events.hold(release.promise);
    const completing = processorOf(answer(result([found('RACE-1')])))(
      job,
      runDeps(events.publisher),
      NOT_LAST,
    );
    await events.reached;
    const dismissing = dismissReportMatches(apiDeps(), acting(), reportId, reason);
    expect(await within(dismissing, WAIT_MS)).toBe('pending');
    release.resolve();
    expect(await completing).toEqual({ outcome: 'completed', status: 'ready' });
    await dismissing;
    expect((await listReportMatches(db, environmentId, reportId)).map((m) => m.status)).toEqual([
      'dismissed',
    ]);
    expect((await getReport(db, environmentId, reportId))?.hasMatch).toBe(false);
  });

  it('a completion after a dismissal committed during its run keeps the match suppressed', async () => {
    const { reportId, job } = await newReport();
    await processorOf(answer(result([found('RACE-2')])))(
      job,
      runDeps(createRecordingEventPublisher()),
      NOT_LAST,
    );
    const events = createRecordingEventPublisher();
    await processorOf(async () => {
      await dismissReportMatches(apiDeps(), acting(), reportId, reason);
      return { kind: 'completed', result: result([found('RACE-2')]) };
    })(await laterRun(reportId), runDeps(events), NOT_LAST);
    expect(events.events.map((event) => event.name)).toEqual(['report/watchlist.ready']);
    expect((await getReport(db, environmentId, reportId))?.hasMatch).toBe(false);
  });

  it('a redaction during the completion waits for its commit and redacts what the run wrote', async () => {
    const { reportId, job } = await newReport();
    const events = gatedEvents();
    const release = deferred();
    events.hold(release.promise);
    const completing = processorOf(answer(result([found('RACE-3')])))(
      job,
      runDeps(events.publisher),
      NOT_LAST,
    );
    await events.reached;
    const redaction = createRedactionService({
      db,
      storage: createInMemoryFileStorage(),
      events: createRecordingEventPublisher(),
      clock,
    });
    const redacting = redaction.redactReport({ organizationId, environmentId }, reportId, null);
    expect(await within(redacting, WAIT_MS)).toBe('pending');
    release.resolve();
    await completing;
    await redacting;
    const [match] = await listReportMatches(db, environmentId, reportId);
    expect(match).toMatchObject({ snapshot: null, entryIndex: null, evidenceHash: null });
    expect((await getReport(db, environmentId, reportId))?.redactedAt).not.toBeNull();
  });

  it('a redaction committed during the run makes the completion discard its result', async () => {
    const { reportId, job } = await newReport();
    const redaction = createRedactionService({
      db,
      storage: createInMemoryFileStorage(),
      events: createRecordingEventPublisher(),
      clock,
    });
    const outcome = await processorOf(async () => {
      await redaction.redactReport({ organizationId, environmentId }, reportId, null);
      return { kind: 'completed', result: result([found('RACE-4')]) };
    })(job, runDeps(createRecordingEventPublisher()), NOT_LAST);
    expect(outcome).toEqual({ outcome: 'completed', status: 'errored' });
    expect(await listReportMatches(db, environmentId, reportId)).toEqual([]);
  });

  it('a pause committed during the run is kept by the completion', async () => {
    const { reportId, job } = await newReport();
    await processorOf(async () => {
      await changeReportMonitoring(apiDeps(), acting(), reportId, 'pause');
      return { kind: 'completed', result: result([]) };
    })(job, runDeps(createRecordingEventPublisher()), NOT_LAST);
    expect(await getReport(db, environmentId, reportId)).toMatchObject({
      status: 'ready',
      pausedReason: 'operator',
    });
  });
});

describe('claims and the sweep (C74.1, C74.3)', () => {
  it('claims one run once when two jobs of it start together', async () => {
    const { reportId, job } = await newReport(null);
    const runs: string[] = [];
    const twice = await Promise.all(
      [1, 2].map(() =>
        processorOf(async () => {
          runs.push('ran');
          await sleep(200);
          return { kind: 'completed', result: result([]) };
        })(job, runDeps(createRecordingEventPublisher()), NOT_LAST),
      ),
    );
    expect(runs).toHaveLength(1);
    expect(twice.map((outcome) => outcome.outcome).sort()).toEqual(['completed', 'not_claimed']);
    expect((await getReport(db, environmentId, reportId))?.status).toBe('ready');
  });

  it('lets a second worker complete a run whose claim expired, and discards the first worker’s result (P11)', async () => {
    const { reportId, job } = await newReport(null);
    const second = deferred();
    const first = processorOf(async () => {
      await second.promise;
      return { kind: 'completed', result: result([found('RACE-5')]) };
    })(job, runDeps(createRecordingEventPublisher()), NOT_LAST);
    await sleep(300);
    now = new Date(now.getTime() + 11 * 60_000);
    const takeover = await processorOf(answer(result([])))(
      job,
      runDeps(createRecordingEventPublisher()),
      NOT_LAST,
    );
    expect(takeover).toEqual({ outcome: 'completed', status: 'ready' });
    second.resolve();
    expect(await first).toEqual({ outcome: 'not_claimed' });
    expect(await listReportMatches(db, environmentId, reportId)).toEqual([]);
    expect((await getReportRun(db, environmentId, job.runId))?.attempt).toBe(2);
  });

  it('inserts one scheduled run when two sweeps meet one due report', async () => {
    const { reportId, job } = await newReport(1);
    await processorOf(answer(result([])))(job, runDeps(createRecordingEventPublisher()), NOT_LAST);
    now = new Date(now.getTime() + 2 * 86_400_000);
    const sweep = createReportSweep({ recover: () => Promise.resolve({ enqueued: 0, failed: 0 }) });
    const deps = () => ({
      db,
      clock,
      logger: silent,
      runs: createRecordingReportRunQueue(),
      rescreens: createRecordingReportRescreenQueue(),
      limits: { perMinute: 600, maxRecurringPerEnvironment: 250_000, maxMediaRunsPerDay: 8_640 },
    });
    await Promise.all([sweep(deps()), sweep(deps())]);
    const scheduled = (await listReportRuns(db, environmentId, reportId)).filter(
      (run) => run.runType === 'scheduled',
    );
    expect(scheduled).toHaveLength(1);
    expect((await getReport(db, environmentId, reportId))?.nextRunAt?.getTime()).toBeGreaterThan(
      now.getTime(),
    );
  });
});

describe('report creation against inquiry redaction (C72.1, C73.7, P06)', () => {
  function creationDeps(audit = createRecordingAuditLogger()) {
    return {
      ...apiDeps(),
      audit,
      rateLimiter: createAllowAllRateLimiter(),
      reportLimits: {
        perMinute: 600,
        maxRecurringPerEnvironment: 250_000,
        maxMediaRunsPerDay: 8_640,
      },
      reportRuns: createRecordingReportRunQueue(),
    } as unknown as ApiDependencies;
  }

  async function bodyFor(inquiryId: string): Promise<CreateReportBody> {
    const template = await seedReportTemplate(db, environmentId, {
      config: { 'search-lists': ['openverify-sandbox'] },
    });
    return {
      data: {
        type: 'report/watchlist',
        attributes: {
          'report-template-id': template.templateId,
          query: { 'name-first': 'Avery', 'name-last': 'Synthetic' },
          'inquiry-id': inquiryId,
        },
      },
      meta: { 'auto-create-account': false },
    };
  }

  const reportsOf = async (inquiryId: string) =>
    (
      await pool.query<{ id: string; redacted_at: Date | null }>(
        'select id, redacted_at from reports where inquiry_id = $1',
        [inquiryId],
      )
    ).rows;

  it('a creation during an inquiry redaction waits for it and answers 410', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId);
    const body = await bodyFor(inquiry.id);
    const events = gatedEvents();
    const release = deferred();
    events.hold(release.promise);
    const redaction = createRedactionService({
      db,
      storage: createInMemoryFileStorage(),
      events: events.publisher,
      clock,
    });
    const redacting = redaction.redactInquiry({ organizationId, environmentId }, inquiry.id, null);
    await events.reached;
    const creating = createReportResource(creationDeps(), acting(), body);
    const settled = creating.then(
      () => 'created',
      (error: unknown) => (error as { status?: number }).status,
    );
    expect(await within(settled, WAIT_MS)).toBe('pending');
    release.resolve();
    await redacting;
    expect(await settled).toBe(410);
    expect(await reportsOf(inquiry.id)).toEqual([]);
  });

  it('an inquiry redaction during a creation waits for it and redacts the new report', async () => {
    const { inquiry } = await createTestInquiry(db, environmentId);
    const body = await bodyFor(inquiry.id);
    const recording = createRecordingAuditLogger();
    const release = deferred();
    const reached = deferred();
    const audit = {
      ...recording,
      record: async (tx: Database, entry: AuditEntry) => {
        reached.resolve();
        await release.promise;
        return recording.record(tx, entry);
      },
    };
    const creating = createReportResource(creationDeps(audit), acting(), body);
    await reached.promise;
    const redaction = createRedactionService({
      db,
      storage: createInMemoryFileStorage(),
      events: createRecordingEventPublisher(),
      clock,
    });
    const redacting = redaction.redactInquiry({ organizationId, environmentId }, inquiry.id, null);
    expect(await within(redacting, WAIT_MS)).toBe('pending');
    release.resolve();
    await creating;
    await redacting;
    const [report] = await reportsOf(inquiry.id);
    expect(report?.redacted_at).not.toBeNull();
  });
});

describe('report creation against account redaction (C72.1, C73.7, C74.6, P06)', () => {
  function creationDeps(audit = createRecordingAuditLogger()) {
    return {
      ...apiDeps(),
      audit,
      rateLimiter: createAllowAllRateLimiter(),
      reportLimits: {
        perMinute: 600,
        maxRecurringPerEnvironment: 250_000,
        maxMediaRunsPerDay: 8_640,
      },
      reportRuns: createRecordingReportRunQueue(),
    } as unknown as ApiDependencies;
  }

  async function bodyFor(accountId: string): Promise<CreateReportBody> {
    const template = await seedReportTemplate(db, environmentId, {
      config: { 'search-lists': ['openverify-sandbox'] },
    });
    return {
      data: {
        type: 'report/watchlist',
        attributes: {
          'report-template-id': template.templateId,
          query: { 'name-first': 'Avery', 'name-last': 'Synthetic' },
          'account-id': accountId,
        },
      },
    };
  }

  const reportsOf = async (accountId: string) =>
    (
      await pool.query<{ id: string; redacted_at: Date | null }>(
        'select id, redacted_at from reports where account_id = $1',
        [accountId],
      )
    ).rows;

  it('a creation during an account redaction waits for it and answers 410', async () => {
    const account = await createAccount(db, environmentId, { id: testId('acc') });
    const body = await bodyFor(account.id);
    const events = gatedEvents();
    const release = deferred();
    events.hold(release.promise);
    const redaction = createRedactionService({
      db,
      storage: createInMemoryFileStorage(),
      events: events.publisher,
      clock,
    });
    const redacting = redaction.redactAccount({ organizationId, environmentId }, account.id, null);
    await events.reached;
    const creating = createReportResource(creationDeps(), acting(), body);
    const settled = creating.then(
      () => 'created',
      (error: unknown) => (error as { status?: number }).status,
    );
    expect(await within(settled, WAIT_MS)).toBe('pending');
    release.resolve();
    await redacting;
    expect(await settled).toBe(410);
    expect(await reportsOf(account.id)).toEqual([]);
  });

  it('an account redaction during a creation waits for it and redacts the new report', async () => {
    const account = await createAccount(db, environmentId, { id: testId('acc') });
    const body = await bodyFor(account.id);
    const recording = createRecordingAuditLogger();
    const release = deferred();
    const reached = deferred();
    const audit = {
      ...recording,
      record: async (tx: Database, entry: AuditEntry) => {
        reached.resolve();
        await release.promise;
        return recording.record(tx, entry);
      },
    };
    const creating = createReportResource(creationDeps(audit), acting(), body);
    await reached.promise;
    const redaction = createRedactionService({
      db,
      storage: createInMemoryFileStorage(),
      events: createRecordingEventPublisher(),
      clock,
    });
    const redacting = redaction.redactAccount({ organizationId, environmentId }, account.id, null);
    expect(await within(redacting, WAIT_MS)).toBe('pending');
    release.resolve();
    await creating;
    await redacting;
    const [report] = await reportsOf(account.id);
    expect(report?.redacted_at).not.toBeNull();
  });
});

describe('recurring caps under concurrent creations (C72.5, R002)', () => {
  it('keeps an environment at its recurring cap when many creations race for the last places', async () => {
    const tenant = await createTestTenant(db);
    const env = tenant.environment.id;
    const template = await seedReportTemplate(db, env, {
      config: { 'search-lists': ['openverify-sandbox'], 'recurrence-interval-days': 7 },
    });
    const deps = {
      ...apiDeps(),
      rateLimiter: createAllowAllRateLimiter(),
      reportLimits: { perMinute: 600, maxRecurringPerEnvironment: 3, maxMediaRunsPerDay: 8_640 },
      reportRuns: createRecordingReportRunQueue(),
    } as unknown as ApiDependencies;
    const own = {
      ctx: { organizationId: tenant.organization.id, environmentId: env },
      actor: { type: 'api-key', id: testId('key') },
      mask: UNMASKED,
    } as unknown as Acting;
    const body: CreateReportBody = {
      data: {
        type: 'report/watchlist',
        attributes: {
          'report-template-id': template.templateId,
          query: { 'name-first': 'Avery', 'name-last': 'Synthetic' },
        },
      },
      meta: { 'auto-create-account': false },
    };
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        createReportResource(deps, own, body).then(
          () => 'created',
          (error: unknown) => (error as { code?: string }).code ?? 'failed',
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome === 'created')).toHaveLength(3);
    expect(outcomes.filter((outcome) => outcome === 'report_recurring_limit')).toHaveLength(5);
    const stored = await pool.query<{ count: number }>(
      'select count(*)::int as count from reports where environment_id = $1',
      [env],
    );
    expect(stored.rows[0]?.count).toBe(3);
  });
});

describe('claims, waits and re-screens on Postgres (C74.1, C74.3, C74.4, C74.6, K6A-7)', () => {
  const sweepDeps = () => ({
    db,
    clock,
    logger: silent,
    runs: createRecordingReportRunQueue(),
    rescreens: createRecordingReportRescreenQueue(),
    limits: { perMinute: 600, maxRecurringPerEnvironment: 250_000, maxMediaRunsPerDay: 8_640 },
  });
  const sweep = createReportSweep({ recover: () => Promise.resolve({ enqueued: 0, failed: 0 }) });
  const enqueuedBy = async (at: Date, runId: string) => {
    now = at;
    const deps = sweepDeps();
    await sweep(deps);
    return deps.runs.jobs.some((job) => job.runId === runId);
  };

  it('enqueues a budget-waiting run again at the first sweep after its not_before, never before', async () => {
    const { job } = await newReport(null);
    const notBefore = new Date(now.getTime() + 5_000);
    expect(
      await processorOf(() => Promise.resolve<RunOutcome>({ kind: 'wait', notBefore }))(
        job,
        runDeps(createRecordingEventPublisher()),
        NOT_LAST,
      ),
    ).toEqual({ outcome: 'waiting', notBefore });
    const waited = now;
    expect(await enqueuedBy(new Date(notBefore.getTime() - 1), job.runId)).toBe(false);
    // The sweep runs every 15 s: the first tick after not_before enqueues it.
    expect(await enqueuedBy(new Date(notBefore.getTime() + 15_000), job.runId)).toBe(true);
    expect(await getReportRun(db, environmentId, job.runId)).toMatchObject({
      status: 'pending',
      attempt: 0,
      enqueuedAt: new Date(notBefore.getTime() + 15_000),
    });
    expect(waited.getTime()).toBeLessThan(notBefore.getTime());
  });

  it('leaves a run held by a live worker running when another worker’s job of it is exhausted', async () => {
    const { reportId, job } = await newReport(null);
    const release = deferred();
    const started = deferred();
    const live = processorOf(async () => {
      started.resolve();
      await release.promise;
      return { kind: 'completed', result: result([]) };
    })(job, runDeps(createRecordingEventPublisher()), NOT_LAST);
    await started.promise;
    const exhausted = await processorOf(answer(result([found('RACE-EXHAUSTED')])))(
      job,
      runDeps(createRecordingEventPublisher()),
      { lastAttempt: true },
    );
    expect(exhausted).toEqual({ outcome: 'not_claimed' });
    expect(await getReportRun(db, environmentId, job.runId)).toMatchObject({
      status: 'running',
      attempt: 1,
    });
    release.resolve();
    expect(await live).toEqual({ outcome: 'completed', status: 'ready' });
    expect(await listReportMatches(db, environmentId, reportId)).toEqual([]);
  });

  it('ends a run errored instead of claiming it an eleventh time', async () => {
    const { reportId, job } = await newReport(null);
    await pool.query('update report_runs set attempt = 10 where id = $1', [job.runId]);
    let ran = false;
    const outcome = await processorOf(() => {
      ran = true;
      return Promise.resolve<RunOutcome>({ kind: 'completed', result: result([]) });
    })(job, runDeps(createRecordingEventPublisher()), NOT_LAST);
    expect(ran).toBe(false);
    expect(outcome).toEqual({ outcome: 'completed', status: 'errored' });
    expect(await getReportRun(db, environmentId, job.runId)).toMatchObject({
      status: 'errored',
      attempt: 11,
      errors: [{ code: 'execution_error' }],
    });
    expect((await getReport(db, environmentId, reportId))?.status).toBe('errored');
  });

  it('a re-screen during a redaction waits for it, and a run it inserts is never enqueued, claimed or run', async () => {
    const { reportId, job } = await newReport(null);
    await processorOf(answer(result([])))(job, runDeps(createRecordingEventPublisher()), NOT_LAST);
    const events = gatedEvents();
    const release = deferred();
    events.hold(release.promise);
    const redacting = createRedactionService({
      db,
      storage: createInMemoryFileStorage(),
      events: events.publisher,
      clock,
    }).redactReport({ organizationId, environmentId }, reportId, null);
    await events.reached;
    // `trigger_sync_id` names a sync without a foreign key; the re-screen of sync 9,000,001.
    const syncId = 9_000_001;
    // The run's foreign-key check waits for the redaction's lock on the report row; the insert
    // read the report before the redaction committed, so it may still insert the run.
    const inserted = insertListUpdateRuns(db, environmentId, {
      syncId,
      reportIds: [reportId],
      at: now,
    });
    expect(await within(inserted, WAIT_MS)).toBe('pending');
    release.resolve();
    await redacting;
    await inserted;
    const rescreen = (await listReportRuns(db, environmentId, reportId)).find(
      (run) => run.runType === 'list_update',
    );
    const runId = rescreen?.id ?? '';
    expect(await enqueuedBy(new Date(now.getTime() + 15_000), runId)).toBe(false);
    let ran = false;
    expect(
      await processorOf(() => {
        ran = true;
        return Promise.resolve<RunOutcome>({ kind: 'completed', result: result([found('X')]) });
      })({ environmentId, reportId, runId }, runDeps(createRecordingEventPublisher()), NOT_LAST),
    ).toEqual({ outcome: 'not_claimed' });
    expect(ran).toBe(false);
    expect(await listReportMatches(db, environmentId, reportId)).toEqual([]);
    expect((await getReport(db, environmentId, reportId))?.redactedAt).not.toBeNull();
  });
});

describe('completion reports against consolidation and account redaction (C74.6, F04, owner decision 11)', () => {
  const ctx = () => ({ organizationId, environmentId });

  /** A pending inquiry on `source` whose version runs one watchlist report on completion. */
  async function completingInquiry() {
    const source = await createAccount(db, environmentId, { id: testId('acc') });
    const target = await createAccount(db, environmentId, { id: testId('acc') });
    const report = await seedReportTemplate(db, environmentId, {
      config: { 'search-lists': ['openverify-sandbox'] },
    });
    const { inquiry } = await createTestInquiry(db, environmentId, {
      fields: { name_first: 'Avery', name_last: 'Synthetic' },
    });
    await pool.query('update inquiry_template_versions set report_config = $1 where id = $2', [
      JSON.stringify({ 'on-completion': [{ 'report-template-id': report.templateId }] }),
      inquiry.inquiryTemplateVersionId,
    ]);
    await pool.query("update inquiries set status = 'pending', account_id = $1 where id = $2", [
      source.id,
      inquiry.id,
    ]);
    const pending = await getInquiry(db, environmentId, inquiry.id);
    if (pending === null) {
      throw new Error('the inquiry is gone');
    }
    return { source: source.id, target: target.id, inquiry: pending };
  }

  /**
   * The inquiry's move to `completed`, held inside its transaction once the report hook created
   * the report, until `release`.
   */
  function heldCompletion(inquiry: Awaited<ReturnType<typeof completingInquiry>>['inquiry']) {
    const reached = deferred();
    const release = deferred();
    const done = db.transaction(async (tx) => {
      const moved = await transitionInquiryInTx(
        tx,
        { events: createRecordingEventPublisher(), clock },
        inquiry,
        'completed',
      );
      reached.resolve();
      await release.promise;
      return moved;
    });
    return {
      reached: reached.promise,
      release: () => {
        release.resolve();
      },
      done,
    };
  }

  /** The move to `completed`, unheld. */
  const completion = (inquiry: Awaited<ReturnType<typeof completingInquiry>>['inquiry']) =>
    db.transaction((tx) =>
      transitionInquiryInTx(
        tx,
        { events: createRecordingEventPublisher(), clock },
        inquiry,
        'completed',
      ),
    );

  const consolidationDeps = (events: ApiDependencies['events']) =>
    ({
      db,
      clock,
      ids: { newId: (prefix: string) => testId(prefix as 'acc') },
      events,
      audit: createRecordingAuditLogger(),
    }) as unknown as ApiDependencies;
  const consolidation = (
    target: string,
    source: string,
    events = createRecordingEventPublisher(),
  ) =>
    consolidateAccounts(
      consolidationDeps(events),
      ctx(),
      { type: 'api-key', id: testId('key') },
      target,
      [source],
    );

  const reportsOfInquiry = async (inquiryId: string) =>
    (
      await pool.query<{ id: string; account_id: string | null; redacted_at: Date | null }>(
        'select id, account_id, redacted_at from reports where inquiry_id = $1',
        [inquiryId],
      )
    ).rows;
  const linksOf = async (reportId: string) =>
    (
      await pool.query<{ account_id: string }>(
        'select account_id from report_accounts where report_id = $1 order by account_id',
        [reportId],
      )
    ).rows.map((row) => row.account_id);

  /** Runs the report's initial run with a fake type job. */
  async function runInitial(reportId: string, events = createRecordingEventPublisher()) {
    const [initial] = (await listReportRuns(db, environmentId, reportId)).filter(
      (run) => run.runType === 'initial',
    );
    return processorOf(answer(result([])))(
      { environmentId, reportId, runId: initial?.id ?? '' },
      runDeps(events),
      NOT_LAST,
    );
  }

  it('a consolidation during the completion waits for the inquiry, and the initial run links the absorbing account', async () => {
    const { source, target, inquiry } = await completingInquiry();
    const completing = heldCompletion(inquiry);
    await completing.reached;
    const consolidating = consolidation(target, source);
    expect(await within(consolidating, WAIT_MS)).toBe('pending');
    completing.release();
    await completing.done;
    await consolidating;

    const [report] = await reportsOfInquiry(inquiry.id);
    expect(report).toMatchObject({ account_id: null, redacted_at: null });
    expect((await getInquiry(db, environmentId, inquiry.id))?.accountId).toBe(target);
    expect(await runInitial(report?.id ?? '')).toEqual({ outcome: 'completed', status: 'ready' });
    expect((await reportsOfInquiry(inquiry.id))[0]?.account_id).toBe(target);
    expect(await linksOf(report?.id ?? '')).toEqual([target]);
  });

  it('a completion during a consolidation waits for it, and the initial run links the absorbing account', async () => {
    const { source, target, inquiry } = await completingInquiry();
    const events = gatedEvents();
    const release = deferred();
    events.hold(release.promise);
    const consolidating = consolidation(target, source, events.publisher);
    await events.reached;
    const completing = completion(inquiry);
    expect(await within(completing, WAIT_MS)).toBe('pending');
    release.resolve();
    await consolidating;
    expect(await completing).not.toBeNull();

    const [report] = await reportsOfInquiry(inquiry.id);
    expect(await runInitial(report?.id ?? '')).toEqual({ outcome: 'completed', status: 'ready' });
    expect((await reportsOfInquiry(inquiry.id))[0]?.account_id).toBe(target);
    expect(await linksOf(report?.id ?? '')).toEqual([target]);
  });

  it('an account redaction during the completion waits for the inquiry and redacts the new report', async () => {
    const { source, inquiry } = await completingInquiry();
    const completing = heldCompletion(inquiry);
    await completing.reached;
    const redacting = createRedactionService({
      db,
      storage: createInMemoryFileStorage(),
      events: createRecordingEventPublisher(),
      clock,
    }).redactAccount(ctx(), source, null);
    expect(await within(redacting, WAIT_MS)).toBe('pending');
    completing.release();
    await completing.done;
    await redacting;

    const reports = await reportsOfInquiry(inquiry.id);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.redacted_at).not.toBeNull();
    expect(await runInitial(reports[0]?.id ?? '')).toEqual({ outcome: 'not_claimed' });
  });

  it('a completion that waited for an account redaction creates no report for the redacted inquiry', async () => {
    const { source, inquiry } = await completingInquiry();
    const events = gatedEvents();
    const release = deferred();
    events.hold(release.promise);
    // Held inside the inquiry's redaction transaction, at its first staged event.
    const redacting = createRedactionService({
      db,
      storage: createInMemoryFileStorage(),
      events: events.publisher,
      clock,
    }).redactAccount(ctx(), source, null);
    await events.reached;
    // The completion read the inquiry before the redaction, as settlement does, and waits for it.
    const completing = completion(inquiry);
    expect(await within(completing, WAIT_MS)).toBe('pending');
    release.resolve();
    await redacting;
    await completing;

    expect((await getInquiry(db, environmentId, inquiry.id))?.redactedAt).not.toBeNull();
    expect(
      (await reportsOfInquiry(inquiry.id)).filter((report) => report.redacted_at === null),
    ).toEqual([]);
  });

  it('a consolidation during the initial run’s account link waits for it and moves the link', async () => {
    const { source, target, inquiry } = await completingInquiry();
    await completion(inquiry);
    const [report] = await reportsOfInquiry(inquiry.id);
    const events = gatedEvents();
    const release = deferred();
    events.hold(release.promise);
    const running = runInitial(report?.id ?? '', events.publisher);
    await events.reached;
    const consolidating = consolidation(target, source);
    expect(await within(consolidating, WAIT_MS)).toBe('pending');
    release.resolve();
    expect(await running).toEqual({ outcome: 'completed', status: 'ready' });
    await consolidating;

    expect((await reportsOfInquiry(inquiry.id))[0]?.account_id).toBe(target);
    expect(await linksOf(report?.id ?? '')).toEqual([target]);
  });

  it('an initial run during a consolidation waits for the absorbed account and links the absorbing one', async () => {
    const { source, target, inquiry } = await completingInquiry();
    await completion(inquiry);
    const [report] = await reportsOfInquiry(inquiry.id);
    const events = gatedEvents();
    const release = deferred();
    events.hold(release.promise);
    const consolidating = consolidation(target, source, events.publisher);
    await events.reached;
    const running = runInitial(report?.id ?? '');
    expect(await within(running, WAIT_MS)).toBe('pending');
    release.resolve();
    await consolidating;
    expect(await running).toEqual({ outcome: 'completed', status: 'ready' });

    expect((await reportsOfInquiry(inquiry.id))[0]?.account_id).toBe(target);
    expect(await linksOf(report?.id ?? '')).toEqual([target]);
  });
});
