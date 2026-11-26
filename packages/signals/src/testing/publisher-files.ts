/**
 * Synthetic files in every publisher's format (plan C92.3, C111.1), generated from a seed: the
 * TorDNSEL exit list, the AWS, Google, Oracle, Cloudflare and Azure range files, RFC 8805 geofeeds
 * (DigitalOcean, Linode), Apple's relay egress list, the X4BNet and bad-asn-list ASN seeds, and the
 * DB-IP-shaped Country, City and ASN MMDBs. Every address is from the documentation ranges, every
 * AS number from the documentation ASNs, every name and point fictional. The same seed always
 * writes the same bytes.
 */
import { IPV4_MAPPED_START, formatKey, parseNetwork } from '../network/address.js';
import { writeMmdb, type MmdbEntry } from './mmdb-writer.js';
import { seededRandom, type SeededRandom } from './random.js';

/** Options every generator takes. */
export interface SyntheticOptions {
  readonly seed: string;
}

const IPV4_BLOCKS = ['192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24'] as const;
const IPV6_BASE = 0x2001_0db8n << 96n;
/** The documentation ASNs (RFC 5398), 32 in all. */
const DOCUMENTATION_ASNS: readonly number[] = [
  ...Array.from({ length: 16 }, (_, index) => 64496 + index),
  ...Array.from({ length: 16 }, (_, index) => 65536 + index),
];
/** ISO 3166-1 user-assigned codes: never a real country. */
const COUNTRIES = ['ZZ', 'XA', 'XB', 'QM'] as const;
const DEFAULT_PUBLISHED = new Date('2026-10-27T16:00:00Z');
const DEFAULT_EPOCH = new Date('2026-10-01T00:00:00Z');
const HOUR = 3_600_000;

/** A prefix inside one of the IPv4 documentation blocks. */
function ipv4Prefix(random: SeededRandom, min = 26, max = 30): string {
  const block = parseNetwork(random.pick(IPV4_BLOCKS));
  const length = random.int(min, max);
  const size = 2n ** BigInt(32 - length);
  const index = random.bigint(0n, 256n / size - 1n);
  return `${formatKey(block.start + index * size)}/${String(length)}`;
}

/** A prefix inside `2001:db8::/32`. */
function ipv6Prefix(random: SeededRandom, min = 40, max = 64): string {
  const length = random.int(min, max);
  const bits = random.bigint(0n, 2n ** BigInt(length - 32) - 1n) << BigInt(128 - length);
  return `${formatKey(IPV6_BASE | bits)}/${String(length)}`;
}

/** The prefix `shorter` bits shorter that holds a prefix. */
function parent(prefix: string, shorter: number): string {
  const network = parseNetwork(prefix);
  const width = network.family === 4 ? 32 : 128;
  const length = Math.max(network.family === 4 ? 24 : 32, network.prefixLength - shorter);
  const mask = ~((1n << BigInt(width - length)) - 1n) & ((1n << BigInt(width)) - 1n);
  const base = network.family === 4 ? network.start - IPV4_MAPPED_START : network.start;
  const start = (base & mask) + (network.family === 4 ? IPV4_MAPPED_START : 0n);
  return `${formatKey(start)}/${String(length)}`;
}

function prefixes(
  random: SeededRandom,
  ipv4: number,
  ipv6: number,
): { v4: string[]; v6: string[] } {
  return {
    v4: Array.from({ length: ipv4 }, () => ipv4Prefix(random)),
    v6: Array.from({ length: ipv6 }, () => ipv6Prefix(random)),
  };
}

function tdnselTime(at: Date): string {
  return at.toISOString().slice(0, 19).replace('T', ' ');
}

/** Every IPv4 documentation address, in a seeded order. */
function documentationAddresses(random: SeededRandom): string[] {
  const all = IPV4_BLOCKS.flatMap((block) => {
    const { start } = parseNetwork(block);
    return Array.from({ length: 256 }, (_, index) => formatKey(start + BigInt(index)));
  });
  return random.shuffle(all);
}

