/**
 * The snapshot memory measurement of C92.3: what the API and the worker hold for every enabled
 * source at rest, and the peak while one source swaps. Every file is synthetic: MMDBs padded to
 * the sizes the research measured for DB-IP's files (Country 8,348,509 B and ASN 9,566,363 B,
 * research §1.1; City Lite 121.1 MB), and range sets with the providers' measured prefix counts,
 * all inside the documentation ranges. The reader keeps a file's buffer and builds no index, so
 * an MMDB's memory is its size whatever the tree inside it.
 *
 * Run it in a fresh process per scenario (the measurement reads the process's own RSS):
 * `node --expose-gc --experimental-transform-types --no-warnings --conditions=@openverify/source
 *   --import ../checks/scripts/register-ts.mjs src/testing/memory-measurement.ts <empty dir>`
 * from `packages/signals`. It writes the files, then measures each scenario in its own child.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPV4_MAPPED_START } from '../network/address.js';
import { canonicalJson } from '../network/canonical.js';
import { IntervalSet } from '../network/interval-set.js';
import type { MmdbRole } from '../network/mmdb.js';
import {
  loadSnapshot,
  type NetworkSnapshot,
  type NetworkSnapshotKind,
} from '../network/snapshot.js';
import { TorExitSet } from '../network/tor-exit-list.js';
import { writeMmdb, type MmdbValue } from './mmdb-writer.js';
import { seededRandom } from './random.js';

/** C92.1's default and optional sources, with the sizes the research measured. */
export const MEASURED_SOURCES = Object.freeze({
  /** Bytes of the decompressed DB-IP Lite MMDBs (research §1.1, 2026-10). */
  mmdbBytes: Object.freeze({ country: 8_348_509, asn: 9_566_363, city: 121_100_000 }),
  /** Prefixes per provider range file (research §4.1, 2026-10-27). */
  rangePrefixes: Object.freeze({
    'aws-ip-ranges': 17_691,
    'gcp-cloud': 1_135,
    'oracle-public-ip-ranges': 1_107,
    'cloudflare-ips': 22,
    'digitalocean-geofeed': 1_235,
    'linode-geofeed': 5_505,
  }),
  /** The exit list held 1,226 IPv4 exits; the documentation ranges hold 768 addresses. */
  torExits: 768,
});

/** The files of one measurement. */
export interface MemoryFiles {
  readonly mmdb: Readonly<Record<'country' | 'asn' | 'city' | 'asn-next' | 'city-next', string>>;
  readonly tor: string;
  readonly ranges: Readonly<Record<string, string>>;
}

/** One scenario: City Lite or not, which source swaps, and how its bytes are read. */
export interface MemoryScenario {
  readonly city: boolean;
  readonly swap: 'asn' | 'city';
  /** `read`: one `readFile`. `stream`: chunks joined with `Buffer.concat`, as an object store's body. */
  readonly load: 'read' | 'stream';
}

/** What one scenario measured, in bytes. */
export interface MemoryReport {
  readonly scenario: MemoryScenario;
  readonly snapshotBytes: number;
  readonly baselineRss: number;
  readonly steadyRss: number;
  readonly steadyDelta: number;
  readonly steadyArrayBuffers: number;
  readonly steadyHeapUsed: number;
  /** RSS with the old and the new snapshot of the swapping source both held. */
  readonly bothHeldRss: number;
  readonly afterSwapRss: number;
  /** The process's peak RSS before the swap, and at its end. */
  readonly peakRssBeforeSwap: number;
  readonly peakRss: number;
  /** The peak over the steady state: what a swap adds. */
  readonly swapPeakDelta: number;
}

const IPV6_BASE = 0x2001_0db8n << 96n;
const PUBLISHED = new Date('2026-10-27T16:00:00Z');
const RECORDS = 256;
const DOCUMENTATION_V4: readonly bigint[] = [0xc000_0200n, 0xc633_6400n, 0xcb00_7100n];

type MmdbFile = keyof MemoryFiles['mmdb'];
const MMDB_FILES: readonly [MmdbFile, 'country' | 'asn' | 'city'][] = [
  ['country', 'country'],
  ['asn', 'asn'],
  ['asn-next', 'asn'],
  ['city', 'city'],
  ['city-next', 'city'],
];

