import { describe, expect, it } from 'vitest';
import { cpuMilliseconds } from '../testing/cpu.js';
import { writeMmdb, type MmdbEntry } from '../testing/mmdb-writer.js';
import { SANDBOX_NETWORK, sandboxNetworkBundle } from '../testing/sandbox-network.js';
import { formatKey, parseAddress, parseNetwork, type ParsedAddress } from './address.js';
import { SPECIAL_BLOCKS } from './address-class.js';
import type { AsnSets } from './asn-seeds.js';
import { IntervalSet } from './interval-set.js';
import {
  NETWORK_FACT_FIELDS,
  evaluateClassified,
  evaluateNetwork,
  networkLookupRules,
  sessionNetworkFacts,
  type IpReputationAnswer,
  type NetworkEvaluation,
  type NetworkLookupInput,
  type NetworkSourceRole,
  type NetworkSourceSnapshot,
} from './lookup.js';
import { MmdbSnapshot } from './mmdb.js';
import type { RangeAttributes } from './range-files.js';
import { SandboxNetwork } from './sandbox.js';
import type { NetworkSnapshot } from './snapshot.js';
import { TorExitSet } from './tor-exit-list.js';

// ---------------------------------------------------------------------------------------------
// Synthetic sources in the real roles. Every address is a documentation address; the public
// path is reached through `evaluateClassified` with the class `public`, never a real address.

const PUBLISHED = new Date('2026-10-27T16:00:00Z');
const RULES = {
  vpnAsnConfidence: 0.6,
  hostingAsnConfidence: 0.5,
  threatLowConfidenceCap: 0.5,
  threatLowConfidenceCapWithAdapter: 0.8,
  torExitWindowHours: 24,
};

function at(text: string): ParsedAddress {
  const parsed = parseAddress(text);
  if (parsed === null) {
    throw new Error('test address does not parse');
  }
  return parsed;
}

function mmdb(
  databaseType: string,
  role: 'country' | 'asn' | 'city',
  entries: readonly MmdbEntry[],
): MmdbSnapshot {
  return MmdbSnapshot.open(writeMmdb({ databaseType, buildEpoch: PUBLISHED, entries }), role);
}

function ranges(provider: string, ...networks: string[]): IntervalSet<RangeAttributes> {
  return IntervalSet.build(
    networks.map((network) => {
      const { start, end } = parseNetwork(network);
      return { start, end, value: { provider, service: 'EC2', region: 'example-1' } };
    }),
  );
}

let syncs = 0;
function source(
  role: NetworkSourceRole,
  sourceId: string,
  snapshot: NetworkSnapshot | null,
  options: Partial<Pick<NetworkSourceSnapshot, 'freshness' | 'sandboxOnly'>> = {},
): NetworkSourceSnapshot {
  syncs += 1;
  return {
    sourceId,
    role,
    sandboxOnly: options.sandboxOnly ?? false,
    freshness: options.freshness ?? 'fresh',
    provenance:
      snapshot === null
        ? null
        : { syncId: String(syncs), publishedAt: PUBLISHED, sha256: 'a'.repeat(64) },
    snapshot,
  };
}

