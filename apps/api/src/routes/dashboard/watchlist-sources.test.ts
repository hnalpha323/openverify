/**
 * C72.3, C76, C81.2, C86: `GET /api/v1/dashboard/watchlist-sources` (`watchlists:read`) serves the
 * install-wide sources in their frozen schema: each manifest source with its row, counts, last
 * sync, staleness and pending re-screen; the newest syncs; the scheduled media runs against the
 * GDELT budget; and the templates of the operator's environment whose pinned lists hold a disabled
 * source or leave out an enabled one. It holds no screened subject. Lists are the committed
 * synthetic sandbox file; values are synthetic.
 */
import { fileURLToPath } from 'node:url';
import { dashboardWatchlistSourcesSchema, GDELT_INSTALL_BUDGET } from '@openverify/contracts';
import {
  recordWatchlistSourceError,
  type WatchlistSourceState,
  type WatchlistSync,
} from '@openverify/db';
import {
  createTestDatabase,
  seedReport,
  seedReportTemplate,
  type TestDatabase,
} from '@openverify/db/testing';
import { keysVersion, variantGroupsFrom } from '@openverify/watchlist';
import { FIXTURES_DIRECTORY } from '@openverify/watchlist/testing';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { WatchlistSettings } from '../../config.js';
import { GDELT_CITATION } from '../../providers/adverse-media/index.js';
import { loadMatcherData } from '../../watchlists/matcher-data.js';
import { watchlistManifest } from '../../watchlists/manifest.js';
import { reconcileWatchlistSources } from '../../watchlists/reconcile.js';
import { sharedWatchlistSession, syncWatchlistSource } from '../../watchlists/sync.js';
import { createDashboardHarness, type DashboardHarness } from './dashboard.test-support.js';
import { watchlistSourcesDocument } from './watchlist-sources.js';

let database: TestDatabase;
const harnesses: DashboardHarness[] = [];
const KEYS = keysVersion('a'.repeat(64));

beforeAll(async () => {
  database = await createTestDatabase();
  await database.db.execute(sql`truncate watchlist_sources cascade`);
  await reconcileWatchlistSources(database.db, { disabled: [] });
  await syncWatchlistSource(
    {
      db: database.db,
      connect: sharedWatchlistSession(database.db),
      clock: { now: () => new Date('2026-10-20T06:00:00.000Z') },
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
      settings: { removedRetentionDays: 90, pep: {} } as WatchlistSettings,
      matcherData: () => ({
        status: 'loaded',
        groups: variantGroupsFrom([], 'a'.repeat(64)),
        keysVersion: KEYS,
      }),
    },
    {
      sourceId: 'openverify-sandbox',
      actor: 'seed',
      importPath: fileURLToPath(new URL('openverify-sandbox.json', FIXTURES_DIRECTORY)),
    },
  );
  await recordWatchlistSourceError(database.db, {
    sourceId: 'eu-fsf',
    code: 'source_not_configured',
  });
}, 60_000);

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

afterAll(async () => {
  await database.close();
});

async function viewer() {
  const api = await createDashboardHarness(database);
  harnesses.push(api);
  const organization = await api.organization();
  const operator = await api.operator(organization, { roles: ['viewer'] });
  return { api, organization, token: await api.signIn(operator.email) };
}

