import { describe, expect, it } from 'vitest';
import { writeMmdb, type MmdbEntry } from '../testing/mmdb-writer.js';
import { parseAddress, type ParsedAddress } from './address.js';
import { NetworkParseError } from './errors.js';
import {
  MmdbSnapshot,
  anonymousIpAnswer,
  lookupAnonymousIp,
  lookupAsn,
  lookupCity,
  lookupCountry,
  type MmdbAnonymousIp,
} from './mmdb.js';

const EPOCH = new Date('2026-10-01T01:41:36Z');

function at(text: string): ParsedAddress {
  const parsed = parseAddress(text);
  if (parsed === null) {
    throw new Error('test address does not parse');
  }
  return parsed;
}

function file(databaseType: string, entries: readonly MmdbEntry[], ipVersion: 4 | 6 = 6): Buffer {
  return writeMmdb({ databaseType, buildEpoch: EPOCH, ipVersion, entries });
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof NetworkParseError) {
      return error.code;
    }
    throw error;
  }
  return undefined;
}

const COUNTRY = file('DBIP-Country-Lite', [
  {
    network: '198.51.100.0/24',
    data: { country: { iso_code: 'ZZ', names: { en: 'Example Land' } } },
  },
  {
    network: '2001:db8::/48',
    data: { country: { iso_code: 'ZZ', names: { en: 'Example Land' } } },
  },
  { network: '203.0.113.0/24', data: { continent: { code: 'OC' } } },
]);
const ASN = file('DBIP-ASN-Lite (compat=GeoLite2-ASN)', [
  {
    network: '198.51.100.0/24',
    data: {
      autonomous_system_number: 64501,
      autonomous_system_organization: 'Example Residential',
    },
  },
  { network: '192.0.2.0/24', data: { autonomous_system_number: 64500 } },
]);
const CITY = file('DBIP-City-Lite', [
  {
    network: '203.0.113.0/25',
    data: {
      city: { names: { en: 'Example City' } },
      country: { iso_code: 'ZZ', names: { en: 'Example Land' } },
      location: { latitude: -30, longitude: -140 },
      subdivisions: [{ iso_code: 'ZZ-01', names: { en: 'Example Region' } }],
    },
  },
  { network: '203.0.113.128/25', data: { location: { latitude: -30.5, longitude: -140.5 } } },
]);
const ANONYMOUS = file('OpenVerify-Synthetic-Anonymous-IP', [
  { network: '192.0.2.40/32', data: { is_anonymous: true, is_public_proxy: true } },
  {
    network: '192.0.2.41/32',
    data: {
      is_anonymous: false,
      is_anonymous_vpn: false,
      is_public_proxy: false,
      is_residential_proxy: false,
      is_tor_exit_node: false,
    },
  },
  { network: '192.0.2.42/32', data: { is_hosting_provider: true } },
]);

describe('MmdbSnapshot.open (C92.3)', () => {
  it('opens a file for its role and reports its metadata', () => {
    const snapshot = MmdbSnapshot.open(COUNTRY, 'country');
    expect(snapshot.kind).toBe('mmdb');
    expect(snapshot.role).toBe('country');
    expect(snapshot.publishedAt.toISOString()).toBe('2026-10-01T01:41:36.000Z');
    expect(snapshot.metadata).toMatchObject({
      databaseType: 'DBIP-Country-Lite',
      ipVersion: 6,
      recordSize: 24,
      bytes: COUNTRY.length,
    });
    expect(snapshot.metadata.nodeCount).toBeGreaterThan(0);
  });

  it('refuses a file of another role, a file that is not an MMDB, and a truncated one', () => {
    expect(codeOf(() => MmdbSnapshot.open(COUNTRY, 'asn'))).toBe('mmdb');
    expect(codeOf(() => MmdbSnapshot.open(ASN, 'city'))).toBe('mmdb');
    expect(codeOf(() => MmdbSnapshot.open(Buffer.from('not a database'), 'country'))).toBe('mmdb');
    expect(codeOf(() => MmdbSnapshot.open(COUNTRY.subarray(0, 40), 'country'))).toBe('mmdb');
    expect(codeOf(() => MmdbSnapshot.open(new Uint8Array(0), 'country'))).toBe('mmdb');
    // The search tree's separator damaged.
    const damaged = Buffer.from(COUNTRY);
    const nodes = MmdbSnapshot.open(COUNTRY, 'country').metadata.nodeCount;
    damaged[nodes * 6 + 3] = 0xff;
    expect(codeOf(() => MmdbSnapshot.open(damaged, 'country'))).toBe('mmdb');
  });
});

