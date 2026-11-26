/**
 * Synthetic Phase 7 documents for `dashboard-signals`' pages (C108): sessions with their device
 * and network, the inquiry's `signals` and `signal-details`, list matches and the network sources
 * page. Addresses come only from the documentation ranges, ASNs from the documentation ASNs,
 * places and points are fictional (country `ZZ`, open ocean), and fingerprints are generated from
 * seeds. Each builder parses its result with the contract schema, so a fixture that drifts from
 * the contract fails where it is built.
 */
import { createHash } from 'node:crypto';
import {
  dashboardNetworkSourcesSchema,
  deviceResourceSchema,
  inquirySessionIncludeDocumentSchema,
  inquirySessionResourceSchema,
  listMatchResourceSchema,
  networkResourceSchema,
  type DashboardNetworkSources,
  type DeviceResource,
  type InquiryResource,
  type InquirySessionIncludeDocument,
  type InquirySessionResource,
  type ListMatchResource,
  type NetworkResource,
} from '@openverify/contracts';
import { LIFECYCLE_IDS, T0, T1, T2 } from './lifecycle-fixtures';

export const SIGNAL_IDS = {
  inquiry: LIFECYCLE_IDS.inquiry,
  account: LIFECYCLE_IDS.account,
  session: LIFECYCLE_IDS.session,
  phoneSession: 'iqse_01JB0000000000000000000003',
  device: 'dev_01JB0000000000000000000001',
  network: 'net_01JB0000000000000000000001',
  phoneNetwork: 'net_01JB0000000000000000000003',
  list: 'lst_01JB0000000000000000000001',
  otherList: 'lst_01JB0000000000000000000002',
  thirdList: 'lst_01JB0000000000000000000003',
  item: 'liea_01JB0000000000000000000001',
  ipItem: 'liip_01JB0000000000000000000001',
  match: 'lmt_01JB0000000000000000000001',
  ipMatch: 'lmt_01JB0000000000000000000002',
} as const;

const IDS = SIGNAL_IDS;

/** A 64-hex digest made from `seed`: a stand-in for an HMAC, never a real one. */
export const seededHex = (seed: string) => createHash('sha256').update(seed).digest('hex');

/** A synthetic browser fingerprint, device class and source digest. */
export const BROWSER_FINGERPRINT = seededHex('dashboard-signals/browser-fingerprint');
export const DEVICE_CLASS = seededHex('dashboard-signals/device-class');
export const SOURCE_SHA256 = seededHex('dashboard-signals/sandbox-network');

/** The session's address (documentation range) and its fictional point. */
export const SESSION_IP = '203.0.113.7';
export const PHONE_IP = '203.0.113.200';
export const SESSION_USER_AGENT = 'SyntheticBrowser/1.0 (Linux x86_64)';
export const POINT = { latitude: -30, longitude: -140 } as const;

type SessionAttributes = InquirySessionResource['attributes'];

/** A desktop session of `IDS.inquiry` with the Phase 7 facts, its device and its network. */
export function phase7Session(
  attributes: Partial<SessionAttributes> = {},
  id: string = IDS.session,
  links: { device?: string | null; network?: string | null } = {},
): InquirySessionResource {
  const device = links.device === undefined ? IDS.device : links.device;
  const network = links.network === undefined ? IDS.network : links.network;
  return inquirySessionResourceSchema.parse({
    type: 'inquiry-session',
    id,
    attributes: {
      status: 'expired',
      'created-at': T0,
      'started-at': T1,
      'expires-at': T2,
      'ip-address': SESSION_IP,
      'user-agent': SESSION_USER_AGENT,
      consent: null,
      'is-tor': false,
      'is-datacenter': null,
      'is-vpn': null,
      'is-proxy': null,
      'hosting-asn': null,
      'threat-level': 'low',
      'country-code': 'ZZ',
      'country-name': 'Example Land',
      'region-code': 'ZZ-01',
      'region-name': 'Example Region',
      latitude: POINT.latitude,
      longitude: POINT.longitude,
      'gps-latitude': null,
      'gps-longitude': null,
      'gps-precision': null,
      'gps-country-code': null,
      'ip-connection-type': null,
      'ip-isp': 'Example Residential',
      'network-organization': 'Example Residential',
      'os-name': 'Linux',
      'os-full-version': null,
      'browser-name': 'Chrome',
      'browser-full-version': '140.0.0.0',
      'device-type': 'desktop',
      'device-name': null,
      'mobile-sdk-name': null,
      'mobile-sdk-full-version': null,
      'signals-collected': ['session-integrity', 'device-recognition'],
      'device-handoff-method': null,
      'handoff-from-session-id': null,
      'handoff-redeemed-at': null,
      'handoff-distance-meters': null,
      'handoff-country-changed': null,
      'handoff-asn-changed': null,
      ...attributes,
    },
    relationships: {
      inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
      device: { data: device === null ? null : { type: 'device', id: device } },
      network: { data: network === null ? null : { type: 'network', id: network } },
    },
  });
}

