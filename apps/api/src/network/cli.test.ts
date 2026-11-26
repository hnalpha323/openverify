/**
 * C92.2: `network:sync`'s command line, over PGlite, in-memory storage and a fake publisher with
 * synthetic bodies (no request leaves the process). Output is one line per source: ids, outcomes,
 * counts and codes only.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listNetworkSourceStates } from '@openverify/db';
import { createTestDatabase, type TestDatabase } from '@openverify/db/testing';
import { sandboxNetworkBundle, syntheticTorExitList } from '@openverify/signals/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OutboundHttp } from '../http/index.js';
import { createWorkerLogger } from '../jobs/logger.js';
import { createInMemoryFileStorage } from '../storage/index.js';
import { sharedWatchlistSession } from '../watchlists/sync-session.js';
import {
  NETWORK_SYNC_USAGE,
  NetworkCliUsageError,
  networkCliExitCode,
  parseNetworkSyncArgs,
  runNetworkSync,
  type NetworkCliRuntime,
} from './cli.js';
import type { NetworkSyncResult } from './sync.js';

let database: TestDatabase;
const directories: string[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.client.query('delete from network_syncs');
  await database.client.query('delete from network_sources');
});

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('parseNetworkSyncArgs', () => {
  it('reads every flag, in either form', () => {
    expect(parseNetworkSyncArgs([])).toEqual({
      source: null,
      importPath: null,
      allowMassRemoval: false,
      allowMassAddition: false,
      acceptOlderPublication: false,
      json: false,
    });
    expect(
      parseNetworkSyncArgs([
        '--source=aws-ip-ranges',
        '--import',
        '/tmp/ip-ranges.json',
        '--allow-mass-removal',
        '--allow-mass-addition',
        '--accept-older-publication',
        '--json',
      ]),
    ).toEqual({
      source: 'aws-ip-ranges',
      importPath: '/tmp/ip-ranges.json',
      allowMassRemoval: true,
      allowMassAddition: true,
      acceptOlderPublication: true,
      json: true,
    });
  });

  it('refuses an unknown flag, a missing value, a bad source id and --import alone', () => {
    expect(() => parseNetworkSyncArgs(['--force'])).toThrow(NetworkCliUsageError);
    expect(() => parseNetworkSyncArgs(['--force'])).toThrow(NETWORK_SYNC_USAGE);
    expect(() => parseNetworkSyncArgs(['--source'])).toThrow(/needs a value/);
    expect(() => parseNetworkSyncArgs(['--source', 'Not A Source'])).toThrow(/source id/);
    expect(() => parseNetworkSyncArgs(['--import', '/tmp/x'])).toThrow(/--import needs --source/);
  });
});

function runtime(answers: Record<string, string>, lines: string[]): NetworkCliRuntime {
  const http: OutboundHttp = {
    client: () => {
      throw new Error('not used');
    },
    streamClient: () => ({
      async stream(request, sink) {
        const body = answers[request.url];
        if (body === undefined) {
          return { status: 503, contentType: null, headers: {}, bytes: 0 };
        }
        await sink.write(Buffer.from(body));
        return { status: 200, contentType: null, headers: {}, bytes: Buffer.byteLength(body) };
      },
    }),
    close: () => Promise.resolve(),
  };
  return {
    db: database.db,
    connect: sharedWatchlistSession(database.db),
    clock: { now: () => new Date('2026-10-30T08:00:00Z') },
    logger: createWorkerLogger({ name: 'network-cli-test', level: 'silent' }),
    network: { sourcesDisabled: [], sourcesEnabled: [] },
    storage: createInMemoryFileStorage(),
    outboundHttp: http,
    out: (line) => lines.push(line),
  };
}

describe('runNetworkSync', () => {
  it('reconciles first, then syncs every enabled source that downloads, one line each', async () => {
    const lines: string[] = [];
    const results = await runNetworkSync(
      parseNetworkSyncArgs([]),
      runtime(
        {
          'https://check.torproject.org/exit-addresses': syntheticTorExitList({
            seed: 'cli',
            publishedAt: new Date('2026-10-30T07:00:00Z'),
          }),
        },
        lines,
      ),
    );
    expect(results.map((result) => result.sourceId)).toEqual([
      'dbip-country-lite',
      'dbip-asn-lite',
      'tor-exit-addresses',
      'aws-ip-ranges',
      'gcp-cloud',
      'oracle-public-ip-ranges',
      'cloudflare-ips',
      'digitalocean-geofeed',
      'linode-geofeed',
    ]);
    expect(results.find((result) => result.sourceId === 'tor-exit-addresses')?.outcome).toBe(
      'applied',
    );
    expect(lines).toHaveLength(results.length);
    expect(lines[0]).toMatch(
      /^dbip-country-lite: error \(sync \d+\), entries 0, bytes 0, code download_failed$/,
    );
    expect(lines.join('\n')).not.toMatch(/https?:|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(networkCliExitCode(results)).toBe(1);
    expect((await listNetworkSourceStates(database.db)).length).toBe(13);
  });

  it('imports one named file, printing JSON lines with --json', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openverify-network-cli-'));
    directories.push(directory);
    const path = join(directory, 'sandbox.json');
    await writeFile(path, sandboxNetworkBundle());
    const lines: string[] = [];
    const results = await runNetworkSync(
      parseNetworkSyncArgs(['--source', 'openverify-sandbox-network', '--import', path, '--json']),
      runtime({}, lines),
    );
    expect(results).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      sourceId: 'openverify-sandbox-network',
      outcome: 'applied',
      origin: 'import',
    });
    expect(networkCliExitCode(results)).toBe(0);
  });

  it('refuses a source the manifest does not name, and an import-only source without --import', async () => {
    await expect(
      runNetworkSync(parseNetworkSyncArgs(['--source', 'no-such-source']), runtime({}, [])),
    ).rejects.toThrow(/not a source of network\/sources\.json/);
    await expect(
      runNetworkSync(parseNetworkSyncArgs(['--source', 'azure-service-tags']), runtime({}, [])),
    ).rejects.toThrow(NetworkCliUsageError);
  });

  it('prints the overrides a sync used', async () => {
    const lines: string[] = [];
    const run = runtime({}, lines);
    const directory = await mkdtemp(join(tmpdir(), 'openverify-network-cli-'));
    directories.push(directory);
    const path = join(directory, 'ip-ranges.json');
    await writeFile(
      path,
      JSON.stringify({
        syncToken: '1793232000',
        createDate: '2026-10-29-00-00-00',
        prefixes: [],
        ipv6_prefixes: [],
      }),
    );
    await runNetworkSync(
      parseNetworkSyncArgs(['--source', 'aws-ip-ranges', '--import', path, '--allow-mass-removal']),
      run,
    );
    expect(lines[0]).toMatch(
      /^aws-ip-ranges: applied \(sync \d+\), entries 0, bytes \d+, import, overrides allow-mass-removal$/,
    );
  });
});

describe('networkCliExitCode', () => {
  const result = (outcome: NetworkSyncResult['outcome']) =>
    ({ outcome }) as unknown as NetworkSyncResult;

  it('is 0 only when every source applied or stayed unchanged', () => {
    expect(networkCliExitCode([])).toBe(0);
    expect(networkCliExitCode([result('applied'), result('unchanged')])).toBe(0);
    expect(networkCliExitCode([result('applied'), result('busy')])).toBe(1);
    expect(networkCliExitCode([result('refused_rollback')])).toBe(1);
  });
});
