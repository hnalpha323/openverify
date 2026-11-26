/**
 * C91.1-C91.3, C91.6, C107.5, C107.6 (Workflow 7A Stage 1b (S)): what an inquiry session serves.
 *
 * - Every read carries the session's network facts, its parsed device fields and
 *   `signals-collected` (all `null`, or `[]`, until evaluated: never a guess), and the `device`
 *   and `network` relationships (`null` without them).
 * - `?include=device,network` adds both resources; an unknown include is refused.
 * - Without `pii:view` the address, the user agent, the region and point, and the device's two
 *   fingerprints are `null` wherever they appear, `included` too; the device class is not PII.
 * - The session's events carry both resources in `included`, unmasked.
 *
 * Every address is from the documentation ranges and every point is fictional.
 */
import {
  inquirySessionIncludeDocumentSchema,
  type InquirySessionIncludeDocument,
} from '@openverify/contracts';
import { seedDevice, seedNetwork } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, createInquiry, expectStatus, resumeInquiry } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const BASE = '/api/v1/inquiry-sessions';
const LOCATION = { regionCode: 'ZZ-1', regionName: 'Synthetic', latitude: -12.5, longitude: -30.5 };

/** A session of a new inquiry, by its resume token; returns the session id. */
async function newSession(): Promise<{ inquiryId: string; sessionId: string }> {
  const inquiryId = await createInquiry(api, {});
  await resumeInquiry(api, inquiryId);
  const { rows } = await api.database.client.query<{ id: string }>(
    'select id from inquiry_sessions where inquiry_id = $1',
    [inquiryId],
  );
  return { inquiryId, sessionId: rows[0]?.id ?? '' };
}

const get = (id: string, query = '', token = api.token) =>
  api.app.inject({ url: `${BASE}/${id}${query}`, headers: bearer(token) });

const reader = () =>
  api.newUserToken(api.environmentId, { permissions: ['inquiry-sessions:read'] });

function documentOf(response: Awaited<ReturnType<typeof get>>): InquirySessionIncludeDocument {
  return inquirySessionIncludeDocumentSchema.parse(expectStatus(response, 200));
}

/** An evaluated network, parsed device fields and both tiers, written as their owners would. */
async function evaluated() {
  const { inquiryId, sessionId } = await newSession();
  const network = await seedNetwork(api.database.db, api.environmentId, {
    inquirySessionId: sessionId,
    ip: '203.0.113.21',
    location: LOCATION,
    asn: 64_502,
    countryCode: 'ZZ',
    threatLevel: 'low',
  });
  await api.database.client.query(
    `update inquiry_sessions set is_tor = false, threat_level = 'low', country_name = 'Synthetic',
       network_organization = 'Example Residential', os_name = 'Synthetic OS',
       browser_name = 'Synthetic Browser', device_type = 'desktop',
       signals_collected = '{session-integrity,device-recognition}'
     where id = $1`,
    [sessionId],
  );
  const device = await seedDevice(api.database.db, api.environmentId, { sessionIds: [sessionId] });
  return { inquiryId, sessionId, networkId: network.id, device };
}

describe('the session serves its signal attributes (C91.1)', () => {
  it('as nulls, [] and empty relationships before anything was evaluated', async () => {
    const { sessionId } = await newSession();

    const { data } = documentOf(await get(sessionId));

    expect(data.attributes).toMatchObject({
      'is-tor': null,
      'is-datacenter': null,
      'is-vpn': null,
      'is-proxy': null,
      'hosting-asn': null,
      'threat-level': null,
      'country-code': null,
      'region-code': null,
      latitude: null,
      'gps-latitude': null,
      'ip-isp': null,
      'os-name': null,
      'device-type': null,
      'mobile-sdk-name': null,
      'signals-collected': [],
    });
    expect(data.relationships).toMatchObject({
      device: { data: null },
      network: { data: null },
    });
  });

  it('with the stored facts, the parsed device and the tiers that applied', async () => {
    const { sessionId, networkId, device } = await evaluated();

    const { data } = documentOf(await get(sessionId));

    expect(data.attributes).toMatchObject({
      'is-tor': false,
      'threat-level': 'low',
      'country-code': 'ZZ',
      'country-name': 'Synthetic',
      'region-code': 'ZZ-1',
      'region-name': 'Synthetic',
      latitude: -12.5,
      longitude: -30.5,
      'ip-isp': 'Example Residential',
      'network-organization': 'Example Residential',
      'os-name': 'Synthetic OS',
      'browser-name': 'Synthetic Browser',
      'device-type': 'desktop',
      'signals-collected': ['session-integrity', 'device-recognition'],
    });
    expect(data.relationships).toMatchObject({
      device: { data: { type: 'device', id: device.id } },
      network: { data: { type: 'network', id: networkId } },
    });
  });

  it('on the list too', async () => {
    const { inquiryId, networkId } = await evaluated();

    const list = expectStatus(
      await api.app.inject({
        url: `${BASE}?filter[inquiry-id]=${inquiryId}`,
        headers: bearer(api.token),
      }),
      200,
    ) as unknown as { data: { relationships: { network?: { data: { id: string } | null } } }[] };

    expect(list.data[0]?.relationships.network?.data?.id).toBe(networkId);
  });
});

