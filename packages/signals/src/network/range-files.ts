/**
 * The cloud providers' range files and the relay egress list (plan C92.1, C92.3, C93.3): each
 * publisher's format parsed strictly into an {@link IntervalSet} of provider-labelled ranges.
 * Formats as the research measured them on 2026-10-27 (`docs/research/phase7-network-data.md`
 * §4.1): AWS `ip-ranges.json`, Google `cloud.json`, Oracle `public_ip_ranges.json`, Cloudflare's
 * API answer and its plain prefix lists, RFC 8805 geofeeds (DigitalOcean, Linode, and Apple's
 * Private Relay egress list), and Azure's service tags.
 *
 * Strict about what is read (every member's type and form, every prefix canonical), tolerant of
 * members a publisher adds, so a new field does not stop a sync while a changed one does.
 */
import { parseNetwork } from './address.js';
import { NetworkParseError } from './errors.js';
import { IntervalSet, type IntervalEntry } from './interval-set.js';
import {
  arrayAt,
  csvFields,
  decodeText,
  epochTime,
  isoUtc,
  label,
  objectAt,
  readJson,
  spaceSeparatedUtc,
  splitLines,
  stringAt,
} from './text.js';

/** What a range says about the addresses it covers. */
export interface RangeAttributes {
  /** Ours: the provider the source names (`aws`, `google-cloud`, ...). */
  readonly provider: string;
  /** The publisher's service or tag, when it gives one. */
  readonly service: string | null;
  /** The publisher's region, or a geofeed's ISO 3166-2 region or country, when given. */
  readonly region: string | null;
}

/** Counts a sync's guards read (C92.2 step 6: `min_prefix`). */
export interface RangeStats {
  readonly prefixes: number;
  readonly ipv4Prefixes: number;
  readonly ipv6Prefixes: number;
  /** The shortest prefix length seen per family, or `null` when the family is absent. */
  readonly shortestIpv4Prefix: number | null;
  readonly shortestIpv6Prefix: number | null;
}

/** A parsed range file. */
export interface RangePublication {
  /** From the file itself (`syncToken`, a timestamp), or `null` when it carries none. */
  readonly publishedAt: Date | null;
  readonly ranges: IntervalSet<RangeAttributes>;
  readonly stats: RangeStats;
}

/** Options every range parser takes. */
export interface RangeParseOptions {
  /** Overrides the parser's default provider label. */
  readonly provider?: string;
}

const PROVIDER = /^[a-z][a-z0-9-]{0,63}$/;
const COUNTRY = /^[A-Z]{2}$/;
const REGION = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;
const STAMP = /last[ -]modified:?[ \t]*([0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}:[0-9]{2})/i;

/** Collects one file's prefixes and the counts its guards read. */
class RangeCollector {
  readonly #provider: string;
  readonly #entries: IntervalEntry<RangeAttributes>[] = [];
  #ipv4 = 0;
  #ipv6 = 0;
  #shortestIpv4: number | null = null;
  #shortestIpv6: number | null = null;

  constructor(provider: string | undefined, fallback: string) {
    const name = provider ?? fallback;
    if (!PROVIDER.test(name)) {
      throw new RangeError('a provider label is lowercase letters, digits and hyphens');
    }
    this.#provider = name;
  }

  add(
    prefix: unknown,
    family: 4 | 6 | null,
    service: string | null,
    region: string | null,
    where: string,
  ): void {
    const text = stringAt(prefix, where);
    let network;
    try {
      network = parseNetwork(text);
    } catch (error) {
      if (error instanceof NetworkParseError) {
        throw new NetworkParseError('address', `${where}: ${error.message}`, { cause: error });
      }
      throw error;
    }
    if (family !== null && network.family !== family) {
      throw new NetworkParseError(
        'format',
        `${where}: an IPv${String(network.family)} prefix in an IPv${String(family)} list`,
      );
    }
    if (network.family === 4) {
      this.#ipv4 += 1;
      this.#shortestIpv4 = Math.min(this.#shortestIpv4 ?? 32, network.prefixLength);
    } else {
      this.#ipv6 += 1;
      this.#shortestIpv6 = Math.min(this.#shortestIpv6 ?? 128, network.prefixLength);
    }
    this.#entries.push({
      start: network.start,
      end: network.end,
      value: { provider: this.#provider, service, region },
    });
  }

  finish(publishedAt: Date | null): RangePublication {
    return {
      publishedAt,
      ranges: IntervalSet.build(this.#entries),
      stats: {
        prefixes: this.#ipv4 + this.#ipv6,
        ipv4Prefixes: this.#ipv4,
        ipv6Prefixes: this.#ipv6,
        shortestIpv4Prefix: this.#shortestIpv4,
        shortestIpv6Prefix: this.#shortestIpv6,
      },
    };
  }
}

