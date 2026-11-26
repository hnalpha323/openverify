import { describe, expect, it } from 'vitest';
import {
  INQUIRY_SESSION_INCLUDES,
  INQUIRY_SESSION_INCLUDE_PERMISSIONS,
  PII_INQUIRY_SESSION_ATTRIBUTES,
  getInquirySessionQuerySchema,
  inquirySessionIncludeDocumentSchema,
  INQUIRY_SESSION_STATUSES,
  buildInquirySessionResource,
  expireAllInquirySessionsBodySchema,
  expireAllInquirySessionsResponseSchema,
  expireInquirySessionBodySchema,
  inquirySessionDocumentSchema,
  inquirySessionListDocumentSchema,
  inquirySessionResourceSchema,
  listInquirySessionsQuerySchema,
} from './inquiry-sessions.js';
import { AT, AT_ISO, IDS, LATER, LATER_ISO, LATEST, LATEST_ISO } from './test-support.js';

const session = {
  type: 'inquiry-session',
  id: IDS.inquirySession,
  attributes: {
    status: 'active',
    'created-at': AT_ISO,
    'started-at': LATER_ISO,
    'expires-at': LATEST_ISO,
    'ip-address': '203.0.113.7',
    'user-agent': 'Mozilla/5.0 (synthetic test agent)',
  },
  relationships: { inquiry: { data: { type: 'inquiry', id: IDS.inquiry } } },
};

describe('inquiry-session resource (C10)', () => {
  it('is active, expired or canceled', () => {
    expect(INQUIRY_SESSION_STATUSES).toEqual(['active', 'expired', 'canceled']);
  });

  it('carries its times, the first caller and its inquiry', () => {
    expect(inquirySessionResourceSchema.parse(session)).toEqual(session);
    expect(inquirySessionDocumentSchema.safeParse({ data: session }).success).toBe(true);
    expect(
      inquirySessionListDocumentSchema.safeParse({ data: [session], links: { next: null } })
        .success,
    ).toBe(true);
  });

  it('masks or omits the caller and has no start before the first flow call', () => {
    const masked = {
      ...session,
      attributes: {
        ...session.attributes,
        'ip-address': null,
        'user-agent': null,
        'started-at': null,
      },
    };
    expect(inquirySessionResourceSchema.safeParse(masked).success).toBe(true);
  });

  it('never carries the session token', () => {
    const leaked = { ...session, attributes: { ...session.attributes, token: 'ovs_x' } };
    expect(inquirySessionResourceSchema.safeParse(leaked).success).toBe(false);
  });

  it('is built from a session record', () => {
    expect(
      buildInquirySessionResource({
        id: IDS.inquirySession,
        inquiryId: IDS.inquiry,
        status: 'active',
        createdAt: AT,
        startedAt: LATER,
        expiresAt: LATEST,
        ipAddress: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (synthetic test agent)',
      }),
    ).toEqual(session);
    expect(
      buildInquirySessionResource({
        id: IDS.inquirySession,
        inquiryId: IDS.inquiry,
        status: 'canceled',
        createdAt: AT,
        startedAt: null,
        expiresAt: LATEST,
        ipAddress: null,
        userAgent: null,
      }).attributes['started-at'],
    ).toBeNull();
  });
});

describe('inquiry-session requests (C10)', () => {
  it('list sessions of an inquiry', () => {
    expect(
      listInquirySessionsQuerySchema.parse({
        'filter[inquiry-id]': IDS.inquiry,
        'filter[status]': 'active',
      }),
    ).toEqual({ 'filter[inquiry-id]': IDS.inquiry, 'filter[status]': 'active' });
    expect(listInquirySessionsQuerySchema.safeParse({ 'filter[inquiry-id]': 'x' }).success).toBe(
      false,
    );
  });

  it('expire one session without parameters', () => {
    expect(expireInquirySessionBodySchema.parse(undefined)).toBeUndefined();
  });

  it('expire every session of an inquiry', () => {
    const body = { meta: { 'inquiry-id': IDS.inquiry } };
    expect(expireAllInquirySessionsBodySchema.parse(body)).toEqual(body);
    expect(expireAllInquirySessionsBodySchema.safeParse({ meta: {} }).success).toBe(false);
    expect(expireAllInquirySessionsResponseSchema.parse({ meta: { 'expired-count': 2 } })).toEqual({
      meta: { 'expired-count': 2 },
    });
    expect(
      expireAllInquirySessionsResponseSchema.safeParse({ meta: { 'expired-count': -1 } }).success,
    ).toBe(false);
  });
});

