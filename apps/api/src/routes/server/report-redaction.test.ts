/**
 * C73.4, C73.5 (P01, F04; Workflow 6A Stage 3, `api-reports`): redacting a report through
 * `DELETE /reports/:id`, the inquiry and account cascades with the account catch-up, the 410 of
 * every change afterwards, the scan of every report table for the matched entry, the subject and
 * the HMACs, and the blind-index rebuild that keeps a dismissal through a key rotation. The real
 * redaction and accounts services; the matches come from framework runs with a fake type job.
 * Synthetic values only.
 */
import {
  createAccount,
  createReport,
  getReport,
  linkReportAccount,
  listReportActions,
  listReportMatches,
  rebuildReportIndexes,
} from '@openverify/db';
import {
  createTestInquiry,
  seedReportRun,
  seedReportTemplate,
  testId,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PHASE6_DEFAULTS } from '../../config.js';
import { createWorkerLogger } from '../../jobs/logger.js';
import type { FoundReportMatch, ReportRunResult } from '../../jobs/report-types/index.js';
import { createReportRunProcessor, type ReportRunProcessorDeps } from '../../jobs/reports/run.js';
import { createAccountsService } from '../../services/accounts.js';
import { createRedactionService } from '../../services/redaction.js';
import { redactAccountReportsInTx } from '../../services/reports/redaction.js';
import { bearer, createTestApi, expectStatus, type TestApi } from '../../test-support/harness.js';

let api: TestApi;
let blindIndexKey = new Uint8Array(32).fill(0x5a);
const SUBJECT = { 'name-first': 'Perpetua', 'name-last': 'Redactable' };
const ENTRY_ID = 'SBX-RD-0001';