/** The phone's session, reached by a QR handoff from `IDS.session` (C96.4). */
export function phoneSession(attributes: Partial<SessionAttributes> = {}): InquirySessionResource {
  return phase7Session(
    {
      'ip-address': PHONE_IP,
      'user-agent': 'SyntheticPhone/1.0 (Android 14)',
      'os-name': 'Android',
      'browser-name': 'Chrome',
      'device-type': 'smartphone',
      'device-name': 'Example Phone',
      'signals-collected': [],
      latitude: -30.5,
      longitude: -140.5,
      'device-handoff-method': 'qr',
      'handoff-from-session-id': IDS.session,
      'handoff-redeemed-at': T1,
      'handoff-distance-meters': 70_000,
      'handoff-country-changed': false,
      'handoff-asn-changed': null,
      ...attributes,
    },
    IDS.phoneSession,
    { device: null, network: IDS.phoneNetwork },
  );
}

type DeviceAttributes = DeviceResource['attributes'];

/** A web device the device-recognition tier recorded. */
export function device(attributes: Partial<DeviceAttributes> = {}): DeviceResource {
  return deviceResourceSchema.parse({
    type: 'device',
    id: IDS.device,
    attributes: {
      'created-at': T1,
      'device-vendor-id': null,
      'device-fingerprint': null,
      'browser-fingerprint': BROWSER_FINGERPRINT,
      'device-class': DEVICE_CLASS,
      platform: 'web',
      'collector-version': 1,
      'fingerprint-randomised': false,
      'key-id': 'Qm9xZXN0ZXI',
      'session-count': 2,
      'first-seen-at': T0,
      'last-seen-at': T1,
      'trusted-at': null,
      'trusted-by': null,
      'trust-reason': null,
      ...attributes,
    },
  });
}

type NetworkAttributes = NetworkResource['attributes'];

/** The network row of a session's address, read against the sandbox source (C93.6). */
export function network(
  attributes: Partial<NetworkAttributes> = {},
  id: string = IDS.network,
  sessionId: string = IDS.session,
): NetworkResource {
  return networkResourceSchema.parse({
    type: 'network',
    id,
    attributes: {
      'created-at': T1,
      'ip-address': SESSION_IP,
      'service-provider': 'Example Residential',
      'service-type': null,
      'proxy-type': null,
      'threat-level': 'low',
      'country-code': 'ZZ',
      'country-name': 'Example Land',
      'region-code': 'ZZ-01',
      'region-name': 'Example Region',
      latitude: POINT.latitude,
      longitude: POINT.longitude,
      asn: 64502,
      'hosting-asn': null,
      'hosting-asn-confidence': null,
      'privacy-relay': null,
      'client-address-source': 'trusted-list',
      'evaluated-at': T1,
      reasons: [
        { field: 'is-datacenter', reason: 'not_in_known_ranges' },
        { field: 'is-vpn', reason: 'not_in_known_ranges' },
        { field: 'is-proxy', reason: 'provider_not_configured' },
        { field: 'hosting-asn', reason: 'not_in_known_ranges' },
        { field: 'threat-level', reason: 'vpn_list_not_exhaustive' },
        { field: 'threat-level', reason: 'proxy_not_evaluated' },
        { field: 'location', reason: 'approximate' },
      ],
      sources: [
        {
          kind: 'sync',
          'source-id': 'openverify-sandbox-network',
          'sync-id': '3',
          'published-at': T0,
          sha256: SOURCE_SHA256,
        },
      ],
      ...attributes,
    },
    relationships: {
      'inquiry-session': { data: { type: 'inquiry-session', id: sessionId } },
    },
  });
}

/** `GET /inquiry-sessions/:id?include=device,network` for `session`. */
export function sessionDocument(
  session: InquirySessionResource,
  included: readonly (DeviceResource | NetworkResource)[],
): InquirySessionIncludeDocument {
  return inquirySessionIncludeDocumentSchema.parse({ data: session, included });
}

/** The same documents as an API without `pii:view` answers them (C15, C91.6). */
export function maskedSession(session: InquirySessionResource): InquirySessionResource {
  return inquirySessionResourceSchema.parse({
    ...session,
    attributes: {
      ...session.attributes,
      'ip-address': null,
      'user-agent': null,
      'region-code': null,
      'region-name': null,
      latitude: null,
      longitude: null,
    },
  });
}

export function maskedDevice(resource: DeviceResource): DeviceResource {
  return deviceResourceSchema.parse({
    ...resource,
    attributes: { ...resource.attributes, 'browser-fingerprint': null, 'device-fingerprint': null },
  });
}

