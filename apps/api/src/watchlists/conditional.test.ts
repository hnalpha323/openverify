/**
 * C254.2 (Workflow 11B, ingestion-11b; decision 39): the validator step of the watchlist sync over
 * PGlite with migration 0036. Downloads go to a fake list client that records each request's
 * headers and answers a fixed status, body and validators, so nothing here touches a publisher or
 * the network. Lists are fixtures-6's synthetic UK files; time comes from the injected clock.
 *
 * Held: a source that opts out sends nothing extra; a conditional source sends its strong
 * validators only while its last full verification is younger than `watchlist-full-check-hours`
 * (the shortest an environment set, else 24), so a 304 never outlasts the forced full check; a 304
 * records `http-304` and downloads nothing; a 200 is compared by SHA-256 (the same file records a
 * full verification with its strong validators, another is downloaded and applied by the sync); a
 * 304 to a plain request, another status and a client failure are download failures; and the
 * sync records each outcome end to end.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getWatchlistSourceStates,
  listRecentWatchlistSyncs,
  updateEnvironmentSettings,
} from '@openverify/db';
import { createTestDatabase, createTestTenant, type TestDatabase } from '@openverify/db/testing';
import { keysVersion, variantGroupsFrom } from '@openverify/watchlist';
import { syntheticWatchlist, ukSanctionsListXml } from '@openverify/watchlist/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WatchlistSettings } from '../config.js';
import {
  OutboundHttpError,
  type OutboundHttp,
  type OutboundHttpRequest,
  type OutboundStreamClientOptions,
} from '../http/index.js';
import { checkSourceConditionally, type ConditionalCheckContext } from './conditional.js';
import {
  installWatchlistFullCheckHours,
  listSourceCheckRecords,
  servedSourceValidation,
} from './conditional-records.js';
import { WatchlistDownloadError } from './download.js';
import { manifestSource, watchlistManifest } from './manifest.js';
import type { MatcherData } from './matcher-data.js';
import { reconcileWatchlistSources } from './reconcile.js';
import { sharedWatchlistSession, syncWatchlistSource } from './sync.js';

const UK = 'uk-sanctions-list';
const UK_URL = 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml';
const NOW = new Date('2026-11-13T12:00:00.000Z');
const HOUR = 3_600_000;
const ETAG = '"synthetic-etag-1"';
const LAST_MODIFIED = 'Fri, 13 Nov 2026 06:00:00 GMT';

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

const SHA = 'c'.repeat(64);
const MATCHER: MatcherData = {
  status: 'loaded',
  groups: variantGroupsFrom([], SHA),
  keysVersion: keysVersion(SHA),
};

let database: TestDatabase;
let temporary: string;

beforeAll(async () => {
  database = await createTestDatabase();
  temporary = await mkdtemp(join(tmpdir(), 'openverify-conditional-test-'));
}, 60_000);

beforeEach(async () => {
  await database.db.execute(sql`truncate watchlist_sources cascade`);
  await database.db.execute(
    sql`update environments set settings = settings - 'watchlist-full-check-hours'`,
  );
  await reconcileWatchlistSources(database.db, { disabled: [] });
});

afterAll(async () => {
  await database.close();
  await rm(temporary, { recursive: true, force: true });
});

const encoder = new TextEncoder();
const sha256 = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');

/** A UK Sanctions List file of synthetic designations, dated `day`. */
function ukFile(day: string, seed = 'conditional'): Uint8Array {
  const records = syntheticWatchlist({
    seed,
    idStyle: 'uk',
    individuals: 12,
    entities: 0,
    vessels: 0,
    aircraft: 0,
    hanNames: false,
  });
  return encoder.encode(ukSanctionsListXml(records, { dateGenerated: day }));
}

interface Answer {
  status: number;
  body?: Uint8Array;
  headers?: Record<string, string>;
}

