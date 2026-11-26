/**
 * The normalised snapshot (plan C92.3): each applied sync stores one object, which every process
 * loads and swaps. An MMDB is stored as published (after gunzip); a range or exit source as the
 * canonical JSON of its sorted, merged intervals; the sandbox source as its bundle. The object's
 * SHA-256 is recorded on the sync row and re-checked on every load.
 */
import { canonicalJson } from './canonical.js';
import { NetworkParseError } from './errors.js';
import { IntervalSet } from './interval-set.js';
import { MmdbSnapshot, type MmdbRole } from './mmdb.js';
import {
  parseAwsIpRanges,
  parseAzureServiceTags,
  parseCloudflareIpsApi,
  parseGeofeed,
  parseGoogleCloudRanges,
  parseOracleIpRanges,
  parsePrefixList,
  type RangeAttributes,
  type RangePublication,
  type RangeStats,
} from './range-files.js';
import { SandboxNetwork } from './sandbox.js';
import { decodeText, readJson } from './text.js';
import { TorExitSet, parseTorExitList } from './tor-exit-list.js';

/** The manifest's `parser` values (C92.1), each a parser of this folder. */
export const NETWORK_PARSERS = [
  'mmdb-country',
  'mmdb-city',
  'mmdb-asn',
  'tordnsel-exit-addresses',
  'aws-ip-ranges',
  'gcp-cloud-json',
  'oracle-public-ip-ranges',
  'cloudflare-ips-api',
  'prefix-list',
  'rfc8805-geofeed',
  'azure-service-tags',
  'openverify-sandbox-network',
] as const;
export type NetworkParserName = (typeof NETWORK_PARSERS)[number];

export const NETWORK_SNAPSHOT_KINDS = ['mmdb', 'ranges', 'tor-exits', 'sandbox'] as const;
export type NetworkSnapshotKind = (typeof NETWORK_SNAPSHOT_KINDS)[number];

/** A loaded snapshot, immutable; the lookups are pure functions over it. */
export type NetworkSnapshot =
  MmdbSnapshot | IntervalSet<RangeAttributes> | TorExitSet | SandboxNetwork;

/** A publication parsed into the object a sync stores. */
export interface NormalisedPublication {
  readonly kind: NetworkSnapshotKind;
  /** The MMDB role, for an MMDB. */
  readonly mmdbRole: MmdbRole | null;
  /** From the publication itself, or `null` (the runner then uses `Last-Modified`). */
  readonly publishedAt: Date | null;
  /** The snapshot object to store. */
  readonly bytes: Buffer;
  readonly snapshot: NetworkSnapshot;
  /** Merged intervals, exit addresses or MMDB records (`network_syncs.entry_count`). */
  readonly entryCount: number;
  /** Addresses covered, for range and relay sources (`covered_ipv4`, `covered_ipv6`). */
  readonly coverage: { readonly ipv4: bigint; readonly ipv6: bigint } | null;
  /** The range file's prefix counts, for C92.2's `min_prefix` guard. */
  readonly rangeStats: RangeStats | null;
}

const MMDB_PARSERS: Readonly<Partial<Record<NetworkParserName, MmdbRole>>> = Object.freeze({
  'mmdb-country': 'country',
  'mmdb-city': 'city',
  'mmdb-asn': 'asn',
});
const PROVIDER = /^[a-z][a-z0-9-]{0,63}$/;
const LABEL = /^[\x20-\x7e]{1,128}$/;

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function rangesOf(
  parser: NetworkParserName,
  bytes: Uint8Array,
  provider: string | undefined,
): RangePublication | null {
  const options = provider === undefined ? {} : { provider };
  const labelled = () => {
    if (provider === undefined) {
      throw new RangeError(`the ${parser} parser needs the source's provider label`);
    }
    return { provider };
  };
  switch (parser) {
    case 'aws-ip-ranges':
      return parseAwsIpRanges(bytes, options);
    case 'gcp-cloud-json':
      return parseGoogleCloudRanges(bytes, options);
    case 'oracle-public-ip-ranges':
      return parseOracleIpRanges(bytes, options);
    case 'cloudflare-ips-api':
      return parseCloudflareIpsApi(bytes, options);
    case 'azure-service-tags':
      return parseAzureServiceTags(bytes, options);
    case 'prefix-list':
      return parsePrefixList(bytes, labelled());
    case 'rfc8805-geofeed':
      return parseGeofeed(bytes, labelled());
    default:
      return null;
  }
}

