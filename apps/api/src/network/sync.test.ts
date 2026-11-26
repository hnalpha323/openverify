/**
 * C92.2, C92.3 (ADR 0006): the network sync on the sync runner, over PGlite and in-memory object
 * storage. Every publication is synthetic (documentation ranges, fictional ASNs), from
 * `@openverify/signals/testing` or written here; the publisher is a fake stream client, so no
 * request leaves the process. The races and `busy` need two connections: they are in
 * `network.integration.test.ts`.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { getNetworkSync, listNetworkSourceStates } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { sandboxNetworkBundle, syntheticTorExitList, writeMmdb } from '@openverify/signals/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OutboundHttp, OutboundStreamClientOptions } from '../http/index.js';
import { createWorkerLogger } from '../jobs/logger.js';
import { createCapturingLogger } from '../jobs/testing.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import { sharedWatchlistSession } from '../watchlists/sync-session.js';
import { loadNetworkManifest } from './manifest.js';
import { reconcileNetworkSources } from './reconcile.js';
import {
  ImportOnlyNetworkSourceError,
  SNAPSHOT_PURGE_AFTER_MS,
  UnknownNetworkSourceError,
  purgeNetworkSnapshots,
  snapshotKey,
  syncNetworkSource,
  type NetworkSyncDeps,
  type NetworkSyncRequest,
} from './sync.js';

let database: TestDatabase;
const manifest = loadNetworkManifest();
const logger = createWorkerLogger({ name: 'network-sync-test', level: 'silent' });

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

let now = new Date('2026-10-30T08:00:00.000Z');
const clock = { now: () => now };
const directories: string[] = [];

beforeEach(async () => {
  now = new Date('2026-10-30T08:00:00.000Z');
  await database.client.query('delete from network_syncs');
  await database.client.query('delete from network_sources');
  await reconcileNetworkSources(database.db, {
    sourcesDisabled: [],
    sourcesEnabled: ['dbip-city-lite', 'azure-service-tags'],
    clock,
    manifest,
  });
});

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

/** A publisher answering each URL with its synthetic body. */
function publisher(answers: Record<string, Uint8Array | string | number>) {
  const requested: string[] = [];
  const options: OutboundStreamClientOptions[] = [];
  const http: OutboundHttp = {
    client: () => {
      throw new Error('not used');
    },
    streamClient(clientOptions) {
      options.push(clientOptions);
      return {
        async stream(request, sink) {
          requested.push(request.url);
          const answer = answers[request.url];
          if (answer === undefined || typeof answer === 'number') {
            return { status: answer ?? 404, contentType: null, headers: {}, bytes: 0 };
          }
          const body = typeof answer === 'string' ? Buffer.from(answer) : Buffer.from(answer);
          await sink.write(body);
          return { status: 200, contentType: null, headers: {}, bytes: body.byteLength };
        },
      };
    },
    close: () => Promise.resolve(),
  };
  return { http, requested, options };
}

function deps(overrides: Partial<NetworkSyncDeps> = {}) {
  const storage = createInMemoryFileStorage();
  const value: NetworkSyncDeps = {
    db: database.db,
    connect: sharedWatchlistSession(database.db),
    clock,
    logger,
    storage,
    manifest,
    ...overrides,
  };
  return { deps: value, storage: (value.storage ?? storage) as typeof storage };
}

const sync = (
  value: NetworkSyncDeps,
  request: Partial<NetworkSyncRequest> & { sourceId: string },
) => syncNetworkSource(value, { actor: 'cli', ...request });

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const AWS = 'https://ip-ranges.amazonaws.com/ip-ranges.json';
const TOR = 'https://check.torproject.org/exit-addresses';

/** An AWS `ip-ranges.json` of `prefixes`, dated by `syncToken` (Unix seconds). */
function awsRanges(prefixes: readonly string[], publishedAt = new Date('2026-10-29T00:00:00Z')) {
  return JSON.stringify({
    syncToken: String(Math.floor(publishedAt.getTime() / 1000)),
    createDate: '2026-10-29-00-00-00',
    prefixes: prefixes.map((prefix) => ({
      ip_prefix: prefix,
      region: 'example-east-1',
      service: 'EC2',
      network_border_group: 'example-east-1',
    })),
    ipv6_prefixes: [],
  });
}

const FOUR = ['192.0.2.0/26', '192.0.2.64/26', '192.0.2.128/26', '192.0.2.192/26'];