/** The files of a measurement directory (the same names {@link writeMemoryFiles} writes). */
export function memoryFilesIn(directory: string): MemoryFiles {
  return {
    mmdb: Object.fromEntries(
      MMDB_FILES.map(([name]) => [name, join(directory, `${name}.mmdb`)]),
    ) as MemoryFiles['mmdb'],
    tor: join(directory, 'tor-exit-addresses.json'),
    ranges: Object.fromEntries(
      Object.keys(MEASURED_SOURCES.rangePrefixes).map((source) => [
        source,
        join(directory, `${source}.json`),
      ]),
    ),
  };
}

function recordOf(
  role: 'country' | 'asn' | 'city',
  index: number,
  padding: string,
): Record<string, MmdbValue> {
  const country = { iso_code: 'ZZ', names: { en: 'Example Land' } };
  switch (role) {
    case 'country':
      return { country, padding };
    case 'asn':
      return {
        autonomous_system_number: 64496 + (index % 16),
        autonomous_system_organization: 'Example Network',
        padding,
      };
    case 'city':
      return {
        country,
        city: { names: { en: 'Example City' } },
        location: { latitude: -30 - (index % 10) / 10, longitude: -140 },
        padding,
      };
  }
}

/** An MMDB of the role, padded to about `target` bytes with seeded hex. */
function paddedMmdb(role: 'country' | 'asn' | 'city', target: number, seed: string): Buffer {
  const records = Math.max(1, Math.min(RECORDS, Math.floor(target / 512)));
  const write = (length: number) => {
    const random = seededRandom(seed);
    return writeMmdb({
      databaseType: `OpenVerify-Synthetic-${role}-memory`,
      buildEpoch: PUBLISHED,
      // A 24-bit record cannot point past 16 MiB of data; City Lite's size needs 28 bits.
      recordSize: target > 16_000_000 ? 28 : 24,
      entries: Array.from({ length: records }, (_, index) => ({
        network: `2001:db8:${index.toString(16)}::/48`,
        data: recordOf(role, index, random.hex(Math.max(1, length))),
      })),
    });
  };
  // Two passes: the first measures the overhead, the second pads to the target.
  const first = write(1);
  return write(Math.ceil((target - first.length) / records) + 1);
}

/** Writes the synthetic files; `scale` shrinks every size (the tests use a tiny one). */
export function writeMemoryFiles(directory: string, scale = 1): MemoryFiles {
  const files = memoryFilesIn(directory);
  for (const [name, role] of MMDB_FILES) {
    writeFileSync(
      files.mmdb[name],
      paddedMmdb(role, Math.floor(MEASURED_SOURCES.mmdbBytes[role] * scale), name),
    );
  }
  const exits = Math.max(1, Math.round(MEASURED_SOURCES.torExits * scale));
  const tor = TorExitSet.build(
    Array.from({ length: exits }, (_, index) => ({
      // The documentation /24s in turn: 192.0.2.0, 198.51.100.0, 203.0.113.0.
      key:
        IPV4_MAPPED_START + (DOCUMENTATION_V4[Math.floor(index / 256)] ?? 0n) + BigInt(index % 256),
      seenAt: PUBLISHED,
    })),
    PUBLISHED,
  );
  writeFileSync(files.tor, canonicalJson(tor.toJSON()));
  let offset = 0n;
  for (const [source, prefixes] of Object.entries(MEASURED_SOURCES.rangePrefixes)) {
    const count = Math.max(1, Math.round(prefixes * scale));
    // Distinct /64s inside 2001:db8::/32, a gap between each, so none merges with its neighbour.
    const set = IntervalSet.build(
      Array.from({ length: count }, (_, index) => {
        const start = IPV6_BASE | ((offset + BigInt(index) * 2n) << 64n);
        return {
          start,
          end: start | ((1n << 64n) - 1n),
          value: {
            provider: source,
            service: index % 2 === 0 ? 'EXAMPLE_A' : 'EXAMPLE_B',
            region: 'example-1',
          },
        };
      }),
    );
    offset += BigInt(count) * 2n + 2n;
    writeFileSync(
      files.ranges[source] ?? '',
      canonicalJson({
        format: 'openverify-network-ranges',
        version: 1,
        'published-at': PUBLISHED.toISOString(),
        ranges: set.toJSON(),
      }),
    );
  }
  return files;
}