/** A fake list client: each request is recorded and gets the next answer (or a thrown error). */
function fakeHttp(answers: (Answer | Error)[]) {
  const created: OutboundStreamClientOptions[] = [];
  const requests: OutboundHttpRequest[] = [];
  const http: OutboundHttp = {
    client: () => {
      throw new Error('no buffered request is made');
    },
    streamClient: (options) => {
      created.push(options);
      return {
        async stream(request, sink) {
          requests.push(request);
          const answer = answers.shift() ?? { status: 404 };
          if (answer instanceof Error) {
            throw answer;
          }
          const body = answer.status >= 200 && answer.status <= 299 ? answer.body : undefined;
          if (body !== undefined) {
            await sink.write(body);
          }
          return {
            status: answer.status,
            contentType: body === undefined ? null : 'application/xml',
            headers: answer.headers ?? {},
            bytes: body?.byteLength ?? 0,
          };
        },
      };
    },
    close: () => Promise.resolve(),
  };
  return { http, created, requests };
}

async function setRow(values: {
  lastSha256?: string | null;
  lastFullCheckAt?: Date | null;
  etag?: string | null;
  lastModified?: string | null;
}) {
  await database.db.execute(
    sql`update watchlist_sources
           set last_sha256 = ${values.lastSha256 ?? null},
               last_full_check_at = ${values.lastFullCheckAt?.toISOString() ?? null},
               last_etag = ${values.etag ?? null},
               last_modified = ${values.lastModified ?? null}
         where id = ${UK}`,
  );
}

const record = async (id = UK) => (await listSourceCheckRecords(database.db)).get(id);

function source(id: string) {
  const found = manifestSource(id);
  if (found === undefined) {
    throw new Error(`no source ${id}`);
  }
  return found;
}

function context(
  http: OutboundHttp | undefined,
  sourceId = UK,
  now = NOW,
): ConditionalCheckContext {
  return { db: database.db, source: source(sourceId), now, settings: SETTINGS, outboundHttp: http };
}

describe('a source that opts out (C254.2)', () => {
  it('sends no request of its own and lets the sync download with no extra header', async () => {
    const fake = fakeHttp([]);
    for (const optedOut of watchlistManifest().sources.filter((s) => s.conditional !== true)) {
      expect(await checkSourceConditionally(context(fake.http, optedOut.id))).toEqual({
        kind: 'download',
        headers: {},
      });
    }
    expect(fake.requests).toEqual([]);
  });
});

