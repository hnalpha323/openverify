/**
 * C76.2 (F17), C76.4, C78.3: the `watchlists-refresh` tick over PGlite. The UK Sanctions List is
 * a synthetic file (fictional designations, `.example`-free ids) served by a fake list client, the
 * OFAC files answer 503, and the EU and Wikidata sources lack their token and User-Agent, so
 * nothing here touches a publisher, Wikidata or the network.
 */
import {
  getWatchlistSourceStates,
  listRecentWatchlistSyncs,
  updateEnvironmentSettings,
  type WatchlistSync,
} from '@openverify/db';
import {
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
} from '@openverify/db/testing';
import { keysVersion, variantGroupsFrom } from '@openverify/watchlist';
import { syntheticWatchlist, ukSanctionsListXml } from '@openverify/watchlist/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WatchlistSettings } from '../../config.js';
import type { OutboundHttp, OutboundHttpRequest } from '../../http/index.js';
import type { ReportRescreenJob } from '../../ports.js';
import type { MatcherData } from '../../watchlists/matcher-data.js';
import { watchlistManifest } from '../../watchlists/manifest.js';
import { sharedWatchlistSession } from '../../watchlists/sync.js';
import {
  refreshBackoffMs,
  runWatchlistsRefresh,
  type WatchlistsRefreshDeps,
} from './watchlists.js';

let database: TestDatabase;
const START = new Date('2026-10-27T12:00:00.000Z');
const HOUR = 3_600_000;

const matcher = (sha: string): MatcherData => ({
  status: 'loaded',
  groups: variantGroupsFrom([], sha),
  keysVersion: keysVersion(sha),
});
const SETTINGS: WatchlistSettings = {
  sourcesDisabled: [],
  refresh: true,
  removedRetentionDays: 90,
  euFsfToken: null,
  wikidataUserAgent: null,
  wikidataSparqlUrl: 'https://query.wikidata.org/sparql',
  pep: {
    openTenureMaxYears: 20,
    includeRelatives: false,
    retentionMonths: 12,
    headRetentionMonths: 60,
  },
};
const logged: string[] = [];
const logger = {
  info: (object: Record<string, unknown>, message: string) =>
    logged.push(JSON.stringify([object, message])),
  warn: (object: Record<string, unknown>, message: string) =>
    logged.push(JSON.stringify([object, message])),
  error: (object: Record<string, unknown>, message: string) =>
    logged.push(JSON.stringify([object, message])),
};
const enqueued: ReportRescreenJob[] = [];
const requests: OutboundHttpRequest[] = [];

const records = syntheticWatchlist({
  seed: 'refresh',
  idStyle: 'uk',
  individuals: 40,
  entities: 0,
  vessels: 0,
  aircraft: 0,
  hanNames: false,
});
const UK_FILE = new TextEncoder().encode(
  ukSanctionsListXml(records, { dateGenerated: '2026-10-26' }),
);
const urlOf = (id: string) =>
  watchlistManifest().sources.find((source) => source.id === id)?.urls[0] ?? '';
const UK_URL = urlOf('uk-sanctions-list');

const http: OutboundHttp = {
  client: () => {
    throw new Error('the refresh makes no buffered request');
  },
  streamClient: (options) => ({
    async stream(request, sink) {
      requests.push(request);
      if (request.url.split('?')[0] !== UK_URL) {
        return { status: 503, contentType: null, headers: {}, bytes: 0 };
      }
      await sink.write(UK_FILE);
      return {
        status: 200,
        contentType: options.contentTypes[0] ?? null,
        headers: {},
        bytes: UK_FILE.byteLength,
      };
    },
  }),
  close: () => Promise.resolve(),
};

function deps(at: Date, overrides: Partial<WatchlistsRefreshDeps> = {}): WatchlistsRefreshDeps {
  return {
    db: database.db,
    connect: sharedWatchlistSession(database.db),
    clock: { now: () => at },
    logger,
    outboundHttp: http,
    watchlists: SETTINGS,
    rescreens: {
      enqueueReportRescreen: (job) => {
        enqueued.push(job);
        return Promise.resolve();
      },
    },
    matcherData: () => matcher('a'.repeat(64)),
    ...overrides,
  };
}

