/** C10 inquiry sessions on the server API: list, fetch, expire and expire-all. */
import {
  eventPayloadSchema,
  expireAllInquirySessionsResponseSchema,
  inquirySessionDocumentSchema,
  inquirySessionListDocumentSchema,
  newId,
} from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  expectStatus,
  PROBLEM_JSON,
  resumeInquiry,
} from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const BASE = '/api/v1/inquiry-sessions';
const DAY_MS = 86_400_000;

/** A new inquiry with `count` sessions; returns the inquiry, the session ids and tokens. */
async function inquiryWithSessions(count: number, tenant = { token: api.token }) {
  const inquiryId = await createInquiry(api, { token: tenant.token });
  const tokens: string[] = [];
  for (let index = 0; index < count; index += 1) {
    tokens.push(await resumeInquiry(api, inquiryId, tenant.token));
  }
  const list = inquirySessionListDocumentSchema.parse(
    expectStatus(
      await api.app.inject({
        url: `${BASE}?filter[inquiry-id]=${inquiryId}`,
        headers: bearer(tenant.token),
      }),
      200,
    ),
  );
  return { inquiryId, sessionIds: list.data.map((session) => session.id).reverse(), tokens };
}

const get = (id: string, token = api.token) =>
  api.app.inject({ url: `${BASE}/${id}`, headers: bearer(token) });

const expire = (id: string, token = api.token) =>
  api.app.inject({ method: 'POST', url: `${BASE}/${id}/expire`, headers: bearer(token) });

const expireAll = (inquiryId: string, token = api.token) =>
  api.app.inject({
    method: 'POST',
    url: `${BASE}/expire-all`,
    headers: bearer(token),
    payload: { meta: { 'inquiry-id': inquiryId } },
  });

const sessionReader = () =>
  api.newUserToken(api.environmentId, { permissions: ['inquiry-sessions:read'] });

describe('GET /api/v1/inquiry-sessions', () => {
  it('lists the sessions of an inquiry, newest first, with their attributes', async () => {
    const { inquiryId, sessionIds } = await inquiryWithSessions(2);

    const list = inquirySessionListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `${BASE}?filter[inquiry-id]=${inquiryId}`,
          headers: bearer(api.token),
        }),
        200,
      ),
    );

    expect(list.data.map((session) => session.id)).toEqual([...sessionIds].reverse());
    expect(list.data[0]).toEqual({
      type: 'inquiry-session',
      id: sessionIds[1],
      attributes: {
        status: 'active',
        'created-at': expect.any(String) as unknown,
        'started-at': null,
        'expires-at': new Date(api.clock.now().getTime() + DAY_MS).toISOString(),
        'ip-address': null,
        'user-agent': null,
        // C42.3, C47: no consent recorded yet.
        consent: null,
        // C91.1 (Workflow 7A): nothing evaluated, parsed or collected yet.
        'is-tor': null,
        'is-datacenter': null,
        'is-vpn': null,
        'is-proxy': null,
        'hosting-asn': null,
        'threat-level': null,
        'country-code': null,
        'country-name': null,
        'region-code': null,
        'region-name': null,
        latitude: null,
        longitude: null,
        'gps-latitude': null,
        'gps-longitude': null,
        'gps-precision': null,
        'gps-country-code': null,
        'ip-connection-type': null,
        'ip-isp': null,
        'network-organization': null,
        'os-name': null,
        'os-full-version': null,
        'browser-name': null,
        'browser-full-version': null,
        'device-type': null,
        'device-name': null,
        'mobile-sdk-name': null,
        'mobile-sdk-full-version': null,
        'signals-collected': [],
        // Workflow 7A (H) (C91.1, C96.4, C96.7): no handoff created the session.
        'device-handoff-method': null,
        'handoff-from-session-id': null,
        'handoff-redeemed-at': null,
        'handoff-rejected-at': null,
        'handoff-distance-meters': null,
        'handoff-country-changed': null,
        'handoff-asn-changed': null,
      },
      relationships: {
        inquiry: { data: { type: 'inquiry', id: inquiryId } },
        device: { data: null },
        network: { data: null },
      },
    });
    expect(list.links.next).toBeNull();
  });

  it('filters by status and pages with page[after]', async () => {
    const { inquiryId, sessionIds } = await inquiryWithSessions(3);
    expectStatus(await expire(sessionIds[0] ?? ''), 200);

    const active = inquirySessionListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `${BASE}?filter[inquiry-id]=${inquiryId}&filter[status]=active&page[size]=1`,
          headers: bearer(api.token),
        }),
        200,
      ),
    );

    expect(active.data.map((session) => session.id)).toEqual([sessionIds[2]]);
    expect(active.links.next).toBe(
      `${BASE}?filter[inquiry-id]=${inquiryId}&filter[status]=active` +
        `&page[after]=${String(sessionIds[2])}&page[size]=1`,
    );
    const next = inquirySessionListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({ url: active.links.next ?? '', headers: bearer(api.token) }),
        200,
      ),
    );
    expect(next.data.map((session) => session.id)).toEqual([sessionIds[1]]);
  });

  it('only lists the caller environment', async () => {
    const tenant = await api.newTenant();
    const { inquiryId } = await inquiryWithSessions(1, tenant);

    const list = inquirySessionListDocumentSchema.parse(
      expectStatus(
        await api.app.inject({
          url: `${BASE}?filter[inquiry-id]=${inquiryId}`,
          headers: bearer(api.token),
        }),
        200,
      ),
    );

    expect(list.data).toEqual([]);
  });

  it('requires inquiry-sessions:read', async () => {
    const response = await api.app.inject({
      url: BASE,
      headers: bearer(api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] })),
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers['www-authenticate']).toContain('scope="inquiry-sessions:read"');
  });
});

