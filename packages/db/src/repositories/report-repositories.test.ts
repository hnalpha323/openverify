/**
 * C73, C74, C75 (Workflow 6A Stage 3, `api-reports`): the report, run, match and action
 * repositories. The report template repository has its own tests (its owner's). Synthetic values
 * only.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createAccount } from './accounts.js';
import {
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  seedReport,
  seedReportTemplate,
  testId,
  wallClockStepsBack,
  type TestDatabase,
} from '../testing.js';
import { insertReportAction, listReportActions } from './report-actions.js';
import {
  dismissedEvidenceExists,
  insertReportMatch,
  listReportMatches,
  updateReportMatch,
} from './report-matches.js';
import {
  addReportRunNotes,
  claimReportRun,
  clearReportRunEnqueued,
  deferReportRun,
  finishReportRun,
  getReportRun,
  hasOpenScheduledRun,
  insertReportRun,
  listReportRuns,
  lockDueRecurringReports,
  releaseReportRunClaim,
  stampEnqueueableReportRuns,
} from './report-runs.js';
import { createReportTemplate, listReportTemplateSourceLists } from './report-templates.js';
import {
  applyReportTagOperation,
  countRecurringReports,
  createReport,
  getReport,
  getReports,
  linkReportAccount,
  listLinkedReportIds,
  listReports,
  moveReportAccountLinks,
  redactReportRecords,
  scheduledMediaRunLoad,
  scheduledMediaRunsPerDay,
  updateReportState,
  type NewReportInput,
} from './reports.js';

let database: TestDatabase;
let environmentId: string;
let otherEnvironmentId: string;
const T = new Date('2026-10-27T10:00:00.000Z');
const minutes = (n: number) => new Date(T.getTime() + n * 60_000);

beforeAll(async () => {
  database = await createTestDatabase();
  environmentId = (await createTestTenant(database.db)).environment.id;
  otherEnvironmentId = (await createTestTenant(database.db)).environment.id;
}, 60_000);

afterAll(async () => {
  await database.close();
});

async function template(type: 'watchlist' | 'adverse-media' = 'watchlist', env = environmentId) {
  return createReportTemplate(database.db, env, {
    id: testId('rptp'),
    name: 'Synthetic screening',
    reportType: type,
    version: { id: testId('rptpv'), config: { 'search-lists': ['openverify-sandbox'] } },
  });
}

async function report(overrides: Partial<NewReportInput> = {}) {
  const created = overrides.reportTemplateId === undefined ? await template() : null;
  return createReport(database.db, environmentId, {
    id: testId('rep'),
    reportType: 'watchlist',
    reportTemplateId: created?.id ?? '',
    reportTemplateVersionId: created?.currentVersion.id ?? '',
    origin: 'api',
    query: { 'name-first': 'Avery', 'name-last': 'Synthetic' },
    querySources: { 'name-first': 'request', 'name-last': 'request' },
    inquiryId: null,
    accountId: null,
    recurrenceIntervalDays: null,
    nextRunAt: null,
    createdAt: T,
    initialRun: { id: testId('rpr'), scheduledFor: T },
    ...overrides,
  });
}

describe('reports (C70, C72, C73)', () => {
  it('creates a pending report with its initial run and home account link, its query sealed', async () => {
    const account = await createAccount(database.db, environmentId, { id: testId('acc') });
    const created = await report({ accountId: account.id });
    expect(created).toMatchObject({
      status: 'pending',
      origin: 'api',
      versionNumber: 1,
      query: { 'name-first': 'Avery', 'name-last': 'Synthetic' },
      queryFields: ['name-first', 'name-last'],
      accountId: account.id,
      accountIds: [account.id],
      completedRunCount: 0,
      hasMatch: false,
    });
    const raw = await database.db.execute(
      sql`select query::text as query from reports where id = ${created.id}`,
    );
    expect(JSON.stringify(raw.rows)).not.toContain('Avery');
    const runs = await listReportRuns(database.db, environmentId, created.id);
    expect(runs.map((run) => [run.runType, run.status])).toEqual([['initial', 'pending']]);
    expect(await getReport(database.db, otherEnvironmentId, created.id)).toBeNull();
    expect((await getReport(database.db, environmentId, created.id, { lock: 'update' }))?.id).toBe(
      created.id,
    );
  });

  it('filters lists as the public API does, has-match false only among ready reports', async () => {
    const env = (await createTestTenant(database.db)).environment.id;
    const tpl = await template('watchlist', env);
    const { inquiry } = await createTestInquiry(database.db, env);
    const account = await createAccount(database.db, env, {
      id: testId('acc'),
      referenceId: 'synthetic-ref-1',
    });
    const base = {
      reportType: 'watchlist' as const,
      reportTemplateId: tpl.id,
      reportTemplateVersionId: tpl.currentVersion.id,
      origin: 'api' as const,
      query: { term: 'Synthetic' },
      querySources: {},
      inquiryId: null,
      accountId: null,
      recurrenceIntervalDays: null,
      nextRunAt: null,
    };
    const make = (n: number, extra: Partial<NewReportInput> = {}) =>
      createReport(database.db, env, {
        ...base,
        id: testId('rep'),
        createdAt: minutes(n),
        initialRun: { id: testId('rpr'), scheduledFor: minutes(n) },
        ...extra,
      });
    const pending = await make(1, { inquiryId: inquiry.id });
    const ready = await make(2);
    const matched = await make(3);
    const errored = await make(4, { accountId: account.id });
    await updateReportState(database.db, env, ready.id, { status: 'ready', completedAt: T });
    await updateReportState(database.db, env, matched.id, { status: 'ready', hasMatch: true });
    await updateReportState(database.db, env, errored.id, {
      status: 'errored',
      errors: [{ code: 'list_stale', source: 'ofac-sdn' }],
    });
    await applyReportTagOperation(database.db, env, matched.id, { kind: 'add', tag: 'Priority' });
    const ids = async (options: Parameters<typeof listReports>[2]) =>
      (await listReports(database.db, env, options)).items.map((row) => row.id);
    expect(await ids({})).toEqual([errored.id, matched.id, ready.id, pending.id]);
    expect(await ids({ hasMatch: false })).toEqual([ready.id]);
    expect(await ids({ hasMatch: true })).toEqual([matched.id]);
    expect(await ids({ status: ['errored', 'pending'] })).toEqual([errored.id, pending.id]);
    expect(await ids({ inquiryId: inquiry.id })).toEqual([pending.id]);
    expect(await ids({ accountId: account.id })).toEqual([errored.id]);
    expect(await ids({ referenceId: 'synthetic-ref-1' })).toEqual([errored.id]);
    expect(await ids({ tag: 'priority' })).toEqual([matched.id]);
    expect(await ids({ reportType: 'adverse-media' })).toEqual([]);
    expect(await ids({ reportTemplateId: tpl.id, size: 2 })).toEqual([errored.id, matched.id]);
    const page = await listReports(database.db, env, { size: 2 });
    expect(page.next).toBe(matched.id);
    expect(await ids({ after: matched.id })).toEqual([ready.id, pending.id]);
    expect((await getReports(database.db, env, [pending.id, ready.id])).map((r) => r.id)).toEqual([
      ready.id,
      pending.id,
    ]);
    expect(await listLinkedReportIds(database.db, env, { inquiryId: inquiry.id })).toEqual([
      pending.id,
    ]);
    expect(await listLinkedReportIds(database.db, env, { accountId: account.id })).toEqual([
      errored.id,
    ]);
  });

  it('links accounts once, moves links on consolidation, and counts recurring reports', async () => {
    const first = await createAccount(database.db, environmentId, { id: testId('acc') });
    const second = await createAccount(database.db, environmentId, { id: testId('acc') });
    const target = await createAccount(database.db, environmentId, { id: testId('acc') });
    const created = await report({
      accountId: first.id,
      recurrenceIntervalDays: 7,
      nextRunAt: minutes(60),
    });
    expect(await linkReportAccount(database.db, environmentId, created.id, second.id)).toBe(true);
    expect(await linkReportAccount(database.db, environmentId, created.id, second.id)).toBe(false);
    expect(
      await moveReportAccountLinks(database.db, environmentId, target.id, [first.id, second.id]),
    ).toBe(1);
    const moved = await getReport(database.db, environmentId, created.id);
    expect(moved?.accountId).toBe(target.id);
    expect(moved?.accountIds).toEqual([target.id]);
    expect(await countRecurringReports(database.db, environmentId)).toBeGreaterThanOrEqual(1);
    expect(
      await countRecurringReports(database.db, environmentId, { reportTypes: ['adverse-media'] }),
    ).toBe(0);
    const media = await template('adverse-media');
    await report({
      reportType: 'adverse-media',
      reportTemplateId: media.id,
      reportTemplateVersionId: media.currentVersion.id,
      query: { term: 'Synthetic' },
      recurrenceIntervalDays: 2,
      nextRunAt: minutes(60),
    });
    expect(await scheduledMediaRunsPerDay(database.db, environmentId)).toBeCloseTo(0.5);
  });

  it('applies tags and writes the run-owned columns', async () => {
    const created = await report();
    const added = await applyReportTagOperation(database.db, environmentId, created.id, {
      kind: 'set',
      tags: ['a', 'B', 'b'],
    });
    expect(added).toMatchObject({ changed: true, report: { tags: ['a', 'B'] } });
    expect(
      await applyReportTagOperation(database.db, environmentId, testId('rep'), {
        kind: 'add',
        tag: 'x',
      }),
    ).toBeNull();
    await updateReportState(database.db, environmentId, created.id, {
      status: 'ready',
      result: { 'matched-lists': [] },
      coverage: { complete: false, limits: ['lossy_script'] },
      sources: [{ 'source-id': 'openverify-sandbox' }],
      unavailableFields: [{ field: 'warning-list', reason: 'list_not_configured' }],
      matcherVersion: 'scorer-1',
      provider: { id: 'sandbox', sandbox: true },
      thresholds: { preset: 'tolerant', 'min-score': 0.8 },
      notices: ['no_ownership_screening'],
      completedAt: T,
    });
    const read = await getReport(database.db, environmentId, created.id);
    expect(read).toMatchObject({
      status: 'ready',
      result: { 'matched-lists': [] },
      coverage: { complete: false, limits: ['lossy_script'] },
      matcherVersion: 'scorer-1',
      notices: ['no_ownership_screening'],
    });
  });

  it('redacts the query, result, every match index and snapshot and every action detail (C73.5)', async () => {
    const created = await report({ recurrenceIntervalDays: 3, nextRunAt: minutes(5) });
    const [run] = await listReportRuns(database.db, environmentId, created.id);
    await updateReportState(database.db, environmentId, created.id, {
      result: { secret: 'Avery' },
      cryptoAddressIndex: 'c'.repeat(64),
    });
    await insertReportMatch(database.db, environmentId, {
      id: testId('rpm'),
      reportId: created.id,
      sourceId: 'openverify-sandbox',
      entryIndex: 'a'.repeat(64),
      evidenceHash: 'b'.repeat(64),
      score: 0.9,
      snapshot: { 'entry-key': 'openverify-sandbox:SBX-1001' },
      status: 'open',
      reviewStatus: 'pending',
      runId: run?.id ?? '',
      at: T,
    });
    for (const actionType of ['dismiss', 'review', 'pause', 'resume', 'run'] as const) {
      await insertReportAction(database.db, environmentId, {
        id: testId('ract'),
        reportId: created.id,
        actionType,
        actorType: 'system',
        actorId: null,
        details: { reason: 'Avery reason' },
        createdAt: T,
      });
    }
    expect(await redactReportRecords(database.db, environmentId, created.id, T)).toEqual({
      matches: 1,
      actions: 5,
    });
    expect(await redactReportRecords(database.db, environmentId, created.id, T)).toBeNull();
    const read = await getReport(database.db, environmentId, created.id);
    expect(read).toMatchObject({
      query: null,
      result: null,
      cryptoAddressIndex: null,
      nextRunAt: null,
      redactedAt: T,
    });
    const [match] = await listReportMatches(database.db, environmentId, created.id);
    expect(match).toMatchObject({ snapshot: null, entryIndex: null, evidenceHash: null });
    expect(match?.score).toBe(0.9);
    const actions = await listReportActions(database.db, environmentId, created.id);
    expect(actions.map((action) => action.details)).toEqual([null, null, null, null, null]);
  });
});

describe('report runs (C74.1)', () => {
  it('claims a due pending run once, fenced by its token, and recovers an expired claim', async () => {
    const created = await report();
    const [initial] = await listReportRuns(database.db, environmentId, created.id);
    const id = initial?.id ?? '';
    const first = await claimReportRun(database.db, environmentId, id, {
      token: 'worker-a:1',
      now: T,
      claimedUntil: minutes(10),
    });
    expect(first).toMatchObject({ status: 'running', attempt: 1, claimedBy: 'worker-a:1' });
    expect(
      await claimReportRun(database.db, environmentId, id, {
        token: 'worker-b:1',
        now: minutes(5),
        claimedUntil: minutes(15),
      }),
    ).toBeNull();
    const recovered = await claimReportRun(database.db, environmentId, id, {
      token: 'worker-b:2',
      now: minutes(11),
      claimedUntil: minutes(21),
    });
    expect(recovered).toMatchObject({ attempt: 2, claimedBy: 'worker-b:2' });
    const outcome = {
      status: 'ready' as const,
      completedAt: minutes(12),
      matchCount: 1,
      newMatchCount: 1,
      sources: [],
      coverage: { complete: true, limits: [] },
      errors: [],
      notes: [],
    };
    expect(await finishReportRun(database.db, environmentId, id, 'worker-a:1', outcome)).toBe(
      false,
    );
    expect(await finishReportRun(database.db, environmentId, id, 'worker-b:2', outcome)).toBe(true);
    expect(await getReportRun(database.db, environmentId, id)).toMatchObject({
      status: 'ready',
      matchCount: 1,
      claimedBy: 'worker-b:2',
    });
    expect(
      await claimReportRun(database.db, environmentId, id, {
        token: 'worker-c:3',
        now: minutes(60),
        claimedUntil: minutes(70),
      }),
    ).toBeNull();
    expect((await getReport(database.db, environmentId, created.id))?.completedRunCount).toBe(1);
    await addReportRunNotes(database.db, environmentId, id, ['report_match']);
    expect((await getReportRun(database.db, environmentId, id))?.notes).toEqual(['report_match']);
  });

  it('releases a claim, defers a budget wait without counting it, and skips redacted reports', async () => {
    const created = await report();
    const [initial] = await listReportRuns(database.db, environmentId, created.id);
    const id = initial?.id ?? '';
    const claim = { token: 'worker-a:1', now: T, claimedUntil: minutes(10) };
    await claimReportRun(database.db, environmentId, id, claim);
    expect(await releaseReportRunClaim(database.db, environmentId, id, 'other')).toBe(false);
    expect(await releaseReportRunClaim(database.db, environmentId, id, 'worker-a:1')).toBe(true);
    expect(await getReportRun(database.db, environmentId, id)).toMatchObject({
      status: 'pending',
      claimedBy: null,
      attempt: 1,
    });
    await claimReportRun(database.db, environmentId, id, { ...claim, token: 'worker-a:2' });
    expect(await deferReportRun(database.db, environmentId, id, 'worker-a:2', minutes(30))).toBe(
      true,
    );
    expect(await getReportRun(database.db, environmentId, id)).toMatchObject({
      status: 'pending',
      attempt: 1,
      enqueuedAt: null,
      notBefore: minutes(30),
    });
    expect(
      await claimReportRun(database.db, environmentId, id, { ...claim, token: 'early' }),
    ).toBeNull();
    await redactReportRecords(database.db, environmentId, created.id, T);
    expect(
      await claimReportRun(database.db, environmentId, id, {
        token: 'late',
        now: minutes(31),
        claimedUntil: minutes(41),
      }),
    ).toBeNull();
  });

  it('stamps enqueueable runs once per five minutes and finds due recurring reports (C74.3)', async () => {
    const created = await report({ recurrenceIntervalDays: 1, nextRunAt: minutes(-1) });
    const [initial] = await listReportRuns(database.db, environmentId, created.id);
    const stamp = (now: Date) =>
      stampEnqueueableReportRuns(database.db, {
        now,
        enqueuedBefore: new Date(now.getTime() - 5 * 60_000),
        limit: 1000,
      });
    const first = await stamp(T);
    expect(first.map((run) => run.runId)).toContain(initial?.id);
    expect((await stamp(minutes(1))).map((run) => run.runId)).not.toContain(initial?.id);
    expect((await stamp(minutes(6))).map((run) => run.runId)).toContain(initial?.id);
    await clearReportRunEnqueued(database.db, environmentId, initial?.id ?? '');
    expect((await stamp(minutes(7))).map((run) => run.runId)).toContain(initial?.id);
    const due = await lockDueRecurringReports(database.db, { now: T, limit: 1000 });
    expect(due.find((row) => row.reportId === created.id)).toMatchObject({
      environmentId,
      recurrenceIntervalDays: 1,
      nextRunAt: minutes(-1),
    });
    expect(await hasOpenScheduledRun(database.db, environmentId, created.id)).toBe(false);
    await insertReportRun(database.db, environmentId, {
      id: testId('rpr'),
      reportId: created.id,
      runType: 'scheduled',
      scheduledFor: T,
    });
    expect(await hasOpenScheduledRun(database.db, environmentId, created.id)).toBe(true);
  });

  it('stamps each environment in turn and an environment’s budget-waiting runs after its others (R001)', async () => {
    const own = await createTestDatabase();
    try {
      const flooding = (await createTestTenant(own.db)).environment.id;
      const victim = (await createTestTenant(own.db)).environment.id;
      const run = async (env: string, scheduledFor: Date) => {
        const created = await createReportTemplate(own.db, env, {
          id: testId('rptp'),
          name: 'Synthetic media',
          reportType: 'adverse-media',
          version: { id: testId('rptpv'), config: {} },
        });
        const id = testId('rpr');
        await createReport(own.db, env, {
          id: testId('rep'),
          reportType: 'adverse-media',
          reportTemplateId: created.id,
          reportTemplateVersionId: created.currentVersion.id,
          origin: 'api',
          query: { term: 'Avery Synthetic' },
          querySources: { term: 'request' },
          inquiryId: null,
          accountId: null,
          recurrenceIntervalDays: null,
          nextRunAt: null,
          createdAt: scheduledFor,
          initialRun: { id, scheduledFor },
        });
        return id;
      };
      // Six budget-waiting runs of the flooding environment, older than everything else.
      const waiting: string[] = [];
      for (let index = 0; index < 6; index += 1) {
        const id = await run(flooding, minutes(-1000 + index));
        const token = `worker:${String(index)}`;
        await claimReportRun(own.db, flooding, id, {
          token,
          now: minutes(-999),
          claimedUntil: minutes(-989),
        });
        await deferReportRun(own.db, flooding, id, token, minutes(-1));
        waiting.push(id);
      }
      const victimRun = await run(victim, minutes(-500));
      const floodingFresh = await run(flooding, minutes(-10));
      const stamp = () =>
        stampEnqueueableReportRuns(own.db, {
          now: T,
          enqueuedBefore: minutes(-5),
          limit: 3,
        });
      expect((await stamp()).map((stamped) => stamped.runId)).toEqual([
        victimRun,
        floodingFresh,
        waiting[0],
      ]);
      expect((await stamp()).map((stamped) => stamped.runId)).toEqual(waiting.slice(1, 4));
    } finally {
      await own.close();
    }
  });
});

describe('report matches and actions (C75, C74.2)', () => {
  it('writes matches, keeps one live row per entry, and finds a dismissed evidence hash', async () => {
    // console-tests-6c follow-up (P5-6): the newest-first order must not rest on the wall clock.
    onTestFinished(wallClockStepsBack());
    const created = await report();
    const [run] = await listReportRuns(database.db, environmentId, created.id);
    const base = {
      reportId: created.id,
      sourceId: 'openverify-sandbox',
      entryIndex: 'd'.repeat(64),
      evidenceHash: 'e'.repeat(64),
      score: 0.92,
      snapshot: { 'entry-key': 'openverify-sandbox:SBX-1001', 'content-hash': 'h1' },
      reviewStatus: 'pending' as const,
      runId: run?.id ?? '',
      at: T,
    };
    const open = await insertReportMatch(database.db, environmentId, {
      ...base,
      id: testId('rpm'),
      status: 'open',
    });
    expect(open).toMatchObject({ status: 'open', snapshot: base.snapshot, presentInLastRun: true });
    await expect(
      insertReportMatch(database.db, environmentId, { ...base, id: testId('rpm'), status: 'open' }),
    ).rejects.toThrow();
    await updateReportMatch(database.db, environmentId, open.id, {
      status: 'dismissed',
      reviewStatus: 'false_positive',
      reviewedAt: T,
      at: T,
    });
    expect(
      await dismissedEvidenceExists(database.db, environmentId, {
        reportId: created.id,
        entryIndex: base.entryIndex,
        evidenceHash: base.evidenceHash,
      }),
    ).toBe(true);
    expect(
      await dismissedEvidenceExists(database.db, environmentId, {
        reportId: created.id,
        entryIndex: base.entryIndex,
        evidenceHash: 'f'.repeat(64),
      }),
    ).toBe(false);
    const lapsed = await insertReportMatch(database.db, environmentId, {
      ...base,
      id: testId('rpm'),
      evidenceHash: 'f'.repeat(64),
      status: 'open',
      lapsedFrom: open.id,
      at: minutes(1),
    });
    await updateReportMatch(database.db, environmentId, lapsed.id, {
      presentInLastRun: false,
      snapshot: { 'entry-key': 'openverify-sandbox:SBX-1001', 'content-hash': 'h2' },
      at: minutes(2),
    });
    const matches = await listReportMatches(database.db, environmentId, created.id);
    expect(matches.map((match) => [match.status, match.lapsedFrom])).toEqual([
      ['open', open.id],
      ['dismissed', null],
    ]);
    expect(matches[0]).toMatchObject({
      presentInLastRun: false,
      snapshot: { 'content-hash': 'h2' },
    });
  });

  it('appends actions with sealed details, newest first', async () => {
    const created = await report();
    const key = testId('key');
    await insertReportAction(database.db, environmentId, {
      id: testId('ract'),
      reportId: created.id,
      actionType: 'dismiss',
      actorType: 'api_key',
      actorId: key,
      details: { reason: 'Synthetic reason', matchIds: [testId('rpm')] },
      createdAt: T,
    });
    await insertReportAction(database.db, environmentId, {
      id: testId('ract'),
      reportId: created.id,
      actionType: 'pause',
      actorType: 'api_key',
      actorId: key,
      details: {},
      createdAt: minutes(1),
    });
    const actions = await listReportActions(database.db, environmentId, created.id);
    expect(actions.map((action) => action.actionType)).toEqual(['pause', 'dismiss']);
    expect(actions[1]?.details?.reason).toBe('Synthetic reason');
    const raw = await database.db.execute(
      sql`select details::text as details from report_actions where report_id = ${created.id}`,
    );
    expect(JSON.stringify(raw.rows)).not.toContain('Synthetic reason');
  });
});

describe('the sources page’s reads of the report tables (C76.4, C81.2)', () => {
  const NOW = new Date('2026-10-27T12:00:00.000Z');

  it('lists the active templates’ pinned source lists from their published versions', async () => {
    const { environment } = await createTestTenant(database.db);
    const { environment: other } = await createTestTenant(database.db);
    const watchlist = await seedReportTemplate(database.db, environment.id, {
      name: 'Synthetic sanctions screening',
      config: { 'search-lists': ['ofac-sdn', 'un-sc'] },
    });
    const pep = await seedReportTemplate(database.db, environment.id, {
      reportType: 'politically-exposed-person',
      config: { 'search-lists': ['wikidata-pep'] },
    });
    await seedReportTemplate(database.db, environment.id, {
      status: 'archived',
      config: { 'search-lists': ['ofac-sdn'] },
    });
    await seedReportTemplate(database.db, environment.id, { reportType: 'email-address' });
    await seedReportTemplate(database.db, other.id, {
      config: { 'search-lists': ['uk-sanctions-list'] },
    });

    const lists = await listReportTemplateSourceLists(database.db, environment.id);

    expect(lists.sort((a, b) => a.reportType.localeCompare(b.reportType))).toEqual([
      {
        reportTemplateId: pep.templateId,
        name: 'Synthetic report template',
        reportType: 'politically-exposed-person',
        searchLists: ['wikidata-pep'],
      },
      {
        reportTemplateId: watchlist.templateId,
        name: 'Synthetic sanctions screening',
        reportType: 'watchlist',
        searchLists: ['ofac-sdn', 'un-sc'],
      },
    ]);
  });

  it('counts the environment’s and the install’s scheduled media runs per day over recurring, live media reports, in one read (C81.2, owner decision 18)', async () => {
    const { environment } = await createTestTenant(database.db);
    const { environment: other } = await createTestTenant(database.db);
    const before = await scheduledMediaRunLoad(database.db, environment.id);
    expect(before.environmentRunsPerDay).toBe(0);
    const media = await seedReportTemplate(database.db, environment.id, {
      reportType: 'adverse-media',
    });
    const business = await seedReportTemplate(database.db, environment.id, {
      reportType: 'business-adverse-media',
    });
    const watchlist = await seedReportTemplate(database.db, environment.id);
    const recurring = (
      template: { templateId: string; versionId: string },
      type: string,
      days: number,
    ) => ({
      ...template,
      reportType: type,
      recurrenceIntervalDays: days,
      nextRunAt: NOW,
    });
    await seedReport(database.db, environment.id, recurring(media, 'adverse-media', 1));
    await seedReport(database.db, environment.id, recurring(media, 'adverse-media', 4));
    await seedReport(database.db, environment.id, recurring(business, 'business-adverse-media', 2));
    await seedReport(database.db, environment.id, {
      ...recurring(media, 'adverse-media', 1),
      pausedAt: NOW,
    });
    await seedReport(database.db, environment.id, {
      ...recurring(media, 'adverse-media', 1),
      redactedAt: NOW,
      query: null,
    });
    await seedReport(database.db, environment.id, recurring(watchlist, 'watchlist', 1));
    await seedReport(database.db, environment.id, { ...media, reportType: 'adverse-media' });
    const elsewhere = await seedReportTemplate(database.db, other.id, {
      reportType: 'adverse-media',
    });
    await seedReport(database.db, other.id, recurring(elsewhere, 'adverse-media', 5));

    const load = await scheduledMediaRunLoad(database.db, environment.id);
    expect(load.environmentRunsPerDay).toBeCloseTo(1.75, 10);
    expect(load.installRunsPerDay - before.installRunsPerDay).toBeCloseTo(1.95, 10);
    expect((await scheduledMediaRunLoad(database.db, other.id)).environmentRunsPerDay).toBeCloseTo(
      0.2,
      10,
    );
  });
});