/** An optional label: `null` for an empty string. */
function optionalLabel(value: unknown, where: string): string | null {
  return value === '' ? null : label(value, where);
}

/** AWS `ip-ranges.json`; the publication time is `syncToken` (Unix seconds). */
export function parseAwsIpRanges(
  bytes: Uint8Array | string,
  options: RangeParseOptions = {},
): RangePublication {
  const root = objectAt(readJson(bytes), 'root');
  const publishedAt = epochTime(stringAt(root.syncToken, 'syncToken'), 'seconds', 'syncToken');
  stringAt(root.createDate, 'createDate');
  const collector = new RangeCollector(options.provider, 'aws');
  for (const [member, prefixMember, family] of [
    ['prefixes', 'ip_prefix', 4],
    ['ipv6_prefixes', 'ipv6_prefix', 6],
  ] as const) {
    arrayAt(root[member], member).forEach((raw, index) => {
      const where = `${member}[${String(index)}]`;
      const item = objectAt(raw, where);
      collector.add(
        item[prefixMember],
        family,
        label(item.service, `${where}.service`),
        label(item.region, `${where}.region`),
        where,
      );
    });
  }
  return collector.finish(publishedAt);
}

/** Google `cloud.json`; the publication time is `syncToken` (Unix milliseconds). */
export function parseGoogleCloudRanges(
  bytes: Uint8Array | string,
  options: RangeParseOptions = {},
): RangePublication {
  const root = objectAt(readJson(bytes), 'root');
  const publishedAt = epochTime(stringAt(root.syncToken, 'syncToken'), 'milliseconds', 'syncToken');
  stringAt(root.creationTime, 'creationTime');
  const collector = new RangeCollector(options.provider, 'google-cloud');
  arrayAt(root.prefixes, 'prefixes').forEach((raw, index) => {
    const where = `prefixes[${String(index)}]`;
    const item = objectAt(raw, where);
    const v4 = item.ipv4Prefix;
    const v6 = item.ipv6Prefix;
    if ((v4 === undefined) === (v6 === undefined)) {
      throw new NetworkParseError(
        'format',
        `${where}: needs exactly one of ipv4Prefix and ipv6Prefix`,
      );
    }
    collector.add(
      v4 ?? v6,
      v4 === undefined ? 6 : 4,
      label(item.service, `${where}.service`),
      label(item.scope, `${where}.scope`),
      where,
    );
  });
  return collector.finish(publishedAt);
}

/** Oracle `public_ip_ranges.json`; the publication time is `last_updated_timestamp`. */
export function parseOracleIpRanges(
  bytes: Uint8Array | string,
  options: RangeParseOptions = {},
): RangePublication {
  const root = objectAt(readJson(bytes), 'root');
  const publishedAt = isoUtc(
    stringAt(root.last_updated_timestamp, 'last_updated_timestamp'),
    'last_updated_timestamp',
  );
  const collector = new RangeCollector(options.provider, 'oracle-cloud');
  arrayAt(root.regions, 'regions').forEach((raw, regionIndex) => {
    const where = `regions[${String(regionIndex)}]`;
    const region = objectAt(raw, where);
    const name = label(region.region, `${where}.region`);
    const lists: [string, unknown, 4 | 6][] = [['cidrs', region.cidrs, 4]];
    if (region.ipv6_cidrs !== undefined) {
      lists.push(['ipv6_cidrs', region.ipv6_cidrs, 6]);
    }
    for (const [member, list, family] of lists) {
      arrayAt(list, `${where}.${member}`).forEach((rawCidr, index) => {
        const at = `${where}.${member}[${String(index)}]`;
        const cidr = objectAt(rawCidr, at);
        const tags = arrayAt(cidr.tags, `${at}.tags`).map((tag, tagIndex) =>
          label(tag, `${at}.tags[${String(tagIndex)}]`),
        );
        const service = tags.length === 0 ? null : [...new Set(tags)].sort().join(',');
        if (service !== null && service.length > 128) {
          throw new NetworkParseError('format', `${at}.tags: longer than 128 characters together`);
        }
        collector.add(cidr.cidr, family, service, name, at);
      });
    }
  });
  return collector.finish(publishedAt);
}

