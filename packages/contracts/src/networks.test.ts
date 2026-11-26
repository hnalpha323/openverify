import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CLIENT_ADDRESS_SOURCES,
  NETWORK_THREAT_LEVELS,
  PII_NETWORK_ATTRIBUTES,
  SESSION_NETWORK_ATTRIBUTE_SHAPE,
  buildNetworkResource,
  networkResourceSchema,
  type NetworkReason,
  type NetworkRecord,
} from './networks.js';
import { PII_SIGNAL_ATTRIBUTES } from './signal-pii.js';

const AT = new Date('2026-10-30T12:00:00.000Z');

const record = (overrides: Partial<NetworkRecord> = {}): NetworkRecord => ({
  id: 'net_01J00000000000000000000000',
  inquirySessionId: 'iqse_01J00000000000000000000000',
  createdAt: AT,
  evaluatedAt: AT,
  ipAddress: '203.0.113.7',
  serviceProvider: 'Example Residential',
  serviceType: null,
  proxyType: null,
  threatLevel: 'low',
  countryCode: 'ZZ',
  countryName: 'Unknown or unspecified country',
  regionCode: null,
  regionName: null,
  latitude: null,
  longitude: null,
  asn: 64502,
  hostingAsn: null,
  hostingAsnConfidence: null,
  privacyRelay: null,
  clientAddressSource: 'socket',
  reasons: [
    { field: 'is-vpn', reason: 'not_in_known_ranges' },
    { field: 'threat-level', reason: 'vpn_list_not_exhaustive' },
    { field: 'location', reason: 'list_unavailable' },
  ],
  sources: [
    {
      kind: 'sync',
      'source-id': 'openverify-sandbox-network',
      'sync-id': '7',
      'published-at': AT.toISOString(),
      sha256: 'b'.repeat(64),
    },
  ],
  ...overrides,
});

describe('the network resource (C91.3)', () => {
  it('builds the public attributes and ours, linked to its session', () => {
    const resource = buildNetworkResource(record());
    expect(resource).toMatchObject({
      type: 'network',
      id: 'net_01J00000000000000000000000',
      attributes: {
        'ip-address': '203.0.113.7',
        'threat-level': 'low',
        asn: 64502,
        'client-address-source': 'socket',
        'evaluated-at': AT.toISOString(),
      },
      relationships: {
        'inquiry-session': {
          data: { type: 'inquiry-session', id: 'iqse_01J00000000000000000000000' },
        },
      },
    });
    expect(networkResourceSchema.parse(resource)).toEqual(resource);
  });

  it('uses the public unknown for an unevaluated threat level', () => {
    expect(NETWORK_THREAT_LEVELS).toEqual(['unknown', 'low', 'medium', 'high']);
    expect(
      buildNetworkResource(record({ threatLevel: 'unknown' })).attributes['threat-level'],
    ).toBe('unknown');
  });

  it('records how the address was resolved (C93.1)', () => {
    expect(CLIENT_ADDRESS_SOURCES).toEqual(['socket', 'trusted-list', 'hop-count', 'trust-all']);
  });

  it('never serves false for the hosting-ASN or privacy-relay flags (C90.3, H13)', () => {
    const bad = { ...buildNetworkResource(record()) };
    for (const member of ['hosting-asn', 'privacy-relay']) {
      expect(
        networkResourceSchema.safeParse({
          ...bad,
          attributes: { ...bad.attributes, [member]: false },
        }).success,
        member,
      ).toBe(false);
    }
  });

  it('refuses a reason outside the frozen enums', () => {
    expect(() =>
      buildNetworkResource(
        record({
          reasons: [JSON.parse('{"field":"is-tor","reason":"looks_clean"}') as NetworkReason],
        }),
      ),
    ).toThrow(z.ZodError);
  });

  it('parses a redacted network: no address, region or point, the derived facts kept (C91.4)', () => {
    const redacted = buildNetworkResource(record({ ipAddress: null }));
    expect(redacted.attributes).toMatchObject({
      'ip-address': null,
      'country-code': 'ZZ',
      asn: 64502,
    });
  });
});

describe('the session network attributes (C91.1)', () => {
  const session = z.strictObject(SESSION_NETWORK_ATTRIBUTE_SHAPE);
  const facts = {
    'is-tor': false,
    'is-datacenter': null,
    'is-vpn': null,
    'is-proxy': null,
    'hosting-asn': null,
    'threat-level': 'low',
    'country-code': 'ZZ',
    'country-name': 'Unknown or unspecified country',
    'region-code': null,
    'region-name': null,
    latitude: null,
    longitude: null,
    'gps-latitude': null,
    'gps-longitude': null,
    'gps-precision': null,
    'gps-country-code': null,
    'ip-connection-type': null,
    'ip-isp': 'Example Residential',
    'network-organization': 'Example Residential',
  };

  it('holds the public names, with is-datacenter and is-vpn true or null (C93.3)', () => {
    expect(session.safeParse(facts).success).toBe(true);
    expect(session.safeParse({ ...facts, 'is-datacenter': false }).success).toBe(false);
    expect(session.safeParse({ ...facts, 'is-vpn': false }).success).toBe(false);
    expect(session.safeParse({ ...facts, 'is-tor': true, 'is-datacenter': true }).success).toBe(
      true,
    );
  });

  it('keeps every GPS attribute null in Phase 7 (decision 9)', () => {
    expect(session.safeParse({ ...facts, 'gps-latitude': 1.5 }).success).toBe(false);
  });
});

describe('PII (C91.6, C107.5)', () => {
  it('marks the address, the region and the point, and nothing derived', () => {
    expect(PII_NETWORK_ATTRIBUTES).toEqual([
      'ip-address',
      'region-code',
      'region-name',
      'latitude',
      'longitude',
      'gps-latitude',
      'gps-longitude',
    ]);
  });

  it('gathers the session, network and later Workflow 7A names in PII_SIGNAL_ATTRIBUTES', () => {
    expect(PII_SIGNAL_ATTRIBUTES).toEqual(
      expect.arrayContaining(['ip-address', 'user-agent', 'region-code', 'latitude', 'longitude']),
    );
    expect(PII_SIGNAL_ATTRIBUTES).not.toContain('country-code');
    expect(PII_SIGNAL_ATTRIBUTES).not.toContain('asn');
  });
});