describe('GET /api/v1/inquiry-sessions/:id', () => {
  it("shows the first flow call's address and user agent, masked without pii:view", async () => {
    const { sessionIds, tokens } = await inquiryWithSessions(1);
    expectStatus(
      await api.app.inject({
        url: '/api/v1/flow/session',
        headers: { ...bearer(tokens[0] ?? ''), 'user-agent': 'SyntheticBrowser/1.0' },
        remoteAddress: '198.51.100.7',
      }),
      200,
    );
    const id = sessionIds[0] ?? '';

    const visible = inquirySessionDocumentSchema.parse(expectStatus(await get(id), 200));
    const masked = inquirySessionDocumentSchema.parse(
      expectStatus(await get(id, sessionReader()), 200),
    );

    expect(visible.data.attributes).toMatchObject({
      'started-at': api.clock.now().toISOString(),
      'ip-address': '198.51.100.7',
      'user-agent': 'SyntheticBrowser/1.0',
    });
    expect(masked.data.attributes).toMatchObject({
      'started-at': api.clock.now().toISOString(),
      'ip-address': null,
      'user-agent': null,
    });
    const unmasked = api.newUserToken(api.environmentId, {
      permissions: ['inquiry-sessions:read', 'pii:view'],
    });
    expect(expectStatus(await get(id, unmasked), 200).data.attributes['ip-address']).toBe(
      '198.51.100.7',
    );
  });

  it('reports a session past its TTL as expired before the sweep marks it', async () => {
    const { sessionIds } = await inquiryWithSessions(1);
    const issuedAt = api.clock.now();

    api.clock.advance(DAY_MS);
    const response = await get(sessionIds[0] ?? '');
    api.clock.set(issuedAt);

    expect(expectStatus(response, 200).data.attributes.status).toBe('expired');
  });

  it('requires inquiry-sessions:read', async () => {
    const { sessionIds } = await inquiryWithSessions(1);
    const reader = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });

    expect((await get(sessionIds[0] ?? '', reader)).statusCode).toBe(403);
  });

  it('answers 404 for a session of another environment', async () => {
    const tenant = await api.newTenant();
    const { sessionIds } = await inquiryWithSessions(1, tenant);

    const response = await get(sessionIds[0] ?? '');

    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  });
});