const TOR = source(
  'tor',
  'tor-exit-addresses',
  TorExitSet.build(
    [
      { key: at('192.0.2.10').key, seenAt: new Date('2026-10-27T16:05:00Z') },
      // Seen 30 h before the list: outside the 24 h window.
      { key: at('192.0.2.11').key, seenAt: new Date('2026-10-26T10:00:00Z') },
    ],
    PUBLISHED,
  ),
);
const AWS = source('cloud-ranges', 'aws-ip-ranges', ranges('aws', '198.51.100.0/26'));
const GCP = source('cloud-ranges', 'gcp-cloud', ranges('google-cloud', '203.0.113.0/30'));
const ASN = source(
  'asn',
  'dbip-asn-lite',
  mmdb('DBIP-ASN-Lite', 'asn', [
    {
      network: '198.51.100.0/24',
      data: {
        autonomous_system_number: 64501,
        autonomous_system_organization: 'Example Residential',
      },
    },
    {
      network: '192.0.2.30/32',
      data: { autonomous_system_number: 64500, autonomous_system_organization: 'Example VPN' },
    },
    {
      network: '192.0.2.50/32',
      data: { autonomous_system_number: 64503, autonomous_system_organization: 'Example Hosting' },
    },
    { network: '2001:db8:5::/48', data: { autonomous_system_number: 64501 } },
  ]),
);
const COUNTRY = source(
  'geo-country',
  'dbip-country-lite',
  mmdb('DBIP-Country-Lite', 'country', [
    {
      network: '198.51.100.0/24',
      data: { country: { iso_code: 'ZZ', names: { en: 'Example Land' } } },
    },
    {
      network: '192.0.2.0/24',
      data: { country: { iso_code: 'ZZ', names: { en: 'Example Land' } } },
    },
    {
      network: '2001:db8:5::/48',
      data: { country: { iso_code: 'ZZ', names: { en: 'Example Land' } } },
    },
  ]),
);
const CITY = source(
  'geo-city',
  'dbip-city-lite',
  mmdb('DBIP-City-Lite', 'city', [
    {
      network: '198.51.100.0/24',
      data: {
        city: { names: { en: 'Example City' } },
        country: { iso_code: 'ZZ', names: { en: 'Example Land' } },
        location: { latitude: -30, longitude: -140 },
        subdivisions: [{ iso_code: 'ZZ-01', names: { en: 'Example Region' } }],
      },
    },
  ]),
);
const RELAY = source(
  'relay',
  'apple-private-relay',
  ranges('apple-private-relay', '198.51.100.250/32'),
);
const SANDBOX = source(
  'sandbox',
  'openverify-sandbox-network',
  SandboxNetwork.parse(sandboxNetworkBundle()),
  {
    sandboxOnly: true,
  },
);
const DEFAULT_SOURCES = [TOR, AWS, GCP, ASN, COUNTRY];
const SEEDS: AsnSets = { hosting: new Set([64503]), vpn: new Set([64500]) };

function input(overrides: Partial<NetworkLookupInput> = {}): NetworkLookupInput {
  return {
    address: '198.51.100.100',
    environment: 'production',
    clientAddressSource: 'socket',
    sources: DEFAULT_SOURCES,
    asnSets: SEEDS,
    ipReputation: null,
    rules: RULES,
    ...overrides,
  };
}

/** The public path, for a documentation address standing in for a public one. */
function asPublic(overrides: Partial<NetworkLookupInput> = {}): NetworkEvaluation {
  const value = input(overrides);
  return evaluateClassified(value, at(value.address), 'public');
}

function adapter(
  value: boolean | null,
  extra: Partial<IpReputationAnswer> = {},
): IpReputationAnswer {
  return {
    provider: 'mmdb-file',
    sandbox: false,
    value,
    proxyType: value === true ? 'public_proxy' : null,
    connectionType: null,
    ...extra,
  };
}

function sourceIds(evaluation: NetworkEvaluation): string[] {
  return evaluation.sources.map((ref) =>
    ref.kind === 'sync' ? ref.sourceId : `provider:${ref.provider}`,
  );
}

// ---------------------------------------------------------------------------------------------