describe('MmdbSnapshot.verify (C92.2 step 5: the strict parse of a whole file)', () => {
  it('walks every node and checks each distinct record once', () => {
    const result = MmdbSnapshot.open(COUNTRY, 'country').verify();
    expect(result.prefixes).toBe(3);
    expect(result.records).toBe(2);
    expect(result.nodes).toBe(MmdbSnapshot.open(COUNTRY, 'country').metadata.nodeCount);
    expect(MmdbSnapshot.open(ASN, 'asn').verify().records).toBe(2);
    expect(MmdbSnapshot.open(CITY, 'city').verify().records).toBe(2);
    expect(MmdbSnapshot.open(ANONYMOUS, 'anonymous-ip').verify().records).toBe(3);
  });

  it('shows a visitor each prefix as a key range, IPv4 in the IPv4-mapped space, with its record', () => {
    const seen: [unknown, bigint, bigint][] = [];
    MmdbSnapshot.open(ASN, 'asn').verify((record, start, end) => seen.push([record, start, end]));
    const range = (network: string) => {
      const parsed = parseAddress(network.split('/')[0] ?? '');
      return parsed?.key ?? -1n;
    };
    expect(seen).toContainEqual([
      { asn: 64501, organization: 'Example Residential' },
      range('198.51.100.0'),
      range('198.51.100.255'),
    ]);
    expect(seen).toContainEqual([
      { asn: 64500, organization: null },
      range('192.0.2.0'),
      range('192.0.2.255'),
    ]);
    expect(seen).toHaveLength(2);
  });

  it('refuses a record that breaks the role, naming no value', () => {
    const bad = file('DBIP-Country-Lite', [
      { network: '198.51.100.0/24', data: { country: { iso_code: 'zz' } } },
    ]);
    expect(codeOf(() => MmdbSnapshot.open(bad, 'country').verify())).toBe('mmdb');
    const badAsn = file('DBIP-ASN-Lite', [
      { network: '198.51.100.0/24', data: { autonomous_system_number: 0 } },
    ]);
    expect(codeOf(() => MmdbSnapshot.open(badAsn, 'asn').verify())).toBe('mmdb');
    const badPoint = file('DBIP-City-Lite', [
      { network: '203.0.113.0/24', data: { location: { latitude: 91, longitude: 0 } } },
    ]);
    expect(codeOf(() => MmdbSnapshot.open(badPoint, 'city').verify())).toBe('mmdb');
    try {
      MmdbSnapshot.open(bad, 'country').verify();
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('198.51.100');
    }
  });
});

