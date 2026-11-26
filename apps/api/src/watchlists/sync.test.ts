/**
 * C76.2, C76.3, C76.6, C76.8, C78.3, C80.1: the sync of one source over PGlite. Lists come only
 * from fixtures-6's synthetic writers (fictional people, `SYN-` and `SBX-` ids, `.example` hosts)
 * and from the committed sandbox files; downloads go to a fake list client, so nothing here
 * touches a publisher, Wikidata or the network. The guards each have a test: rollback, a future
 * publication, mass removal, a bad schema, an oversize file, missing matcher data, an unconfigured
 * source, and an older keys version, which is re-keyed first.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getWatchlistSourceStates,
  getWatchlistSync,
  listRecentWatchlistSyncs,
  loadLiveEntryHashes,
  type WatchlistSync,
} from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import {
  PEP_IMPORT_FORMAT,
  keysVersion,
  parseOfacEnhanced,
  readPublication,
  variantGroupsFrom,
  type WatchlistRecord,
} from '@openverify/watchlist';
import {
  FIXTURES_DIRECTORY,
  normalisedImport,
  normalisedImportText,
  ofacEnhancedXml,
  ofacSdnEnhancedZip,
  euFsfXml,
  syntheticWatchlist,
  ukSanctionsListXml,
} from '@openverify/watchlist/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WatchlistSettings } from '../config.js';
import {
  OutboundHttpError,
  type OutboundHttp,
  type OutboundHttpRequest,
  type OutboundStreamClientOptions,
} from '../http/index.js';
import type { ReportRescreenJob } from '../ports.js';
import { loadMatcherData, type MatcherData } from './matcher-data.js';
import { watchlistManifest, type WatchlistManifest } from './manifest.js';
import { reconcileWatchlistSources } from './reconcile.js';
import {
  sharedWatchlistSession,
  syncWatchlistSource,
  UnknownWatchlistSourceError,
  type WatchlistSyncDeps,
  type WatchlistSyncRequest,
} from './sync.js';

let database: TestDatabase;
let files: string;
let temporary: string;
const NOW = new Date('2026-10-27T12:00:00.000Z');
let now = NOW;

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const matcher = (sha: string, groups: [string, string[]][] = []): MatcherData => ({
  status: 'loaded',
  groups: variantGroupsFrom(groups, sha),
  keysVersion: keysVersion(sha),
});
const MATCHER_A = matcher(SHA_A);
const KEYS_A = keysVersion(SHA_A);

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
const rescreens = {
  enqueueReportRescreen: (job: ReportRescreenJob) => {
    enqueued.push(job);
    return Promise.resolve();
  },
};

beforeAll(async () => {
  database = await createTestDatabase();
  files = await mkdtemp(join(tmpdir(), 'openverify-sync-test-'));
}, 60_000);

beforeEach(async () => {
  await database.db.execute(sql`truncate watchlist_sources cascade`);
  await reconcileWatchlistSources(database.db, { disabled: [] });
  temporary = await mkdtemp(join(files, 'tmp-'));
  logged.length = 0;
  enqueued.length = 0;
  now = NOW;
});

afterAll(async () => {
  await database.close();
  await rm(files, { recursive: true, force: true });
});

function deps(overrides: Partial<WatchlistSyncDeps> = {}): WatchlistSyncDeps {
  return {
    db: database.db,
    connect: sharedWatchlistSession(database.db),
    clock: { now: () => now },
    logger,
    settings: SETTINGS,
    rescreens,
    matcherData: () => MATCHER_A,
    temporaryDirectory: temporary,
    sleep: () => Promise.resolve(),
    ...overrides,
  };
}

const sandboxFile = (name = 'openverify-sandbox.json') =>
  fileURLToPath(new URL(name, FIXTURES_DIRECTORY));

async function file(name: string, body: string | Uint8Array): Promise<string> {
  const path = join(files, name);
  await writeFile(path, body);
  return path;
}

const sync = (request: Partial<WatchlistSyncRequest> & { sourceId: string }, overrides = {}) =>
  syncWatchlistSource(deps(overrides), { actor: 'cli', ...request });

const state = async (id: string) => (await getWatchlistSourceStates(database.db, [id]))[0];
const lastSync = async (): Promise<WatchlistSync | undefined> =>
  (await listRecentWatchlistSyncs(database.db, 1))[0];

/** A UK Sanctions List file of `count` synthetic designations, dated `day`. */
function ukFile(day: string, count: number, seed = 'uk') {
  const records = syntheticWatchlist({
    seed,
    idStyle: 'uk',
    individuals: count,
    entities: 0,
    vessels: 0,
    aircraft: 0,
    hanNames: false,
  });
  return { records, xml: ukSanctionsListXml(records, { dateGenerated: day }) };
}

