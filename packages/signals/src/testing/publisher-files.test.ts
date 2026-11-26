import { describe, expect, it } from 'vitest';
import { formatKey, parseAddress } from '../network/address.js';
import { classifyAddress } from '../network/address-class.js';
import { parseBadAsnList, parseX4bnetAsnList } from '../network/asn-seeds.js';
import type { IntervalSet } from '../network/interval-set.js';
import { MmdbSnapshot, lookupAsn, lookupCity, lookupCountry } from '../network/mmdb.js';
import {
  parseAwsIpRanges,
  parseAzureServiceTags,
  parseCloudflareIpsApi,
  parseGeofeed,
  parseGoogleCloudRanges,
  parseOracleIpRanges,
  parsePrefixList,
  type RangePublication,
} from '../network/range-files.js';
import { isDocumentationAsn } from '../network/sandbox.js';
import { parseTorExitList } from '../network/tor-exit-list.js';
import {
  syntheticAsnMmdb,
  syntheticAwsIpRanges,
  syntheticAzureServiceTags,
  syntheticBadAsnList,
  syntheticCityMmdb,
  syntheticCloudflareIps,
  syntheticCountryMmdb,
  syntheticGeofeed,
  syntheticGoogleCloudRanges,
  syntheticOracleIpRanges,
  syntheticRelayEgress,
  syntheticTorExitList,
  syntheticX4bnetAsnList,
} from './publisher-files.js';

function documentationOnly(ranges: IntervalSet<unknown>): void {
  for (const { start, end } of ranges.intervals()) {
    for (const key of [start, end]) {
      const parsed = parseAddress(formatKey(key));
      expect(parsed && classifyAddress(parsed)).toBe('documentation');
    }
  }
}

function both(publication: RangePublication): void {
  expect(publication.stats.ipv4Prefixes).toBeGreaterThan(0);
  expect(publication.stats.ipv6Prefixes).toBeGreaterThan(0);
  documentationOnly(publication.ranges);
}

