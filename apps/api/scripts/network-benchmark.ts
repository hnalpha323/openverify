/**
 * Workflow 7A's capacity items (b) and (d) (Workflow 11D load-harness; the load method's
 * `network-lookup` and `city-lite-verify` rows): a development benchmark, never compiled or shipped
 * (`UNLISTED_DEVELOPMENT_SCRIPTS` in `src/commands-build.test.ts`), whose file reading lives in its
 * two runners under `load/mmdb/` (this module touches no file):
 *
 *   node --experimental-transform-types --no-warnings --conditions=@openverify/source \
 *     --import ./packages/checks/scripts/register-ts.mjs load/mmdb/network-lookup.mjs <empty dir> [--calls n]
 *   node ... load/mmdb/verify-city-lite.mjs <file.mmdb.gz | file.mmdb>
 *
 * - `network-lookup` (C93.2: 1 ms a call, the mean over 1,000,000 calls with its p99 beside it):
 *   `evaluateNetwork` as a session's start runs it, over the default sources' synthetic files at the
 *   sizes the research measured (`@openverify/signals/testing`'s `writeMemoryFiles`: Country and ASN
 *   Lite padded to their real bytes, the six range files at their prefix counts, the exit list),
 *   addresses of the documentation ranges in turn.
 * - `city-lite-verify`: `MmdbSnapshot.open(bytes, 'city').verify()` on a fresh process's bytes, its
 *   wall and CPU time, peak RSS, nodes, prefixes and distinct records (reported; no budget exists).
 *
 * Every address is a documentation address and every file synthetic, except the City Lite file
 * the method pins (`load/city-lite-manifest.json`), which is never committed or baked (rule 9).
 */
import { gunzipSync } from 'node:zlib';
import {
  MmdbSnapshot,
  evaluateNetwork,
  loadSnapshot,
  type NetworkLookupInput,
  type NetworkLookupRules,
  type NetworkSourceRole,
  type NetworkSourceSnapshot,
  type NetworkSnapshot,
} from '@openverify/signals/network';

/** C93.2's budget: 1 ms a call, the mean. */
export const NETWORK_LOOKUP_BUDGET_MS = 1;
/** The method's call count per take. */
export const NETWORK_LOOKUP_CALLS = 1_000_000;

/** The default sources' files, by source id, with the role each fills and its snapshot kind. */
export const LOOKUP_SOURCES: readonly {
  sourceId: string;
  role: NetworkSourceRole;
  kind: 'mmdb' | 'ranges' | 'tor-exits';
  mmdbRole?: 'country' | 'asn';
}[] = Object.freeze([
  { sourceId: 'dbip-country-lite', role: 'geo-country', kind: 'mmdb', mmdbRole: 'country' },
  { sourceId: 'dbip-asn-lite', role: 'asn', kind: 'mmdb', mmdbRole: 'asn' },
  { sourceId: 'tor-exit-addresses', role: 'tor', kind: 'tor-exits' },
  { sourceId: 'aws-ip-ranges', role: 'cloud-ranges', kind: 'ranges' },
  { sourceId: 'gcp-cloud', role: 'cloud-ranges', kind: 'ranges' },
  { sourceId: 'oracle-public-ip-ranges', role: 'cloud-ranges', kind: 'ranges' },
  { sourceId: 'cloudflare-ips', role: 'cloud-ranges', kind: 'ranges' },
  { sourceId: 'digitalocean-geofeed', role: 'cloud-ranges', kind: 'ranges' },
  { sourceId: 'linode-geofeed', role: 'cloud-ranges', kind: 'ranges' },
]);

/** The rules the benchmark evaluates with (the confidences the network constants ship). */
export const LOOKUP_RULES: NetworkLookupRules = Object.freeze({
  vpnAsnConfidence: 0.6,
  hostingAsnConfidence: 0.6,
  threatLowConfidenceCap: 0.4,
  threatLowConfidenceCapWithAdapter: 0.4,
  torExitWindowHours: 24,
});

const PUBLISHED = new Date('2026-10-27T16:00:00Z');
/** The null reasons of an address the evaluation refused before reading any source. */
const NOT_EVALUATED: ReadonlySet<string> = new Set([
  'address_not_public',
  'client_address_untrusted',
]);