describe('evaluateNetwork in a default install (C93.3, C93.4, H04: no adapter, fresh lists)', () => {
  it('reads a listed-nowhere IPv4 address as low with capped confidence and its limits, never clean', () => {
    const evaluation = asPublic();
    expect(evaluation.facts['is-tor']).toEqual({
      value: false,
      nullReason: null,
      reasons: [],
      confidence: null,
    });
    expect(evaluation.facts['is-datacenter']).toMatchObject({
      value: null,
      nullReason: 'not_in_known_ranges',
    });
    expect(evaluation.facts['is-vpn']).toMatchObject({
      value: null,
      nullReason: 'not_in_known_ranges',
    });
    expect(evaluation.facts['hosting-asn']).toMatchObject({
      value: null,
      nullReason: 'not_in_known_ranges',
    });
    expect(evaluation.facts['is-proxy']).toMatchObject({
      value: null,
      nullReason: 'provider_not_configured',
    });
    expect(evaluation.facts['threat-level']).toEqual({
      value: 'low',
      nullReason: null,
      reasons: ['vpn_list_not_exhaustive', 'proxy_not_evaluated'],
      confidence: 0.5,
    });
    expect(evaluation.facts['country-code']).toEqual({
      value: 'ZZ',
      nullReason: null,
      reasons: ['approximate'],
      confidence: null,
    });
    expect(evaluation.countryName).toBe('Example Land');
    expect(evaluation.facts.asn.value).toBe(64501);
    expect(evaluation.asnOrganization).toBe('Example Residential');
    expect(evaluation.facts.location).toMatchObject({
      value: null,
      nullReason: 'list_unavailable',
    });
    expect(evaluation.facts['region-code']).toMatchObject({
      value: null,
      nullReason: 'list_unavailable',
    });
    expect(evaluation.facts['privacy-relay']).toMatchObject({
      value: null,
      nullReason: 'list_unavailable',
    });
    expect(evaluation.evaluated).toEqual({
      tor: true,
      vpn: true,
      hosting: true,
      providerRanges: true,
      proxy: false,
    });
    expect(evaluation.ipConnectionType).toBeNull();
    expect(evaluation.proxyType).toBeNull();
    expect(sourceIds(evaluation)).toEqual([
      'tor-exit-addresses',
      'aws-ip-ranges',
      'gcp-cloud',
      'dbip-asn-lite',
      'dbip-country-lite',
    ]);
    expect(evaluation.sources[0]).toEqual({
      kind: 'sync',
      sourceId: 'tor-exit-addresses',
      syncId: TOR.provenance?.syncId,
      publishedAt: PUBLISHED,
      sha256: 'a'.repeat(64),
    });
  });

  it('gives every null fact exactly one null reason in the network reasons, in field order', () => {
    const evaluation = asPublic();
    const fields = evaluation.reasons.map((reason) => reason.field);
    expect(fields).toEqual(
      [...fields].sort((a, b) => NETWORK_FACT_FIELDS.indexOf(a) - NETWORK_FACT_FIELDS.indexOf(b)),
    );
    for (const field of NETWORK_FACT_FIELDS) {
      const fact = evaluation.facts[field];
      const own = evaluation.reasons
        .filter((reason) => reason.field === field)
        .map((reason) => reason.reason);
      expect(own, field).toEqual(fact.nullReason === null ? fact.reasons : [fact.nullReason]);
    }
  });
});