describe('?include=device,network (C91.1, C107.6)', () => {
  it('includes both resources, and only those asked for', async () => {
    const { sessionId, networkId, device } = await evaluated();

    const both = documentOf(await get(sessionId, '?include=device,network'));
    const network = documentOf(await get(sessionId, '?include=network'));

    expect(both.included?.map((resource) => `${resource.type}/${resource.id}`).sort()).toEqual(
      [`device/${device.id}`, `network/${networkId}`].sort(),
    );
    expect(network.included?.map((resource) => resource.type)).toEqual(['network']);
    const included = both.included?.find((resource) => resource.type === 'network');
    expect(included?.attributes).toMatchObject({
      'ip-address': '203.0.113.21',
      'country-code': 'ZZ',
      latitude: -12.5,
      asn: 64_502,
    });
    const served = both.included?.find((resource) => resource.type === 'device');
    expect(served?.attributes).toMatchObject({
      'browser-fingerprint': device.browserFingerprint,
      'device-class': device.deviceClass,
      'session-count': 1,
    });
  });

  it('includes nothing for a session without either', async () => {
    const { sessionId } = await newSession();

    expect(documentOf(await get(sessionId, '?include=device,network')).included).toEqual([]);
  });

  it('refuses an unknown include (400)', async () => {
    const { sessionId } = await newSession();

    expect((await get(sessionId, '?include=account')).statusCode).toBe(400);
  });
});

describe('masking without pii:view (C91.6, C107.5)', () => {
  it('nulls the address, user agent, region, point and fingerprints, in data and included', async () => {
    const { sessionId, device } = await evaluated();

    const document = documentOf(await get(sessionId, '?include=device,network', reader()));

    expect(document.data.attributes).toMatchObject({
      'ip-address': null,
      'user-agent': null,
      'region-code': null,
      'region-name': null,
      latitude: null,
      longitude: null,
      'country-code': 'ZZ',
      'is-tor': false,
    });
    const network = document.included?.find((resource) => resource.type === 'network');
    expect(network?.attributes).toMatchObject({
      'ip-address': null,
      'region-code': null,
      latitude: null,
      longitude: null,
      'country-code': 'ZZ',
    });
    const served = document.included?.find((resource) => resource.type === 'device');
    expect(served?.attributes).toMatchObject({
      'browser-fingerprint': null,
      'device-fingerprint': null,
      'device-class': device.deviceClass,
    });
    expect(JSON.stringify(document)).not.toContain('203.0.113.21');
    expect(JSON.stringify(document)).not.toContain(device.browserFingerprint ?? 'none');
  });
});

describe('the session events carry the device and network in included (C91.1)', () => {
  it('unmasked, on an expiry', async () => {
    const { sessionId, networkId, device } = await evaluated();

    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `${BASE}/${sessionId}/expire`,
        headers: bearer(api.token),
      }),
      200,
    );

    const event = api.events.events.find(
      (staged) => staged.name === 'inquiry-session.expired' && staged.payload.data.id === sessionId,
    );
    const included = (event?.payload as { included?: { type: string; id: string }[] } | undefined)
      ?.included;
    expect(included?.map((resource) => `${resource.type}/${resource.id}`).sort()).toEqual(
      [`device/${device.id}`, `network/${networkId}`].sort(),
    );
    expect(JSON.stringify(included)).toContain('203.0.113.21');
  });
});