export function maskedNetwork(resource: NetworkResource): NetworkResource {
  return networkResourceSchema.parse({
    ...resource,
    attributes: {
      ...resource.attributes,
      'ip-address': null,
      'region-code': null,
      'region-name': null,
      latitude: null,
      longitude: null,
    },
  });
}

type InquiryAttributes = InquiryResource['attributes'];

/**
 * The inquiry's `signals` and `signal-details` (C90.5), as the dashboard read serves them: a
 * computed set with a low bot score, an unevaluated behaviour level, a network level of `low`, a
 * Tor flag left unevaluated for IPv6, and a list count left `null` by a partial screening.
 */
export function computedSignals(): Pick<InquiryAttributes, 'signals' | 'signal-details'> {
  const detail = { stage: 'ga', version: 1, reasons: [], 'computed-at': T1 } as const;
  const beta = { ...detail, stage: 'beta', version: 2 } as const;
  return {
    signals: [
      { name: 'inquiry/bot_score', value: 12 },
      { name: 'inquiry/behavior_threat_level', value: null },
      { name: 'inquiry/automation_artefact_count', value: 0 },
      { name: 'inquiry/network_threat_level', value: 'low' },
      { name: 'inquiry/tor_detected', value: null },
      { name: 'inquiry/max_session_distance', value: 70_000 },
      { name: 'inquiry/list_match_count', value: null },
    ],
    'signal-details': {
      'computed-at': T1,
      'inquiry/bot_score': {
        ...beta,
        tier: 'H',
        confidence: 0.4,
        thresholds: { 'low-score-confidence-cap': 0.5 },
        'null-reason': null,
        reasons: ['no_artefact_found'],
      },
      'inquiry/behavior_threat_level': {
        ...beta,
        tier: 'H',
        confidence: null,
        thresholds: { 'min-screens': 3 },
        'null-reason': 'insufficient_behaviour',
      },
      'inquiry/automation_artefact_count': {
        ...detail,
        tier: 'R',
        'null-reason': null,
        reasons: ['no_artefact_found'],
      },
      'inquiry/network_threat_level': {
        ...beta,
        tier: 'H',
        confidence: 0.5,
        thresholds: { 'low-confidence-cap': 0.5 },
        'null-reason': null,
        reasons: ['vpn_list_not_exhaustive', 'proxy_not_evaluated'],
      },
      'inquiry/tor_detected': {
        ...detail,
        tier: 'R',
        'null-reason': 'ipv6_not_covered',
      },
      'inquiry/max_session_distance': {
        ...detail,
        tier: 'R',
        'null-reason': null,
        reasons: ['approximate'],
      },
      'inquiry/list_match_count': {
        ...detail,
        tier: 'R',
        'null-reason': 'list_unscreened',
        'list-screening': {
          status: 'partial',
          unscreened: [{ 'list-id': IDS.otherList, reason: 'list_items_pending' }],
          'not-applicable': [{ 'list-id': IDS.thirdList, reason: 'subject_has_no_value' }],
          'review-cause': 'inquiry_already_decided',
        },
      },
    },
  };
}

/** The signals before the job ran: `[]` and `computed-at: null` (C90.5, H23). */
export const NOT_COMPUTED_SIGNALS = {
  signals: [],
  'signal-details': { 'computed-at': null },
} as Pick<InquiryAttributes, 'signals' | 'signal-details'>;

type MatchAttributes = ListMatchResource['attributes'];

/** An open, exact R-tier match of the inquiry's confirmed email against `IDS.list`. */
export function listMatch(
  attributes: Partial<MatchAttributes> = {},
  id: string = IDS.match,
  links: { list?: string; listType?: string; item?: string | null; itemType?: string } = {},
): ListMatchResource {
  const kind = links.listType ?? 'email-address';
  const item = links.item === undefined ? IDS.item : links.item;
  return listMatchResourceSchema.parse({
    type: 'list-match',
    id,
    attributes: {
      status: 'open',
      source: 'otp.email-address',
      method: 'exact',
      tier: 'R',
      confidence: null,
      approximate: false,
      score: null,
      'distance-meters': null,
      'list-version': 2,
      'matched-value': 'listed@example.test',
      'dismissed-at': null,
      reason: null,
      'created-at': T1,
      'redacted-at': null,
      ...attributes,
    },
    relationships: {
      list: { data: { type: `list/${kind}`, id: links.list ?? IDS.list } },
      'list-item': {
        data: item === null ? null : { type: `list-item/${links.itemType ?? kind}`, id: item },
      },
      inquiry: { data: { type: 'inquiry', id: IDS.inquiry } },
      account: { data: { type: 'account', id: IDS.account } },
    },
  });
}