const syncsOf = async (sourceId: string): Promise<WatchlistSync[]> =>
  (await listRecentWatchlistSyncs(database.db, 100)).filter((sync) => sync.sourceId === sourceId);
const ukRequests = () => requests.filter((request) => request.url.startsWith(UK_URL)).length;

beforeAll(async () => {
  database = await createTestDatabase();
}, 60_000);

afterAll(async () => {
  await database.close();
});

describe('runWatchlistsRefresh (C76.2, F17)', () => {
  it('reconciles the sources, syncs each enabled one never checked, skips the unconfigured without a sync row, and enqueues the re-screen', async () => {
    const result = await runWatchlistsRefresh(deps(START));

    expect(result).toEqual({ due: 5, applied: 1, unchanged: 0, skipped: 2, failed: 2, rekeyed: 0 });
    const [uk] = await syncsOf('uk-sanctions-list');
    expect(uk).toMatchObject({ outcome: 'applied', actor: 'job', origin: 'publisher' });
    expect(enqueued).toEqual([{ syncId: uk?.id }]);
    expect(await syncsOf('eu-fsf')).toEqual([]);
    expect(await syncsOf('wikidata-pep')).toEqual([]);
    const states = await getWatchlistSourceStates(database.db, ['eu-fsf', 'wikidata-pep']);
    expect(states.map((state) => state.lastErrorCode)).toEqual([
      'source_not_configured',
      'source_not_configured',
    ]);
    expect((await syncsOf('ofac-sdn'))[0]).toMatchObject({ outcome: 'error', actor: 'job' });
    expect(await syncsOf('openverify-sandbox')).toEqual([]);
    expect(await syncsOf('un-sc')).toEqual([]);
    const names = records.flatMap((record) => record.names.map((name) => name.full));
    expect(names.some((name) => logged.join('\n').includes(name))).toBe(false);
  });

  it('leaves a source alone until its refresh interval has passed since its last check', async () => {
    const before = ukRequests();

    const result = await runWatchlistsRefresh(deps(new Date(START.getTime() + HOUR)));

    expect(result.due).toBe(4);
    expect(ukRequests()).toBe(before);
  });

  it('syncs it again once the interval has passed, and an unchanged file counts as unchanged', async () => {
    const result = await runWatchlistsRefresh(deps(new Date(START.getTime() + 7 * HOUR)));

    expect(result).toMatchObject({ due: 5, applied: 0, unchanged: 1 });
    expect((await syncsOf('uk-sanctions-list'))[0]?.outcome).toBe('unchanged');
  });

  it('re-keys a source keyed by another matcher version even before it is due', async () => {
    const before = ukRequests();
    const other = matcher('b'.repeat(64));

    const result = await runWatchlistsRefresh(
      deps(new Date(START.getTime() + 8 * HOUR), { matcherData: () => other }),
    );

    expect(result.rekeyed).toBe(1);
    expect(ukRequests()).toBe(before);
    const [state] = await getWatchlistSourceStates(database.db, ['uk-sanctions-list']);
    expect(state?.keysVersion).toBe(other.status === 'loaded' ? other.keysVersion : '');
    expect((await syncsOf('uk-sanctions-list'))[0]).toMatchObject({
      outcome: 'rekeyed',
      actor: 'job',
    });
  });

  it('does not sync a source the disabled variable lists', async () => {
    const before = ukRequests();

    const result = await runWatchlistsRefresh(
      deps(new Date(START.getTime() + 20 * HOUR), {
        watchlists: { ...SETTINGS, sourcesDisabled: ['uk-sanctions-list'] },
      }),
    );

    expect(result.due).toBe(4);
    expect(ukRequests()).toBe(before);
    const [state] = await getWatchlistSourceStates(database.db, ['uk-sanctions-list']);
    expect(state?.enabled).toBe(false);
  });

  it('counts a source whose sync throws as failed and goes on with the others', async () => {
    const result = await runWatchlistsRefresh(
      deps(new Date(START.getTime() + 40 * HOUR), {
        matcherData: () => {
          throw new Error('unreadable variant groups');
        },
      }),
    );

    expect(result.failed).toBe(result.due - result.skipped);
    expect(logged.at(-1)).toMatch(/watchlist refresh/);
  });
});