/**
 * Parses a publication (already decompressed) with the manifest's parser and builds the object
 * to store.
 * @throws {NetworkParseError} for a publication the parser refuses.
 */
export function normalisePublication(
  parser: NetworkParserName,
  bytes: Uint8Array,
  options: { readonly provider?: string } = {},
): NormalisedPublication {
  const role = MMDB_PARSERS[parser];
  if (role !== undefined) {
    const snapshot = MmdbSnapshot.open(bytes, role);
    const { prefixes } = snapshot.verify();
    return {
      kind: 'mmdb',
      mmdbRole: role,
      publishedAt: snapshot.publishedAt,
      bytes: asBuffer(bytes),
      snapshot,
      entryCount: prefixes,
      coverage: null,
      rangeStats: null,
    };
  }
  if (parser === 'tordnsel-exit-addresses') {
    const publication = parseTorExitList(bytes);
    return {
      kind: 'tor-exits',
      mmdbRole: null,
      publishedAt: publication.publishedAt,
      bytes: Buffer.from(canonicalJson(publication.exits.toJSON())),
      snapshot: publication.exits,
      entryCount: publication.exits.size,
      coverage: null,
      rangeStats: null,
    };
  }
  if (parser === 'openverify-sandbox-network') {
    const snapshot = SandboxNetwork.parse(bytes);
    return {
      kind: 'sandbox',
      mmdbRole: null,
      publishedAt: snapshot.publishedAt,
      bytes: asBuffer(bytes),
      snapshot,
      entryCount: snapshot.entryCount,
      coverage: null,
      rangeStats: null,
    };
  }
  const publication = rangesOf(parser, bytes, options.provider);
  if (publication === null) {
    throw new RangeError(`no network parser ${parser}`);
  }
  return {
    kind: 'ranges',
    mmdbRole: null,
    publishedAt: publication.publishedAt,
    bytes: Buffer.from(
      canonicalJson({
        format: 'openverify-network-ranges',
        version: 1,
        'published-at':
          publication.publishedAt === null ? null : publication.publishedAt.toISOString(),
        ranges: publication.ranges.toJSON(),
      }),
    ),
    snapshot: publication.ranges,
    entryCount: publication.ranges.size,
    coverage: publication.ranges.coverage(),
    rangeStats: publication.stats,
  };
}

/** A stored JSON snapshot, refused unless its bytes are its canonical form. */
function canonicalStored(bytes: Uint8Array, format: string): Record<string, unknown> {
  const text = decodeText(bytes);
  const json = readJson(text);
  if (canonicalJson(json) !== text) {
    throw new NetworkParseError('format', 'the stored snapshot is not canonical JSON');
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new NetworkParseError('format', 'the stored snapshot is not an object');
  }
  const value = json as Record<string, unknown>;
  if (value.format !== format || value.version !== 1) {
    throw new NetworkParseError('format', `the stored snapshot is not ${format} version 1`);
  }
  return value;
}

function rangeAttributes(value: unknown): RangeAttributes {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('not range attributes');
  }
  const { provider, service, region, ...rest } = value as Record<string, unknown>;
  const optional = (member: unknown) =>
    member === null || (typeof member === 'string' && LABEL.test(member));
  if (
    Object.keys(rest).length > 0 ||
    typeof provider !== 'string' ||
    !PROVIDER.test(provider) ||
    !optional(service) ||
    !optional(region)
  ) {
    throw new TypeError('not range attributes');
  }
  return { provider, service: service as string | null, region: region as string | null };
}

/**
 * Loads a stored snapshot object.
 * @throws {NetworkParseError} for an object that is not a canonical snapshot of its kind.
 */
export function loadSnapshot(
  kind: NetworkSnapshotKind,
  bytes: Uint8Array,
  mmdbRole: MmdbRole | null = null,
): NetworkSnapshot {
  switch (kind) {
    case 'mmdb':
      if (mmdbRole === null) {
        throw new RangeError('an MMDB snapshot needs its role');
      }
      return MmdbSnapshot.open(bytes, mmdbRole);
    case 'ranges':
      return IntervalSet.fromJSON(
        canonicalStored(bytes, 'openverify-network-ranges').ranges,
        rangeAttributes,
      );
    case 'tor-exits':
      return TorExitSet.fromJSON(canonicalStored(bytes, 'openverify-tor-exits'));
    case 'sandbox':
      return SandboxNetwork.parse(bytes);
  }
}