/** Each source's snapshot from its file's bytes (read by the runner). */
export function lookupSources(bytesOf: (sourceId: string) => Uint8Array): NetworkSourceSnapshot[] {
  return LOOKUP_SOURCES.map((source, index) => {
    const bytes = bytesOf(source.sourceId);
    const snapshot: NetworkSnapshot = loadSnapshot(source.kind, bytes, source.mmdbRole ?? null);
    return {
      sourceId: source.sourceId,
      role: source.role,
      sandboxOnly: false,
      freshness: 'fresh',
      provenance: { syncId: String(index + 1), publishedAt: PUBLISHED, sha256: 'a'.repeat(64) },
      snapshot,
    };
  });
}

/** `count` documentation addresses: the three IPv4 blocks and IPv6 addresses in `2001:db8::/32`. */
export function documentationAddresses(count: number): string[] {
  const blocks = ['192.0.2', '198.51.100', '203.0.113'];
  return Array.from({ length: count }, (_, i) =>
    i % 4 === 3
      ? `2001:db8:${(i % 65_536).toString(16)}::${(i % 251).toString(16)}`
      : `${blocks[i % 3] ?? '192.0.2'}.${String(i % 256)}`,
  );
}

export interface LookupTiming {
  calls: number;
  meanMs: number;
  p99Ms: number;
  maxMs: number;
  /** Calls the evaluation refused before any lookup (a sign the take measured nothing). */
  unevaluated: number;
  budgetMs: number;
  met: boolean;
}

/** Times `calls` evaluations, each on its own clock (`now` in ns), after `warmUp` untimed calls. */
export function timeLookups(
  sources: readonly NetworkSourceSnapshot[],
  options: { calls: number; warmUp?: number; now?: () => bigint },
): LookupTiming {
  const now = options.now ?? (() => process.hrtime.bigint());
  const addresses = documentationAddresses(1024);
  const input = (address: string): NetworkLookupInput => ({
    address,
    environment: 'sandbox',
    clientAddressSource: 'trusted-list',
    sources,
    asnSets: null,
    ipReputation: null,
    rules: LOOKUP_RULES,
  });
  for (let i = 0; i < (options.warmUp ?? 2000); i += 1) {
    evaluateNetwork(input(addresses[i % addresses.length] ?? '192.0.2.1'));
  }
  const times = new Float64Array(options.calls);
  let unevaluated = 0;
  for (let i = 0; i < options.calls; i += 1) {
    const at = now();
    const evaluation = evaluateNetwork(input(addresses[i % addresses.length] ?? '192.0.2.1'));
    times[i] = Number(now() - at) / 1e6;
    if (NOT_EVALUATED.has(evaluation.facts['country-code'].nullReason ?? '')) {
      unevaluated += 1;
    }
  }
  const sorted = Float64Array.from(times).sort();
  const sum = times.reduce((total, value) => total + value, 0);
  const meanMs = options.calls === 0 ? 0 : sum / options.calls;
  return {
    calls: options.calls,
    meanMs,
    p99Ms: sorted[Math.max(0, Math.ceil(0.99 * sorted.length) - 1)] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    unevaluated,
    budgetMs: NETWORK_LOOKUP_BUDGET_MS,
    met: options.calls > 0 && meanMs <= NETWORK_LOOKUP_BUDGET_MS,
  };
}

export interface VerifyTiming {
  bytes: number;
  wallMs: number;
  cpuMs: number;
  peakRssMiB: number;
  nodes: number;
  prefixes: number;
  records: number;
}

/** Opens a City MMDB (gunzipping a `.gz`) and verifies it, timing the open and the verify. */
export function verifyCityMmdb(file: Uint8Array, options: { gzipped: boolean }): VerifyTiming {
  const wall = performance.now();
  const cpu = process.cpuUsage();
  const bytes = options.gzipped ? gunzipSync(file) : Buffer.from(file);
  const result = MmdbSnapshot.open(bytes, 'city').verify();
  const used = process.cpuUsage(cpu);
  return {
    bytes: bytes.byteLength,
    wallMs: Math.round((performance.now() - wall) * 10) / 10,
    cpuMs: Math.round((used.user + used.system) / 100) / 10,
    // `maxRSS` is in kibibytes on Linux.
    peakRssMiB: Math.round((process.resourceUsage().maxRSS / 1024) * 10) / 10,
    nodes: result.nodes,
    prefixes: result.prefixes,
    records: result.records,
  };
}
