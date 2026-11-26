/**
 * Workflow 7A's capacity items (b) and (d) (Workflow 11D load-harness): the C93.2 lookup row over
 * the default sources' synthetic files, and City Lite's verify, both run by `load/mmdb/`'s runners
 * in a fresh process. Here the files are synthetic and small (`writeMemoryFiles` at 1% of the
 * measured sizes, `syntheticCityMmdb`): never the real City Lite file (rule 9). Vitest runs
 * `src/**` tests, so the script's tests live here.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { syntheticCityMmdb } from '@openverify/signals/testing';
// The measured-size writer is the signals package's measurement tool, not one of its exports.
import { writeMemoryFiles } from '../../../packages/signals/src/testing/memory-measurement.js';
import { afterAll, describe, expect, it } from 'vitest';
import {
  LOOKUP_SOURCES,
  NETWORK_LOOKUP_BUDGET_MS,
  NETWORK_LOOKUP_CALLS,
  documentationAddresses,
  lookupSources,
  timeLookups,
  verifyCityMmdb,
} from '../scripts/network-benchmark.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const made: string[] = [];
const scratch = () => {
  const directory = mkdtempSync(join(tmpdir(), 'openverify-network-benchmark-'));
  made.push(directory);
  return directory;
};

afterAll(() => {
  for (const directory of made) rmSync(directory, { recursive: true, force: true });
});

function smallSources() {
  const files = writeMemoryFiles(scratch(), 0.01);
  const paths: Record<string, string> = {
    'dbip-country-lite': files.mmdb.country,
    'dbip-asn-lite': files.mmdb.asn,
    'tor-exit-addresses': files.tor,
    ...files.ranges,
  };
  return lookupSources((sourceId) => readFileSync(paths[sourceId] ?? ''));
}

const NODE = [
  '--experimental-transform-types',
  '--no-warnings',
  '--conditions=@openverify/source',
  '--import',
  './packages/checks/scripts/register-ts.mjs',
];

describe('the C93.2 lookup row (7A item (b))', () => {
  it('holds the method budget and its call count', () => {
    expect(NETWORK_LOOKUP_BUDGET_MS).toBe(1);
    expect(NETWORK_LOOKUP_CALLS).toBe(1_000_000);
    expect(LOOKUP_SOURCES.map((source) => source.role)).toEqual([
      'geo-country',
      'asn',
      'tor',
      'cloud-ranges',
      'cloud-ranges',
      'cloud-ranges',
      'cloud-ranges',
      'cloud-ranges',
      'cloud-ranges',
    ]);
  });

  it('gives documentation addresses only', () => {
    const addresses = documentationAddresses(8);
    expect(addresses).toEqual([
      '192.0.2.0',
      '198.51.100.1',
      '203.0.113.2',
      '2001:db8:3::3',
      '198.51.100.4',
      '203.0.113.5',
      '192.0.2.6',
      '2001:db8:7::7',
    ]);
  });

  it('evaluates every call over the default sources and times each on its own clock', () => {
    let tick = 0n;
    const timing = timeLookups(smallSources(), {
      calls: 400,
      warmUp: 10,
      now: () => (tick += 250_000n),
    });
    // Each call reads the clock twice, 0.25 ms apart.
    expect(timing).toEqual({
      calls: 400,
      meanMs: 0.25,
      p99Ms: 0.25,
      maxMs: 0.25,
      unevaluated: 0,
      budgetMs: 1,
      met: true,
    });
    expect(timeLookups(smallSources(), { calls: 0, warmUp: 0 }).met).toBe(false);
  });

  it('runs as its own process and prints one JSON line', () => {
    const output = execFileSync(
      process.execPath,
      [...NODE, 'load/mmdb/network-lookup.mjs', scratch(), '--calls', '2000', '--scale', '0.01'],
      { cwd: ROOT, encoding: 'utf8' },
    );
    const line = JSON.parse(output) as Record<string, unknown>;
    expect(line).toMatchObject({ calls: 2000, unevaluated: 0, budgetMs: 1 });
    expect(typeof line.meanMs).toBe('number');
    expect(typeof line.loadStart).toBe('number');
  });
});

describe("City Lite's verify (7A item (d))", () => {
  const city = syntheticCityMmdb({ seed: 'city-verify' });

  it('verifies a City MMDB, gunzipped or not, with its times and counts', () => {
    const plain = verifyCityMmdb(city, { gzipped: false });
    const zipped = verifyCityMmdb(gzipSync(city), { gzipped: true });
    expect(plain.bytes).toBe(city.byteLength);
    expect(zipped).toMatchObject({
      bytes: city.byteLength,
      nodes: plain.nodes,
      prefixes: plain.prefixes,
      records: plain.records,
    });
    expect(plain.prefixes).toBeGreaterThan(0);
    expect(plain.records).toBeGreaterThan(0);
    expect(plain.peakRssMiB).toBeGreaterThan(0);
  });

  it('runs as a fresh process on a .gz file and prints one JSON line', () => {
    const file = join(scratch(), 'city.mmdb.gz');
    writeFileSync(file, gzipSync(city));
    const output = execFileSync(
      process.execPath,
      [...NODE, 'load/mmdb/verify-city-lite.mjs', file],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    );
    expect(JSON.parse(output)).toMatchObject({
      bytes: city.byteLength,
      prefixes: verifyCityMmdb(city, { gzipped: false }).prefixes,
    });
  });

  it('refuses a runner call without a file', () => {
    expect(() =>
      execFileSync(process.execPath, [...NODE, 'load/mmdb/verify-city-lite.mjs'], {
        cwd: ROOT,
        stdio: 'pipe',
      }),
    ).toThrow();
  });
});