function countryMmdb(entries: number, buildEpoch = new Date('2026-10-01T00:00:00Z')) {
  return writeMmdb({
    databaseType: 'DBIP-Country-Lite',
    buildEpoch,
    languages: ['en'],
    entries: Array.from({ length: entries }, (_, index) => ({
      network: `${index < 256 ? '203.0.113' : '198.51.100'}.${String(index % 256)}/32`,
      data: { country: { iso_code: 'ZZ', names: { en: 'Example Land' } } },
    })),
  });
}

function networkCap(id: string): number {
  return manifest.sources.find((source) => source.id === id)?.max_bytes.inflated ?? 0;
}

async function stateOf(id: string) {
  return (await listNetworkSourceStates(database.db)).find((state) => state.id === id);
}

describe('syncNetworkSource: imports (C76.2 imports, C93.6)', () => {
  it('imports the sandbox bundle as an import, storing the snapshot under its SHA-256', async () => {
    const { deps: value, storage } = deps();
    const bundle = sandboxNetworkBundle();
    const result = await sync(value, {
      sourceId: 'openverify-sandbox-network',
      actor: 'seed',
      importBytes: bundle,
    });
    expect(result).toMatchObject({
      sourceId: 'openverify-sandbox-network',
      outcome: 'applied',
      origin: 'import',
      errorCode: null,
      overrides: [],
      snapshotBytes: bundle.byteLength,
    });
    expect(result.entryCount).toBeGreaterThan(0);
    const key = snapshotKey('openverify-sandbox-network', sha256(bundle));
    expect(Buffer.from((await storage.get(key)) ?? []).equals(bundle)).toBe(true);
    const state = await stateOf('openverify-sandbox-network');
    expect(state).toMatchObject({
      lastSha256: sha256(bundle),
      lastOrigin: 'import',
      lastSyncId: result.syncId,
    });
    const row = await getNetworkSync(database.db, result.syncId ?? 0);
    expect(row).toMatchObject({
      outcome: 'applied',
      actor: 'seed',
      origin: 'import',
      entryCount: result.entryCount,
    });

    // The same bundle again changes nothing.
    const again = await sync(value, {
      sourceId: 'openverify-sandbox-network',
      actor: 'seed',
      importBytes: bundle,
    });
    expect(again).toMatchObject({ outcome: 'unchanged', origin: 'import' });
  });

  it('imports a file from --import without asking the publisher', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openverify-network-import-'));
    directories.push(directory);
    const path = join(directory, 'ip-ranges.json');
    await writeFile(path, awsRanges(FOUR));
    const fake = publisher({});
    const { deps: value } = deps({ outboundHttp: fake.http });
    const result = await sync(value, { sourceId: 'aws-ip-ranges', importPath: path });
    expect(result).toMatchObject({ outcome: 'applied', origin: 'import', entryCount: 1 });
    expect(fake.requested).toEqual([]);
  });

  it('refuses an import-only source without --import, and an unknown source', async () => {
    const { deps: value } = deps();
    await expect(sync(value, { sourceId: 'azure-service-tags' })).rejects.toBeInstanceOf(
      ImportOnlyNetworkSourceError,
    );
    await expect(sync(value, { sourceId: 'no-such-source' })).rejects.toBeInstanceOf(
      UnknownNetworkSourceError,
    );
  });
});

