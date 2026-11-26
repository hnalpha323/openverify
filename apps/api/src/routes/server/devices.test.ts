/**
 * Workflow 7A Stage 3 (`api-signals`; C91.2, C91.6, C107.5): the device routes and the device's
 * masking at every exit.
 *
 * - `GET /api/v1/devices` needs `filter[inquiry-session-id]` (400 `filter_required`) and lists the
 *   session's device; `GET /api/v1/devices/:id` fetches one; both under `inquiry-sessions:read`,
 *   both within the caller's environment.
 * - Both fingerprints are PII: `null` without `pii:view` on the resource, the list, a session's
 *   `included` and the stored API logs; the device class (a model-level HMAC) is not. Webhook
 *   payloads carry them unmasked, as every payload does (C15).
 *
 * Every HMAC is random hex; every key id synthetic.
 */
import {
  apiLogDocumentSchema,
  deviceDocumentSchema,
  deviceListDocumentSchema,
  inquirySessionIncludeDocumentSchema,
} from '@openverify/contracts';
import { createApiLog } from '@openverify/db';
import { seedDevice, testId } from '@openverify/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, expectStatus, openFlowSession } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const get = (url: string, token = api.token) =>
  api.app.inject({ method: 'GET', url, headers: bearer(token) });

/** A started session of a new inquiry in the harness's environment,. */
async function sessionWithDevice(token = api.token, environmentId = api.environmentId) {
  const { inquiryId, sessionToken } = await openFlowSession(api, { token });
  expectStatus(
    await api.app.inject({
      method: 'GET',
      url: '/api/v1/flow/session',
      headers: bearer(sessionToken),
    }),
    200,
  );
  const sessions = expectStatus(
    await get(`/api/v1/inquiry-sessions?filter[inquiry-id]=${inquiryId}`, token),
    200,
  ) as unknown as { data: { id: string }[] };
  const sessionId = sessions.data[0]?.id ?? '';
  const device = await seedDevice(api.database.db, environmentId, { sessionIds: [sessionId] });
  return { inquiryId, sessionId, device };
}

describe('GET /api/v1/devices (C91.2)', () => {
  it('refuses a request without filter[inquiry-session-id] with 400 filter_required', async () => {
    const response = await get('/api/v1/devices');
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe('filter_required');
  });

  it('lists the session’s device, unmasked for a principal with pii:view', async () => {
    const { sessionId, device } = await sessionWithDevice();
    const document = deviceListDocumentSchema.parse(
      expectStatus(await get(`/api/v1/devices?filter[inquiry-session-id]=${sessionId}`), 200),
    );
    expect(document.links).toEqual({ next: null });
    expect(document.data).toHaveLength(1);
    expect(document.data[0]?.attributes).toMatchObject({
      platform: 'web',
      'browser-fingerprint': device.browserFingerprint,
      'device-class': device.deviceClass,
      'device-fingerprint': null,
      'device-vendor-id': null,
      'key-id': 'AAAAAAAAAAA',
      'session-count': 1,
      'fingerprint-randomised': false,
    });
  });

  it('lists nothing for a session without a device, or of another environment', async () => {
    const { sessionId } = await sessionWithDevice();
    const bare = await openFlowSession(api);
    const sessions = expectStatus(
      await get(`/api/v1/inquiry-sessions?filter[inquiry-id]=${bare.inquiryId}`),
      200,
    ) as unknown as { data: { id: string }[] };
    expect(
      deviceListDocumentSchema.parse(
        expectStatus(
          await get(`/api/v1/devices?filter[inquiry-session-id]=${sessions.data[0]?.id ?? ''}`),
          200,
        ),
      ).data,
    ).toEqual([]);
    const other = await api.newTenant();
    expect(
      deviceListDocumentSchema.parse(
        expectStatus(
          await get(`/api/v1/devices?filter[inquiry-session-id]=${sessionId}`, other.token),
          200,
        ),
      ).data,
    ).toEqual([]);
  });

  it('answers 403 without inquiry-sessions:read', async () => {
    const token = await api.newApiKey(api.environmentId, { scopes: ['inquiries:read'] });
    const response = await get(
      `/api/v1/devices?filter[inquiry-session-id]=${testId('iqse')}`,
      token,
    );
    expect(response.statusCode).toBe(403);
  });
});

