/**
 * C75 (Workflow 6A Stage 3, `api-reports`): dismissing and reviewing a report's matches through
 * the server API: the dismissal and its ignore list, every review status, the re-opening of a
 * mistaken dismissal, the superseded and delisted rows (C75.8), the refusals, the events with
 * their meta, the history actions, pause-on-match's resume and the masked API-log bodies. The
 * matches come from runs of the framework with a fake type job. Synthetic values only.
 */
import { watchlistReportResourceSchema } from '@openverify/contracts';
import type { Permission } from '@openverify/core';
import {
  createApiKey,
  createReport,
  generateApiKey,
  getReport,
  listApiLogs,
  listReportMatches,
} from '@openverify/db';
import {
  seedReport,
  seedReportMatch,
  seedReportRun,
  seedReportTemplate,
  testId,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHASE6_DEFAULTS } from '../../config.js';
import { createWorkerLogger } from '../../jobs/logger.js';
import type { FoundReportMatch, ReportRunResult } from '../../jobs/report-types/index.js';
import { createReportRunProcessor, type ReportRunProcessorDeps } from '../../jobs/reports/run.js';
import {
  bearer,
  createTestApi,
  expectStatus,
  TEST_PEPPER,
  type TestApi,
} from '../../test-support/harness.js';

let api: TestApi;
const BLIND_INDEX_KEY = new Uint8Array(32).fill(0x4e);
const REASON = 'Synthetic: a different person, other birth date';

beforeAll(async () => {
  api = await createTestApi();
}, 60_000);

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  api.events.events.length = 0;
});