describe('syncNetworkSource: downloads (C92.2)', () => {
  it('applies a fresh exit list, dated by its newest LastStatus, then reads an equal one as unchanged', async () => {
    const list = syntheticTorExitList({
      seed: 'apply',
      relays: 30,
      publishedAt: new Date('2026-10-30T07:00:00Z'),
    });
    const fake = publisher({ [TOR]: list });
    const { deps: value } = deps({ outboundHttp: fake.http });
    const applied = await sync(value, { sourceId: 'tor-exit-addresses', actor: 'job' });
    expect(applied).toMatchObject({ outcome: 'applied', origin: 'publisher' });
    expect((await stateOf('tor-exit-addresses'))?.lastPublishedAt).toEqual(
      new Date('2026-10-30T07:00:00Z'),
    );
    now = new Date('2026-10-30T09:00:00Z');
    const unchanged = await sync(value, { sourceId: 'tor-exit-addresses', actor: 'job' });
    expect(unchanged.outcome).toBe('unchanged');
    expect((await stateOf('tor-exit-addresses'))?.lastCheckedAt).toEqual(now);
  });

  it('refuses a disabled source without asking the publisher', async () => {
    await reconcileNetworkSources(database.db, {
      sourcesDisabled: ['gcp-cloud'],
      sourcesEnabled: [],
      clock,
      manifest,
    });
    const fake = publisher({});
    const { deps: value } = deps({ outboundHttp: fake.http });
    const result = await sync(value, { sourceId: 'gcp-cloud' });
    expect(result).toMatchObject({ outcome: 'error', errorCode: 'source_disabled' });
    expect(fake.requested).toEqual([]);
  });

  it('refuses without object storage, before any request', async () => {
    const fake = publisher({ [TOR]: 'x' });
    const { deps: value } = deps({ outboundHttp: fake.http, storage: undefined });
    const result = await sync({ ...value, storage: undefined }, { sourceId: 'tor-exit-addresses' });
    expect(result).toMatchObject({ outcome: 'error', errorCode: 'storage_not_configured' });
    expect(fake.requested).toEqual([]);
  });

  it('records a failed download as an error that counts toward the back-off', async () => {
    const fake = publisher({ [TOR]: 503 });
    const { deps: value } = deps({ outboundHttp: fake.http });
    const result = await sync(value, { sourceId: 'tor-exit-addresses', actor: 'job' });
    expect(result).toMatchObject({ outcome: 'error', errorCode: 'download_failed' });
    expect(await stateOf('tor-exit-addresses')).toMatchObject({
      lastErrorCode: 'download_failed',
      checkFailures: 1,
      lastFailedAt: now,
    });
    expect((await getNetworkSync(database.db, result.syncId ?? 0))?.errorCode).toBe(
      'download_failed',
    );
  });

  it('refuses a file it cannot parse, and an empty publication', async () => {
    const { deps: value } = deps({
      outboundHttp: publisher({ [AWS]: '{"not": "aws"}' }).http,
    });
    expect((await sync(value, { sourceId: 'aws-ip-ranges' })).outcome).toBe('refused_schema');
    const empty = deps({ outboundHttp: publisher({ [AWS]: awsRanges([]) }).http });
    expect((await sync(empty.deps, { sourceId: 'aws-ip-ranges' })).outcome).toBe('refused_schema');
    expect(await stateOf('aws-ip-ranges')).toMatchObject({ checkFailures: 2 });
    const forced = await sync(empty.deps, { sourceId: 'aws-ip-ranges', allowMassRemoval: true });
    expect(forced).toMatchObject({ outcome: 'applied', overrides: ['allow-mass-removal'] });
  });

  it('counts each error or refusal as network_sync_failed, never an applied sync (C250.7, Workflow 11B)', async () => {
    const counting = createCapturingLogger();
    const failing = deps({ outboundHttp: publisher({ [TOR]: 503 }).http, logger: counting });
    await sync(failing.deps, { sourceId: 'tor-exit-addresses', actor: 'job' });
    const refusing = deps({
      outboundHttp: publisher({ [AWS]: '{"not": "aws"}' }).http,
      logger: counting,
    });
    await sync(refusing.deps, { sourceId: 'aws-ip-ranges' });
    const applying = deps({
      outboundHttp: publisher({ [AWS]: awsRanges(['192.0.2.0/26']) }).http,
      logger: counting,
    });
    expect((await sync(applying.deps, { sourceId: 'aws-ip-ranges' })).outcome).toBe('applied');

    const metrics = counting.entries.filter(({ object }) => 'metric' in object);
    expect(metrics.map(({ level, object }) => ({ level, ...object }))).toEqual([
      { level: 'info', metric: 'network_sync_failed', value: 1 },
      { level: 'info', metric: 'network_sync_failed', value: 1 },
    ]);
  });
});