describe('GET /api/v1/devices/:id (C91.2)', () => {
  it('fetches the device, and answers 404 in another environment and for an unknown id', async () => {
    const { sessionId } = await sessionWithDevice();
    const listed = deviceListDocumentSchema.parse(
      expectStatus(await get(`/api/v1/devices?filter[inquiry-session-id]=${sessionId}`), 200),
    );
    const id = listed.data[0]?.id ?? '';
    const document = deviceDocumentSchema.parse(
      expectStatus(await get(`/api/v1/devices/${id}`), 200),
    );
    expect(document.data).toEqual(listed.data[0]);
    const other = await api.newTenant();
    expect((await get(`/api/v1/devices/${id}`, other.token)).statusCode).toBe(404);
    expect((await get(`/api/v1/devices/${testId('dev')}`)).statusCode).toBe(404);
  });
});

describe('device masking at every exit (C91.6, C107.5)', () => {
  const masked = () =>
    api.newUserToken(api.environmentId, { permissions: ['inquiry-sessions:read'] });

  it('nulls both fingerprints without pii:view on the resource and the list, keeping the class', async () => {
    const { sessionId, device } = await sessionWithDevice();
    const token = masked();
    const listed = deviceListDocumentSchema.parse(
      expectStatus(
        await get(`/api/v1/devices?filter[inquiry-session-id]=${sessionId}`, token),
        200,
      ),
    );
    expect(listed.data[0]?.attributes).toMatchObject({
      'browser-fingerprint': null,
      'device-fingerprint': null,
      'device-class': device.deviceClass,
    });
    const fetched = deviceDocumentSchema.parse(
      expectStatus(await get(`/api/v1/devices/${listed.data[0]?.id ?? ''}`, token), 200),
    );
    expect(fetched.data.attributes['browser-fingerprint']).toBeNull();
    expect(JSON.stringify([listed, fetched])).not.toContain(device.browserFingerprint ?? '-');
  });

  it('nulls them in a session’s included device without pii:view', async () => {
    const { sessionId, device } = await sessionWithDevice();
    const document = inquirySessionIncludeDocumentSchema.parse(
      expectStatus(
        await get(`/api/v1/inquiry-sessions/${sessionId}?include=device`, masked()),
        200,
      ),
    );
    expect(document.included?.[0]?.attributes).toMatchObject({ 'browser-fingerprint': null });
    expect(JSON.stringify(document)).not.toContain(device.browserFingerprint ?? '-');
  });

  it('nulls them in the stored API log of a device route read without pii:view', async () => {
    const { device } = await sessionWithDevice();
    const logId = testId('alog');
    await createApiLog(api.database.db, api.environmentId, {
      id: logId,
      method: 'GET',
      path: '/api/v1/devices/dev_x',
      route: '/api/v1/devices/:id',
      status: 200,
      durationMs: 3,
      requestId: 'req-device-1',
      idempotencyKey: null,
      apiKeyId: testId('key'),
      ip: '203.0.113.5',
      userAgent: 'SeedClient/1.0',
      query: {},
      requestBody: null,
      responseBody: {
        data: {
          type: 'device',
          id: testId('dev'),
          attributes: {
            'browser-fingerprint': device.browserFingerprint,
            'device-fingerprint': null,
            'device-class': device.deviceClass,
          },
        },
      },
    });
    const token = api.newUserToken(api.environmentId, { permissions: ['api-logs:read'] });
    const document = apiLogDocumentSchema.parse(
      expectStatus(await get(`/api/v1/api-logs/${logId}`, token), 200),
    );
    expect(JSON.stringify(document)).not.toContain(device.browserFingerprint ?? '-');
    const unmasked = api.newUserToken(api.environmentId, {
      permissions: ['api-logs:read', 'pii:view'],
    });
    expect(
      JSON.stringify(expectStatus(await get(`/api/v1/api-logs/${logId}`, unmasked), 200)),
    ).toContain(device.browserFingerprint ?? '-');
  });
});