describe('the refresh back-off (owner decision 6, K6A-11)', () => {
  const MINUTE = 60_000;

  it('doubles from 15 minutes after the first failure, capped at the refresh interval and at 24 h', () => {
    const six = 6 * HOUR;
    expect([1, 2, 3, 4, 5, 6].map((failures) => refreshBackoffMs(failures, six) / MINUTE)).toEqual([
      15, 30, 60, 120, 240, 360,
    ]);
    expect(refreshBackoffMs(40, six)).toBe(six);
    expect(refreshBackoffMs(12, 168 * HOUR)).toBe(24 * HOUR);
    expect(refreshBackoffMs(0, six)).toBe(0);
  });

  it('asks a failing source again only after its back-off, and a successful check resets it', async () => {
    const own = await createTestDatabase();
    try {
      let ukFails = true;
      const flaky: OutboundHttp = {
        ...http,
        streamClient: (options) => ({
          async stream(request, sink) {
            if (request.url.split('?')[0] !== UK_URL || ukFails) {
              return { status: 503, contentType: null, headers: {}, bytes: 0 };
            }
            await sink.write(UK_FILE);
            return {
              status: 200,
              contentType: options.contentTypes[0] ?? null,
              headers: {},
              bytes: UK_FILE.byteLength,
            };
          },
        }),
      };
      const tick = (minutes: number) =>
        runWatchlistsRefresh({
          ...deps(new Date(START.getTime() + minutes * MINUTE), { outboundHttp: flaky }),
          db: own.db,
          connect: sharedWatchlistSession(own.db),
        });
      const syncs = async (sourceId: string) =>
        (await listRecentWatchlistSyncs(own.db, 100)).filter((sync) => sync.sourceId === sourceId)
          .length;
      const failures = async (sourceId: string) =>
        (
          await own.db.execute<{ check_failures: number }>(
            sql`select check_failures from watchlist_sources where id = ${sourceId}`,
          )
        ).rows[0]?.check_failures;

      await tick(0);
      expect([await syncs('ofac-sdn'), await syncs('uk-sanctions-list')]).toEqual([1, 1]);
      // 10 minutes after the first failure: neither is asked again.
      expect((await tick(10)).due).toBe(2);
      expect([await syncs('ofac-sdn'), await syncs('uk-sanctions-list')]).toEqual([1, 1]);
      ukFails = false;
      await tick(15);
      expect([await syncs('ofac-sdn'), await syncs('uk-sanctions-list')]).toEqual([2, 2]);
      expect([await failures('ofac-sdn'), await failures('uk-sanctions-list')]).toEqual([2, 0]);
      // The second failure doubles the wait to 30 minutes; the UK list is fresh again.
      await tick(40);
      expect([await syncs('ofac-sdn'), await syncs('uk-sanctions-list')]).toEqual([2, 2]);
      await tick(45);
      expect([await syncs('ofac-sdn'), await syncs('uk-sanctions-list')]).toEqual([3, 2]);
      expect(await failures('ofac-sdn')).toBe(3);
    } finally {
      await own.close();
    }
  });
});

describe('runWatchlistsRefresh and the UN opt-in (C254.1, Q10 granted; KP11-31)', () => {
  it('reconciles un-sc enabled for an environment that opted in while the install allows it, and not otherwise', async () => {
    const own = await createTestDatabase();
    try {
      const { environment } = await createTestTenant(own.db);
      await updateEnvironmentSettings(own.db, environment.id, {
        'watchlist-un-opt-in': {
          'source-id': 'un-sc',
          'terms-url': 'https://www.un.org/en/about-us/terms-of-use',
          'accepted-at': START.toISOString(),
          'accepted-by': testId('usr'),
        },
      });
      const tick = (allowed: boolean) =>
        runWatchlistsRefresh(
          deps(START, {
            db: own.db,
            connect: sharedWatchlistSession(own.db),
            watchlists: { ...SETTINGS, unOptInAllowed: allowed },
          }),
        );
      await tick(false);
      expect((await getWatchlistSourceStates(own.db, ['un-sc']))[0]?.enabled).toBe(false);
      await tick(true);
      expect((await getWatchlistSourceStates(own.db, ['un-sc']))[0]?.enabled).toBe(true);
    } finally {
      await own.close();
    }
  }, 60_000);
});
