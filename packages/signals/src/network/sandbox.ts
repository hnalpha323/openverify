/**
 * The sandbox network source, `openverify-sandbox-network` (plan C92.1, C93.6): one normalised
 * JSON bundle with its own exit list, provider ranges, relay ranges, ASN sets, proxy addresses and
 * three synthetic MMDB files (base64). It is read only for documentation addresses in sandbox
 * environments, never in production (H26), and never stale (C92.4). The parser refuses any
 * address outside the documentation ranges and any AS number outside the documentation ASNs, so
 * no sandbox answer can describe a real network.
 */
import { formatKey, parseAddress, parseNetwork, type ParsedAddress } from './address.js';
import { classifyAddress } from './address-class.js';
import type { AsnSets } from './asn-seeds.js';
import { NetworkParseError } from './errors.js';
import { IntervalSet, type IntervalEntry } from './interval-set.js';
import { MmdbSnapshot, type MmdbAsn, type MmdbRole } from './mmdb.js';
import type { RangeAttributes } from './range-files.js';
import { arrayAt, label, objectAt, readJson, stringAt } from './text.js';
import { TorExitSet, parseTorExitList } from './tor-exit-list.js';

/** The documentation AS numbers (RFC 5398). */
export const DOCUMENTATION_ASN_RANGES: readonly (readonly [number, number])[] = Object.freeze([
  Object.freeze([64496, 64511] as const),
  Object.freeze([65536, 65551] as const),
]);

const PROVIDER = /^[a-z][a-z0-9-]{0,63}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Whether an AS number is a documentation ASN. */
export function isDocumentationAsn(asn: number): boolean {
  return DOCUMENTATION_ASN_RANGES.some(([low, high]) => asn >= low && asn <= high);
}

function outside(where: string): never {
  throw new NetworkParseError('sandbox', `${where}: outside the documentation ranges and ASNs`);
}

/** Refuses a key range that is not wholly inside one documentation range. */
function documentationRange(start: bigint, end: bigint, where: string): void {
  for (const key of [start, end]) {
    const parsed = parseAddress(formatKey(key));
    if (parsed === null || classifyAddress(parsed) !== 'documentation') {
      outside(where);
    }
  }
}

function documentationAsn(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new NetworkParseError('asn', `${where}: not an AS number`);
  }
  if (!isDocumentationAsn(value)) {
    outside(where);
  }
  return value;
}

function nullableLabel(value: unknown, where: string): string | null {
  return value === null ? null : label(value, where);
}

function rangesOf(value: unknown, where: string): IntervalSet<RangeAttributes> {
  const entries: IntervalEntry<RangeAttributes>[] = arrayAt(value, where).map((raw, index) => {
    const at = `${where}[${String(index)}]`;
    const item = objectAt(raw, at);
    const network = parseNetwork(stringAt(item.network, `${at}.network`));
    documentationRange(network.start, network.end, at);
    const provider = stringAt(item.provider, `${at}.provider`);
    if (!PROVIDER.test(provider)) {
      throw new NetworkParseError('format', `${at}.provider: not a provider label`);
    }
    return {
      start: network.start,
      end: network.end,
      value: {
        provider,
        service: nullableLabel(item.service, `${at}.service`),
        region: nullableLabel(item.region, `${at}.region`),
      },
    };
  });
  return IntervalSet.build(entries);
}

function mmdbOf(value: unknown, role: MmdbRole, where: string): MmdbSnapshot {
  const text = stringAt(value, where);
  if (!BASE64.test(text)) {
    throw new NetworkParseError('format', `${where}: not base64`);
  }
  const bytes = Buffer.from(text, 'base64');
  if (bytes.toString('base64') !== text) {
    throw new NetworkParseError('format', `${where}: not canonical base64`);
  }
  const snapshot = MmdbSnapshot.open(bytes, role);
  snapshot.verify((record, start, end) => {
    documentationRange(start, end, where);
    if (role === 'asn') {
      documentationAsn((record as MmdbAsn).asn, where);
    }
  });
  return snapshot;
}

/** The parsed sandbox bundle: one snapshot per role, all of them synthetic. */
export class SandboxNetwork {
  readonly kind = 'sandbox' as const;
  readonly #publishedAt: Date;
  readonly #tor: TorExitSet;
  readonly #providerRanges: IntervalSet<RangeAttributes>;
  readonly #relayRanges: IntervalSet<RangeAttributes>;
  readonly #proxies: IntervalSet<string>;
  readonly #country: MmdbSnapshot;
  readonly #asn: MmdbSnapshot;
  readonly #city: MmdbSnapshot;
  readonly #asnSets: AsnSets;