describe('POST /api/v1/inquiry-sessions/:id/expire', () => {
  it('expires an active session, emits inquiry-session.expired and audits it', async () => {
    const { inquiryId, sessionIds, tokens } = await inquiryWithSessions(1);
    const id = sessionIds[0] ?? '';
    const userId = newId('usr');

    const document = inquirySessionDocumentSchema.parse(
      expectStatus(await expire(id, api.newUserToken(api.environmentId, { userId })), 200),
    );

    expect(document.data.attributes.status).toBe('expired');
    const events = api.events
      .named('inquiry-session.expired')
      .filter((e) => e.payload.data.id === id);
    expect(events).toHaveLength(1);
    expect(eventPayloadSchema.parse(events[0]?.payload).data).toMatchObject({
      type: 'inquiry-session',
      attributes: { status: 'expired' },
      relationships: { inquiry: { data: { id: inquiryId } } },
    });
    expect(
      api.audit.withAction('inquiry-session.expired').filter((e) => e.resourceId === id),
    ).toEqual([
      expect.objectContaining({
        actor: { type: 'user', id: userId },
        resourceType: 'inquiry-session',
      }),
    ]);
    const flow = await api.app.inject({
      url: '/api/v1/flow/session',
      headers: bearer(tokens[0] ?? ''),
    });
    expect(flow.statusCode).toBe(401);
    expect(flow.json<{ code: string }>().code).toBe('session_expired');
  });

  it('answers 409 invalid-transition for a session that is no longer active', async () => {
    const { sessionIds } = await inquiryWithSessions(1);
    const id = sessionIds[0] ?? '';
    expectStatus(await expire(id), 200);

    const response = await expire(id);

    expect(response.statusCode).toBe(409);
    expect(response.json<{ type: string }>().type).toBe(
      'https://openverify.dev/problems/invalid-transition',
    );
  });

  it('answers 404 across environments and 403 without inquiry-sessions:write', async () => {
    const tenant = await api.newTenant();
    const foreign = (await inquiryWithSessions(1, tenant)).sessionIds[0] ?? '';
    const own = (await inquiryWithSessions(1)).sessionIds[0] ?? '';

    expect((await expire(foreign)).statusCode).toBe(404);
    expect((await expire(own, sessionReader())).statusCode).toBe(403);
  });
});

describe('POST /api/v1/inquiry-sessions/expire-all', () => {
  it('expires every active session of the inquiry and counts them', async () => {
    const { inquiryId, sessionIds } = await inquiryWithSessions(3);
    expectStatus(await expire(sessionIds[0] ?? ''), 200);

    const response = await expireAll(inquiryId);

    expect(expireAllInquirySessionsResponseSchema.parse(expectStatus(response, 200))).toEqual({
      meta: { 'expired-count': 2 },
    });
    const expired = api.events
      .named('inquiry-session.expired')
      .map((event) => event.payload.data.id)
      .filter((id) => sessionIds.includes(id));
    expect(expired.sort()).toEqual([...sessionIds].sort());
    expect(
      expireAllInquirySessionsResponseSchema.parse(expectStatus(await expireAll(inquiryId), 200)),
    ).toEqual({ meta: { 'expired-count': 0 } });
  });

  it('answers 404 for an inquiry of another environment, expiring nothing', async () => {
    const tenant = await api.newTenant();
    const { inquiryId, tokens } = await inquiryWithSessions(1, tenant);

    expect((await expireAll(inquiryId)).statusCode).toBe(404);
    expect(
      (await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(tokens[0] ?? '') }))
        .statusCode,
    ).toBe(200);
  });

  it('requires inquiry-sessions:write and a meta inquiry-id', async () => {
    const { inquiryId } = await inquiryWithSessions(1);

    expect((await expireAll(inquiryId, sessionReader())).statusCode).toBe(403);
    expect(
      (
        await api.app.inject({
          method: 'POST',
          url: `${BASE}/expire-all`,
          headers: bearer(api.token),
          payload: { meta: {} },
        })
      ).statusCode,
    ).toBe(400);
  });
});