/** TorDNSEL `exit-addresses`: `relays` records, a share seen outside the 24 h window. */
export function syntheticTorExitList(
  options: SyntheticOptions & {
    readonly relays?: number;
    readonly publishedAt?: Date;
    readonly collectorHeader?: boolean;
    readonly ipv6Exit?: boolean;
  },
): string {
  const random = seededRandom(`tor-exit-list/${options.seed}`);
  const relays = options.relays ?? 20;
  if (!Number.isInteger(relays) || relays < 1 || relays > 384) {
    throw new RangeError('the documentation ranges hold exits for 1 to 384 relays');
  }
  const published = (options.publishedAt ?? DEFAULT_PUBLISHED).getTime();
  const addresses = documentationAddresses(random);
  const lines: string[] = [];
  if (options.collectorHeader === true) {
    lines.push('@type tordnsel 1.0', `Downloaded ${tdnselTime(new Date(published + 12 * 60_000))}`);
  }
  for (let relay = 0; relay < relays; relay += 1) {
    const lastStatus = relay === 0 ? published : published - random.int(0, 6) * HOUR;
    lines.push(
      `ExitNode ${random.hex(40).toUpperCase()}`,
      `Published ${tdnselTime(new Date(lastStatus - random.int(1, 18) * HOUR))}`,
      `LastStatus ${tdnselTime(new Date(lastStatus))}`,
    );
    const exits = random.int(1, 2);
    for (let exit = 0; exit < exits; exit += 1) {
      // One in five sightings is 30 to 72 hours old: outside C93.3's 24 h window.
      const stale = random.int(0, 4) === 0;
      const seen = stale
        ? published - random.int(30, 72) * HOUR
        : published - random.int(0, 20 * 60) * 60_000;
      lines.push(`ExitAddress ${addresses.pop() ?? ''} ${tdnselTime(new Date(seen))}`);
    }
    if (relay === 0 && options.ipv6Exit === true) {
      lines.push(
        `ExitAddress ${ipv6Prefix(random, 128, 128).split('/')[0] ?? ''} ${tdnselTime(new Date(published))}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/** AWS `ip-ranges.json`. */
export function syntheticAwsIpRanges(
  options: SyntheticOptions & { readonly ipv4?: number; readonly ipv6?: number },
): string {
  const random = seededRandom(`aws-ip-ranges/${options.seed}`);
  const { v4, v6 } = prefixes(random, options.ipv4 ?? 8, options.ipv6 ?? 4);
  const region = () => random.pick(['example-east-1', 'example-west-1', 'example-south-1']);
  const service = () => random.pick(['EC2', 'S3', 'CLOUDFRONT', 'ROUTE53_HEALTHCHECKS']);
  const entry = (member: string, prefix: string, name: string, place: string) => ({
    [member]: prefix,
    region: place,
    service: name,
    network_border_group: place,
  });
  // Each service range also sits inside a broader AMAZON range, as in the published file.
  const ipv4 = v4.flatMap((prefix) => [
    entry('ip_prefix', prefix, service(), region()),
    entry('ip_prefix', parent(prefix, 2), 'AMAZON', 'GLOBAL'),
  ]);
  const ipv6 = v6.flatMap((prefix) => [
    entry('ipv6_prefix', prefix, service(), region()),
    entry('ipv6_prefix', parent(prefix, 8), 'AMAZON', 'GLOBAL'),
  ]);
  return JSON.stringify(
    {
      syncToken: '1793107625',
      createDate: '2026-10-27-13-27-05',
      prefixes: ipv4,
      ipv6_prefixes: ipv6,
    },
    null,
    2,
  );
}

/** Google `cloud.json`. */
export function syntheticGoogleCloudRanges(
  options: SyntheticOptions & { readonly ipv4?: number; readonly ipv6?: number },
): string {
  const random = seededRandom(`gcp-cloud/${options.seed}`);
  const { v4, v6 } = prefixes(random, options.ipv4 ?? 6, options.ipv6 ?? 3);
  const scope = () => random.pick(['example-east1', 'example-west1', 'global']);
  return JSON.stringify(
    {
      syncToken: '1793110333116',
      creationTime: '2026-10-27T14:12:13.116812',
      prefixes: [
        ...v4.map((prefix) => ({ ipv4Prefix: prefix, service: 'Google Cloud', scope: scope() })),
        ...v6.map((prefix) => ({ ipv6Prefix: prefix, service: 'Google Cloud', scope: scope() })),
      ],
    },
    null,
    2,
  );
}

/** Oracle `public_ip_ranges.json`. */
export function syntheticOracleIpRanges(
  options: SyntheticOptions & { readonly ipv4?: number; readonly ipv6?: number },
): string {
  const random = seededRandom(`oracle-ip-ranges/${options.seed}`);
  const { v4, v6 } = prefixes(random, options.ipv4 ?? 6, options.ipv6 ?? 2);
  const tags = () => random.shuffle(['OCI', 'OSN', 'OBJECT_STORAGE']).slice(0, random.int(0, 2));
  const regions = ['example-region-1', 'example-region-2'].map((region, index) => ({
    region,
    cidrs: v4.filter((_, at) => at % 2 === index).map((cidr) => ({ cidr, tags: tags() })),
    ipv6_cidrs: v6.filter((_, at) => at % 2 === index).map((cidr) => ({ cidr, tags: tags() })),
  }));
  return JSON.stringify({ last_updated_timestamp: '2026-08-25T08:06:24.123456', regions }, null, 2);
}

/** Cloudflare's `ips-v4` and `ips-v6` lists and its `client/v4/ips` answer. */
export function syntheticCloudflareIps(options: SyntheticOptions): {
  readonly ipv4: string;
  readonly ipv6: string;
  readonly api: string;
} {
  const random = seededRandom(`cloudflare-ips/${options.seed}`);
  const { v4, v6 } = prefixes(random, 4, 2);
  return {
    ipv4: `${v4.join('\n')}\n`,
    ipv6: `${v6.join('\n')}\n`,
    api: JSON.stringify({
      result: { ipv4_cidrs: v4, ipv6_cidrs: v6, etag: random.hex(32) },
      success: true,
      errors: [],
      messages: [],
    }),
  };
}

function geofeedRows(
  random: SeededRandom,
  rows: number,
  columns: (prefix: string, index: number) => string,
): string[] {
  return Array.from({ length: rows }, (_, index) =>
    columns(index % 2 === 0 ? ipv4Prefix(random) : ipv6Prefix(random), index),
  );
}

/** An RFC 8805 geofeed, as DigitalOcean and Linode publish them. */
export function syntheticGeofeed(options: SyntheticOptions & { readonly rows?: number }): string {
  const random = seededRandom(`geofeed/${options.seed}`);
  const rows = geofeedRows(random, Math.max(2, options.rows ?? 10), (prefix, index) => {
    const country = random.pick(COUNTRIES);
    const city = index === 0 ? '"Example City, North"' : `Example City ${String(index)}`;
    return `${prefix},${country},${country}-0${String(random.int(1, 9))},${city},0000${String(index % 10)}`;
  });
  return [
    '# Synthetic geofeed (RFC 8805), documentation ranges only',
    '# Last modified: 2026-10-27 10:00:05',
    ...rows,
    '',
  ].join('\n');
}

/** Azure's service tags, with overlapping tags. */
export function syntheticAzureServiceTags(
  options: SyntheticOptions & { readonly tags?: number },
): string {
  const random = seededRandom(`azure-service-tags/${options.seed}`);
  const { v4, v6 } = prefixes(random, 6, 3);
  const all = [...v4, ...v6];
  const services = ['AzureStorage', 'AzureSQL', 'AzureMonitor', 'AzureFrontDoor'];
  const values = [
    {
      name: 'AzureCloud',
      id: 'AzureCloud',
      properties: {
        changeNumber: 7,
        region: '',
        regionId: 0,
        platform: 'Azure',
        systemService: '',
        addressPrefixes: all,
      },
    },
    ...Array.from({ length: Math.max(1, options.tags ?? 3) }, (_, index) => {
      const service = services[index % services.length] ?? 'AzureStorage';
      const region = `exampleregion${String(index + 1)}`;
      return {
        name: `${service}.${region}`,
        id: `${service}.${region}`,
        properties: {
          changeNumber: index + 1,
          region,
          regionId: index + 1,
          platform: 'Azure',
          systemService: service,
          addressPrefixes: random.shuffle(all).slice(0, random.int(1, 3)),
        },
      };
    }),
  ];
  return JSON.stringify({ changeNumber: 42, cloud: 'Public', values }, null, 2);
}

/** Apple's Private Relay egress list (five columns, the last empty). */
export function syntheticRelayEgress(
  options: SyntheticOptions & { readonly rows?: number },
): string {
  const random = seededRandom(`relay-egress/${options.seed}`);
  const rows = geofeedRows(random, Math.max(2, options.rows ?? 8), (prefix, index) => {
    const country = random.pick(COUNTRIES);
    return `${prefix},${country},${country}-0${String(random.int(1, 9))},Example City ${String(index)},`;
  });
  return `${rows.join('\n')}\n`;
}

function asnSample(random: SeededRandom, asns: number, repeats: number): number[] {
  if (
    !Number.isInteger(asns) ||
    asns < 1 ||
    asns > DOCUMENTATION_ASNS.length ||
    repeats < 0 ||
    repeats > asns
  ) {
    throw new RangeError(
      `the documentation ASNs give 1 to ${String(DOCUMENTATION_ASNS.length)} distinct ASNs`,
    );
  }
  const chosen = random.shuffle(DOCUMENTATION_ASNS).slice(0, asns);
  return random.shuffle([...chosen, ...chosen.slice(0, repeats)]);
}

/** An X4BNet `ASN.txt`, with `repeats` ASNs named twice. */
export function syntheticX4bnetAsnList(
  options: SyntheticOptions & { readonly asns?: number; readonly repeats?: number },
): string {
  const random = seededRandom(`x4bnet-asn/${options.seed}`);
  const lines = asnSample(random, options.asns ?? 12, options.repeats ?? 2).map(
    (asn, index) =>
      `AS${String(asn)}${index % 3 === 0 ? '\t' : ' '}# Example Hosting ${String(index)}, ZZ`,
  );
  return `${lines.join('\n')}\n`;
}

/** `bad-asn-list.csv`, with quoted names and `repeats` ASNs named twice. */
export function syntheticBadAsnList(
  options: SyntheticOptions & { readonly asns?: number; readonly repeats?: number },
): string {
  const random = seededRandom(`bad-asn-list/${options.seed}`);
  const rows = asnSample(random, options.asns ?? 12, options.repeats ?? 2).map((asn, index) =>
    index % 2 === 0
      ? `${String(asn)},"Example Hosting, ""Unit ${String(index)}"""`
      : `${String(asn)},Example Colocation ${String(index)}`,
  );
  return ['ASN,Entity', ...rows, ''].join('\n');
}

/** The documentation ranges split into a few prefixes each. */
function coverage(random: SeededRandom): string[] {
  return [
    ...IPV4_BLOCKS.flatMap((block) => {
      const { start } = parseNetwork(block);
      return [`${formatKey(start)}/25`, `${formatKey(start + 128n)}/25`];
    }),
    ...Array.from(
      { length: 3 },
      (_, index) => `${formatKey(IPV6_BASE | (BigInt(index) << 80n))}/48`,
    ),
    ipv6Prefix(random, 56, 64),
  ];
}

function mmdbOf(
  databaseType: string,
  buildEpoch: Date | undefined,
  entries: readonly MmdbEntry[],
): Buffer {
  return writeMmdb({
    databaseType,
    buildEpoch: buildEpoch ?? DEFAULT_EPOCH,
    entries,
    languages: ['en'],
  });
}

/** A DB-IP-shaped Country Lite MMDB over the documentation ranges. */
export function syntheticCountryMmdb(
  options: SyntheticOptions & { readonly buildEpoch?: Date },
): Buffer {
  const random = seededRandom(`country-mmdb/${options.seed}`);
  return mmdbOf(
    'OpenVerify-Synthetic-DBIP-Country-Lite',
    options.buildEpoch,
    coverage(random).map((network) => {
      const code = random.pick(COUNTRIES);
      return {
        network,
        data: {
          continent: { code: 'OC', names: { en: 'Oceania' } },
          country: {
            iso_code: code,
            names: { en: `Example Land ${code}` },
            is_in_european_union: false,
          },
        },
      };
    }),
  );
}

/** A DB-IP-shaped ASN Lite MMDB over the documentation ranges, with documentation ASNs. */
export function syntheticAsnMmdb(
  options: SyntheticOptions & { readonly buildEpoch?: Date },
): Buffer {
  const random = seededRandom(`asn-mmdb/${options.seed}`);
  return mmdbOf(
    'OpenVerify-Synthetic-DBIP-ASN-Lite (compat=GeoLite2-ASN)',
    options.buildEpoch,
    coverage(random).map((network, index) => ({
      network,
      data: {
        autonomous_system_number: random.pick(DOCUMENTATION_ASNS),
        autonomous_system_organization: `Example Network ${String(index)}`,
      },
    })),
  );
}

/** A DB-IP-shaped City Lite MMDB over the documentation ranges, with fictional ocean points. */
export function syntheticCityMmdb(
  options: SyntheticOptions & { readonly buildEpoch?: Date },
): Buffer {
  const random = seededRandom(`city-mmdb/${options.seed}`);
  // Open ocean in the South Pacific: 20 to 40 degrees south, 120 to 150 degrees west.
  const point = (low: number, high: number) =>
    Math.round((low + random.next() * (high - low)) * 10_000) / 10_000;
  return mmdbOf(
    'OpenVerify-Synthetic-DBIP-City-Lite',
    options.buildEpoch,
    coverage(random).map((network, index) => {
      const code = random.pick(COUNTRIES);
      return {
        network,
        data: {
          city: { names: { en: `Example City ${String(index)}` } },
          continent: { code: 'OC', names: { en: 'Oceania' } },
          country: { iso_code: code, names: { en: `Example Land ${code}` } },
          location: { latitude: point(-40, -20), longitude: point(-150, -120) },
          subdivisions: [{ names: { en: `Example Region ${String(index)}` } }],
        },
      };
    }),
  );
}