describe('syncNetworkSource: the guards under the lock (C92.2 step 6)', () => {
  it('refuses a rollback unless told to accept an older publication', async () => {
    const newer = deps({ outboundHttp: publisher({ [AWS]: awsRanges(FOUR) }).http });
    expect((await sync(newer.deps, { sourceId: 'aws-ip-ranges' })).outcome).toBe('applied');
    const older = deps({
      outboundHttp: publisher({
        [AWS]: awsRanges(
          ['192.0.2.0/25', '192.0.2.128/26', '192.0.2.192/26'],
          new Date('2026-10-20T00:00:00Z'),
        ),
      }).http,
      storage: newer.storage,
    });
    expect((await sync(older.deps, { sourceId: 'aws-ip-ranges' })).outcome).toBe(
      'refused_rollback',
    );
    const accepted = await sync(older.deps, {
      sourceId: 'aws-ip-ranges',
      acceptOlderPublication: true,
    });
    expect(accepted).toMatchObject({ outcome: 'applied', overrides: ['accept-older-publication'] });
  });

  it('refuses a publication dated more than a day ahead', async () => {
    const future = deps({
      outboundHttp: publisher({ [AWS]: awsRanges(FOUR, new Date('2026-11-02T00:00:00Z')) }).http,
    });
    expect((await sync(future.deps, { sourceId: 'aws-ip-ranges' })).outcome).toBe('refused_future');
  });

  it('refuses a range set that loses more than a quarter of its addresses, unless allowed', async () => {
    const first = deps({ outboundHttp: publisher({ [AWS]: awsRanges(FOUR) }).http });
    await sync(first.deps, { sourceId: 'aws-ip-ranges' });
    // One /26 of four gone is exactly a quarter, which the guard lets through.
    const quarter = deps({
      outboundHttp: publisher({
        [AWS]: awsRanges(FOUR.slice(0, 3), new Date('2026-10-29T06:00:00Z')),
      }).http,
      storage: first.storage,
    });
    expect((await sync(quarter.deps, { sourceId: 'aws-ip-ranges' })).outcome).toBe('applied');
    const smaller = deps({
      outboundHttp: publisher({
        [AWS]: awsRanges(FOUR.slice(0, 1), new Date('2026-10-29T07:00:00Z')),
      }).http,
      storage: first.storage,
    });
    const refused = await sync(smaller.deps, { sourceId: 'aws-ip-ranges' });
    expect(refused).toMatchObject({
      outcome: 'refused_mass_removal',
      errorCode: 'refused_mass_removal',
    });
    const allowed = await sync(smaller.deps, { sourceId: 'aws-ip-ranges', allowMassRemoval: true });
    expect(allowed).toMatchObject({ outcome: 'applied', overrides: ['allow-mass-removal'] });
  });

  it('refuses a range set that grows by more than a quarter or holds a prefix under min_prefix', async () => {
    const first = deps({ outboundHttp: publisher({ [AWS]: awsRanges(['192.0.2.0/26']) }).http });
    await sync(first.deps, { sourceId: 'aws-ip-ranges' });
    const larger = deps({
      outboundHttp: publisher({
        [AWS]: awsRanges(['192.0.2.0/26', '198.51.100.0/24'], new Date('2026-10-29T06:00:00Z')),
      }).http,
      storage: first.storage,
    });
    expect((await sync(larger.deps, { sourceId: 'aws-ip-ranges' })).outcome).toBe(
      'refused_mass_addition',
    );
    const allowed = await sync(larger.deps, { sourceId: 'aws-ip-ranges', allowMassAddition: true });
    expect(allowed).toMatchObject({ outcome: 'applied', overrides: ['allow-mass-addition'] });

    await database.client.query('delete from network_syncs');
    await database.client.query(
      `update network_sources set last_sync_id = null, last_sha256 = null, last_published_at = null`,
    );
    const wide = deps({ outboundHttp: publisher({ [AWS]: awsRanges(['192.0.0.0/7']) }).http });
    expect((await sync(wide.deps, { sourceId: 'aws-ip-ranges' })).outcome).toBe(
      'refused_mass_addition',
    );
  });

  it('refuses an exit list that loses more than a quarter of its exits', async () => {
    const first = deps({
      outboundHttp: publisher({ [TOR]: syntheticTorExitList({ seed: 'many', relays: 60 }) }).http,
    });
    await sync(first.deps, { sourceId: 'tor-exit-addresses' });
    const few = deps({
      outboundHttp: publisher({
        [TOR]: syntheticTorExitList({
          seed: 'few',
          relays: 5,
          publishedAt: new Date('2026-10-28T00:00:00Z'),
        }),
      }).http,
      storage: first.storage,
    });
    expect((await sync(few.deps, { sourceId: 'tor-exit-addresses' })).outcome).toBe(
      'refused_mass_removal',
    );
  });
});