describe('evaluateNetwork: each fact (C93.3)', () => {
  it('lists a Tor exit seen within 24 h, high with confidence 1, and not one seen before', () => {
    const tor = asPublic({ address: '192.0.2.10' });
    expect(tor.facts['is-tor']).toEqual({
      value: true,
      nullReason: null,
      reasons: ['tor_exit_listed'],
      confidence: null,
    });
    expect(tor.facts['threat-level']).toEqual({
      value: 'high',
      nullReason: null,
      reasons: ['tor_exit_listed'],
      confidence: 1,
    });
    expect(tor.proxyType).toBe('tor');
    expect(asPublic({ address: '192.0.2.11' }).facts['is-tor'].value).toBe(false);
    expect(
      asPublic({ address: '192.0.2.11', rules: { ...RULES, torExitWindowHours: 31 } }).facts[
        'is-tor'
      ].value,
    ).toBe(true);
  });

  it('takes the datacenter fields from provider ranges only (H13)', () => {
    const datacenter = asPublic({ address: '198.51.100.9' });
    expect(datacenter.facts['is-datacenter']).toEqual({
      value: true,
      nullReason: null,
      reasons: ['provider_range'],
      confidence: null,
    });
    expect(datacenter.providerRanges).toEqual([
      { provider: 'aws', service: 'EC2', region: 'example-1' },
    ]);
    expect(datacenter.ipConnectionType).toBe('datacenter');
    expect(datacenter.facts['threat-level']).toMatchObject({
      value: 'medium',
      confidence: 1,
      reasons: ['provider_range'],
    });
    const hosting = asPublic({ address: '192.0.2.50' });
    expect(hosting.facts['hosting-asn']).toEqual({
      value: true,
      nullReason: null,
      reasons: ['hosting_asn'],
      confidence: 0.5,
    });
    expect(hosting.facts['is-datacenter']).toMatchObject({
      value: null,
      nullReason: 'not_in_known_ranges',
    });
    expect(hosting.ipConnectionType).toBeNull();
    expect(hosting.facts['threat-level']).toMatchObject({
      value: 'medium',
      confidence: 0.5,
      reasons: ['hosting_asn'],
    });
  });

  it('flags a VPN ASN with its confidence, H-tier', () => {
    const vpn = asPublic({ address: '192.0.2.30' });
    expect(vpn.facts['is-vpn']).toEqual({
      value: true,
      nullReason: null,
      reasons: ['vpn_asn'],
      confidence: 0.6,
    });
    expect(vpn.proxyType).toBe('vpn');
    expect(vpn.facts['threat-level']).toMatchObject({
      value: 'medium',
      confidence: 0.6,
      reasons: ['vpn_asn'],
    });
  });

  it('answers is-proxy only from a bound adapter, with its provider among the sources', () => {
    const flagged = asPublic({ address: '198.51.100.100', ipReputation: adapter(true) });
    expect(flagged.facts['is-proxy']).toEqual({
      value: true,
      nullReason: null,
      reasons: ['proxy_flagged'],
      confidence: null,
    });
    expect(flagged.facts['threat-level']).toMatchObject({
      value: 'high',
      confidence: 1,
      reasons: ['proxy_flagged'],
    });
    expect(flagged.proxyType).toBe('public_proxy');
    expect(flagged.sources.at(-1)).toEqual({
      kind: 'provider',
      provider: 'mmdb-file',
      sandbox: false,
    });
    const negative = asPublic({ ipReputation: adapter(false) });
    expect(negative.facts['is-proxy']).toEqual({
      value: false,
      nullReason: null,
      reasons: ['adapter_negative'],
      confidence: null,
    });
    expect(negative.facts['threat-level']).toEqual({
      value: 'low',
      nullReason: null,
      reasons: ['vpn_list_not_exhaustive'],
      confidence: 0.8,
    });
    const unknown = asPublic({ ipReputation: adapter(null, { connectionType: 'cable' }) });
    expect(unknown.facts['is-proxy']).toMatchObject({
      value: null,
      nullReason: 'not_in_provider_data',
    });
    expect(unknown.evaluated.proxy).toBe(true);
    expect(unknown.facts['threat-level']).toMatchObject({ value: 'low', confidence: 0.8 });
    expect(unknown.ipConnectionType).toBe('cable');
  });

  it('reads the city point, its region and its name only with City Lite', () => {
    const city = asPublic({ sources: [...DEFAULT_SOURCES, CITY] });
    expect(city.facts.location).toEqual({
      value: { latitude: -30, longitude: -140 },
      nullReason: null,
      reasons: ['approximate'],
      confidence: null,
    });
    expect(city.facts['region-code']).toEqual({
      value: 'ZZ-01',
      nullReason: null,
      reasons: ['approximate'],
      confidence: null,
    });
    expect(city.regionName).toBe('Example Region');
    expect(city.cityName).toBe('Example City');
    expect(
      asPublic({ address: '192.0.2.200', sources: [...DEFAULT_SOURCES, CITY] }).facts.location,
    ).toMatchObject({
      value: null,
      nullReason: 'not_in_known_ranges',
    });
    // A country from City Lite when Country Lite has not synced.
    const fromCity = asPublic({
      sources: [
        TOR,
        AWS,
        ASN,
        CITY,
        source('geo-country', 'dbip-country-lite', null, { freshness: 'unavailable' }),
      ],
    });
    expect(fromCity.facts['country-code'].value).toBe('ZZ');
  });

  it('sets privacy-relay from the relay list, which never raises the level', () => {
    const relay = asPublic({ address: '198.51.100.250', sources: [...DEFAULT_SOURCES, RELAY] });
    expect(relay.facts['privacy-relay']).toEqual({
      value: true,
      nullReason: null,
      reasons: [],
      confidence: null,
    });
    expect(relay.facts['threat-level'].value).toBe('low');
    expect(asPublic({ sources: [...DEFAULT_SOURCES, RELAY] }).facts['privacy-relay']).toMatchObject(
      { nullReason: 'not_in_known_ranges' },
    );
  });
});