function deps(): ReportRunProcessorDeps {
  return {
    db: api.database.db,
    clock: api.clock,
    logger: createWorkerLogger({ level: 'silent' }),
    events: api.events,
    keyring: api.database.keyring,
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

const SOURCE = {
  sourceId: 'openverify-sandbox',
  syncId: '1',
  publishedAt: new Date('2026-01-01T00:00:00.000Z'),
  checkedAt: new Date('2026-10-20T00:00:00.000Z'),
  sha256: 'a'.repeat(64),
  origin: 'import' as const,
  attribution: 'Synthetic attribution',
};

function found(entryId: string, contentHash = 'c1'): FoundReportMatch {
  const entryKey = `openverify-sandbox:${entryId}`;
  return {
    sourceId: 'openverify-sandbox',
    entryKey,
    contentHash,
    riskDataHash: 'r1',
    matchedName: `Avery Synthetic ${entryId}`,
    score: 0.9,
    snapshot: {
      entity: {
        'entity-id': entryKey,
        name: `Avery Synthetic ${entryId}`,
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
        'list-name': `Avery Synthetic ${entryId}`,
        'name-level': 'full',
        methods: ['equal'],
        preset: 'tolerant',
        'min-score': 0.8,
      },
    },
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

/** Runs one run of the report with a fake job that answers `value`. */
async function runWith(reportId: string, runId: string, value: ReportRunResult) {
  const processor = createReportRunProcessor({
    jobs: (type) => ({ type, run: () => Promise.resolve({ kind: 'completed', result: value }) }),
  });
  return processor({ environmentId: api.environmentId, reportId, runId }, deps(), {
    lastAttempt: false,
  });
}

/** A report whose initial run found `entryIds` (or answered `value`). */
async function matched(
  entryIds: string[],
  options: { config?: Record<string, unknown>; value?: ReportRunResult; recurrence?: number } = {},
) {
  const { templateId, versionId } = await seedReportTemplate(api.database.db, api.environmentId, {
    config: { 'search-lists': ['openverify-sandbox'], ...options.config },
  });
  const runId = testId('rpr');
  const report = await createReport(api.database.db, api.environmentId, {
    id: testId('rep'),
    reportType: 'watchlist',
    reportTemplateId: templateId,
    reportTemplateVersionId: versionId,
    origin: 'api',
    query: { 'name-first': 'Avery', 'name-last': 'Synthetic' },
    querySources: { 'name-first': 'request', 'name-last': 'request' },
    inquiryId: null,
    accountId: null,
    recurrenceIntervalDays: options.recurrence ?? null,
    nextRunAt:
      options.recurrence === undefined
        ? null
        : new Date(api.clock.now().getTime() + options.recurrence * 86_400_000),
    createdAt: api.clock.now(),
    initialRun: { id: runId, scheduledFor: api.clock.now() },
  });
  await runWith(report.id, runId, options.value ?? result(entryIds.map((id) => found(id))));
  return report.id;
}

/** Runs the report again with what `value` says it found. */
async function rerun(reportId: string, value: ReportRunResult) {
  const runId = await seedReportRun(api.database.db, api.environmentId, {
    reportId,
    runType: 'manual',
    scheduledFor: api.clock.now(),
  });
  await runWith(reportId, runId, value);
}

const post = (path: string, attributes: Record<string, unknown>, token = api.token) =>
  api.app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    headers: bearer(token),
    payload: { data: { attributes } },
  });
const get = (path: string, token = api.token) =>
  api.app.inject({ method: 'GET', url: `/api/v1${path}`, headers: bearer(token) });

const matchesOf = (reportId: string) =>
  listReportMatches(api.database.db, api.environmentId, reportId);
const eventNames = () => api.events.events.map((event) => event.name);
const metaOf = (name: string) =>
  (
    api.events.events.find((event) => event.name === name)?.payload as
      { meta?: unknown } | undefined
  )?.meta;

describe('POST /reports/:id/dismiss (C75.2)', () => {
  it('dismisses every open match into the ignore list, fires dismissed with the match ids and records the action', async () => {
    const reportId = await matched(['SBX-D1', 'SBX-D2']);
    const ids = (await matchesOf(reportId)).map((match) => match.id).sort();
    api.events.events.length = 0;
    const document = expectStatus(
      await post(`/reports/${reportId}/dismiss`, { reason: REASON }),
      200,
    );
    expect(document.data.attributes).toMatchObject({ status: 'ready', 'has-match': false });
    const ignored = document.data.attributes['ignore-list'] as Record<string, unknown>[];
    expect(ignored.map((entry) => entry['match-id']).sort()).toEqual(ids);
    expect(ignored[0]).toMatchObject({
      'ignore-reason': REASON,
      user: expect.stringMatching(/^key_/) as unknown,
    });
    expect(document.data.attributes['matched-lists']).toEqual([]);
    expect((await matchesOf(reportId)).map((match) => [match.status, match.reviewStatus])).toEqual([
      ['dismissed', 'false_positive'],
      ['dismissed', 'false_positive'],
    ]);
    expect(eventNames()).toEqual(['report/watchlist.dismissed']);
    expect(
      (metaOf('report/watchlist.dismissed') as { 'match-ids': string[] })['match-ids'].sort(),
    ).toEqual(ids);
    const history = expectStatus(await get(`/reports/${reportId}/history`), 200);
    expect(history.data[0]).toMatchObject({
      type: 'report-action',
      attributes: {
        'action-type': 'dismiss',
        reason: REASON,
        'match-ids': expect.arrayContaining(ids) as unknown,
      },
    });
    expect(api.audit.entries.map((entry) => entry.action)).toContain('report.dismissed');
  });

  it('dismisses only the entry it names, and answers 404 for an entry the report does not hold', async () => {
    const reportId = await matched(['SBX-E1', 'SBX-E2']);
    const document = expectStatus(
      await post(`/reports/${reportId}/dismiss`, {
        reason: REASON,
        'entity-id': 'openverify-sandbox:SBX-E1',
      }),
      200,
    );
    expect(document.data.attributes['has-match']).toBe(true);
    const byEntry = new Map(
      (await matchesOf(reportId)).map((match) => [match.snapshot?.['entry-key'], match.status]),
    );
    expect(byEntry.get('openverify-sandbox:SBX-E1')).toBe('dismissed');
    expect(byEntry.get('openverify-sandbox:SBX-E2')).toBe('open');
    const missing = await post(`/reports/${reportId}/dismiss`, {
      reason: REASON,
      'entity-id': 'openverify-sandbox:SBX-NONE',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'report_match_not_found' });
  });

  it('keeps a dismissed match suppressed on a re-run with the same evidence', async () => {
    const reportId = await matched(['SBX-S1']);
    expectStatus(await post(`/reports/${reportId}/dismiss`, { reason: REASON }), 200);
    api.events.events.length = 0;
    await rerun(reportId, result([found('SBX-S1')]));
    expect(eventNames()).toEqual(['report/watchlist.ready']);
    expect((await getReport(api.database.db, api.environmentId, reportId))?.hasMatch).toBe(false);
  });

  it('refuses a pending report, an errored one without a match, a type without review and a redacted report', async () => {
    const { templateId, versionId } = await seedReportTemplate(api.database.db, api.environmentId, {
      config: { 'search-lists': ['openverify-sandbox'] },
    });
    const pending = await seedReport(api.database.db, api.environmentId, { templateId, versionId });
    const erroredId = await matched([], {
      value: result([], { errors: [{ code: 'list_stale', source: 'ofac-sdn' }] }),
    });
    const email = await seedReportTemplate(api.database.db, api.environmentId, {
      reportType: 'email-address',
    });
    const emailReport = await seedReport(api.database.db, api.environmentId, {
      templateId: email.templateId,
      versionId: email.versionId,
      reportType: 'email-address',
      status: 'ready',
      query: { 'email-address': 'synthetic@example.test' },
    });
    for (const id of [pending, erroredId, emailReport]) {
      const response = await post(`/reports/${id}/dismiss`, { reason: REASON });
      expect(response.statusCode, id).toBe(409);
      expect(response.json()).toMatchObject({ code: 'report_not_reviewable' });
    }
    const redacted = await seedReport(api.database.db, api.environmentId, {
      templateId,
      versionId,
      status: 'ready',
      query: null,
      redactedAt: api.clock.now(),
    });
    const gone = await post(`/reports/${redacted}/dismiss`, { reason: REASON });
    expect(gone.statusCode).toBe(410);
    expect(gone.json()).toMatchObject({ code: 'report_redacted' });
    const writer = await api.newApiKey(api.environmentId, {
      scopes: ['reports:write', 'reports:read'],
    });
    expect(
      (await post(`/reports/${erroredId}/dismiss`, { reason: REASON }, writer)).statusCode,
    ).toBe(403);
  });

  it('dismisses the matches an errored run kept, and the report stays errored (C69.4)', async () => {
    const reportId = await matched([], {
      value: result([found('SBX-K1')], { errors: [{ code: 'list_stale', source: 'eu-fsf' }] }),
    });
    const document = expectStatus(
      await post(`/reports/${reportId}/dismiss`, { reason: REASON }),
      200,
    );
    expect(document.data.attributes).toMatchObject({ status: 'errored', 'has-match': false });
  });

  it('serves the stored dismissal body with its reason masked to a caller without pii:view (P04)', async () => {
    const reportId = await matched(['SBX-L1']);
    expectStatus(await post(`/reports/${reportId}/dismiss`, { reason: REASON }), 200);
    const developer = api.newUserToken(api.environmentId, { permissions: ['api-logs:read'] });
    await vi.waitFor(async () => {
      const page = await listApiLogs(api.database.db, api.environmentId, {
        route: '/api/v1/reports/:id/dismiss',
      });
      expect(page.items.length).toBeGreaterThan(0);
    });
    const logs = expectStatus(
      await get('/api-logs?filter[route]=/api/v1/reports/:id/dismiss', developer),
      200,
    );
    expect(logs.data.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs.data)).not.toContain(REASON);
  });
});

describe('POST /reports/:id/review (C75.5, C75.8)', () => {
  it('reviews one record, keeps it open and fires reviewed with its meta', async () => {
    const reportId = await matched(['SBX-R1', 'SBX-R2']);
    const [match] = await matchesOf(reportId);
    api.events.events.length = 0;
    const document = expectStatus(
      await post(`/reports/${reportId}/review`, {
        'review-type': 'record',
        'record-token': match?.id,
        'review-status': 'true_positive',
        'risk-level': 'material',
        comment: 'Synthetic: confirmed by the reviewer',
        'notify-on-change': true,
      }),
      200,
    );
    expect(document.data.attributes['has-match']).toBe(true);
    const reviewed = (await matchesOf(reportId)).find((row) => row.id === match?.id);
    expect(reviewed).toMatchObject({
      status: 'open',
      reviewStatus: 'true_positive',
      riskLevel: 'material',
      notifyOnChange: true,
    });
    expect(reviewed?.reviewedAt).toBeInstanceOf(Date);
    expect(eventNames()).toEqual(['report/watchlist.reviewed']);
    expect(metaOf('report/watchlist.reviewed')).toEqual({
      'review-type': 'record',
      'review-status': 'true_positive',
      'risk-level': 'material',
      'record-token': match?.id,
      reviewer: expect.stringMatching(/^key_/) as unknown,
    });
  });

  it('reviews every open match with all_records, in one reviewed event', async () => {
    const reportId = await matched(['SBX-A1', 'SBX-A2']);
    api.events.events.length = 0;
    expectStatus(
      await post(`/reports/${reportId}/review`, {
        'review-type': 'all_records',
        'review-status': 'indeterminate',
      }),
      200,
    );
    expect((await matchesOf(reportId)).map((match) => match.reviewStatus)).toEqual([
      'indeterminate',
      'indeterminate',
    ]);
    expect(eventNames()).toEqual(['report/watchlist.reviewed']);
    expect(metaOf('report/watchlist.reviewed')).toMatchObject({
      'record-token': null,
      'risk-level': null,
    });
  });

  it('dismisses a false positive, with reviewed and dismissed, the comment as the ignore reason', async () => {
    const reportId = await matched(['SBX-F1']);
    const [match] = await matchesOf(reportId);
    api.events.events.length = 0;
    const document = expectStatus(
      await post(`/reports/${reportId}/review`, {
        'review-type': 'record',
        'record-token': match?.id,
        'review-status': 'false_positive',
        comment: REASON,
      }),
      200,
    );
    expect(document.data.attributes['has-match']).toBe(false);
    expect((document.data.attributes['ignore-list'] as Record<string, unknown>[])[0]).toMatchObject(
      {
        'ignore-reason': REASON,
      },
    );
    expect(eventNames()).toEqual(['report/watchlist.reviewed', 'report/watchlist.dismissed']);
  });

  it('re-opens a mistaken dismissal, and refuses one whose entry has a newer row (V07)', async () => {
    const reportId = await matched(['SBX-M1']);
    expectStatus(await post(`/reports/${reportId}/dismiss`, { reason: REASON }), 200);
    const [dismissed] = await matchesOf(reportId);
    const reopened = expectStatus(
      await post(`/reports/${reportId}/review`, {
        'review-type': 'record',
        'record-token': dismissed?.id,
        'review-status': 'true_positive',
      }),
      200,
    );
    expect(reopened.data.attributes['has-match']).toBe(true);
    expect(reopened.data.attributes['ignore-list']).toEqual([]);
    expect((await matchesOf(reportId))[0]).toMatchObject({
      status: 'open',
      reviewStatus: 'true_positive',
    });

    const lapsing = await matched(['SBX-M2']);
    expectStatus(await post(`/reports/${lapsing}/dismiss`, { reason: REASON }), 200);
    const [old] = await matchesOf(lapsing);
    await rerun(lapsing, result([found('SBX-M2', 'c2')]));
    expect((await matchesOf(lapsing)).map((match) => match.status)).toEqual(['open', 'dismissed']);
    const superseded = await post(`/reports/${lapsing}/review`, {
      'review-type': 'record',
      'record-token': old?.id,
      'review-status': 'true_positive',
    });
    expect(superseded.statusCode).toBe(409);
    expect(superseded.json()).toMatchObject({ code: 'report_match_superseded' });
  });

  it('records a review of a delisted match, which stays delisted', async () => {
    const { templateId, versionId } = await seedReportTemplate(api.database.db, api.environmentId, {
      config: { 'search-lists': ['openverify-sandbox'] },
    });
    const reportId = await seedReport(api.database.db, api.environmentId, {
      templateId,
      versionId,
      status: 'ready',
    });
    const runId = await seedReportRun(api.database.db, api.environmentId, {
      reportId,
      status: 'ready',
    });
    const delisted = await seedReportMatch(api.database.db, api.environmentId, {
      reportId,
      runId,
      status: 'delisted',
      snapshot: found('SBX-X1').snapshot,
    });
    expectStatus(
      await post(`/reports/${reportId}/review`, {
        'review-type': 'record',
        'record-token': delisted,
        'review-status': 'indeterminate',
      }),
      200,
    );
    expect((await matchesOf(reportId))[0]).toMatchObject({
      status: 'delisted',
      reviewStatus: 'indeterminate',
    });
  });

  it('answers 404 for a record of another report, and 409 for nothing open to review', async () => {
    const reportId = await matched(['SBX-N1']);
    const other = await matched(['SBX-N2']);
    const [foreign] = await matchesOf(other);
    const missing = await post(`/reports/${reportId}/review`, {
      'review-type': 'record',
      'record-token': foreign?.id,
      'review-status': 'true_positive',
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'report_match_not_found' });
    expectStatus(await post(`/reports/${reportId}/dismiss`, { reason: REASON }), 200);
    const none = await post(`/reports/${reportId}/review`, {
      'review-type': 'all_records',
      'review-status': 'true_positive',
    });
    expect(none.statusCode).toBe(404);
    expect(none.json()).toMatchObject({ code: 'report_match_not_found' });
  });

  it('resumes a report paused on a match once no open match is unreviewed (C74.5)', async () => {
    const reportId = await matched(['SBX-P1'], {
      config: { 'recurrence-interval-days': 7, 'pause-on-match': true, 'resume-delay-minutes': 30 },
      recurrence: 7,
    });
    expect((await getReport(api.database.db, api.environmentId, reportId))?.pausedReason).toBe(
      'match',
    );
    expectStatus(
      await post(`/reports/${reportId}/review`, {
        'review-type': 'all_records',
        'review-status': 'true_positive',
      }),
      200,
    );
    const report = await getReport(api.database.db, api.environmentId, reportId);
    expect(report).toMatchObject({ pausedAt: null, pausedReason: null });
    expect(report?.nextRunAt?.getTime()).toBe(api.clock.now().getTime() + 30 * 60_000);
  });
});

describe('review and dismissal need pii:view (owner decision 16, C75.5 amended)', () => {
  const REVIEW = { 'review-type': 'all_records', 'review-status': 'true_positive' };

  /** A user session holding `permissions` in the harness's environment. */
  const userWith = (permissions: readonly Permission[]) =>
    api.newUserToken(api.environmentId, { permissions });

  /**
   * An API key minted by a user without `pii:view`: the API stores it `pii_masked` (2B F001,
   * `services/api-keys.ts`), as written here.
   */
  async function maskedKey(): Promise<string> {
    const generated = generateApiKey('sandbox', TEST_PEPPER);
    await createApiKey(api.database.db, api.environmentId, {
      id: testId('key'),
      name: 'Masked reviewer',
      prefix: generated.prefix,
      secretHash: generated.secretHash,
      scopes: ['reports:read', 'reports:review'],
      piiMasked: true,
    });
    return generated.token;
  }

  async function expectRefused(token: string) {
    const reportId = await matched(['SBX-K1']);
    api.events.events.length = 0;
    const missing = `rep_${'0'.repeat(26)}`;
    for (const [path, attributes] of [
      [`/reports/${reportId}/dismiss`, { reason: REASON }],
      [`/reports/${reportId}/review`, REVIEW],
      [`/reports/${missing}/dismiss`, { reason: REASON }],
    ] as const) {
      const response = await post(path, attributes, token);
      expect(response.statusCode, path).toBe(403);
      expect(response.json(), path).toMatchObject({
        type: 'https://openverify.dev/problems/forbidden',
      });
      expect(response.body, path).toContain('pii:view');
    }
    expect((await matchesOf(reportId)).map((match) => [match.status, match.reviewStatus])).toEqual([
      ['open', 'pending'],
    ]);
    expect(eventNames()).toEqual([]);
    const history = expectStatus(await get(`/reports/${reportId}/history`), 200) as unknown as {
      data: { type: string }[];
    };
    expect(history.data.filter((entry) => entry.type === 'report-action')).toEqual([]);
  }

  it('refuses a user without pii:view with 403 forbidden, before reading the report, and changes nothing', async () => {
    await expectRefused(userWith(['reports:read', 'reports:review']));
  });

  it('refuses an API key minted masked with 403 forbidden, and changes nothing', async () => {
    await expectRefused(await maskedKey());
  });

  it('keeps an unmasked API key and a user with pii:view reviewing and dismissing', async () => {
    const byKey = await matched(['SBX-K2']);
    expectStatus(await post(`/reports/${byKey}/review`, REVIEW, api.token), 200);
    expectStatus(await post(`/reports/${byKey}/dismiss`, { reason: REASON }, api.token), 200);
    const byUser = await matched(['SBX-K3']);
    const reviewer = userWith(['reports:read', 'reports:review', 'pii:view']);
    expectStatus(await post(`/reports/${byUser}/review`, REVIEW, reviewer), 200);
    expectStatus(await post(`/reports/${byUser}/dismiss`, { reason: REASON }, reviewer), 200);
    expect((await matchesOf(byUser)).map((match) => match.status)).toEqual(['dismissed']);
  });
});

describe('the evidence members of owner decision 9', () => {
  it('serves an entry’s list memberships from the snapshot in the matched lists and the ignore list, in the contract', async () => {
    const memberships = [{ list: 'Synthetic Sectoral List', program: 'SYNTHETIC-SECTORAL' }];
    const listed = found('SBX-LM1');
    const entity = { ...(listed.snapshot.entity as Record<string, unknown>) };
    entity['list-memberships'] = memberships;
    const reportId = await matched([], {
      value: result([{ ...listed, snapshot: { ...listed.snapshot, entity } }]),
    });

    const served = expectStatus(await get(`/reports/${reportId}`), 200) as unknown as {
      data: {
        attributes: {
          status: string;
          errors: unknown[];
          'matched-lists': { entities: Record<string, unknown>[] }[];
        };
      };
    };
    // The framework refuses a match its type's served shape does not take (execution_error).
    expect(served.data.attributes).toMatchObject({ status: 'ready', errors: [] });
    expect(watchlistReportResourceSchema.safeParse(served.data).success).toBe(true);
    expect(served.data.attributes['matched-lists'][0]?.entities[0]?.['list-memberships']).toEqual(
      memberships,
    );

    const dismissed = expectStatus(
      await post(`/reports/${reportId}/dismiss`, { reason: REASON }),
      200,
    ) as unknown as {
      data: {
        attributes: { 'ignore-list': { match: { entities: Record<string, unknown>[] } }[] };
      };
    };
    expect(
      dismissed.data.attributes['ignore-list'][0]?.match.entities[0]?.['list-memberships'],
    ).toEqual(memberships);
  });
});