beforeAll(async () => {
  api = await createTestApi((defaults) => ({
    accounts: createAccountsService({ events: defaults.events, ids: defaults.ids }),
    redaction: createRedactionService({
      db: defaults.db,
      storage: defaults.storage,
      events: defaults.events,
      clock: defaults.clock,
      audit: defaults.audit,
    }),
  }));
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
    blindIndexKey,
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

function found(contentHash = 'c'.repeat(64)): FoundReportMatch {
  const entryKey = `openverify-sandbox:${ENTRY_ID}`;
  return {
    sourceId: 'openverify-sandbox',
    entryKey,
    contentHash,
    riskDataHash: 'r'.repeat(64),
    matchedName: 'Perpetua Redactable',
    score: 0.93,
    snapshot: {
      entity: {
        'entity-id': entryKey,
        name: 'Perpetua Redactable',
        'alias-type': 'primary_name',
        'match-types': ['name_exact'],
        birthdates: [{ day: 3, month: 9, year: 1977, granularity: 'day' }],
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
      qualifiers: ['dob_exact'],
      components: {
        'subject-name': 'Perpetua Redactable',
        'list-name': 'Perpetua Redactable',
        'name-level': 'full',
        methods: ['equal'],
        preset: 'tolerant',
        'min-score': 0.8,
      },
    },
  };
}

function result(matches: FoundReportMatch[]): ReportRunResult {
  return {
    errors: [],
    sources: [
      {
        sourceId: 'openverify-sandbox',
        syncId: '1',
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        checkedAt: new Date('2026-10-20T00:00:00.000Z'),
        sha256: 'a'.repeat(64),
        origin: 'import',
        attribution: 'Synthetic attribution',
      },
    ],
    coverage: { complete: true, limits: [] },
    result: { 'coverage-detail': [{ 'openverify-sandbox': 'same_script' }] },
    unavailableFields: [],
    provider: null,
    thresholds: { preset: 'tolerant', 'min-score': 0.8 },
    notices: [],
    matcherVersion: 'scorer-1',
    matches,
  };
}

async function runWith(reportId: string, runId: string, value: ReportRunResult) {
  const processor = createReportRunProcessor({
    jobs: (type) => ({ type, run: () => Promise.resolve({ kind: 'completed', result: value }) }),
  });
  return processor({ environmentId: api.environmentId, reportId, runId }, deps(), {
    lastAttempt: false,
  });
}

async function rerun(reportId: string, value: ReportRunResult) {
  const runId = await seedReportRun(api.database.db, api.environmentId, {
    reportId,
    runType: 'manual',
    scheduledFor: api.clock.now(),
  });
  await runWith(reportId, runId, value);
}

/** A recurring report linked as asked, whose initial run found the synthetic entry. */
async function matched(links: { inquiryId?: string; accountId?: string } = {}) {
  const { templateId, versionId } = await seedReportTemplate(api.database.db, api.environmentId, {
    config: { 'search-lists': ['openverify-sandbox'], 'recurrence-interval-days': 7 },
  });
  const runId = testId('rpr');
  const report = await createReport(api.database.db, api.environmentId, {
    id: testId('rep'),
    reportType: 'watchlist',
    reportTemplateId: templateId,
    reportTemplateVersionId: versionId,
    origin: 'api',
    query: SUBJECT,
    querySources: { 'name-first': 'request', 'name-last': 'request' },
    inquiryId: links.inquiryId ?? null,
    accountId: links.accountId ?? null,
    recurrenceIntervalDays: 7,
    nextRunAt: new Date(api.clock.now().getTime() + 7 * 86_400_000),
    createdAt: api.clock.now(),
    initialRun: { id: runId, scheduledFor: api.clock.now() },
  });
  await runWith(report.id, runId, result([found()]));
  return report.id;
}

const call = (method: 'POST' | 'DELETE' | 'GET', path: string, payload?: Record<string, unknown>) =>
  api.app.inject({
    method,
    url: `/api/v1${path}`,
    headers: bearer(api.token),
    ...(payload === undefined ? {} : { payload }),
  });

/**
 * Every column of every report table that belongs to the report, as one string, but a run's
 * `claimed_by`: the worker's `host:pid:random` names the process, not the subject, and a pid can
 * hold any digits (a run with pid 1701977 once read as the birth year 1977).
 */
async function rowsOf(reportId: string): Promise<string> {
  const tables = ['reports', 'report_runs', 'report_matches', 'report_actions', 'report_accounts'];
  const out: unknown[] = [];
  for (const table of tables) {
    const column = table === 'reports' ? 'id' : 'report_id';
    const rows = await api.database.client.query<{ row: string }>(
      `select (to_jsonb(t) - 'claimed_by')::text as row from ${table} t where ${column} = $1`,
      [reportId],
    );
    out.push(...rows.rows.map((row) => row.row));
  }
  const events = await api.database.client.query<{ payload: string }>(
    `select payload::text as payload from events where object_id = $1`,
    [reportId],
  );
  out.push(...events.rows.map((row) => row.payload));
  return out.join('\n');
}

describe('DELETE /reports/:id (C73.5)', () => {
  it('redacts the report, its matches and actions, stubs its events and fires redacted once', async () => {
    const reportId = await matched();
    expectStatus(
      await call('POST', `/reports/${reportId}/dismiss`, {
        data: { attributes: { reason: 'Synthetic: other person' } },
      }),
      200,
    );
    const [match] = await listReportMatches(api.database.db, api.environmentId, reportId);
    const hmacs = [match?.entryIndex, match?.evidenceHash].filter(
      (value): value is string => typeof value === 'string',
    );
    expect(hmacs).toHaveLength(2);
    api.events.events.length = 0;
    const document = expectStatus(await call('DELETE', `/reports/${reportId}`), 200);
    expect(document.data.attributes).toMatchObject({
      'redacted-at': api.clock.now().toISOString(),
      'next-run-at': null,
      'is-recurring': false,
      'matched-lists': null,
      'ignore-list': null,
      matches: null,
    });
    expect(api.events.events.map((event) => event.name)).toEqual(['report/watchlist.redacted']);
    const scan = await rowsOf(reportId);
    for (const value of [
      'Perpetua',
      'Redactable',
      ENTRY_ID,
      '1977',
      'Synthetic: other person',
      ...hmacs,
    ]) {
      expect(scan, value).not.toContain(value);
    }
    const [kept] = await listReportMatches(api.database.db, api.environmentId, reportId);
    expect(kept).toMatchObject({
      status: 'dismissed',
      score: 0.93,
      snapshot: null,
      entryIndex: null,
    });
    expect(api.audit.entries.map((entry) => entry.action)).toContain('report.redacted');

    api.events.events.length = 0;
    expectStatus(await call('DELETE', `/reports/${reportId}`), 200);
    expect(api.events.events).toEqual([]);
  });

  it('answers 410 report_redacted to every change afterwards (H23)', async () => {
    const reportId = await matched();
    expectStatus(await call('DELETE', `/reports/${reportId}`), 200);
    const changes: [string, Record<string, unknown>][] = [
      ['add-tag', { meta: { 'tag-name': 'synthetic' } }],
      ['dismiss', { data: { attributes: { reason: 'Synthetic' } } }],
      [
        'review',
        {
          data: { attributes: { 'review-type': 'all_records', 'review-status': 'true_positive' } },
        },
      ],
      ['pause', {}],
      ['resume', {}],
      ['run', {}],
    ];
    for (const [action, payload] of changes) {
      const response = await call('POST', `/reports/${reportId}/${action}`, payload);
      expect(response.statusCode, action).toBe(410);
      expect(response.json(), action).toMatchObject({ code: 'report_redacted' });
    }
    expectStatus(await call('GET', `/reports/${reportId}`), 200);
  });

  it('answers 404 for a report of another environment', async () => {
    const other = await api.newTenant();
    const response = await api.app.inject({
      method: 'DELETE',
      url: `/api/v1/reports/${testId('rep')}`,
      headers: bearer(other.token),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('the cascades (C73.5, F04)', () => {
  it('redacts the reports of a redacted inquiry', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const reportId = await matched({ inquiryId: inquiry.id });
    expectStatus(await call('POST', `/inquiries/${inquiry.id}/redact`, {}), 200);
    expect(
      (await getReport(api.database.db, api.environmentId, reportId))?.redactedAt,
    ).not.toBeNull();
    expect(api.events.events.map((event) => event.name)).toContain('report/watchlist.redacted');
  });

  it('redacts the reports an account holds, home or linked, and catches up on one linked since', async () => {
    const account = await createAccount(api.database.db, api.environmentId, { id: testId('acc') });
    const home = await matched({ accountId: account.id });
    const linked = await matched();
    await linkReportAccount(api.database.db, api.environmentId, linked, account.id);
    expectStatus(await call('POST', `/accounts/${account.id}/redact`, {}), 200);
    for (const id of [home, linked]) {
      expect(
        (await getReport(api.database.db, api.environmentId, id))?.redactedAt,
        id,
      ).not.toBeNull();
    }
    const late = await matched();
    await linkReportAccount(api.database.db, api.environmentId, late, account.id);
    api.events.events.length = 0;
    const staged = await api.database.db.transaction((tx) =>
      redactAccountReportsInTx(
        tx,
        { events: api.events, clock: api.clock },
        {
          environmentId: api.environmentId,
          accountId: account.id,
          at: api.clock.now(),
          actor: SYSTEM,
        },
      ),
    );
    expect(staged).toHaveLength(1);
    expect((await getReport(api.database.db, api.environmentId, late))?.redactedAt).not.toBeNull();
    expect(await redactActions(late)).toEqual([
      { actorType: 'system', actorId: null, details: null },
    ]);
  });
});

const SYSTEM = { actorType: 'system', actorId: null } as const;

/** The report's `redact` actions, as stored. */
async function redactActions(reportId: string) {
  return (await listReportActions(api.database.db, api.environmentId, reportId))
    .filter((action) => action.actionType === 'redact')
    .map(({ actorType, actorId, details }) => ({ actorType, actorId, details }));
}

/** The `redact` entries of the report's history, as served. */
async function servedRedactions(reportId: string) {
  const history = expectStatus(
    await call('GET', `/reports/${reportId}/history`),
    200,
  ) as unknown as {
    data: { type: string; attributes: Record<string, unknown> }[];
  };
  return history.data
    .filter((entry) => entry.type === 'report-action')
    .filter((entry) => entry.attributes['action-type'] === 'redact')
    .map((entry) => ({ actor: entry.attributes.actor, reason: entry.attributes.reason }));
}

describe('the redact action and its actor (owner decision 12, K6A-8 (d))', () => {
  it('records the API key that deletes the report, once, served in its history without details', async () => {
    const reportId = await matched();
    expectStatus(await call('DELETE', `/reports/${reportId}`), 200);
    expectStatus(await call('DELETE', `/reports/${reportId}`), 200);

    const stored = await redactActions(reportId);
    expect(stored).toEqual([
      { actorType: 'api_key', actorId: expect.stringMatching(/^key_/u) as unknown, details: null },
    ]);
    expect(await servedRedactions(reportId)).toEqual([{ actor: stored[0]?.actorId, reason: null }]);
  });

  it('records the user who deletes the report', async () => {
    const reportId = await matched();
    const token = api.newUserToken(api.environmentId, {
      permissions: ['reports:read', 'reports:redact'],
      userId: 'usr_01M5Y5Z4002AR4WWQRG0C7TSD9',
    });
    expectStatus(
      await api.app.inject({
        method: 'DELETE',
        url: `/api/v1/reports/${reportId}`,
        headers: bearer(token),
      }),
      200,
    );

    expect(await redactActions(reportId)).toEqual([
      { actorType: 'user', actorId: 'usr_01M5Y5Z4002AR4WWQRG0C7TSD9', details: null },
    ]);
    expect(await servedRedactions(reportId)).toEqual([
      { actor: 'usr_01M5Y5Z4002AR4WWQRG0C7TSD9', reason: null },
    ]);
  });

  it('records system for the inquiry and account cascades and for retention', async () => {
    const { inquiry } = await createTestInquiry(api.database.db, api.environmentId);
    const ofInquiry = await matched({ inquiryId: inquiry.id });
    expectStatus(await call('POST', `/inquiries/${inquiry.id}/redact`, {}), 200);
    const account = await createAccount(api.database.db, api.environmentId, { id: testId('acc') });
    const ofAccount = await matched({ accountId: account.id });
    expectStatus(await call('POST', `/accounts/${account.id}/redact`, {}), 200);
    // Retention redacts through the service without an actor (services/retention.ts).
    const retained = await matched();
    await api.deps.redaction.redactReport(
      { organizationId: api.organizationId, environmentId: api.environmentId },
      retained,
      null,
    );

    for (const reportId of [ofInquiry, ofAccount, retained]) {
      expect(await redactActions(reportId), reportId).toEqual([
        { actorType: 'system', actorId: null, details: null },
      ]);
      expect(await servedRedactions(reportId), reportId).toEqual([
        { actor: 'system', reason: null },
      ]);
    }
  });
});

describe('the blind-index rebuild (C73.4)', () => {
  it('keeps a dismissal through a key rotation, and lapses it when the entry changes', async () => {
    const reportId = await matched();
    expectStatus(
      await call('POST', `/reports/${reportId}/dismiss`, {
        data: { attributes: { reason: 'Synthetic' } },
      }),
      200,
    );
    blindIndexKey = new Uint8Array(32).fill(0x6b);
    const rebuilt = await rebuildReportIndexes(api.database.db, blindIndexKey);
    expect(rebuilt.matches.updated).toBeGreaterThanOrEqual(1);
    api.events.events.length = 0;
    await rerun(reportId, result([found()]));
    expect(api.events.events.map((event) => event.name)).toEqual(['report/watchlist.ready']);
    await rerun(reportId, result([found('d'.repeat(64))]));
    expect(api.events.events.map((event) => event.name)).toContain('report/watchlist.matched');
    const matches = await listReportMatches(api.database.db, api.environmentId, reportId);
    expect(matches.map((match) => match.status)).toEqual(['open', 'dismissed']);
  });
});
