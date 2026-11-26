/**
 * C254.2 (Workflow 11B, ingestion-11b; decision 39): a conditional watchlist sync on real Postgres
 * (Testcontainers, `pgvector/pgvector:pg17` through `startIntegrationPostgres`, migration 0036),
 * each sync on its own pool connection as the CLIs and the worker run it, its requests made by the
 * real stream client to a local publisher on 127.0.0.1 (never a real publisher: the clients here
 * only gain `allowPrivateNetworks` and `allowPlainHttp` to reach it). The publisher serves a
 * synthetic UK Sanctions List file with a strong `ETag` and a `Last-Modified`, and answers 304 to a
 * matching `If-None-Match`, as the UK publisher does on its own URL.
 *
 * Held: the first sync applies the file; the next verifies it in full and keeps its validators; a
 * check within `watchlist-full-check-hours` sends them and the 304 downloads nothing; once the full
 * verification is that old, no validator is sent, whatever the publisher would answer, so a 304
 * never outlasts the forced full check; a changed file is applied. Time comes from the injected
 * clock.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDatabase,
  getWatchlistSourceStates,
  listRecentWatchlistSyncs,
  runMigrations,
  type Database,
} from '@openverify/db';
import { createIntegrationPool, ifSet, startIntegrationPostgres } from '@openverify/db/testing';
import { keysVersion, variantGroupsFrom } from '@openverify/watchlist';
import { syntheticWatchlist, ukSanctionsListXml } from '@openverify/watchlist/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WatchlistSettings } from '../config.js';
import { createOutboundHttp, type OutboundHttp } from '../http/index.js';
import { listSourceCheckRecords } from './conditional-records.js';
import { watchlistManifest, type WatchlistManifest } from './manifest.js';
import type { MatcherData } from './matcher-data.js';
import { reconcileWatchlistSources } from './reconcile.js';
import { poolWatchlistSessions } from './sync-session.js';
import { syncWatchlistSource } from './sync.js';

const UK = 'uk-sanctions-list';
const START = new Date('2026-11-13T12:00:00.000Z');
const HOUR = 3_600_000;
const MATCHER: MatcherData = {
  status: 'loaded',
  groups: variantGroupsFrom([], 'd'.repeat(64)),
  keysVersion: keysVersion('d'.repeat(64)),
};
const SETTINGS: WatchlistSettings = {
  sourcesDisabled: [],
  refresh: false,
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
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** The local publisher's current file and validators, and the conditional headers it was sent. */
const publisher = {
  body: '',
  etag: '"synthetic-uk-1"',
  lastModified: 'Fri, 13 Nov 2026 06:00:00 GMT',
  requests: [] as { ifNoneMatch: string | null; ifModifiedSince: string | null }[],
};

function ukFile(day: string, seed: string): string {
  const records = syntheticWatchlist({
    seed,
    idStyle: 'uk',
    individuals: 20,
    entities: 0,
    vessels: 0,
    aircraft: 0,
    hanNames: false,
  });
  return ukSanctionsListXml(records, { dateGenerated: day });
}

const header = (request: IncomingMessage, name: string): string | null => {
  const value = request.headers[name];
  return typeof value === 'string' ? value : null;
};

let container: StartedPostgreSqlContainer | undefined;
let pool: Pool;
let db: Database;
let server: Server;
let http: OutboundHttp;
let manifest: WatchlistManifest;
let temporary: string;