describe('evaluateNetwork: unknowns are null with their reason, never false (C90.3, C93.3)', () => {
  it('gives list_stale for a stale exit list and list_unavailable for a missing one', () => {
    const stale = asPublic({
      sources: [
        source('tor', 'tor-exit-addresses', TOR.snapshot, { freshness: 'stale' }),
        AWS,
        ASN,
        COUNTRY,
      ],
    });
    expect(stale.facts['is-tor']).toMatchObject({ value: null, nullReason: 'list_stale' });
    expect(stale.facts['threat-level']).toMatchObject({ value: null, nullReason: 'list_stale' });
    expect(sourceIds(stale)).not.toContain('tor-exit-addresses');
    const missing = asPublic({ sources: [AWS, ASN, COUNTRY] });
    expect(missing.facts['is-tor']).toMatchObject({ value: null, nullReason: 'list_unavailable' });
    // A Tor exit still reads high when another input is unknown.
    expect(asPublic({ address: '192.0.2.10', sources: [TOR] }).facts['threat-level'].value).toBe(
      'high',
    );
  });

  it('gives ipv6_not_covered for IPv6, whatever the list', () => {
    const v6 = asPublic({ address: '2001:db8:5::1' });
    expect(v6.facts['is-tor']).toMatchObject({ value: null, nullReason: 'ipv6_not_covered' });
    expect(v6.facts['threat-level']).toMatchObject({ value: null, nullReason: 'ipv6_not_covered' });
    expect(v6.facts['country-code'].value).toBe('ZZ');
    expect(v6.facts.asn.value).toBe(64501);
  });

  it('prefers a data gap over a fact about the subject for the threat level', () => {
    const evaluation = asPublic({ address: '2001:db8:5::1', sources: [TOR, ASN, COUNTRY] });
    expect(evaluation.facts['is-datacenter']).toMatchObject({ nullReason: 'list_unavailable' });
    expect(evaluation.facts['threat-level']).toMatchObject({
      value: null,
      nullReason: 'list_unavailable',
    });
  });

  it('gives list_unavailable without the ASN seeds, and the ASN source reason without ASN data', () => {
    const noSeeds = asPublic({ asnSets: null });
    expect(noSeeds.facts['is-vpn']).toMatchObject({ value: null, nullReason: 'list_unavailable' });
    expect(noSeeds.facts['hosting-asn']).toMatchObject({
      value: null,
      nullReason: 'list_unavailable',
    });
    expect(noSeeds.facts['threat-level']).toMatchObject({
      value: null,
      nullReason: 'list_unavailable',
    });
    const staleAsn = asPublic({
      sources: [
        TOR,
        AWS,
        source('asn', 'dbip-asn-lite', ASN.snapshot, { freshness: 'stale' }),
        COUNTRY,
      ],
    });
    expect(staleAsn.facts.asn).toMatchObject({ value: null, nullReason: 'list_stale' });
    expect(staleAsn.facts['is-vpn']).toMatchObject({ value: null, nullReason: 'list_stale' });
    expect(staleAsn.facts['hosting-asn']).toMatchObject({ value: null, nullReason: 'list_stale' });
    // No AS record for the address: not in the lists we hold, which still counts as evaluated.
    const noRecord = asPublic({ address: '203.0.113.200' });
    expect(noRecord.facts.asn).toMatchObject({ value: null, nullReason: 'not_in_known_ranges' });
    expect(noRecord.facts['is-vpn']).toMatchObject({
      value: null,
      nullReason: 'not_in_known_ranges',
    });
    expect(noRecord.evaluated.vpn).toBe(true);
  });

  describe('a source of the role that was not read (R002, ADR 0006)', () => {
    const staleAws = source('cloud-ranges', 'aws-ip-ranges', AWS.snapshot, { freshness: 'stale' });
    const unloaded = source('cloud-ranges', 'linode-geofeed', null, { freshness: 'unavailable' });

    it('makes the fact null with its reason, never not_in_known_ranges, beside a fresh sibling', () => {
      const evaluation = asPublic({
        address: '198.51.100.100',
        sources: [TOR, staleAws, GCP, ASN, COUNTRY],
      });

      expect(evaluation.facts['is-datacenter']).toMatchObject({
        value: null,
        nullReason: 'list_stale',
      });
      expect(evaluation.facts['threat-level']).toMatchObject({
        value: null,
        nullReason: 'list_stale',
      });
      expect(sourceIds(evaluation)).not.toContain('aws-ip-ranges');
    });

    it('says list_unavailable for a source never loaded', () => {
      const evaluation = asPublic({
        address: '198.51.100.1',
        sources: [TOR, AWS, GCP, unloaded, ASN, COUNTRY],
      });

      expect(evaluation.facts['is-datacenter']).toMatchObject({ value: true });
      const outside = asPublic({
        address: '203.0.113.200',
        sources: [TOR, AWS, GCP, unloaded, ASN, COUNTRY],
      });
      expect(outside.facts['is-datacenter']).toMatchObject({
        value: null,
        nullReason: 'list_unavailable',
      });
    });

    it('keeps a true hit from a fresh sibling: a listed range is listed', () => {
      const evaluation = asPublic({
        address: '203.0.113.1',
        sources: [TOR, staleAws, GCP, ASN, COUNTRY],
      });

      expect(evaluation.facts['is-datacenter']).toMatchObject({ value: true });
      expect(evaluation.facts['threat-level']).toMatchObject({ value: 'medium' });
    });

    it('never reads a false from a Tor list while another of the role was not read', () => {
      const unreadTor = source('tor', 'second-exit-list', null, { freshness: 'stale' });

      const evaluation = asPublic({
        address: '203.0.113.200',
        sources: [TOR, unreadTor, AWS, GCP, ASN, COUNTRY],
      });

      expect(evaluation.facts['is-tor']).toMatchObject({ value: null, nullReason: 'list_stale' });
    });

    it('reads every other fact the same way: the ASN, the country and the relay', () => {
      const evaluation = asPublic({
        address: '203.0.113.200',
        sources: [
          TOR,
          AWS,
          GCP,
          ASN,
          source('asn', 'second-asn', null, { freshness: 'unavailable' }),
          COUNTRY,
          source('geo-country', 'second-country', null, { freshness: 'stale' }),
          source('relay', 'apple-private-relay', ranges('apple', '192.0.2.0/24')),
          source('relay', 'second-relay', null, { freshness: 'unavailable' }),
        ],
      });

      expect(evaluation.facts.asn).toMatchObject({ value: null, nullReason: 'list_unavailable' });
      expect(evaluation.facts['is-vpn']).toMatchObject({ nullReason: 'list_unavailable' });
      expect(evaluation.facts['country-code']).toMatchObject({ nullReason: 'list_stale' });
      expect(evaluation.facts['privacy-relay']).toMatchObject({ nullReason: 'list_unavailable' });
    });

    it('still reads not_in_known_ranges when every source of the role answered', () => {
      const evaluation = asPublic({
        address: '203.0.113.200',
        sources: [TOR, AWS, GCP, ASN, COUNTRY],
      });

      expect(evaluation.facts['is-datacenter']).toMatchObject({
        value: null,
        nullReason: 'not_in_known_ranges',
      });
    });
  });

  it('reads a source whose record breaks its role as unavailable, never as "not in the data"', () => {
    const broken = source(
      'geo-country',
      'dbip-country-lite',
      mmdb('DBIP-Country-Lite', 'country', [
        { network: '198.51.100.0/24', data: { country: { iso_code: 5 } } },
      ]),
    );
    const evaluation = asPublic({ sources: [TOR, AWS, ASN, broken] });
    expect(evaluation.facts['country-code']).toMatchObject({
      value: null,
      nullReason: 'list_unavailable',
    });
    expect(sourceIds(evaluation)).not.toContain('dbip-country-lite');
  });

  it('answers client_address_untrusted for every fact under trust-all in production (C93.1, P05)', () => {
    const evaluation = evaluateNetwork(
      input({ clientAddressSource: 'trust-all', ipReputation: adapter(true) }),
    );
    for (const field of NETWORK_FACT_FIELDS) {
      expect(evaluation.facts[field], field).toMatchObject({
        value: null,
        nullReason: 'client_address_untrusted',
      });
    }
    expect(evaluation.sources).toEqual([]);
    expect(evaluation.evaluated).toEqual({
      tor: false,
      vpn: false,
      hosting: false,
      providerRanges: false,
      proxy: false,
    });
  });

  it('answers address_not_public for a non-public address, in either environment', () => {
    for (const block of SPECIAL_BLOCKS.filter((entry) => entry.class === 'not_public')) {
      const address = formatKey(parseNetwork(block.network).start);
      for (const environment of ['sandbox', 'production'] as const) {
        const evaluation = evaluateNetwork(
          input({ address, environment, sources: [...DEFAULT_SOURCES, SANDBOX] }),
        );
        expect(evaluation.facts['country-code'].nullReason, block.network).toBe(
          'address_not_public',
        );
        expect(evaluation.facts['threat-level'].nullReason).toBe('address_not_public');
        expect(evaluation.sources).toEqual([]);
      }
    }
  });

  it('never reads the sandbox source in production (H26)', () => {
    const documentation = evaluateNetwork(
      input({ address: SANDBOX_NETWORK.torExit, sources: [...DEFAULT_SOURCES, SANDBOX] }),
    );
    expect(documentation.addressClass).toBe('documentation');
    expect(documentation.facts['is-tor']).toMatchObject({
      value: null,
      nullReason: 'address_not_public',
    });
    expect(documentation.sources).toEqual([]);
    const publicAddress = asPublic({
      address: SANDBOX_NETWORK.torExit,
      sources: [...DEFAULT_SOURCES, SANDBOX],
    });
    expect(sourceIds(publicAddress)).not.toContain('openverify-sandbox-network');
  });

  it('throws on an address that does not parse', () => {
    expect(() => evaluateNetwork(input({ address: 'not an address' }))).toThrow(TypeError);
  });
});