describe('syncNetworkSource: DB-IP MMDBs (gunzip, the page digest, the size guard)', () => {
  const page = 'https://db-ip.com/db/download/ip-to-country-lite';
  const url = 'https://download.db-ip.com/free/dbip-country-lite-2026-10.mmdb.gz';
  const sha1 = (bytes: Uint8Array) => createHash('sha1').update(bytes).digest('hex');

  it('applies a gunzipped MMDB whose SHA-1 the page names, storing the decompressed file', async () => {
    const mmdb = countryMmdb(40);
    const fake = publisher({ [url]: gzipSync(mmdb), [page]: `<td>${sha1(mmdb)}</td>` });
    const { deps: value, storage } = deps({ outboundHttp: fake.http });
    const result = await sync(value, { sourceId: 'dbip-country-lite' });
    expect(result).toMatchObject({ outcome: 'applied', snapshotBytes: mmdb.byteLength });
    const stored = await storage.get(snapshotKey('dbip-country-lite', sha256(mmdb)));
    expect(Buffer.from(stored ?? []).equals(mmdb)).toBe(true);
    expect((await stateOf('dbip-country-lite'))?.lastPublishedAt).toEqual(
      new Date('2026-10-01T00:00:00Z'),
    );
  });

  it('refuses an MMDB whose SHA-1 the page does not name', async () => {
    const fake = publisher({ [url]: gzipSync(countryMmdb(40)), [page]: '<td>no digest here</td>' });
    const { deps: value } = deps({ outboundHttp: fake.http });
    expect((await sync(value, { sourceId: 'dbip-country-lite' })).outcome).toBe('refused_digest');
  });

  it('refuses an MMDB under half the applied size, unless allowed', async () => {
    const large = countryMmdb(400);
    const first = deps({
      outboundHttp: publisher({ [url]: gzipSync(large), [page]: sha1(large) }).http,
    });
    expect((await sync(first.deps, { sourceId: 'dbip-country-lite' })).outcome).toBe('applied');
    const small = countryMmdb(4, new Date('2026-10-02T00:00:00Z'));
    const second = deps({
      outboundHttp: publisher({ [url]: gzipSync(small), [page]: sha1(small) }).http,
      storage: first.storage,
    });
    expect((await sync(second.deps, { sourceId: 'dbip-country-lite' })).outcome).toBe(
      'refused_mass_removal',
    );
  });

  it('refuses a file that inflates past the cap, or is no gzip at all', async () => {
    const cap = networkCap('dbip-country-lite');
    const over = deps({ outboundHttp: publisher({ [url]: gzipSync(Buffer.alloc(cap + 1)) }).http });
    expect((await sync(over.deps, { sourceId: 'dbip-country-lite' })).outcome).toBe('refused_size');
    const plain = deps({ outboundHttp: publisher({ [url]: 'not gzip' }).http });
    expect((await sync(plain.deps, { sourceId: 'dbip-country-lite' })).outcome).toBe(
      'refused_schema',
    );
  });
});

describe('purgeNetworkSnapshots (C92.3, P27)', () => {
  it('deletes superseded snapshots a week after supersession, keeping the current and previous', async () => {
    const storage = createInMemoryFileStorage();
    const lists = [0, 1, 2].map((index) =>
      syntheticTorExitList({
        seed: 'purge',
        relays: 30,
        publishedAt: new Date(Date.UTC(2026, 9, 28, index)),
      }),
    );
    for (const list of lists) {
      const value = deps({ outboundHttp: publisher({ [TOR]: list }).http, storage });
      const result = await sync(value.deps, {
        sourceId: 'tor-exit-addresses',
        allowMassRemoval: true,
      });
      expect(result.outcome).toBe('applied');
      now = new Date(now.getTime() + 60_000);
    }
    const keys = async () =>
      await Promise.all(
        (
          await database.client.query<{ sha256: string }>(
            `select sha256 from network_syncs where outcome = 'applied' order by id`,
          )
        ).rows.map(
          async ({ sha256: digest }) =>
            (await storage.get(snapshotKey('tor-exit-addresses', digest))) !== null,
        ),
      );
    expect(await keys()).toEqual([true, true, true]);
    expect(await purgeNetworkSnapshots({ db: database.db, clock, storage })).toBe(0);
    now = new Date(now.getTime() + SNAPSHOT_PURGE_AFTER_MS + 60_000);
    expect(await purgeNetworkSnapshots({ db: database.db, clock, storage })).toBe(1);
    expect(await keys()).toEqual([false, true, true]);
  });
});