describe('the MMDB lookups (C93.3)', () => {
  it('reads a country, or null where the file holds none', () => {
    const country = MmdbSnapshot.open(COUNTRY, 'country');
    expect(lookupCountry(country, at('198.51.100.9'))).toEqual({
      code: 'ZZ',
      name: 'Example Land',
    });
    expect(lookupCountry(country, at('2001:db8::9'))).toEqual({ code: 'ZZ', name: 'Example Land' });
    expect(lookupCountry(country, at('192.0.2.1'))).toBeNull();
    expect(lookupCountry(country, at('203.0.113.1'))).toBeNull();
  });

  it('reads an AS with or without its organisation', () => {
    const asn = MmdbSnapshot.open(ASN, 'asn');
    expect(lookupAsn(asn, at('198.51.100.9'))).toEqual({
      asn: 64501,
      organization: 'Example Residential',
    });
    expect(lookupAsn(asn, at('192.0.2.30'))).toEqual({ asn: 64500, organization: null });
    expect(lookupAsn(asn, at('203.0.113.1'))).toBeNull();
  });

  it("reads a city point with its region and country, and a city file's country", () => {
    const city = MmdbSnapshot.open(CITY, 'city');
    expect(lookupCity(city, at('203.0.113.9'))).toEqual({
      country: { code: 'ZZ', name: 'Example Land' },
      regionCode: 'ZZ-01',
      regionName: 'Example Region',
      cityName: 'Example City',
      latitude: -30,
      longitude: -140,
    });
    expect(lookupCity(city, at('203.0.113.200'))).toEqual({
      country: null,
      regionCode: null,
      regionName: null,
      cityName: null,
      latitude: -30.5,
      longitude: -140.5,
    });
    expect(lookupCountry(city, at('203.0.113.9'))).toEqual({ code: 'ZZ', name: 'Example Land' });
    expect(lookupCity(city, at('2001:db8::1'))).toBeNull();
  });

  it('answers null for IPv6 in an IPv4-only file, and refuses a lookup of another role', () => {
    const v4 = MmdbSnapshot.open(
      file(
        'DBIP-Country-Lite',
        [{ network: '198.51.100.0/24', data: { country: { iso_code: 'ZZ' } } }],
        4,
      ),
      'country',
    );
    expect(lookupCountry(v4, at('198.51.100.1'))).toEqual({ code: 'ZZ', name: null });
    expect(lookupCountry(v4, at('2001:db8::1'))).toBeNull();
    expect(() => lookupAsn(MmdbSnapshot.open(COUNTRY, 'country'), at('198.51.100.1'))).toThrow(
      RangeError,
    );
    expect(MmdbSnapshot.open(COUNTRY, 'country').raw(at('198.51.100.1'))).toMatchObject({
      country: { iso_code: 'ZZ' },
    });
  });

  it('throws mmdb, never "not in the data", for a record that breaks its role', () => {
    const bad = MmdbSnapshot.open(
      file('DBIP-Country-Lite', [
        { network: '198.51.100.0/24', data: { country: { iso_code: 7 } } },
      ]),
      'country',
    );
    expect(codeOf(() => lookupCountry(bad, at('198.51.100.1')))).toBe('mmdb');
  });

  it("reads an anonymous-IP file's flags", () => {
    const anonymous = MmdbSnapshot.open(ANONYMOUS, 'anonymous-ip');
    expect(lookupAnonymousIp(anonymous, at('192.0.2.40'))).toEqual({
      isAnonymous: true,
      isAnonymousVpn: null,
      isHostingProvider: null,
      isPublicProxy: true,
      isResidentialProxy: null,
      isTorExitNode: null,
    });
    expect(lookupAnonymousIp(anonymous, at('192.0.2.50'))).toBeNull();
  });
});

describe('anonymousIpAnswer (C93.5: true, a recorded negative, or null)', () => {
  const none: MmdbAnonymousIp = {
    isAnonymous: null,
    isAnonymousVpn: null,
    isHostingProvider: null,
    isPublicProxy: null,
    isResidentialProxy: null,
    isTorExitNode: null,
  };

  it('flags an anonymiser, naming the most specific kind', () => {
    expect(anonymousIpAnswer({ ...none, isAnonymous: true, isPublicProxy: true })).toEqual({
      value: true,
      proxyType: 'public_proxy',
    });
    expect(
      anonymousIpAnswer({
        ...none,
        isAnonymous: true,
        isResidentialProxy: true,
        isPublicProxy: true,
      }),
    ).toEqual({
      value: true,
      proxyType: 'residential_proxy',
    });
    expect(anonymousIpAnswer({ ...none, isAnonymousVpn: true })).toEqual({
      value: true,
      proxyType: 'vpn',
    });
    expect(anonymousIpAnswer({ ...none, isTorExitNode: true })).toEqual({
      value: true,
      proxyType: 'tor',
    });
    expect(anonymousIpAnswer({ ...none, isAnonymous: true })).toEqual({
      value: true,
      proxyType: 'anonymous',
    });
  });

  it('answers false only when every anonymiser flag is positively cleared', () => {
    const cleared = {
      ...none,
      isAnonymous: false,
      isAnonymousVpn: false,
      isPublicProxy: false,
      isResidentialProxy: false,
      isTorExitNode: false,
    };
    expect(anonymousIpAnswer(cleared)).toEqual({ value: false, proxyType: null });
    expect(anonymousIpAnswer({ ...cleared, isTorExitNode: null })).toEqual({
      value: null,
      proxyType: null,
    });
    // A hosting flag alone is not a proxy.
    expect(anonymousIpAnswer({ ...none, isHostingProvider: true })).toEqual({
      value: null,
      proxyType: null,
    });
    expect(anonymousIpAnswer(null)).toEqual({ value: null, proxyType: null });
  });
});