describe('a conditional source (C254.2)', () => {
  it('makes its one request through the list client the download uses', async () => {
    const body = ukFile('2026-11-12');
    await setRow({ lastSha256: sha256(body) });
    const fake = fakeHttp([{ status: 200, body }]);

    await checkSourceConditionally(context(fake.http));

    expect(fake.created).toEqual([
      expect.objectContaining({
        name: UK,
        contentTypes: ['application/xml', 'text/xml'],
        maxResponseBytes: 134_217_728,
        timeoutMs: 300_000,
        exposeHeaders: ['etag', 'last-modified', 'x-amz-meta-publication-id'],
        redirect: undefined,
      }),
    ]);
  });

  it('downloads in full, sending no validator, when it was never fully checked', async () => {
    const body = ukFile('2026-11-12');
    const fake = fakeHttp([{ status: 200, body, headers: { etag: ETAG } }]);

    expect(await checkSourceConditionally(context(fake.http))).toEqual({
      kind: 'download',
      headers: {},
    });
    expect(fake.requests).toEqual([{ method: 'GET', url: UK_URL }]);
    expect(await record()).toMatchObject({
      lastValidatedAt: null,
      validatedBy: null,
      lastFullCheckAt: null,
      validators: { etag: null, lastModified: null },
    });
  });

  it('records a full verification and its strong validators when the file is the applied one', async () => {
    const body = ukFile('2026-11-12');
    await setRow({ lastSha256: sha256(body) });
    const fake = fakeHttp([
      { status: 200, body, headers: { etag: ETAG, 'last-modified': LAST_MODIFIED } },
    ]);

    expect(await checkSourceConditionally(context(fake.http))).toEqual({ kind: 'not-modified' });
    expect(fake.requests[0]?.headers).toBeUndefined();
    expect(await record()).toEqual({
      lastSha256: sha256(body),
      lastValidatedAt: NOW,
      validatedBy: 'sha256',
      lastFullCheckAt: NOW,
      validators: { etag: ETAG, lastModified: LAST_MODIFIED },
    });
  });

  it('keeps no weak or unreadable validator', async () => {
    const body = ukFile('2026-11-12');
    await setRow({ lastSha256: sha256(body) });
    const fake = fakeHttp([
      { status: 200, body, headers: { etag: 'W/"weak"', 'last-modified': 'yesterday' } },
    ]);

    await checkSourceConditionally(context(fake.http));

    expect((await record())?.validators).toEqual({ etag: null, lastModified: null });
  });

  it('sends If-None-Match and If-Modified-Since within the window, and a 304 downloads nothing', async () => {
    const fullCheck = new Date(NOW.getTime() - 3 * HOUR);
    await setRow({
      lastSha256: SHA,
      lastFullCheckAt: fullCheck,
      etag: ETAG,
      lastModified: LAST_MODIFIED,
    });
    const fake = fakeHttp([{ status: 304, headers: { etag: ETAG } }]);

    expect(await checkSourceConditionally(context(fake.http))).toEqual({ kind: 'not-modified' });
    expect(fake.requests).toEqual([
      {
        method: 'GET',
        url: UK_URL,
        headers: { 'if-none-match': ETAG, 'if-modified-since': LAST_MODIFIED },
      },
    ]);
    expect(await record()).toMatchObject({
      lastValidatedAt: NOW,
      validatedBy: 'http-304',
      lastFullCheckAt: fullCheck,
      validators: { etag: ETAG, lastModified: LAST_MODIFIED },
    });
  });

  it('never lets a 304 outlast the forced full check (24 hours by default)', async () => {
    const body = ukFile('2026-11-12');
    await setRow({
      lastSha256: sha256(body),
      lastFullCheckAt: new Date(NOW.getTime() - 24 * HOUR),
      etag: ETAG,
      lastModified: LAST_MODIFIED,
    });
    const refusing = fakeHttp([{ status: 304 }]);

    await expect(checkSourceConditionally(context(refusing.http))).rejects.toEqual(
      new WatchlistDownloadError('download_failed'),
    );
    expect(refusing.requests[0]?.headers).toBeUndefined();
    expect((await record())?.validatedBy).toBeNull();

    const full = fakeHttp([{ status: 200, body, headers: { etag: '"synthetic-etag-2"' } }]);
    expect(await checkSourceConditionally(context(full.http))).toEqual({ kind: 'not-modified' });
    expect(full.requests[0]?.headers).toBeUndefined();
    expect(await record()).toMatchObject({
      validatedBy: 'sha256',
      lastFullCheckAt: NOW,
      validators: { etag: '"synthetic-etag-2"', lastModified: null },
    });
  });

  it('takes the shortest watchlist-full-check-hours an environment set', async () => {
    const first = await createTestTenant(database.db);
    const second = await createTestTenant(database.db);
    await updateEnvironmentSettings(database.db, first.environment.id, {
      'watchlist-full-check-hours': 2,
    });
    await updateEnvironmentSettings(database.db, second.environment.id, {
      'watchlist-full-check-hours': 48,
    });
    expect(await installWatchlistFullCheckHours(database.db)).toBe(2);

    await setRow({
      lastSha256: SHA,
      lastFullCheckAt: new Date(NOW.getTime() - 2 * HOUR),
      etag: ETAG,
    });
    const fake = fakeHttp([{ status: 200, body: ukFile('2026-11-13') }]);

    expect(await checkSourceConditionally(context(fake.http))).toEqual({
      kind: 'download',
      headers: {},
    });
    expect(fake.requests[0]?.headers).toBeUndefined();
  });

  it('answers download for another file, keeping the old validators until a check finds it applied', async () => {
    await setRow({
      lastSha256: SHA,
      lastFullCheckAt: new Date(NOW.getTime() - HOUR),
      etag: ETAG,
    });
    const fake = fakeHttp([
      { status: 200, body: ukFile('2026-11-13'), headers: { etag: '"synthetic-etag-2"' } },
    ]);

    expect(await checkSourceConditionally(context(fake.http))).toEqual({
      kind: 'download',
      headers: {},
    });
    expect(fake.requests[0]?.headers).toEqual({ 'if-none-match': ETAG });
    expect(await record()).toMatchObject({ validatedBy: null, validators: { etag: ETAG } });
  });

  it('fails as a download for another status, a client failure or no list client, writing nothing', async () => {
    await setRow({ lastSha256: SHA, lastFullCheckAt: new Date(NOW.getTime() - HOUR), etag: ETAG });
    for (const [answer, code] of [
      [{ status: 500 }, 'download_failed'],
      [{ status: 404 }, 'download_failed'],
      [new OutboundHttpError(UK, 'timeout'), 'timeout'],
      [new OutboundHttpError(UK, 'too_large'), 'download_too_large'],
    ] as const) {
      await expect(checkSourceConditionally(context(fakeHttp([answer]).http))).rejects.toEqual(
        new WatchlistDownloadError(code),
      );
    }
    await expect(checkSourceConditionally(context(undefined))).rejects.toEqual(
      new WatchlistDownloadError('download_failed'),
    );
    expect(await record()).toMatchObject({ lastValidatedAt: null, validatedBy: null });
  });
});

