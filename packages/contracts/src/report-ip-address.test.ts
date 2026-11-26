import { describe, expect, it } from 'vitest';
import { REPORT_QUERY_SOURCES, ipAddressQuerySchema } from './report-queries.js';
import {
  IP_ADDRESS_REPORT_NULL_CAUSES,
  REPORT_UNAVAILABLE_REASONS,
  ipAddressReportResourceSchema,
  ipAddressUnavailableReason,
} from './reports.js';
import { SIGNAL_NULL_REASONS } from './signals.js';

const AT = '2026-10-30T12:00:00.000Z';

/** A ready report on a sandbox Tor exit (C93.6), every other fact evaluated. */
const report = (attributes: Record<string, unknown> = {}) => ({
  type: 'report/ip-address',
  id: 'rep_01J00000000000000000000000',
  attributes: {
    status: 'ready',
    'created-at': AT,
    'completed-at': AT,
    'redacted-at': null,
    'report-template-version-name': 'v1',
    'has-match': false,
    'is-continuous': false,
    'is-recurring': false,
    tags: [],
    query: { 'ip-address': '192.0.2.10' },
    origin: 'api',
    errors: [],
    'unavailable-fields': [
      { field: 'proxy-detected', reason: 'provider_not_configured' },
      { field: 'vpn-detected', reason: 'not_in_known_ranges' },
      { field: 'datacenter-ip', reason: 'not_in_known_ranges' },
      { field: 'service-type', reason: 'not_in_known_ranges' },
      { field: 'mobile-ip', reason: 'no_adapter' },
      { field: 'city', reason: 'list_unavailable' },
      { field: 'region', reason: 'list_unavailable' },
      { field: 'latitude', reason: 'list_unavailable' },
      { field: 'longitude', reason: 'list_unavailable' },
    ],
    coverage: null,
    'next-run-at': null,
    'paused-at': null,
    'paused-reason': null,
    sources: [
      {
        'source-id': 'openverify-sandbox-network',
        'sync-id': '3',
        'published-at': AT,
        'checked-at': AT,
        sha256: 'c'.repeat(64),
        origin: 'import',
        attribution: 'Synthetic network data for the sandbox (OpenVerify)',
      },
    ],
    'query-sources': { 'ip-address': 'request' },
    'matcher-version': null,
    provider: null,
    thresholds: null,
    notices: [],
    'service-type': null,
    'datacenter-ip': null,
    'vpn-detected': null,
    'proxy-detected': null,
    'tor-exit-node': 'MATCHED',
    isp: 'Example Residential',
    'mobile-ip': null,
    'country-code': 'ZZ',
    'country-name': 'Unknown or unspecified country',
    city: null,
    region: null,
    latitude: null,
    longitude: null,
    error: null,
    flagged: true,
    'hosting-asn': null,
    'client-address-source': null,
    'field-details': {
      'tor-exit-node': { tier: 'R', reasons: ['tor_exit_listed'] },
      'vpn-detected': { tier: 'H', confidence: null, reasons: [] },
      'proxy-detected': { tier: 'A', reasons: [] },
    },
    ...attributes,
  },
  relationships: {
    inquiry: { data: null },
    account: { data: null },
    accounts: { data: [] },
    'report-template': { data: { type: 'report-template', id: 'rptp_01J00000000000000000000000' } },
    'report-template-version': {
      data: { type: 'report-template-version', id: 'rptpv_01J00000000000000000000000' },
    },
    transaction: { data: null },
  },
});

const ok = (value: unknown) => ipAddressReportResourceSchema.safeParse(value).success;

describe('the ip-address query (C106.1)', () => {
  it('takes one IPv4 or IPv6 host', () => {
    for (const address of ['192.0.2.10', '2001:db8::7', '198.51.100.1']) {
      expect(ipAddressQuerySchema.safeParse({ 'ip-address': address }).success, address).toBe(true);
    }
  });

  it('refuses ranges, netmasks, zone indexes and anything that is not an address', () => {
    for (const value of [
      '192.0.2.0/24',
      '2001:db8::/32',
      '192.0.2.10/255.255.255.0',
      'fe80::1%eth0',
      'example.org',
      '',
    ]) {
      expect(ipAddressQuerySchema.safeParse({ 'ip-address': value }).success, value).toBe(false);
    }
  });

  it('records the first evaluated session as a query source (C84.2)', () => {
    expect(REPORT_QUERY_SOURCES).toContain('inquiry_session');
  });
});