beforeAll(async () => {
  container = await startIntegrationPostgres();
  pool = createIntegrationPool(container.getConnectionUri(), { max: 6 });
  db = createDatabase(pool);
  await runMigrations(db);
  await reconcileWatchlistSources(db, { disabled: [] });
  temporary = await mkdtemp(join(tmpdir(), 'openverify-conditional-it-'));

  server = createServer((request, response) => {
    const ifNoneMatch = header(request, 'if-none-match');
    publisher.requests.push({ ifNoneMatch, ifModifiedSince: header(request, 'if-modified-since') });
    const validators = { etag: publisher.etag, 'last-modified': publisher.lastModified };
    if (ifNoneMatch === publisher.etag) {
      response.writeHead(304, validators).end();
      return;
    }
    response.writeHead(200, { ...validators, 'content-type': 'application/xml' });
    response.end(publisher.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const base = createOutboundHttp({
    resolve: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
  });
  http = {
    ...base,
    streamClient: (options) => {
      const client = base.streamClient?.({
        ...options,
        allowPrivateNetworks: true,
        allowPlainHttp: true,
      });
      if (client === undefined) {
        throw new Error('the outbound client has no stream form');
      }
      return client;
    },
  };
  const shipped = watchlistManifest();
  manifest = {
    ...shipped,
    sources: shipped.sources.map((source) =>
      source.id === UK
        ? { ...source, urls: [`http://lists.example.test:${String(port)}/UK-Sanctions-List.xml`] }
        : source,
    ),
  };
}, 180_000);

afterAll(async () => {
  await ifSet(http)?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await ifSet(pool)?.end();
  await container?.stop();
  await rm(temporary, { recursive: true, force: true });
});

const sync = (at: Date, allowMassRemoval = false) =>
  syncWatchlistSource(
    {
      db,
      connect: poolWatchlistSessions(pool),
      clock: { now: () => at },
      logger: silent,
      settings: SETTINGS,
      outboundHttp: http,
      matcherData: () => MATCHER,
      manifest,
      temporaryDirectory: temporary,
    },
    { sourceId: UK, actor: 'job', allowMassRemoval },
  );

const checks = async () => (await listSourceCheckRecords(db)).get(UK);
const requestsOf = async (at: Date, allowMassRemoval = false) => {
  publisher.requests.length = 0;
  const result = await sync(at, allowMassRemoval);
  return { result, requests: [...publisher.requests] };
};

describe('a conditional sync against a local publisher (C254.2)', () => {
  it('applies, verifies in full, takes the 304 within the window, never past it, and applies a change', async () => {
    publisher.body = ukFile('2026-11-12', 'conditional-it');

    // 1. Never checked: the step's full request, then the sync's download, applied.
    const first = await requestsOf(START);
    expect(first.result).toMatchObject({ outcome: 'applied', errorCode: null });
    expect(first.requests).toEqual([
      { ifNoneMatch: null, ifModifiedSince: null },
      { ifNoneMatch: null, ifModifiedSince: null },
    ]);

    // 2. The step finds the applied file: a full verification, its validators kept.
    const atSecond = new Date(START.getTime() + HOUR);
    const second = await requestsOf(atSecond);
    expect(second.result.outcome).toBe('unchanged');
    expect(second.requests).toHaveLength(1);
    expect(await checks()).toMatchObject({
      validatedBy: 'sha256',
      lastFullCheckAt: atSecond,
      validators: { etag: publisher.etag, lastModified: publisher.lastModified },
    });

    // 3. Within the window: the validators are sent and the 304 downloads nothing.
    const atThird = new Date(atSecond.getTime() + 23 * HOUR);
    const third = await requestsOf(atThird);
    expect(third.result.outcome).toBe('unchanged');
    expect(third.requests).toEqual([
      { ifNoneMatch: publisher.etag, ifModifiedSince: publisher.lastModified },
    ]);
    expect(await checks()).toMatchObject({
      lastValidatedAt: atThird,
      validatedBy: 'http-304',
      lastFullCheckAt: atSecond,
    });
    const [state] = await getWatchlistSourceStates(db, [UK]);
    expect(state?.lastCheckedAt).toEqual(atThird);

    // 4. 24 hours after the full verification no validator is sent, though the publisher would
    //    answer 304 to it: the forced full check.
    const atFourth = new Date(atSecond.getTime() + 24 * HOUR);
    const fourth = await requestsOf(atFourth);
    expect(fourth.result.outcome).toBe('unchanged');
    expect(fourth.requests).toEqual([{ ifNoneMatch: null, ifModifiedSince: null }]);
    expect(await checks()).toMatchObject({ validatedBy: 'sha256', lastFullCheckAt: atFourth });

    // 5. The publisher changes its file and its tag: the conditional request gets a 200 and the
    //    sync downloads and applies it (another synthetic list: its removals allowed).
    publisher.body = ukFile('2026-11-14', 'conditional-it-changed');
    publisher.etag = '"synthetic-uk-2"';
    const atFifth = new Date(atFourth.getTime() + HOUR);
    const fifth = await requestsOf(atFifth, true);
    expect(fifth.result).toMatchObject({ outcome: 'applied', errorCode: null });
    expect(fifth.requests).toEqual([
      { ifNoneMatch: '"synthetic-uk-1"', ifModifiedSince: publisher.lastModified },
      { ifNoneMatch: null, ifModifiedSince: null },
    ]);
    expect((await listRecentWatchlistSyncs(db, 1))[0]?.outcome).toBe('applied');
  });
});