describe('the sync with its validator step (C254.2, end to end on PGlite)', () => {
  const sync = (http: OutboundHttp, now: Date, allowMassRemoval = false) =>
    syncWatchlistSource(
      {
        db: database.db,
        connect: sharedWatchlistSession(database.db),
        clock: { now: () => now },
        logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
        settings: SETTINGS,
        outboundHttp: http,
        matcherData: () => MATCHER,
        temporaryDirectory: temporary,
        sleep: () => Promise.resolve(),
      },
      { sourceId: UK, actor: 'job', allowMassRemoval },
    );

  it('applies, then verifies in full, then takes the publisher’s 304, then verifies in full again', async () => {
    const body = ukFile('2026-11-12');
    const validators = { etag: ETAG, 'last-modified': LAST_MODIFIED };

    // 1. Never checked: the step's full request and the sync's download, applied.
    const first = fakeHttp([
      { status: 200, body, headers: validators },
      { status: 200, body, headers: validators },
    ]);
    expect(await sync(first.http, NOW)).toMatchObject({ outcome: 'applied', errorCode: null });
    expect(first.requests).toHaveLength(2);

    // 2. An hour later the step finds the applied file: a full verification, nothing downloaded again.
    const second = fakeHttp([{ status: 200, body, headers: validators }]);
    const atSecond = new Date(NOW.getTime() + HOUR);
    expect((await sync(second.http, atSecond)).outcome).toBe('unchanged');
    expect(second.requests).toHaveLength(1);
    expect(await record()).toMatchObject({ validatedBy: 'sha256', lastFullCheckAt: atSecond });

    // 3. Within the window, the 304: unchanged, one request, the check time moved.
    const third = fakeHttp([{ status: 304 }]);
    const atThird = new Date(NOW.getTime() + 7 * HOUR);
    const result = await sync(third.http, atThird);
    expect(result.outcome).toBe('unchanged');
    expect(third.requests).toEqual([
      expect.objectContaining({
        headers: { 'if-none-match': ETAG, 'if-modified-since': LAST_MODIFIED },
      }),
    ]);
    const [state] = await getWatchlistSourceStates(database.db, [UK]);
    expect(state?.lastCheckedAt).toEqual(atThird);
    expect(state?.lastSha256).toBe(sha256(body));
    expect((await listRecentWatchlistSyncs(database.db, 1))[0]).toMatchObject({
      outcome: 'unchanged',
      sha256: sha256(body),
    });
    expect(await record()).toMatchObject({
      lastValidatedAt: atThird,
      validatedBy: 'http-304',
      lastFullCheckAt: atSecond,
    });

    // 4. 24 hours after the full verification, a 304 is no longer asked for.
    const fourth = fakeHttp([{ status: 200, body, headers: validators }]);
    const atFourth = new Date(atSecond.getTime() + 24 * HOUR);
    expect((await sync(fourth.http, atFourth)).outcome).toBe('unchanged');
    expect(fourth.requests[0]?.headers).toBeUndefined();
    expect(await record()).toMatchObject({ validatedBy: 'sha256', lastFullCheckAt: atFourth });
  });

  it('applies a changed file the publisher serves with a new validator', async () => {
    const old = ukFile('2026-11-12');
    const changed = ukFile('2026-11-13', 'conditional-changed');
    const first = fakeHttp([
      { status: 200, body: old },
      { status: 200, body: old },
    ]);
    await sync(first.http, NOW);
    await sync(fakeHttp([{ status: 200, body: old, headers: { etag: ETAG } }]).http, NOW);

    const next = fakeHttp([
      { status: 200, body: changed, headers: { etag: '"synthetic-etag-2"' } },
      { status: 200, body: changed, headers: { etag: '"synthetic-etag-2"' } },
    ]);
    const later = new Date(NOW.getTime() + HOUR);
    // Another synthetic list: its removals allowed.
    expect(await sync(next.http, later, true)).toMatchObject({
      outcome: 'applied',
      errorCode: null,
    });
    expect(next.requests[0]?.headers).toEqual({ 'if-none-match': ETAG });
    expect(next.requests[1]?.headers).toBeUndefined();
    const [state] = await getWatchlistSourceStates(database.db, [UK]);
    expect(state?.lastSha256).toBe(sha256(changed));
  });
});