describe('the ip-address result (C106.1, H01, H07, H13)', () => {
  it('serves the public result attributes and ours', () => {
    expect(ok(report())).toBe(true);
  });

  it('never has a match: the review model is none (decision 42)', () => {
    expect(ok(report({ 'has-match': true }))).toBe(false);
  });

  it('answers CLEARED only for an IPv4 address (no exit list has IPv6 exits)', () => {
    expect(ok(report({ 'tor-exit-node': 'CLEARED', flagged: false }))).toBe(true);
    expect(
      ok(
        report({
          query: { 'ip-address': '2001:db8::7' },
          'tor-exit-node': 'CLEARED',
          flagged: false,
        }),
      ),
    ).toBe(false);
  });

  it('lists tor-exit-node in unavailable-fields whenever it is null, once the run ended', () => {
    const unlisted = report({ 'tor-exit-node': null, flagged: false });
    expect(ok(unlisted)).toBe(false);
    expect(
      ok(
        report({
          'tor-exit-node': null,
          flagged: false,
          'unavailable-fields': [{ field: 'tor-exit-node', reason: 'ipv6_not_covered' }],
          query: { 'ip-address': '2001:db8::7' },
        }),
      ),
    ).toBe(true);
    expect(
      ok(
        report({
          status: 'pending',
          'completed-at': null,
          'tor-exit-node': null,
          flagged: false,
          'unavailable-fields': [],
        }),
      ),
    ).toBe(true);
  });

  it('types the provider-range and VPN fields true or null, never false (H13)', () => {
    expect(ok(report({ 'datacenter-ip': false }))).toBe(false);
    expect(ok(report({ 'vpn-detected': false }))).toBe(false);
    expect(ok(report({ 'service-type': 'HOSTING' }))).toBe(false);
    expect(ok(report({ 'service-type': 'DATACENTER', 'datacenter-ip': true }))).toBe(true);
  });

  it('sets flagged exactly when Tor, VPN, proxy or a provider range is true (decision 42)', () => {
    expect(ok(report({ flagged: false }))).toBe(false);
    expect(ok(report({ 'tor-exit-node': 'CLEARED', flagged: true }))).toBe(false);
    expect(ok(report({ 'tor-exit-node': 'CLEARED', 'proxy-detected': true, flagged: true }))).toBe(
      true,
    );
  });

  it('carries a confidence and reasons for its H fields only', () => {
    expect(
      ok(
        report({
          'field-details': { 'vpn-detected': { tier: 'H', reasons: [] } },
        }),
      ),
    ).toBe(false);
    expect(
      ok(
        report({
          'field-details': { 'tor-exit-node': { tier: 'R', confidence: 1, reasons: [] } },
        }),
      ),
    ).toBe(false);
  });
});

describe('null causes and report reasons (C106.1, V12)', () => {
  it('adds the network reasons to the unavailable reasons', () => {
    expect(REPORT_UNAVAILABLE_REASONS).toEqual(
      expect.arrayContaining([
        'list_stale',
        'list_unavailable',
        'ipv6_not_covered',
        'address_not_public',
        'not_in_known_ranges',
        'not_in_provider_data',
        'client_address_untrusted',
      ]),
    );
  });

  it('maps each C93 null reason a report field can carry to its report reason, one to one', () => {
    for (const [field, causes] of Object.entries(IP_ADDRESS_REPORT_NULL_CAUSES)) {
      for (const cause of causes) {
        expect(SIGNAL_NULL_REASONS as readonly string[], `${field} ${cause}`).toContain(cause);
        expect(ipAddressUnavailableReason(cause), `${field} ${cause}`).toBe(cause);
        expect(REPORT_UNAVAILABLE_REASONS as readonly string[]).toContain(cause);
      }
    }
  });

  it('freezes the causes of each field (golden)', () => {
    const shared = ['address_not_public', 'client_address_untrusted'];
    const lists = ['list_stale', 'list_unavailable'];
    expect(IP_ADDRESS_REPORT_NULL_CAUSES).toEqual({
      'tor-exit-node': ['ipv6_not_covered', ...shared, ...lists],
      'datacenter-ip': ['not_in_known_ranges', ...shared, ...lists],
      'service-type': ['not_in_known_ranges', ...shared, ...lists],
      'vpn-detected': ['not_in_known_ranges', ...shared, ...lists],
      'proxy-detected': ['provider_not_configured', 'not_in_provider_data', ...shared],
      isp: [...shared, ...lists],
      'country-code': [...shared, ...lists],
      'country-name': [...shared, ...lists],
      city: [...shared, ...lists],
      region: [...shared, ...lists],
      latitude: [...shared, ...lists],
      longitude: [...shared, ...lists],
    });
  });

  it('refuses a reason no field can carry', () => {
    expect(() => ipAddressUnavailableReason('collector_missing')).toThrow();
  });
});