describe('synthetic publisher files (C92.3, C111.1: generated from seeds, documentation data only)', () => {
  it('writes a TorDNSEL exit list that the parser reads, with exits outside the window', () => {
    const publishedAt = new Date('2026-10-27T16:00:00Z');
    const text = syntheticTorExitList({
      seed: 'tor',
      relays: 40,
      publishedAt,
      collectorHeader: true,
      ipv6Exit: true,
    });
    expect(text.startsWith('@type tordnsel 1.0\n')).toBe(true);
    const publication = parseTorExitList(text);
    expect(publication.stats.relays).toBe(40);
    expect(publication.stats.ignoredIpv6).toBe(1);
    expect(publication.publishedAt).toEqual(publishedAt);
    const keys = [...publication.exits.keys()];
    const listed = keys.filter((key) => publication.exits.listed(key, 24));
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.length).toBeLessThan(keys.length);
    for (const key of keys) {
      const parsed = parseAddress(formatKey(key));
      expect(parsed && classifyAddress(parsed)).toBe('documentation');
    }
  });

  it('is deterministic per seed, and another seed writes another file', () => {
    expect(syntheticTorExitList({ seed: 'same' })).toBe(syntheticTorExitList({ seed: 'same' }));
    expect(syntheticTorExitList({ seed: 'same' })).not.toBe(
      syntheticTorExitList({ seed: 'other' }),
    );
    expect(syntheticAwsIpRanges({ seed: 'same' })).toBe(syntheticAwsIpRanges({ seed: 'same' }));
    expect(
      syntheticCountryMmdb({ seed: 'same' }).equals(syntheticCountryMmdb({ seed: 'same' })),
    ).toBe(true);
  });

  it('writes every range format so that its parser reads both families', () => {
    both(parseAwsIpRanges(syntheticAwsIpRanges({ seed: 'aws', ipv4: 12, ipv6: 6 })));
    both(parseGoogleCloudRanges(syntheticGoogleCloudRanges({ seed: 'gcp' })));
    both(parseOracleIpRanges(syntheticOracleIpRanges({ seed: 'oracle' })));
    const cloudflare = syntheticCloudflareIps({ seed: 'cloudflare' });
    both(parseCloudflareIpsApi(cloudflare.api));
    expect(parsePrefixList(cloudflare.ipv4, { provider: 'cloudflare' }).stats.ipv6Prefixes).toBe(0);
    expect(parsePrefixList(cloudflare.ipv6, { provider: 'cloudflare' }).stats.ipv4Prefixes).toBe(0);
    both(
      parseGeofeed(syntheticGeofeed({ seed: 'geofeed', rows: 20 }), { provider: 'example-cloud' }),
    );
    both(parseAzureServiceTags(syntheticAzureServiceTags({ seed: 'azure', tags: 4 })));
    const relay = syntheticRelayEgress({ seed: 'relay', rows: 10 });
    expect(relay.split('\n')[0]?.split(',')).toHaveLength(5);
    both(parseGeofeed(relay, { provider: 'apple-private-relay' }));
  });

  it('writes AWS supersets over its service ranges, as the real file does', () => {
    const publication = parseAwsIpRanges(
      syntheticAwsIpRanges({ seed: 'aws-supersets', ipv4: 8, ipv6: 4 }),
    );
    const services = new Set(
      [...publication.ranges.intervals()].flatMap((interval) =>
        interval.values.map((v) => v.service),
      ),
    );
    expect(services.has('AMAZON')).toBe(true);
    expect(services.size).toBeGreaterThan(1);
  });

  it('writes ASN seeds with repeats, which the parsers drop', () => {
    const x4bnet = parseX4bnetAsnList(
      syntheticX4bnetAsnList({ seed: 'x4bnet', asns: 10, repeats: 2 }),
    );
    expect(x4bnet).toMatchObject({ entries: 12, duplicates: 2 });
    expect(x4bnet.asns).toHaveLength(10);
    const bad = parseBadAsnList(syntheticBadAsnList({ seed: 'bad', asns: 8, repeats: 3 }));
    expect(bad).toMatchObject({ entries: 11, duplicates: 3 });
    for (const asn of [...x4bnet.asns, ...bad.asns]) {
      expect(isDocumentationAsn(asn)).toBe(true);
    }
    expect(() => syntheticX4bnetAsnList({ seed: 'x', asns: 33 })).toThrow(RangeError);
  });

  it('writes Country, ASN and City MMDBs in DB-IP shape that verify and answer', () => {
    const country = MmdbSnapshot.open(syntheticCountryMmdb({ seed: 'country' }), 'country');
    expect(country.metadata.databaseType).toBe('OpenVerify-Synthetic-DBIP-Country-Lite');
    expect(country.verify().prefixes).toBeGreaterThan(1);
    // ISO 3166-1 user-assigned codes only (AA, QM-QZ, XA-XZ, ZZ): never a real country.
    expect(lookupCountry(country, parseAddressOrThrow('198.51.100.1'))?.code).toMatch(
      /^(?:AA|Q[M-Z]|X[A-Z]|ZZ)$/,
    );
    const asn = MmdbSnapshot.open(syntheticAsnMmdb({ seed: 'asn' }), 'asn');
    const found = lookupAsn(asn, parseAddressOrThrow('203.0.113.1'));
    expect(found !== null && isDocumentationAsn(found.asn)).toBe(true);
    const visited: number[] = [];
    asn.verify((record) => visited.push((record as { asn: number }).asn));
    expect(visited.every((value) => isDocumentationAsn(value))).toBe(true);
    const city = MmdbSnapshot.open(syntheticCityMmdb({ seed: 'city' }), 'city');
    const point = lookupCity(city, parseAddressOrThrow('192.0.2.1'));
    expect(point?.latitude).not.toBeNull();
    expect(lookupCity(city, parseAddressOrThrow('2001:db8::1'))?.longitude).not.toBeNull();
  });
});

function parseAddressOrThrow(text: string) {
  const parsed = parseAddress(text);
  if (parsed === null) {
    throw new Error('test address does not parse');
  }
  return parsed;
}