describe('imports of the sandbox list (C76.2, C76.6)', () => {
  it('applies the normalised sandbox list, records its provenance and enqueues its re-screen', async () => {
    const result = await sync({
      sourceId: 'openverify-sandbox',
      importPath: sandboxFile(),
      actor: 'seed',
    });

    expect(result).toMatchObject({
      sourceId: 'openverify-sandbox',
      outcome: 'applied',
      rekeyed: false,
      entryCount: 69,
      added: 69,
      changed: 0,
      removed: 0,
      rescreen: 'enqueued',
      errorCode: null,
    });
    const row = await getWatchlistSync(database.db, result.syncId ?? 0);
    expect(row).toMatchObject({
      outcome: 'applied',
      actor: 'seed',
      origin: 'import',
      override: null,
      keysVersion: KEYS_A,
      rescreenState: 'pending',
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(row?.rescreenEnqueuedAt).toEqual(NOW);
    expect(enqueued).toEqual([{ syncId: result.syncId }]);
    expect(await state('openverify-sandbox')).toMatchObject({
      lastSyncId: result.syncId,
      lastOrigin: 'import',
      lastCheckedAt: NOW,
      lastAppliedAt: NOW,
      lastErrorCode: null,
      keysVersion: KEYS_A,
    });
    expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/);
    const names = await database.db.execute(
      sql`select count(*)::int as count from watchlist_names where source_id = 'openverify-sandbox'`,
    );
    expect(names.rows[0]?.count).toBe(102);
    const df = await database.db.execute(
      sql`select count from watchlist_key_df where source_id = 'openverify-sandbox' and key = '#names'`,
    );
    expect(Number(df.rows[0]?.count)).toBeGreaterThan(90);
  });

  it('answers unchanged for the same file, moving only the last check', async () => {
    await sync({ sourceId: 'openverify-sandbox', importPath: sandboxFile() });
    now = new Date(NOW.getTime() + 3_600_000);
    enqueued.length = 0;

    const result = await sync({ sourceId: 'openverify-sandbox', importPath: sandboxFile() });

    expect(result).toMatchObject({ outcome: 'unchanged', added: 0, rescreen: 'none' });
    expect((await lastSync())?.outcome).toBe('unchanged');
    expect((await state('openverify-sandbox'))?.lastCheckedAt).toEqual(now);
    expect((await state('openverify-sandbox'))?.lastAppliedAt).toEqual(NOW);
    expect(enqueued).toEqual([]);
  });

  it('applies a newer version, refuses an older one, and takes it back with the audited override', async () => {
    await sync({ sourceId: 'openverify-sandbox', importPath: sandboxFile() });
    const two = await sync({
      sourceId: 'openverify-sandbox',
      importPath: sandboxFile('openverify-sandbox.v2.json'),
    });
    expect(two).toMatchObject({ outcome: 'applied', added: 1, removed: 0, rescreen: 'enqueued' });

    const back = await sync({ sourceId: 'openverify-sandbox', importPath: sandboxFile() });
    expect(back).toMatchObject({ outcome: 'refused_rollback', errorCode: 'refused_rollback' });
    expect((await loadLiveEntryHashes(database.db, 'openverify-sandbox')).has('SBX-1002')).toBe(
      true,
    );
    expect((await state('openverify-sandbox'))?.lastErrorCode).toBe('refused_rollback');

    const accepted = await sync({
      sourceId: 'openverify-sandbox',
      importPath: sandboxFile(),
      acceptOlderPublication: true,
    });
    expect(accepted).toMatchObject({ outcome: 'applied', removed: 1, rescreen: 'none' });
    expect((await lastSync())?.override).toBe('accept-older-publication');
    expect((await loadLiveEntryHashes(database.db, 'openverify-sandbox')).has('SBX-1002')).toBe(
      false,
    );
  });

  it('refuses the normalised format for a publisher’s source unless allowed, and records the override', async () => {
    const records = syntheticWatchlist({ seed: 'normalised', idStyle: 'uk' });
    const path = await file(
      'uk-normalised.json',
      normalisedImportText(
        normalisedImport('uk-sanctions-list', '2026-10-26T00:00:00.000Z', records),
      ),
    );

    expect(await sync({ sourceId: 'uk-sanctions-list', importPath: path })).toMatchObject({
      outcome: 'refused_schema',
    });
    const allowed = await sync({
      sourceId: 'uk-sanctions-list',
      importPath: path,
      allowNormalised: true,
    });
    expect(allowed).toMatchObject({ outcome: 'applied', added: records.length });
    expect((await lastSync())?.override).toBe('allow-normalised');
    expect((await state('uk-sanctions-list'))?.lastOrigin).toBe('import');
  });

  it('refuses a normalised file written for another source', async () => {
    const path = await file(
      'other-source.json',
      normalisedImportText(
        normalisedImport('openverify-sandbox-pep', '2026-01-01T00:00:00.000Z', []),
      ),
    );

    expect(await sync({ sourceId: 'openverify-sandbox', importPath: path })).toMatchObject({
      outcome: 'refused_schema',
    });
  });
});

/**
 * Owner decision 9 after Workflow 6B: the first sync after the upgrade reads the same OFAC
 * publication with the new members. The stored rows of "before the upgrade" are the new parser's
 * records without `list_memberships`, which is exactly what the earlier parser wrote, imported as
 * the normalised format; then the publisher's own file is synced, dated a day later.
 */
describe('the record additions on the first sync after the upgrade (owner decision 9 after 6B)', () => {
  async function parsedOfac(xml: string): Promise<WatchlistRecord[]> {
    const read: WatchlistRecord[] = [];
    await readPublication(
      parseOfacEnhanced([new TextEncoder().encode(xml)], { maxBytes: 50_000_000 }),
      (record) => {
        read.push(record);
      },
    );
    return read;
  }
  const beforeTheUpgrade = (records: readonly WatchlistRecord[]): WatchlistRecord[] =>
    records.map((record) => {
      const earlier = { ...record };
      delete earlier.list_memberships;
      return earlier;
    });
  const changedSyncIds = async (sourceId: string) =>
    new Map(
      (
        await database.db.execute<{ entry_id: string; changed: string }>(
          sql`select entry_id, changed_sync_id::text as changed from watchlist_entries
               where source_id = ${sourceId} and removed_at is null`,
        )
      ).rows.map((row) => [row.entry_id, Number(row.changed)]),
    );
  const nameVersions = async (sourceId: string) =>
    (
      await database.db.execute<{ version: string }>(
        sql`select entry_id || ':' || ordinal || ':' || xmin::text as version
              from watchlist_names where source_id = ${sourceId} order by 1`,
      )
    ).rows.map((row) => row.version);

  async function upgrade(sourceId: 'ofac-sdn' | 'ofac-consolidated', list: 'sdn' | 'consolidated') {
    const records = syntheticWatchlist({ seed: `upgrade-${list}`, idStyle: 'ofac' });
    const xml = ofacEnhancedXml(records, { dataAsOf: '2026-10-26T00:00:00Z', list });
    const parsed = await parsedOfac(xml);
    const earlier = await sync({
      sourceId,
      allowNormalised: true,
      importPath: await file(
        `${list}-before-the-upgrade.json`,
        normalisedImportText(
          normalisedImport(sourceId, '2026-10-25T00:00:00.000Z', beforeTheUpgrade(parsed)),
        ),
      ),
    });
    expect(earlier).toMatchObject({ outcome: 'applied', added: records.length });
    const hashes = await loadLiveEntryHashes(database.db, sourceId);
    const changed = await changedSyncIds(sourceId);
    const names = await nameVersions(sourceId);
    enqueued.length = 0;
    const after = await sync({ sourceId, importPath: await file(`${list}.xml`, xml) });
    return { parsed, earlier, after, hashes, changed, names };
  }

  it('changes neither hash of an entry without the new members, and writes nothing for it', async () => {
    const { parsed, earlier, after, hashes, changed, names } = await upgrade('ofac-sdn', 'sdn');

    expect(parsed.every((record) => record.list_memberships === undefined)).toBe(true);
    expect(after).toMatchObject({ outcome: 'applied', added: 0, changed: 0, removed: 0 });
    expect(after.rescreen).toBe('none');
    expect(await loadLiveEntryHashes(database.db, 'ofac-sdn')).toEqual(hashes);
    expect(await changedSyncIds('ofac-sdn')).toEqual(changed);
    expect([...changed.values()].every((id) => id === earlier.syncId)).toBe(true);
    expect(await nameVersions('ofac-sdn')).toEqual(names);
    expect(enqueued).toEqual([]);
  });

  it('changes only the risk-data hash of an entry that gains list memberships, which gets changed_sync_id and is re-screened', async () => {
    const { parsed, after, hashes, names } = await upgrade('ofac-consolidated', 'consolidated');

    expect(parsed.every((record) => (record.list_memberships ?? []).length > 0)).toBe(true);
    expect(after).toMatchObject({
      outcome: 'applied',
      added: 0,
      changed: parsed.length,
      removed: 0,
      rescreen: 'enqueued',
    });
    const now = await loadLiveEntryHashes(database.db, 'ofac-consolidated');
    expect(now.size).toBe(hashes.size);
    for (const [entryId, was] of hashes) {
      expect(now.get(entryId)?.contentHash, entryId).toBe(was.contentHash);
      expect(now.get(entryId)?.riskDataHash, entryId).not.toBe(was.riskDataHash);
    }
    const changed = await changedSyncIds('ofac-consolidated');
    expect([...changed.values()].every((id) => id === after.syncId)).toBe(true);
    // The content did not change, so the names, identifiers and keys are not rewritten.
    expect(await nameVersions('ofac-consolidated')).toEqual(names);
    expect(enqueued).toEqual([{ syncId: after.syncId }]);
    expect((await getWatchlistSync(database.db, after.syncId ?? 0))?.rescreenState).toBe('pending');
  });
});

describe('publisher files (C77.2)', () => {
  it('imports a UK Sanctions List file in its own format', async () => {
    const { records, xml } = ukFile('2026-10-26', 8);
    const result = await sync({
      sourceId: 'uk-sanctions-list',
      importPath: await file('uk.xml', xml),
    });

    expect(result).toMatchObject({ outcome: 'applied', added: records.length });
    expect((await lastSync())?.publishedAt).toEqual(new Date('2026-10-26T00:00:00.000Z'));
  });

  it('refuses another publisher’s format for a source', async () => {
    const { xml } = ukFile('2026-10-26', 3);

    expect(
      await sync({ sourceId: 'ofac-consolidated', importPath: await file('uk-for-ofac.xml', xml) }),
    ).toMatchObject({ outcome: 'refused_schema', errorCode: 'refused_schema' });
  });

  it('removes exactly the entries a publication dropped and never rewrites an unchanged one (evaluation-6)', async () => {
    const first = ukFile('2026-10-25', 30);
    await sync({ sourceId: 'uk-sanctions-list', importPath: await file('uk-30.xml', first.xml) });
    const versions = async () =>
      new Map(
        (
          await database.db.execute<{ entry_id: string; version: string }>(
            sql`select entry_id, xmin::text as version from watchlist_entries
                 where source_id = 'uk-sanctions-list' and removed_at is null`,
          )
        ).rows.map((row) => [row.entry_id, row.version]),
      );
    const before = await versions();
    const kept = first.records.slice(1);
    const dropped = first.records[0]?.entry_id ?? '';
    const next = ukSanctionsListXml(kept, { dateGenerated: '2026-10-26' });

    expect(
      await sync({ sourceId: 'uk-sanctions-list', importPath: await file('uk-29.xml', next) }),
    ).toMatchObject({ outcome: 'applied', added: 0, changed: 0, removed: 1, entryCount: 29 });
    const after = await versions();
    expect([...after.keys()].sort()).toEqual(kept.map((record) => record.entry_id).sort());
    expect(after.has(dropped)).toBe(false);
    for (const [entryId, version] of after) {
      expect({ entryId, version }).toEqual({ entryId, version: before.get(entryId) });
    }
  });

  it('refuses a mass removal (C77.6) unless the operator allows it', async () => {
    const first = ukFile('2026-10-25', 120);
    await sync({ sourceId: 'uk-sanctions-list', importPath: await file('uk-120.xml', first.xml) });
    const fewer = ukSanctionsListXml(first.records.slice(0, 100), { dateGenerated: '2026-10-26' });
    const path = await file('uk-100.xml', fewer);

    expect(await sync({ sourceId: 'uk-sanctions-list', importPath: path })).toMatchObject({
      outcome: 'refused_mass_removal',
      removed: 20,
    });
    expect((await loadLiveEntryHashes(database.db, 'uk-sanctions-list')).size).toBe(120);
    const allowed = await sync({
      sourceId: 'uk-sanctions-list',
      importPath: path,
      allowMassRemoval: true,
    });
    expect(allowed).toMatchObject({ outcome: 'applied', removed: 20 });
    expect((await lastSync())?.override).toBe('allow-mass-removal');
  });

  it('refuses a publication with no entries, the first one included, unless the operator allows it (R009)', async () => {
    const empty = await file(
      'uk-empty.xml',
      ukSanctionsListXml([], { dateGenerated: '2026-10-26' }),
    );

    expect(await sync({ sourceId: 'uk-sanctions-list', importPath: empty })).toMatchObject({
      outcome: 'refused_schema',
      errorCode: 'refused_schema',
      entryCount: 0,
    });
    expect(await state('uk-sanctions-list')).toMatchObject({
      lastAppliedAt: null,
      lastCheckedAt: null,
      lastErrorCode: 'refused_schema',
    });
    const allowed = await sync({
      sourceId: 'uk-sanctions-list',
      importPath: empty,
      allowMassRemoval: true,
    });
    expect(allowed).toMatchObject({ outcome: 'applied', entryCount: 0 });
    expect((await lastSync())?.override).toBe('allow-mass-removal');
  });

  it('refuses a publication dated more than a day ahead (P08)', async () => {
    const records = syntheticWatchlist({ seed: 'future' });
    const path = await file(
      'future.json',
      normalisedImportText(
        normalisedImport('openverify-sandbox', new Date(NOW.getTime() + 25 * 3_600_000), records),
      ),
    );

    expect(await sync({ sourceId: 'openverify-sandbox', importPath: path })).toMatchObject({
      outcome: 'refused_future',
    });
    expect((await loadLiveEntryHashes(database.db, 'openverify-sandbox')).size).toBe(0);
  });

  it('refuses a file that does not parse and keeps the previous data', async () => {
    await sync({ sourceId: 'openverify-sandbox', importPath: sandboxFile() });
    const path = await file(
      'broken.json',
      '{"source": "openverify-sandbox", "published_at": "2026-02-01T00:00:00.000Z", "entries": [{"entry_id": "SBX-X"}]}',
    );

    const result = await sync({ sourceId: 'openverify-sandbox', importPath: path });

    expect(result).toMatchObject({ outcome: 'refused_schema', errorCode: 'refused_schema' });
    expect((await loadLiveEntryHashes(database.db, 'openverify-sandbox')).size).toBe(69);
    expect((await lastSync())?.outcome).toBe('refused_schema');
    expect(logged.join('\n')).not.toMatch(/SBX-X/);
  });

  it('refuses a file over the source’s byte cap', async () => {
    const manifest: WatchlistManifest = {
      ...watchlistManifest(),
      sources: watchlistManifest().sources.map((source) =>
        source.id === 'openverify-sandbox'
          ? { ...source, max_bytes: { compressed: 1024, inflated: 1024 } }
          : source,
      ),
    };

    expect(
      await sync({ sourceId: 'openverify-sandbox', importPath: sandboxFile() }, { manifest }),
    ).toMatchObject({
      outcome: 'refused_size',
      errorCode: 'refused_size',
    });
  });
});

describe('matcher data and keys (C78.3, V04)', () => {
  it('refuses a sync without the filtered variant groups, changing nothing', async () => {
    const result = await sync(
      { sourceId: 'openverify-sandbox', importPath: sandboxFile() },
      { matcherData: (): MatcherData => ({ status: 'missing' }) },
    );

    expect(result).toMatchObject({
      outcome: 'refused_matcher_data',
      errorCode: 'refused_matcher_data',
    });
    expect((await lastSync())?.outcome).toBe('refused_matcher_data');
    expect((await loadLiveEntryHashes(database.db, 'openverify-sandbox')).size).toBe(0);
  });

  it('re-keys a source keyed by another version before an unchanged publication', async () => {
    await sync({ sourceId: 'openverify-sandbox', importPath: sandboxFile() });
    const versionB = matcher(SHA_B, [['synthetic-group', ['avery', 'averie']]]);

    const result = await sync(
      { sourceId: 'openverify-sandbox', importPath: sandboxFile() },
      { matcherData: () => versionB },
    );

    expect(result).toMatchObject({ outcome: 'unchanged', rekeyed: true });
    const syncs = await listRecentWatchlistSyncs(database.db, 2);
    expect(syncs.map(({ outcome }) => outcome)).toEqual(['unchanged', 'rekeyed']);
    expect((await state('openverify-sandbox'))?.keysVersion).toBe(
      versionB.status === 'loaded' ? versionB.keysVersion : '',
    );
    const grouped = await database.db.execute(
      sql`select count(*)::int as count from watchlist_names
           where source_id = 'openverify-sandbox' and 'g:synthetic-group' = any(keys)`,
    );
    expect(grouped.rows[0]?.count).toBeGreaterThan(0);
  });

  it('reads the matcher data: missing, or another digest than the shipped one', async () => {
    expect(loadMatcherData(join(files, 'no-such-file.json'))).toEqual({ status: 'missing' });
    const path = await file(
      'groups.json',
      JSON.stringify({
        format: 'openverify/variant-groups/v1',
        source: { name: 'synthetic', sha256: SHA_A },
        heldOut: false,
        maxForms: 60,
        groups: [['synthetic-group', ['avery', 'averie']]],
      }),
    );
    expect(loadMatcherData(path)).toEqual({ status: 'unexpected' });
    const digest = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    const loaded = loadMatcherData(path, digest);
    expect(loaded).toMatchObject({ status: 'loaded', keysVersion: keysVersion(digest) });
  });
});

/** A fake list client: answers each URL with a body, and records what it was created with. */
function fakeHttp(answers: Record<string, () => Uint8Array | Error | number>) {
  const created: OutboundStreamClientOptions[] = [];
  const requests: OutboundHttpRequest[] = [];
  const http: OutboundHttp = {
    client: () => {
      throw new Error('the sync makes no buffered request here');
    },
    streamClient: (options) => {
      created.push(options);
      return {
        async stream(request, sink) {
          requests.push(request);
          const key = request.url.split('?')[0] ?? '';
          const answer = answers[key]?.();
          if (answer === undefined || typeof answer === 'number') {
            return { status: answer ?? 404, contentType: null, headers: {}, bytes: 0 };
          }
          if (answer instanceof Error) {
            throw answer;
          }
          await sink.write(answer);
          return {
            status: 200,
            contentType: options.contentTypes[0] ?? null,
            headers: {},
            bytes: answer.byteLength,
          };
        },
      };
    },
    close: () => Promise.resolve(),
  };
  return { http, created, requests };
}

const SDN_URL =
  'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN_ENHANCED.ZIP';
const EU_URL = 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content';

describe('downloads (C76.2 step 3, C85.1)', () => {
  it('downloads the SDN ZIP through the list client with the source’s rules, as the publisher’s data', async () => {
    const records = syntheticWatchlist({ seed: 'ofac', idStyle: 'ofac' });
    const zip = ofacSdnEnhancedZip(records, { dataAsOf: '2026-10-26T00:00:00' });
    const fake = fakeHttp({ [SDN_URL]: () => zip });

    const result = await sync({ sourceId: 'ofac-sdn' }, { outboundHttp: fake.http });

    expect(result).toMatchObject({ outcome: 'applied', added: records.length });
    expect(fake.created).toEqual([
      expect.objectContaining({
        contentTypes: ['application/zip', 'application/octet-stream'],
        maxResponseBytes: 67_108_864,
        timeoutMs: 300_000,
        redirect: {
          maxHops: 1,
          host: 'wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com',
        },
      }),
    ]);
    expect(fake.requests).toEqual([{ method: 'GET', url: SDN_URL }]);
    expect((await lastSync())?.origin).toBe('publisher');
    expect((await state('ofac-sdn'))?.lastOrigin).toBe('publisher');
    expect(await readdir(temporary)).toEqual([]);
  });

  it('sends the EU token only in the request, never to a log or a row', async () => {
    const token = 'change-me-synthetic-eu-token';
    const records = syntheticWatchlist({ seed: 'eu', idStyle: 'eu' });
    const fake = fakeHttp({
      [EU_URL]: () =>
        new TextEncoder().encode(
          euFsfXml(records, {
            generationDate: '2026-10-26T10:00:00.000+02:00',
            globalFileId: 185699,
          }),
        ),
    });

    const result = await sync(
      { sourceId: 'eu-fsf' },
      { outboundHttp: fake.http, settings: { ...SETTINGS, euFsfToken: token } },
    );

    expect(result.outcome).toBe('applied');
    expect(fake.requests[0]?.url).toBe(`${EU_URL}?token=${token}`);
    expect(logged.join('\n')).not.toContain(token);
    expect(JSON.stringify(await listRecentWatchlistSyncs(database.db, 5))).not.toContain(token);
  });

  it('records a source that is not configured, without any request; the refresh writes no row', async () => {
    const fake = fakeHttp({});

    const cli = await sync({ sourceId: 'eu-fsf' }, { outboundHttp: fake.http });
    expect(cli).toMatchObject({ outcome: 'error', errorCode: 'source_not_configured' });
    expect(cli.syncId).not.toBeNull();
    expect((await state('eu-fsf'))?.lastErrorCode).toBe('source_not_configured');

    const job = await sync({ sourceId: 'wikidata-pep', actor: 'job' }, { outboundHttp: fake.http });
    expect(job).toMatchObject({
      outcome: 'error',
      errorCode: 'source_not_configured',
      syncId: null,
    });
    expect((await state('wikidata-pep'))?.lastErrorCode).toBe('source_not_configured');
    expect(fake.requests).toEqual([]);
  });

  it('records each download failure by its code, with no change to the data', async () => {
    const cases: [() => Error | number, string][] = [
      [() => new OutboundHttpError('ofac-sdn', 'blocked'), 'redirect_refused'],
      [() => new OutboundHttpError('ofac-sdn', 'too_large'), 'download_too_large'],
      [() => new OutboundHttpError('ofac-sdn', 'content_type'), 'content_type_refused'],
      [() => new OutboundHttpError('ofac-sdn', 'timeout'), 'timeout'],
      [() => 503, 'download_failed'],
    ];
    for (const [answer, code] of cases) {
      const fake = fakeHttp({ [SDN_URL]: answer });
      expect(await sync({ sourceId: 'ofac-sdn' }, { outboundHttp: fake.http })).toMatchObject({
        outcome: 'error',
        errorCode: code,
      });
      expect((await state('ofac-sdn'))?.lastErrorCode).toBe(code);
      expect((await state('ofac-sdn'))?.lastCheckedAt).toBeNull();
    }
  });

  it('removes a stale private directory left by an earlier run, and keeps a fresh one', async () => {
    const stale = join(temporary, 'openverify-watchlist-stale');
    const fresh = join(temporary, 'openverify-watchlist-fresh');
    await mkdir(stale);
    await mkdir(fresh);
    const old = new Date(NOW.getTime() - 2 * 3_600_000);
    await utimes(stale, old, old);
    const fake = fakeHttp({ [SDN_URL]: () => 404 });

    await sync({ sourceId: 'ofac-sdn' }, { outboundHttp: fake.http });

    expect(await readdir(temporary)).toEqual(['openverify-watchlist-fresh']);
    expect((await stat(fresh)).isDirectory()).toBe(true);
  });
});

describe('Wikidata (C80.1)', () => {
  const entity = (qid: string) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${qid}` });
  const literal = (value: string, lang?: string) => ({
    type: 'literal',
    value,
    ...(lang === undefined ? {} : { 'xml:lang': lang }),
  });
  const time = (date: string) => ({
    type: 'literal',
    value: `${date}T00:00:00Z`,
    datatype: 'http://www.w3.org/2001/XMLSchema#dateTime',
  });
  const results = (bindings: unknown[]) => ({ head: { vars: [] }, results: { bindings } });
  const precision = {
    type: 'literal',
    value: '11',
    datatype: 'http://www.w3.org/2001/XMLSchema#integer',
  };

  it('imports a recorded answer document into wikidata-pep with no request and no User-Agent', async () => {
    const document = {
      format: PEP_IMPORT_FORMAT,
      positions: {
        Q2285706: results([
          {
            statement: {
              type: 'uri',
              value: 'http://www.wikidata.org/entity/statement/synthetic-1',
            },
            person: entity('Q-test-1001'),
            position: entity('Q-test-2001'),
            positionLabel: literal('Prime Minister of Synthetica', 'en'),
            start: time('2023-05-01'),
            startPrecision: precision,
            jurisdiction: literal('GB'),
          },
        ]),
      },
      persons: results([
        {
          person: entity('Q-test-1001'),
          fact: literal('label'),
          value: literal('Marlowe Testerton', 'en'),
        },
        {
          person: entity('Q-test-1001'),
          fact: literal('birth'),
          value: time('1968-03-14'),
          precision,
        },
      ]),
    };
    const path = await file('pep-answers.json', JSON.stringify(document));
    const fake = fakeHttp({});

    const result = await sync(
      { sourceId: 'wikidata-pep', importPath: path },
      { outboundHttp: fake.http },
    );

    expect(result).toMatchObject({ outcome: 'applied', added: 1 });
    expect((await lastSync())?.origin).toBe('import');
    expect(fake.requests).toEqual([]);
    expect([...(await loadLiveEntryHashes(database.db, 'wikidata-pep')).keys()]).toEqual([
      'Q-test-1001',
    ]);
  });
});

describe('the purge of removed entries (C76.8)', () => {
  it('purges entries removed more than the retention ago, after a successful check', async () => {
    await sync({
      sourceId: 'openverify-sandbox',
      importPath: sandboxFile('openverify-sandbox.v2.json'),
    });
    now = new Date('2026-10-28T12:00:00.000Z');
    await sync({
      sourceId: 'openverify-sandbox',
      importPath: sandboxFile(),
      acceptOlderPublication: true,
    });
    const removed = sql`select entry_id from watchlist_entries
                         where source_id = 'openverify-sandbox' and removed_at is not null`;
    expect((await database.db.execute(removed)).rows).toEqual([{ entry_id: 'SBX-1002' }]);

    now = new Date(now.getTime() + 89 * 86_400_000);
    await sync({ sourceId: 'openverify-sandbox', importPath: sandboxFile() });
    expect((await database.db.execute(removed)).rows).toHaveLength(1);

    now = new Date(now.getTime() + 2 * 86_400_000);
    expect(
      (await sync({ sourceId: 'openverify-sandbox', importPath: sandboxFile() })).outcome,
    ).toBe('unchanged');
    expect((await database.db.execute(removed)).rows).toEqual([]);
    expect((await loadLiveEntryHashes(database.db, 'openverify-sandbox')).size).toBe(69);
  });
});

describe('requests', () => {
  it('throws for a source the manifest does not know', async () => {
    await expect(sync({ sourceId: 'not-a-source' })).rejects.toBeInstanceOf(
      UnknownWatchlistSourceError,
    );
  });

  it('logs counts and codes only, never a listed name', async () => {
    await sync({ sourceId: 'openverify-sandbox', importPath: sandboxFile() });

    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join('\n')).not.toMatch(/Avery|Quillfeather|SBX-1001/);
  });
});
