/**
 * Workflow 7A Stage 1b (S) (C91.2, C91.5, C94.2, C94.6, C107.3; F28): the frozen routes of the
 * signals family, registered with their contract schemas and scopes (built by `api-signals` in
 * Stage 3, whose own tests cover their answers), and in the OpenAPI document:
 *
 * - `GET /api/v1/devices` and `GET /api/v1/devices/:id` (scope `inquiry-sessions:read`);
 * - `POST /api/v1/flow/signals` (session authentication, a body cap of 8 KiB, the C12 policy
 *   `flow-signals` per session);
 * - `POST /api/v1/inquiry-sessions/expire-all` with `meta.inquiry-ids`, beside `meta.inquiry-id`;
 * - `POST /api/v1/inquiry-sessions/:id/generate-one-time-link` (scope `inquiries:write`).
 *
 * `GET /api/v1/flow/session` serves its `signals` member (`null` until the session may collect).
 */
import { FLOW_SIGNALS_MAX_BODY_BYTES } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { bearer, createInquiry, expectStatus, openFlowSession } from '../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const BODY = {
  platform: 'web',
  'collector-version': 1,
  screen: 'consent',
  sequence: 0,
};

const signals = (token: string, payload: unknown) =>
  api.app.inject({
    method: 'POST',
    url: '/api/v1/flow/signals',
    headers: bearer(token),
    payload: payload as Record<string, unknown>,
  });

describe('the device routes (C91.2)', () => {
  it('are registered under inquiry-sessions:read', async () => {
    const id = 'dev_01M5CK16P0D13FXHZSS4TCFBVH';
    const session = 'iqse_01M5CK16P0D13FXHZSS4TCFBVH';

    expect(
      (
        await api.app.inject({
          url: `/api/v1/devices?filter[inquiry-session-id]=${session}`,
          headers: bearer(api.token),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await api.app.inject({ url: `/api/v1/devices/${id}`, headers: bearer(api.token) }))
        .statusCode,
    ).toBe(404);
    expect((await api.app.inject({ url: `/api/v1/devices/${id}` })).statusCode).toBe(401);
    const noScope = api.newUserToken(api.environmentId, { permissions: ['inquiries:read'] });
    expect(
      (await api.app.inject({ url: `/api/v1/devices/${id}`, headers: bearer(noScope) })).statusCode,
    ).toBe(403);
    expect(
      (
        await api.app.inject({
          url: '/api/v1/devices/inq_01M5CK16P0D13FXHZSS4TCFBVH',
          headers: bearer(api.token),
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('POST /api/v1/flow/signals (C94.2)', () => {
  it('takes a valid body under session authentication (409 consent_required before consent)', async () => {
    const { sessionToken } = await openFlowSession(api);

    expect((await signals(sessionToken, BODY)).statusCode).toBe(409);
    expect(
      (await api.app.inject({ method: 'POST', url: '/api/v1/flow/signals', payload: BODY }))
        .statusCode,
    ).toBe(401);
  });

  it('refuses a body the contract refuses (400) and one over 8 KiB (413)', async () => {
    const { sessionToken } = await openFlowSession(api);

    expect((await signals(sessionToken, { ...BODY, keystrokes: 'abc' })).statusCode).toBe(400);
    expect(
      (await signals(sessionToken, { ...BODY, padding: 'x'.repeat(FLOW_SIGNALS_MAX_BODY_BYTES) }))
        .statusCode,
    ).toBe(413);
  });

  it('counts each body under the flow-signals policy, per session', async () => {
    const { sessionToken } = await openFlowSession(api);
    const before = api.rateLimiter.calls.length;

    await signals(sessionToken, BODY);

    const calls = api.rateLimiter.calls.slice(before).map((call) => call.policy.name);
    expect(calls).toContain('flow-signals');
    const rule = api.rateLimiter.calls
      .slice(before)
      .find((call) => call.policy.name === 'flow-signals');
    expect(rule?.key).toMatch(/^iqse_/);
    expect(rule?.policy).toMatchObject({ limit: 60, windowSeconds: 60 });
  });
});

describe('GET /api/v1/flow/session: the signals member (C94.6)', () => {
  it('is served, null until the session may collect', async () => {
    const { sessionToken } = await openFlowSession(api);

    const body = expectStatus(
      await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(sessionToken) }),
      200,
    ) as unknown as Record<string, unknown>;

    expect(body).toHaveProperty('signals', null);
  });
});

describe('the session routes of C91.5', () => {
  it('takes meta.inquiry-ids on expire-all and keeps meta.inquiry-id', async () => {
    const inquiryId = await createInquiry(api, {});
    const call = (meta: Record<string, unknown>) =>
      api.app.inject({
        method: 'POST',
        url: '/api/v1/inquiry-sessions/expire-all',
        headers: bearer(api.token),
        payload: { meta },
      });

    expect(expectStatus(await call({ 'inquiry-ids': [inquiryId] }), 200)).toEqual({
      meta: { 'expired-count': 0 },
    });
    expect((await call({ 'inquiry-ids': [] })).statusCode).toBe(400);
    expect((await call({ 'inquiry-ids': [inquiryId, inquiryId] })).statusCode).toBe(400);
    expect((await call({ 'inquiry-id': inquiryId, 'inquiry-ids': [inquiryId] })).statusCode).toBe(
      400,
    );
    expect(expectStatus(await call({ 'inquiry-id': inquiryId }), 200)).toEqual({
      meta: { 'expired-count': 0 },
    });
  });

  it('registers generate-one-time-link on a session under inquiries:write', async () => {
    const id = 'iqse_01M5CK16P0D13FXHZSS4TCFBVH';
    const url = `/api/v1/inquiry-sessions/${id}/generate-one-time-link`;

    expect(
      (await api.app.inject({ method: 'POST', url, headers: bearer(api.token) })).statusCode,
    ).toBe(404);
    const reader = api.newUserToken(api.environmentId, { permissions: ['inquiry-sessions:read'] });
    expect(
      (await api.app.inject({ method: 'POST', url, headers: bearer(reader) })).statusCode,
    ).toBe(403);
  });
});

describe('the OpenAPI document (C107.3)', () => {
  it('lists every frozen path', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, unknown>>;
    }>();

    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/devices',
        '/api/v1/devices/{id}',
        '/api/v1/flow/signals',
        '/api/v1/inquiry-sessions/{id}/generate-one-time-link',
      ]),
    );
  });
});