/** Cloudflare's `client/v4/ips` answer; it carries no publication time. */
export function parseCloudflareIpsApi(
  bytes: Uint8Array | string,
  options: RangeParseOptions = {},
): RangePublication {
  const root = objectAt(readJson(bytes), 'root');
  if (root.success !== true) {
    throw new NetworkParseError('format', 'success: the answer does not report success');
  }
  const result = objectAt(root.result, 'result');
  const collector = new RangeCollector(options.provider, 'cloudflare');
  for (const [member, family] of [
    ['ipv4_cidrs', 4],
    ['ipv6_cidrs', 6],
  ] as const) {
    arrayAt(result[member], `result.${member}`).forEach((prefix, index) => {
      collector.add(prefix, family, null, null, `result.${member}[${String(index)}]`);
    });
  }
  return collector.finish(null);
}

/** A plain list of prefixes, one per line (Cloudflare's `ips-v4` and `ips-v6`). */
export function parsePrefixList(
  bytes: Uint8Array | string,
  options: RangeParseOptions & { readonly provider: string },
): RangePublication {
  const collector = new RangeCollector(options.provider, options.provider);
  splitLines(decodeText(bytes)).forEach((line, index) => {
    if (line !== '') {
      collector.add(line, null, null, null, `line ${String(index + 1)}`);
    }
  });
  return collector.finish(null);
}

/** An RFC 8805 geofeed (DigitalOcean, Linode, Apple's Private Relay egress list). */
export function parseGeofeed(
  bytes: Uint8Array | string,
  options: RangeParseOptions & { readonly provider: string },
): RangePublication {
  const collector = new RangeCollector(options.provider, options.provider);
  let publishedAt: Date | null = null;
  splitLines(decodeText(bytes)).forEach((line, index) => {
    const where = `line ${String(index + 1)}`;
    if (line === '') {
      return;
    }
    if (line.startsWith('#')) {
      const stamp = STAMP.exec(line);
      if (stamp !== null && publishedAt === null) {
        publishedAt = spaceSeparatedUtc((stamp[1] ?? '').replace('T', ' '), where);
      }
      return;
    }
    const fields = csvFields(line, where);
    if (fields.length > 5) {
      throw new NetworkParseError('format', `${where}: more than the five RFC 8805 columns`);
    }
    const [prefix = '', countryText = '', regionText = ''] = fields;
    const country = countryText.toUpperCase();
    const region = regionText.toUpperCase();
    if (country !== '' && !COUNTRY.test(country)) {
      throw new NetworkParseError('format', `${where}: the country is not ISO 3166-1 alpha-2`);
    }
    if (region !== '' && !REGION.test(region)) {
      throw new NetworkParseError('format', `${where}: the region is not ISO 3166-2`);
    }
    collector.add(
      prefix,
      null,
      null,
      region !== '' ? region : country !== '' ? country : null,
      where,
    );
  });
  return collector.finish(publishedAt);
}

/** Azure's service tags; the file carries no publication time. */
export function parseAzureServiceTags(
  bytes: Uint8Array | string,
  options: RangeParseOptions = {},
): RangePublication {
  const root = objectAt(readJson(bytes), 'root');
  if (!Number.isInteger(root.changeNumber)) {
    throw new NetworkParseError('format', 'changeNumber: not an integer');
  }
  label(root.cloud, 'cloud');
  const collector = new RangeCollector(options.provider, 'azure');
  arrayAt(root.values, 'values').forEach((raw, index) => {
    const where = `values[${String(index)}]`;
    const value = objectAt(raw, where);
    label(value.name, `${where}.name`, 128);
    const properties = objectAt(value.properties, `${where}.properties`);
    const service = optionalLabel(properties.systemService, `${where}.properties.systemService`);
    const region = optionalLabel(properties.region, `${where}.properties.region`);
    arrayAt(properties.addressPrefixes, `${where}.properties.addressPrefixes`).forEach(
      (prefix, prefixIndex) => {
        collector.add(
          prefix,
          null,
          service,
          region,
          `${where}.properties.addressPrefixes[${String(prefixIndex)}]`,
        );
      },
    );
  });
  return collector.finish(null);
}