describe('evaluateNetwork with the sandbox network (C93.6: one golden per address)', () => {
  const sandbox = (address: string, ipReputation: IpReputationAnswer | null = null) =>
    evaluateNetwork(
      input({
        address,
        environment: 'sandbox',
        sources: [...DEFAULT_SOURCES, SANDBOX],
        ipReputation,
      }),
    );

  it('answers each sandbox address from the sandbox source alone', () => {
    const tor = sandbox('192.0.2.10');
    expect(tor.facts['is-tor'].value).toBe(true);
    expect(tor.facts['threat-level'].value).toBe('high');
    expect(sourceIds(tor)).toEqual(['openverify-sandbox-network']);
    const datacenter = sandbox('192.0.2.20');
    expect(datacenter.facts['is-datacenter'].value).toBe(true);
    expect(datacenter.providerRanges[0]?.provider).toBe('example-cloud');
    expect(datacenter.facts['threat-level'].value).toBe('medium');
    const vpn = sandbox('192.0.2.30');
    expect(vpn.facts['is-vpn'].value).toBe(true);
    expect(vpn.facts.asn.value).toBe(64500);
    const proxy = sandbox('192.0.2.40', {
      provider: 'sandbox',
      sandbox: true,
      value: true,
      proxyType: 'public_proxy',
      connectionType: null,
    });
    expect(proxy.facts['is-proxy'].value).toBe(true);
    expect(proxy.facts['threat-level'].value).toBe('high');
    expect(proxy.sources.at(-1)).toEqual({ kind: 'provider', provider: 'sandbox', sandbox: true });
    const hosting = sandbox('192.0.2.50');
    expect(hosting.facts['hosting-asn'].value).toBe(true);
    expect(hosting.facts['is-datacenter'].value).toBeNull();
    const residential = sandbox('198.51.100.7');
    expect(residential.facts['is-tor'].value).toBe(false);
    expect(residential.facts['threat-level']).toMatchObject({ value: 'low', confidence: 0.5 });
    expect(residential.facts['country-code'].value).toBe('ZZ');
    expect(residential.asnOrganization).toBe('Example Residential');
    const city = sandbox('203.0.113.9');
    expect(city.facts.location.value).toEqual({ latitude: -30, longitude: -140 });
    expect(city.facts.asn.value).toBe(64502);
    const v6 = sandbox('2001:db8::1');
    expect(v6.facts['is-tor']).toMatchObject({ value: null, nullReason: 'ipv6_not_covered' });
    expect(v6.facts['country-code'].value).toBe('ZZ');
  });

  it('reads the sandbox source even when marked stale, and gives list_unavailable without it', () => {
    const staleMarked = source('sandbox', 'openverify-sandbox-network', SANDBOX.snapshot, {
      sandboxOnly: true,
      freshness: 'stale',
    });
    expect(
      evaluateNetwork(
        input({ address: '192.0.2.10', environment: 'sandbox', sources: [staleMarked] }),
      ).facts['is-tor'].value,
    ).toBe(true);
    const none = evaluateNetwork(
      input({ address: '192.0.2.10', environment: 'sandbox', sources: DEFAULT_SOURCES }),
    );
    expect(none.facts['is-tor']).toMatchObject({ value: null, nullReason: 'list_unavailable' });
    expect(none.facts['hosting-asn']).toMatchObject({
      value: null,
      nullReason: 'list_unavailable',
    });
  });

  it('keeps the sandbox source out of a sandbox evaluation of a public address', () => {
    const value = input({ environment: 'sandbox', sources: [...DEFAULT_SOURCES, SANDBOX] });
    expect(sourceIds(evaluateClassified(value, at(value.address), 'public'))).not.toContain(
      'openverify-sandbox-network',
    );
  });
});