describe('GET /watchlist-sources (C72.3)', () => {
  it('needs an operator session', async () => {
    const { api } = await viewer();

    expect((await api.call('GET', '/watchlist-sources')).statusCode).toBe(401);
  });

  it('serves every manifest source with its row, counts, last sync and re-screen, in the frozen schema', async () => {
    const { api, token } = await viewer();

    const response = await api.call('GET', '/watchlist-sources', { token });

    expect(response.statusCode, response.body).toBe(200);
    const document = dashboardWatchlistSourcesSchema.parse(response.json());
    expect(document.sources.map(({ id }) => id)).toEqual(
      watchlistManifest().sources.map(({ id }) => id),
    );
    const sandbox = document.sources.find(({ id }) => id === 'openverify-sandbox');
    expect(sandbox).toMatchObject({
      publisher: 'OpenVerify',
      kind: 'sanctions',
      enabled: true,
      'sandbox-only': true,
      configured: true,
      'last-origin': 'import',
      'last-error-code': null,
      'entry-count': 69,
      'name-count': 102,
      stale: false,
      'refresh-interval-hours': null,
      'stale-after-hours': null,
      'rescreen-pending': true,
      attribution: 'OpenVerify synthetic sandbox list (fictional entries, for tests only)',
      terms: null,
    });
    expect(sandbox?.['last-sync-id']).toMatch(/^\d+$/);
    expect(document.sources.find(({ id }) => id === 'eu-fsf')).toMatchObject({
      configured: false,
      'last-error-code': 'source_not_configured',
      'last-checked-at': null,
      'entry-count': 0,
      stale: false,
    });
    expect(document.sources.find(({ id }) => id === 'un-sc')).toMatchObject({
      enabled: false,
      terms: expect.stringMatching(/non-commercial/) as unknown,
    });
    expect(document['recent-syncs'][0]).toMatchObject({
      'source-id': 'openverify-sandbox',
      outcome: 'applied',
      actor: 'seed',
      origin: 'import',
      added: 69,
    });
    // Owner decisions 17 and 18: the environment's own media runs, never the install's total.
    expect(document.media).toEqual({
      'environment-scheduled-runs-per-day': 0,
      'install-budget-per-day': GDELT_INSTALL_BUDGET.requestsPerDay,
      'warn-above-share': GDELT_INSTALL_BUDGET.warnAboveShare,
      'install-above-warn-share': false,
      attribution: GDELT_CITATION,
    });
    const matcher = loadMatcherData();
    expect((document as Record<string, unknown>).matcher).toEqual({
      loaded: matcher.status === 'loaded',
      'keys-version': matcher.status === 'loaded' ? matcher.keysVersion : null,
    });
    expect(response.body).not.toMatch(/Avery|Quillfeather|SBX-1001/);
  });

  it('names the environment’s templates whose pinned lists hold a disabled source or leave out an enabled one', async () => {
    const { api, organization, token } = await viewer();
    const pinned = await seedReportTemplate(api.database.db, organization.sandboxId, {
      name: 'Synthetic pinned screening',
      config: { 'search-lists': ['ofac-sdn', 'un-sc'] },
    });
    const complete = await seedReportTemplate(api.database.db, organization.sandboxId, {
      reportType: 'politically-exposed-person',
      config: { 'search-lists': ['openverify-sandbox-pep', 'wikidata-pep'] },
    });
    const media = await seedReportTemplate(api.database.db, organization.sandboxId, {
      reportType: 'adverse-media',
    });
    await seedReport(api.database.db, organization.sandboxId, {
      ...media,
      reportType: 'adverse-media',
      recurrenceIntervalDays: 2,
      nextRunAt: new Date('2026-10-21T00:00:00.000Z'),
    });
    // Another tenant's media runs count towards the install, never towards this page's figure.
    const elsewhere = await api.organization();
    const theirs = await seedReportTemplate(api.database.db, elsewhere.sandboxId, {
      reportType: 'adverse-media',
    });
    await seedReport(api.database.db, elsewhere.sandboxId, {
      ...theirs,
      reportType: 'adverse-media',
      recurrenceIntervalDays: 1,
      nextRunAt: new Date('2026-10-21T00:00:00.000Z'),
    });

    const document = dashboardWatchlistSourcesSchema.parse(
      (await api.call('GET', '/watchlist-sources', { token })).json(),
    );

    expect(document['template-warnings']).toEqual([
      {
        'report-template-id': pinned.templateId,
        name: 'Synthetic pinned screening',
        'report-type': 'watchlist',
        'disabled-sources': ['un-sc'],
        'omitted-sources': [
          'eu-fsf',
          'ofac-consolidated',
          'openverify-sandbox',
          'uk-sanctions-list',
        ],
      },
    ]);
    expect(complete.templateId).not.toBe(pinned.templateId);
    expect(document.media).toMatchObject({
      'environment-scheduled-runs-per-day': 0.5,
      'install-above-warn-share': false,
    });
  });

  it('serves each source’s last validation, how it was made, and its last full verification (C254.2)', async () => {
    const { api, token } = await viewer();
    // A conditional source whose last check was the publisher's 304, three hours after its last
    // full verification (what the validator step records, conditional.ts).
    await api.database.db.execute(
      sql`update watchlist_sources
             set last_checked_at = '2026-10-20T09:00:00.000Z',
                 last_validated_at = '2026-10-20T09:00:00.000Z', validated_by = 'http-304',
                 last_full_check_at = '2026-10-20T06:00:00.000Z',
                 last_etag = '"synthetic-etag"'
           where id = 'uk-sanctions-list'`,
    );

    const response = await api.call('GET', '/watchlist-sources', { token });
    const document = dashboardWatchlistSourcesSchema.parse(response.json());

    expect(document.sources.find(({ id }) => id === 'uk-sanctions-list')).toMatchObject({
      conditional: true,
      'last-validated-at': '2026-10-20T09:00:00.000Z',
      'validated-by': 'http-304',
      'last-full-check-at': '2026-10-20T06:00:00.000Z',
    });
    // A source that opts out downloads and compares the SHA-256 at every check.
    expect(document.sources.find(({ id }) => id === 'openverify-sandbox')).toMatchObject({
      conditional: false,
      'last-validated-at': '2026-10-20T06:00:00.000Z',
      'validated-by': 'sha256',
      'last-full-check-at': '2026-10-20T06:00:00.000Z',
    });
    expect(document.sources.find(({ id }) => id === 'eu-fsf')).toMatchObject({
      conditional: false,
      'last-validated-at': null,
      'validated-by': null,
      'last-full-check-at': null,
    });
    // The validators are the platform's to send, never the page's.
    expect(response.body).not.toContain('synthetic-etag');
  });
});