describe('MmdbSnapshot: every record size, an IPv4 tree, and the refusals of each role (C92.2 step 5)', () => {
  it('verifies 28- and 32-bit trees and an IPv4-only tree', () => {
    for (const recordSize of [28, 32] as const) {
      const bytes = writeMmdb({
        databaseType: 'DBIP-ASN-Lite',
        buildEpoch: EPOCH,
        recordSize,
        entries: [{ network: '198.51.100.0/24', data: { autonomous_system_number: 64501 } }],
      });
      const snapshot = MmdbSnapshot.open(bytes, 'asn');
      expect(snapshot.verify().records, String(recordSize)).toBe(1);
      expect(lookupAsn(snapshot, at('198.51.100.1'))?.asn).toBe(64501);
    }
    const v4 = MmdbSnapshot.open(
      file(
        'DBIP-ASN-Lite',
        [{ network: '203.0.113.0/24', data: { autonomous_system_number: 64502 } }],
        4,
      ),
      'asn',
    );
    const seen: bigint[] = [];
    expect(v4.verify((_record, start) => seen.push(start)).prefixes).toBe(1);
    expect(seen).toEqual([at('203.0.113.0').key]);
  });

  it('refuses records that break each role', () => {
    const cases: ['country' | 'city' | 'asn' | 'anonymous-ip', string, Record<string, unknown>][] =
      [
        ['country', 'DBIP-Country-Lite', { country: 'ZZ' }],
        ['country', 'DBIP-Country-Lite', { country: { iso_code: 'ZZ', names: 'Example' } }],
        [
          'country',
          'DBIP-Country-Lite',
          { country: { iso_code: 'ZZ', names: { en: 'line\nbreak' } } },
        ],
        [
          'country',
          'DBIP-Country-Lite',
          { country: { iso_code: 'ZZ', names: { en: 'x'.repeat(201) } } },
        ],
        [
          'asn',
          'DBIP-ASN-Lite',
          { autonomous_system_number: 64501, autonomous_system_organization: '' },
        ],
        ['city', 'DBIP-City-Lite', { location: 'here' }],
        ['city', 'DBIP-City-Lite', { location: { latitude: 0, longitude: 181 } }],
        ['city', 'DBIP-City-Lite', { subdivisions: 'ZZ-01' }],
        ['city', 'DBIP-City-Lite', { subdivisions: ['ZZ-01'] }],
        ['city', 'DBIP-City-Lite', { subdivisions: [{ iso_code: 'with space' }] }],
        ['city', 'DBIP-City-Lite', { city: 'Example' }],
        ['anonymous-ip', 'OpenVerify-Anonymous-IP', { is_public_proxy: 'yes' }],
      ];
    for (const [role, databaseType, data] of cases) {
      const snapshot = MmdbSnapshot.open(
        file(databaseType, [{ network: '198.51.100.0/24', data: data as MmdbEntry['data'] }]),
        role,
      );
      expect(
        codeOf(() => snapshot.verify()),
        JSON.stringify(data),
      ).toBe('mmdb');
    }
    const list = MmdbSnapshot.open(
      file('DBIP-Country-Lite', [{ network: '198.51.100.0/24', data: { list: [1] } }]),
      'country',
    );
    expect(lookupCountry(list, at('198.51.100.1'))).toBeNull();
  });

  it('accepts a city record with an empty subdivision list and names without English', () => {
    const snapshot = MmdbSnapshot.open(
      file('DBIP-City-Lite', [
        {
          network: '198.51.100.0/24',
          data: { subdivisions: [], city: {}, country: { iso_code: 'ZZ', names: {} } },
        },
      ]),
      'city',
    );
    expect(lookupCity(snapshot, at('198.51.100.1'))).toEqual({
      country: { code: 'ZZ', name: null },
      regionCode: null,
      regionName: null,
      cityName: null,
      latitude: null,
      longitude: null,
    });
  });

  it('refuses a file whose metadata breaks the format', () => {
    const marker = Buffer.from('abcdef4d61784d696e642e636f6d', 'hex');
    // A marker with no decodable map after it.
    expect(
      codeOf(() => MmdbSnapshot.open(Buffer.concat([Buffer.alloc(64), marker]), 'country')),
    ).toBe('mmdb');
    // A tree whose records point past the data section.
    const bytes = Buffer.from(COUNTRY);
    bytes.writeUIntBE(0xff_ffff, 0, 3);
    expect(codeOf(() => MmdbSnapshot.open(bytes, 'country').verify())).toBe('mmdb');
  });
});