describe('what the sources page serves (C254.2)', () => {
  const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);
  const conditional = source(UK);
  const optedOut = source('ofac-sdn');
  const blank = {
    lastSha256: null,
    lastValidatedAt: null,
    validatedBy: null,
    lastFullCheckAt: null,
    validators: { etag: null, lastModified: null },
  } as const;

  it('serves nothing known for a source never checked', () => {
    expect(servedSourceValidation(conditional, undefined, undefined)).toEqual({
      conditional: true,
      'last-validated-at': null,
      'validated-by': null,
      'last-full-check-at': null,
    });
  });

  it('serves every check of a source that opts out as a SHA-256 comparison', () => {
    expect(
      servedSourceValidation(optedOut, { lastCheckedAt: at(1), lastAppliedAt: at(0) }, blank),
    ).toEqual({
      conditional: false,
      'last-validated-at': at(1).toISOString(),
      'validated-by': 'sha256',
      'last-full-check-at': at(1).toISOString(),
    });
  });

  it('serves a conditional source’s 304 and its last full verification', () => {
    expect(
      servedSourceValidation(
        conditional,
        { lastCheckedAt: at(3), lastAppliedAt: at(0) },
        { ...blank, lastValidatedAt: at(3), validatedBy: 'http-304', lastFullCheckAt: at(1) },
      ),
    ).toEqual({
      conditional: true,
      'last-validated-at': at(3).toISOString(),
      'validated-by': 'http-304',
      'last-full-check-at': at(1).toISOString(),
    });
  });

  it('serves an apply after the recorded validation as a full SHA-256 verification', () => {
    expect(
      servedSourceValidation(
        conditional,
        { lastCheckedAt: at(5), lastAppliedAt: at(5) },
        { ...blank, lastValidatedAt: at(3), validatedBy: 'http-304', lastFullCheckAt: at(1) },
      ),
    ).toEqual({
      conditional: true,
      'last-validated-at': at(5).toISOString(),
      'validated-by': 'sha256',
      'last-full-check-at': at(5).toISOString(),
    });
  });
});