describe('watchlistSourcesDocument', () => {
  const NOW = new Date('2026-10-27T12:00:00.000Z');
  const state = (
    id: string,
    overrides: Partial<WatchlistSourceState> = {},
  ): WatchlistSourceState => ({
    id,
    enabled: true,
    sandboxOnly: false,
    keysVersion: KEYS,
    lastSyncId: 7,
    lastPublishedAt: new Date('2026-10-26T20:00:00.000Z'),
    lastSha256: 'b'.repeat(64),
    lastAppliedAt: new Date('2026-10-27T06:00:00.000Z'),
    lastCheckedAt: new Date('2026-10-27T06:00:00.000Z'),
    lastOrigin: 'publisher',
    lastErrorCode: null,
    ...overrides,
  });
  const document = (
    states: WatchlistSourceState[],
    keys: string | null,
    syncs: WatchlistSync[] = [],
  ) =>
    watchlistSourcesDocument({
      manifest: watchlistManifest(),
      states,
      counts: new Map([['ofac-sdn', { entries: 3, names: 7 }]]),
      syncs,
      pendingRescreens: new Set(),
      matcher: { loaded: keys !== null, keysVersion: keys },
      mediaRuns: { environment: 12.5, install: 12.5 },
      templates: [],
      environmentKind: 'production',
      now: NOW,
    });

  it('says whether a source is keyed by this version, and stale past its own limit', () => {
    const current = document([state('ofac-sdn')], KEYS);
    const other = document([state('ofac-sdn')], keysVersion('c'.repeat(64)));
    const unknown = document([state('ofac-sdn')], null);
    const stale = document(
      [state('ofac-sdn', { lastCheckedAt: new Date('2026-10-24T11:00:00.000Z') })],
      KEYS,
    );

    const ofac = (doc: typeof current) => doc.sources.find(({ id }) => id === 'ofac-sdn');
    expect(ofac(current)).toMatchObject({
      'keys-current': true,
      stale: false,
      'entry-count': 3,
      'name-count': 7,
      'last-sync-id': '7',
    });
    expect(ofac(other)?.['keys-current']).toBe(false);
    expect(ofac(unknown)?.['keys-current']).toBe(false);
    expect(ofac(stale)?.stale).toBe(true);
    expect(dashboardWatchlistSourcesSchema.parse(current).media).toMatchObject({
      'environment-scheduled-runs-per-day': 12.5,
    });
  });

  it('says whether this process holds the matcher data, so a missing file never reads as a re-key (owner decision 17)', () => {
    const matcherOf = (doc: unknown) => (doc as Record<string, unknown>).matcher;
    expect(matcherOf(document([state('ofac-sdn')], KEYS))).toEqual({
      loaded: true,
      'keys-version': KEYS,
    });
    expect(matcherOf(document([state('ofac-sdn')], null))).toEqual({
      loaded: false,
      'keys-version': null,
    });
  });

  it('flags the install above 80% of the GDELT budget with one boolean, beside the environment’s own runs (owner decision 18, R004)', () => {
    const mediaOf = (install: number) =>
      watchlistSourcesDocument({
        manifest: watchlistManifest(),
        states: [],
        counts: new Map(),
        syncs: [],
        pendingRescreens: new Set(),
        matcher: { loaded: false, keysVersion: null },
        mediaRuns: { environment: 3, install },
        templates: [],
        environmentKind: 'production',
        now: NOW,
      }).media;
    const threshold = GDELT_INSTALL_BUDGET.requestsPerDay * GDELT_INSTALL_BUDGET.warnAboveShare;
    expect(mediaOf(threshold)).toEqual({
      'environment-scheduled-runs-per-day': 3,
      'install-budget-per-day': GDELT_INSTALL_BUDGET.requestsPerDay,
      'warn-above-share': GDELT_INSTALL_BUDGET.warnAboveShare,
      'install-above-warn-share': false,
      attribution: GDELT_CITATION,
    });
    expect(mediaOf(threshold + 1)).toMatchObject({
      'environment-scheduled-runs-per-day': 3,
      'install-above-warn-share': true,
    });
    expect(JSON.stringify(mediaOf(threshold + 1))).not.toContain(String(threshold + 1));
  });

  it('leaves the sandbox lists out of what a production template omits', () => {
    const doc = watchlistSourcesDocument({
      manifest: watchlistManifest(),
      states: watchlistManifest().sources.map(({ id, sandbox_only, enabled_by_default }) =>
        state(id, { sandboxOnly: sandbox_only, enabled: enabled_by_default }),
      ),
      counts: new Map(),
      syncs: [],
      pendingRescreens: new Set(),
      matcher: { loaded: true, keysVersion: KEYS },
      mediaRuns: { environment: 0, install: 0 },
      templates: [
        {
          reportTemplateId: 'rptp_01M5Y5Z4002AR4WWQRG0C7TSD0',
          name: 'Synthetic production watchlist',
          reportType: 'watchlist',
          searchLists: ['ofac-sdn', 'ofac-consolidated', 'eu-fsf', 'uk-sanctions-list'],
        },
        {
          reportTemplateId: 'rptp_01M5Y5Z4002AR4WWQRG0C7TSD1',
          name: 'Synthetic production PEP',
          reportType: 'politically-exposed-person',
          searchLists: [],
        },
      ],
      environmentKind: 'production',
      now: NOW,
    });

    expect(doc['template-warnings']).toEqual([
      {
        'report-template-id': 'rptp_01M5Y5Z4002AR4WWQRG0C7TSD1',
        name: 'Synthetic production PEP',
        'report-type': 'politically-exposed-person',
        'disabled-sources': [],
        'omitted-sources': ['wikidata-pep'],
      },
    ]);
  });
});