  private constructor(parts: {
    publishedAt: Date;
    tor: TorExitSet;
    providerRanges: IntervalSet<RangeAttributes>;
    relayRanges: IntervalSet<RangeAttributes>;
    proxies: IntervalSet<string>;
    country: MmdbSnapshot;
    asn: MmdbSnapshot;
    city: MmdbSnapshot;
    asnSets: AsnSets;
  }) {
    this.#publishedAt = parts.publishedAt;
    this.#tor = parts.tor;
    this.#providerRanges = parts.providerRanges;
    this.#relayRanges = parts.relayRanges;
    this.#proxies = parts.proxies;
    this.#country = parts.country;
    this.#asn = parts.asn;
    this.#city = parts.city;
    this.#asnSets = parts.asnSets;
  }

  /**
   * Parses the bundle.
   * @throws {NetworkParseError} `format`, `address`, `asn`, `mmdb`, or `sandbox` for data outside
   * the documentation ranges and ASNs.
   */
  static parse(bytes: Uint8Array | string): SandboxNetwork {
    const root = objectAt(readJson(bytes), 'root');
    if (root.format !== 'openverify-sandbox-network' || root.version !== 1) {
      throw new NetworkParseError(
        'format',
        'root: not format openverify-sandbox-network version 1',
      );
    }
    const publishedText = stringAt(root['published-at'], 'published-at');
    const publishedAt = new Date(publishedText);
    if (Number.isNaN(publishedAt.getTime()) || publishedAt.toISOString() !== publishedText) {
      throw new NetworkParseError('format', 'published-at: not a canonical time');
    }
    const torPublication = parseTorExitList(
      stringAt(root['tor-exit-addresses'], 'tor-exit-addresses'),
    );
    for (const key of torPublication.exits.keys()) {
      documentationRange(key, key, 'tor-exit-addresses');
    }
    const proxies = IntervalSet.build(
      arrayAt(root.proxies, 'proxies').map((raw, index) => {
        const at = `proxies[${String(index)}]`;
        const item = objectAt(raw, at);
        const network = parseNetwork(stringAt(item.network, `${at}.network`));
        documentationRange(network.start, network.end, at);
        return {
          start: network.start,
          end: network.end,
          value: label(item['proxy-type'], `${at}.proxy-type`),
        };
      }),
    );
    const asns = (member: string) =>
      new Set(
        arrayAt(root[member], member).map((value, index) =>
          documentationAsn(value, `${member}[${String(index)}]`),
        ),
      );
    const mmdb = objectAt(root.mmdb, 'mmdb');
    return new SandboxNetwork({
      publishedAt,
      tor: torPublication.exits,
      providerRanges: rangesOf(root['provider-ranges'], 'provider-ranges'),
      relayRanges: rangesOf(root['relay-ranges'], 'relay-ranges'),
      proxies,
      country: mmdbOf(mmdb.country, 'country', 'mmdb.country'),
      asn: mmdbOf(mmdb.asn, 'asn', 'mmdb.asn'),
      city: mmdbOf(mmdb.city, 'city', 'mmdb.city'),
      asnSets: { hosting: asns('hosting-asns'), vpn: asns('vpn-asns') },
    });
  }

  get publishedAt(): Date {
    return new Date(this.#publishedAt.getTime());
  }

  get tor(): TorExitSet {
    return this.#tor;
  }

  get providerRanges(): IntervalSet<RangeAttributes> {
    return this.#providerRanges;
  }

  get relayRanges(): IntervalSet<RangeAttributes> {
    return this.#relayRanges;
  }

  get country(): MmdbSnapshot {
    return this.#country;
  }

  get asn(): MmdbSnapshot {
    return this.#asn;
  }

  get city(): MmdbSnapshot {
    return this.#city;
  }

  get asnSets(): AsnSets {
    return this.#asnSets;
  }

  /** Every count in the bundle (`network_syncs.entry_count`). */
  get entryCount(): number {
    return (
      this.#tor.size +
      this.#providerRanges.size +
      this.#relayRanges.size +
      this.#proxies.size +
      this.#asnSets.hosting.size +
      this.#asnSets.vpn.size
    );
  }

  /**
   * C93.6: the sandbox `ipReputation` answer: `true` with its proxy type for a listed proxy,
   * otherwise `null` (`not_in_provider_data`); never `false`.
   */
  ipReputation(address: ParsedAddress): {
    readonly value: true | null;
    readonly proxyType: string | null;
  } {
    const proxyType = this.#proxies.lookup(address.key)[0];
    return proxyType === undefined ? { value: null, proxyType: null } : { value: true, proxyType };
  }
}