/** An IP-derived match: the session's address inside a listed range (approximate, C93.3). */
export function ipRangeMatch(attributes: Partial<MatchAttributes> = {}): ListMatchResource {
  return listMatch(
    {
      source: 'session.ip-address',
      method: 'cidr',
      approximate: true,
      'matched-value': SESSION_IP,
      ...attributes,
    },
    IDS.ipMatch,
    { list: IDS.otherList, listType: 'ip-address', item: IDS.ipItem },
  );
}

/** A list match as the API answers it without `pii:view`. */
export function maskedMatch(match: ListMatchResource): ListMatchResource {
  return listMatchResourceSchema.parse({
    ...match,
    attributes: {
      ...match.attributes,
      'matched-value': null,
      reason: null,
    },
  });
}

export function matchList(matches: readonly ListMatchResource[], next: string | null = null) {
  return { data: matches, links: { next } };
}

/** `GET /dashboard/network-sources`: a sandbox source, a stale one, a refused one and the seeds. */
export function networkSources(
  overrides: Partial<DashboardNetworkSources> = {},
): DashboardNetworkSources {
  const terms = {
    note: 'Synthetic terms note: read the publisher terms before enabling the source.',
    url: 'https://terms.example.org/network',
  };
  return dashboardNetworkSourcesSchema.parse({
    sources: [
      {
        id: 'openverify-sandbox-network',
        publisher: 'OpenVerify (synthetic sandbox data)',
        role: 'sandbox',
        enabled: true,
        'enabled-by-default': true,
        'sandbox-only': true,
        'import-only': true,
        'last-sync-id': '3',
        'last-checked-at': T1,
        'last-applied-at': T1,
        'published-at': T0,
        sha256: SOURCE_SHA256,
        origin: 'import',
        stale: false,
        'stale-after-hours': null,
        'refresh-interval-hours': null,
        'last-error-code': null,
        'check-failures': 0,
        'last-failed-at': null,
        attribution: 'Synthetic sandbox network data',
        'link-back': null,
        terms,
      },
      {
        id: 'dbip-country-lite',
        publisher: 'Example Geo Publisher',
        role: 'geo-country',
        enabled: true,
        'enabled-by-default': true,
        'sandbox-only': false,
        'import-only': false,
        'last-sync-id': '7',
        'last-checked-at': T0,
        'last-applied-at': T0,
        'published-at': T0,
        sha256: seededHex('dashboard-signals/country'),
        origin: 'publisher',
        stale: true,
        'stale-after-hours': 1080,
        'refresh-interval-hours': 24,
        'last-error-code': 'refused_mass_removal',
        'check-failures': 2,
        'last-failed-at': T1,
        attribution: 'IP geolocation by DB-IP',
        'link-back': 'https://db-ip.com',
        terms,
      },
      {
        id: 'tor-exit-addresses',
        publisher: 'Example Exit List Publisher',
        role: 'tor',
        enabled: true,
        'enabled-by-default': true,
        'sandbox-only': false,
        'import-only': false,
        'last-sync-id': null,
        'last-checked-at': null,
        'last-applied-at': null,
        'published-at': null,
        sha256: null,
        origin: null,
        stale: null,
        'stale-after-hours': 6,
        'refresh-interval-hours': 1,
        'last-error-code': 'storage_not_configured',
        'check-failures': 0,
        'last-failed-at': null,
        attribution: 'Synthetic exit list attribution',
        'link-back': null,
        terms: { note: 'Synthetic terms note for the exit list.', url: null },
      },
    ],
    'recent-syncs': [
      {
        id: '8',
        'source-id': 'dbip-country-lite',
        'started-at': T1,
        'finished-at': T1,
        outcome: 'refused_mass_removal',
        'error-code': null,
        'published-at': T1,
        sha256: seededHex('dashboard-signals/country-refused'),
        'snapshot-bytes': 1024,
        'entry-count': 12,
        actor: 'job',
        origin: 'publisher',
        overrides: [],
      },
      {
        id: '3',
        'source-id': 'openverify-sandbox-network',
        'started-at': T0,
        'finished-at': T0,
        outcome: 'applied',
        'error-code': null,
        'published-at': T0,
        sha256: SOURCE_SHA256,
        'snapshot-bytes': 2048,
        'entry-count': 9,
        actor: 'seed',
        origin: 'import',
        overrides: ['allow-mass-addition'],
      },
    ],
    'asn-seeds': {
      status: 'loaded',
      files: ['x4bnet_datacenter_asns', 'x4bnet_vpn_asns'],
      'hosting-asns': 933,
      'vpn-asns': 16,
      seeds: [
        {
          name: 'x4bnet_datacenter_asns',
          commit: seededHex('dashboard-signals/seed-commit').slice(0, 40),
          sha256: seededHex('dashboard-signals/seed-datacenter'),
        },
      ],
    },
    ...overrides,
  });
}