describe('networkLookupRules and sessionNetworkFacts', () => {
  it('reads the core registry constants by their keys', () => {
    const table = {
      'threat-low-confidence-cap': { value: 0.5 },
      'threat-low-confidence-cap-with-adapter': { value: 0.8 },
      'vpn-asn-confidence': { value: 0.6 },
      'hosting-asn-confidence': { value: 0.5 },
      // K7A-13: the caller's table holds the window, so this package needs no core at runtime.
      'tor-exit-window-hours': { value: 24 },
    };
    expect(networkLookupRules(table)).toEqual(RULES);
    expect(
      networkLookupRules({ ...table, 'tor-exit-window-hours': { value: 12 } }).torExitWindowHours,
    ).toBe(12);
    expect(() => networkLookupRules({ ...table, 'vpn-asn-confidence': { value: 'x' } })).toThrow(
      RangeError,
    );
    expect(() => networkLookupRules({ ...table, 'tor-exit-window-hours': { value: 0 } })).toThrow(
      RangeError,
    );
  });

  it("maps an evaluation onto the session's network attributes", () => {
    expect(
      sessionNetworkFacts(
        asPublic({ address: '198.51.100.9', sources: [...DEFAULT_SOURCES, CITY] }),
      ),
    ).toEqual({
      isTor: false,
      isDatacenter: true,
      isVpn: null,
      isProxy: null,
      hostingAsn: null,
      threatLevel: 'medium',
      countryCode: 'ZZ',
      countryName: 'Example Land',
      regionCode: 'ZZ-01',
      regionName: 'Example Region',
      latitude: -30,
      longitude: -140,
      ipConnectionType: 'datacenter',
      ipIsp: 'Example Residential',
      networkOrganization: 'Example Residential',
    });
  });
});

describe('evaluateNetwork cost (C93.2: a pure call under 1 ms)', () => {
  it('evaluates 2,000 addresses in under 2,000 ms of CPU time', () => {
    const sources = [...DEFAULT_SOURCES, CITY, RELAY, SANDBOX];
    const addresses = ['198.51.100.100', '192.0.2.10', '192.0.2.30', '2001:db8:5::1'];
    const used = cpuMilliseconds(() => {
      for (let i = 0; i < 2_000; i += 1) {
        const value = input({ address: addresses[i % addresses.length] ?? '', sources });
        evaluateClassified(value, at(value.address), 'public');
      }
    });
    expect(used).toBeLessThan(2_000);
  });
});