describe('inquiry-session network facts and includes (C91.1, C91.3, Phase 7)', () => {
  const network = {
    isTor: false,
    isDatacenter: null,
    isVpn: null,
    isProxy: null,
    hostingAsn: null,
    threatLevel: 'low',
    countryCode: 'ZZ',
    countryName: 'Unknown or unspecified country',
    regionCode: null,
    regionName: null,
    latitude: null,
    longitude: null,
    ipConnectionType: null,
    ipIsp: 'Example Residential',
    networkOrganization: 'Example Residential',
  } as const;

  const built = () =>
    buildInquirySessionResource({
      id: IDS.inquirySession,
      inquiryId: IDS.inquiry,
      status: 'active',
      createdAt: AT,
      startedAt: LATER,
      expiresAt: LATEST,
      ipAddress: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (synthetic test agent)',
      network,
      networkId: 'net_01J00000000000000000000000',
    });

  it('serves the network facts and the network relationship when the record carries them', () => {
    expect(built()).toMatchObject({
      attributes: {
        'is-tor': false,
        'is-datacenter': null,
        'threat-level': 'low',
        'country-code': 'ZZ',
        'gps-latitude': null,
        'ip-isp': 'Example Residential',
      },
      relationships: {
        network: { data: { type: 'network', id: 'net_01J00000000000000000000000' } },
      },
    });
  });

  it('leaves them out for a record without them, so earlier payloads still parse', () => {
    const plain = buildInquirySessionResource({
      id: IDS.inquirySession,
      inquiryId: IDS.inquiry,
      status: 'active',
      createdAt: AT,
      startedAt: LATER,
      expiresAt: LATEST,
      ipAddress: null,
      userAgent: null,
    });
    expect(plain.attributes).not.toHaveProperty('is-tor');
    expect(plain.relationships).not.toHaveProperty('network');
  });

  it('includes the network, needing only inquiry-sessions:read (C107.6)', () => {
    expect(INQUIRY_SESSION_INCLUDES).toContain('network');
    expect(INQUIRY_SESSION_INCLUDE_PERMISSIONS).toMatchObject({
      network: ['inquiry-sessions:read'],
    });
    expect(getInquirySessionQuerySchema.parse({ include: 'network' })).toEqual({
      include: 'network',
    });
    expect(getInquirySessionQuerySchema.safeParse({ include: 'verifications' }).success).toBe(
      false,
    );
    const document = {
      data: built(),
      included: [
        {
          type: 'network',
          id: 'net_01J00000000000000000000000',
          attributes: {
            'created-at': AT_ISO,
            'ip-address': null,
            'service-provider': null,
            'service-type': null,
            'proxy-type': null,
            'threat-level': 'unknown',
            'country-code': null,
            'country-name': null,
            'region-code': null,
            'region-name': null,
            latitude: null,
            longitude: null,
            asn: null,
            'hosting-asn': null,
            'hosting-asn-confidence': null,
            'privacy-relay': null,
            'client-address-source': 'trust-all',
            'evaluated-at': AT_ISO,
            reasons: [{ field: 'is-tor', reason: 'client_address_untrusted' }],
            sources: [],
          },
          relationships: {
            'inquiry-session': { data: { type: 'inquiry-session', id: IDS.inquirySession } },
          },
        },
      ],
    };
    expect(inquirySessionIncludeDocumentSchema.parse(document)).toEqual(document);
  });

  it('marks the address, the user agent, the region and the point PII (C91.6)', () => {
    expect(PII_INQUIRY_SESSION_ATTRIBUTES).toEqual([
      'ip-address',
      'user-agent',
      'region-code',
      'region-name',
      'latitude',
      'longitude',
      'gps-latitude',
      'gps-longitude',
    ]);
  });
});