async function streamed(path: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(path)) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Measures one scenario in this process (`--expose-gc` makes the figures stable). */
export async function measureScenario(
  files: MemoryFiles,
  scenario: MemoryScenario,
): Promise<MemoryReport> {
  if (scenario.swap === 'city' && !scenario.city) {
    throw new RangeError('City Lite can swap only when it is loaded');
  }
  const gc = (globalThis as { gc?: () => void }).gc;
  // Twice, a turn apart: a released buffer's backing store is freed by the second pass.
  const collect = async () => {
    gc?.();
    await new Promise((resolve) => setImmediate(resolve));
    gc?.();
  };
  const read = (path: string) => (scenario.load === 'read' ? readFile(path) : streamed(path));
  const held = new Map<string, NetworkSnapshot>();
  let snapshotBytes = 0;
  const open = async (
    id: string,
    path: string,
    kind: NetworkSnapshotKind,
    role: MmdbRole | null,
  ) => {
    const bytes = await read(path);
    // Every load re-checks the snapshot's SHA-256 (decision 44).
    createHash('sha256').update(bytes).digest();
    held.set(id, loadSnapshot(kind, bytes, role));
    snapshotBytes += bytes.length;
  };

  await collect();
  const baseline = process.memoryUsage();
  await open('country', files.mmdb.country, 'mmdb', 'country');
  await open('asn', files.mmdb.asn, 'mmdb', 'asn');
  if (scenario.city) {
    await open('city', files.mmdb.city, 'mmdb', 'city');
  }
  await open('tor', files.tor, 'tor-exits', null);
  for (const [source, path] of Object.entries(files.ranges)) {
    await open(source, path, 'ranges', null);
  }
  await collect();
  const steady = process.memoryUsage();
  const peakBefore = process.resourceUsage().maxRSS * 1024;

  // C92.3: a changed source loads beside the current one, swaps, and the old one is released.
  const nextBytes = await read(files.mmdb[scenario.swap === 'asn' ? 'asn-next' : 'city-next']);
  createHash('sha256').update(nextBytes).digest();
  const next = loadSnapshot('mmdb', nextBytes, scenario.swap);
  const bothHeld = process.memoryUsage().rss;
  held.set(scenario.swap, next);
  await collect();
  const after = process.memoryUsage().rss;
  const peak = process.resourceUsage().maxRSS * 1024;
  return {
    scenario,
    snapshotBytes: held.size > 0 ? snapshotBytes : 0,
    baselineRss: baseline.rss,
    steadyRss: steady.rss,
    steadyDelta: steady.rss - baseline.rss,
    steadyArrayBuffers: steady.arrayBuffers,
    steadyHeapUsed: steady.heapUsed,
    bothHeldRss: bothHeld,
    afterSwapRss: after,
    peakRssBeforeSwap: peakBefore,
    peakRss: peak,
    swapPeakDelta: peak - steady.rss,
  };
}

/** The four scenarios the record reports. */
export const MEMORY_SCENARIOS: readonly MemoryScenario[] = Object.freeze([
  { city: false, swap: 'asn', load: 'read' },
  { city: false, swap: 'asn', load: 'stream' },
  { city: true, swap: 'city', load: 'read' },
  { city: true, swap: 'city', load: 'stream' },
]);

/**
 * The command line: write the files in one child, then measure each scenario in a fresh child.
 * The parent stays small because Linux carries a process's peak RSS across `fork` and `exec`: a
 * child forked from a large parent would report the parent's size as its own peak.
 */
async function main(argv: readonly string[]): Promise<void> {
  const [mode, directory, scenarioText] = argv;
  const self = new URL(import.meta.url).pathname;
  const child = (...args: string[]) =>
    execFileSync(process.execPath, [...process.execArgv, self, ...args], { encoding: 'utf8' });
  if (mode === '--write' && directory !== undefined) {
    writeMemoryFiles(directory);
    return;
  }
  if (mode === '--measure' && directory !== undefined && scenarioText !== undefined) {
    const report = await measureScenario(
      memoryFilesIn(directory),
      JSON.parse(scenarioText) as MemoryScenario,
    );
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  if (mode === undefined || mode.startsWith('--')) {
    throw new Error('usage: memory-measurement.ts <empty directory>');
  }
  child('--write', mode);
  for (const scenario of MEMORY_SCENARIOS) {
    const load = loadavg()
      .map((value) => value.toFixed(2))
      .join(' ');
    const report = JSON.parse(child('--measure', mode, JSON.stringify(scenario))) as MemoryReport;
    process.stdout.write(`${JSON.stringify({ load, ...report })}\n`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
