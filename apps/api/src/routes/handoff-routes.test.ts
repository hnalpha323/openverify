/**
 * Workflow 7A Stage 1b (H) (C96.3, C107.3; F01, F13, F30, V04): the frozen flow handoff routes,
 * registered with their contract schemas (built by `flow-handoff` in Stage 3, whose own tests cover
 * their answers; each answers 501 until then), and the shared plumbing around them:
 *
 * - `POST /flow/handoffs`, `/continue-here`, `GET /flow/handoffs/current` and
 *   `POST /flow/handoffs/current/reject` take the session token; `POST /flow/handoffs` is counted
 *   under `flow-handoffs` per session and `flow-handoffs-ip` per address.
 * - `POST /flow/handoffs/preview`, `/decline` and `/redeem` take no token (the `ovh_` token in the
 *   body is the credential) and are counted under `one-time-link-redeem` per address.
 * - `GET /flow/session` serves `handoff` and `handoff-context` from `flowSessionHandoffOf`.
 * - `assertSessionNotHandedOff`: while `isSessionHandedOff` says so, every non-GET flow route of
 *   the session answers 409 `session_handed_off`, except the handoff routes; a test walks every
 *   flow route of the OpenAPI document.
 *
 * `flow-handoff`'s builder and check are replaced here by switchable spies. Synthetic values only.
 */
import { newHandoffToken } from '@openverify/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowSessionHandoffContext } from '../services/handoff/flow-session.js';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { bearer, expectStatus, openFlowSession } from '../test-support/harness.js';

const control = vi.hoisted(() => ({
  handedOff: false,
  serve: false,
  guarded: [] as string[],
  built: [] as { stepTypes: string[]; sessionId: string }[],
}));

vi.mock('../services/handoff/guard.js', () => ({
  isSessionHandedOff: (_db: unknown, session: { id: string }) => {
    control.guarded.push(session.id);
    return Promise.resolve(control.handedOff);
  },
}));

vi.mock('../services/handoff/flow-session.js', () => ({
  flowSessionHandoffOf: (context: FlowSessionHandoffContext) => {
    control.built.push({
      stepTypes: context.flow.steps.map((step) => step.type),
      sessionId: context.session.id,
    });
    return Promise.resolve(
      control.serve
        ? {
            handoff: { 'step-id': 'device_handoff', state: 'pending' },
            handoffContext: {
              'organization-display-name': 'Example Verification Ltd',
              steps: ['selfie'],
              'started-at': '2026-10-20T12:00:00.000Z',
              'issuing-country-code': null,
              attribution: null,
            },
          }
        : { handoff: null, handoffContext: null },
    );
  },
}));

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(() => {
  control.handedOff = false;
  control.serve = false;
  control.guarded.length = 0;
  control.built.length = 0;
});

const FLOW = '/api/v1/flow';
const TOKEN_BODY = () => ({
  'inquiry-id': 'inq_01M5CK16P0D13FXHZSS4TCFBVH',
  'handoff-token': newHandoffToken(),
});

const post = (url: string, payload: unknown, token?: string) =>
  api.app.inject({
    method: 'POST',
    url: `${FLOW}${url}`,
    ...(token === undefined ? {} : { headers: bearer(token) }),
    payload: payload as Record<string, unknown>,
  });

function policiesSince(before: number) {
  return api.rateLimiter.calls.slice(before).map((call) => ({
    name: call.policy.name,
    key: call.key,
    limit: call.policy.limit,
    windowSeconds: call.policy.windowSeconds,
  }));
}

describe('the session handoff routes (C96.3)', () => {
  it('take the session token and answer as built by flow-handoff: a flow without the step has none waiting', async () => {
    const { sessionToken } = await openFlowSession(api);
    const code = (response: { statusCode: number; json: () => unknown }) => [
      response.statusCode,
      (response.json() as { code?: string }).code,
    ];

    expect(code(await post('/handoffs', { method: 'qr' }, sessionToken))).toEqual([
      409,
      'handoff_not_available',
    ]);
    expect(code(await post('/handoffs/continue-here', {}, sessionToken))).toEqual([
      409,
      'handoff_not_available',
    ]);
    expect(code(await post('/handoffs/current/reject', {}, sessionToken))).toEqual([
      409,
      'handoff_not_redeemed',
    ]);
    expect(
      code(
        await api.app.inject({
          url: `${FLOW}/handoffs/current`,
          headers: bearer(sessionToken),
        }),
      ),
    ).toEqual([409, 'handoff_not_available']);
    expect((await post('/handoffs', { method: 'qr' })).statusCode).toBe(401);
    expect((await api.app.inject({ url: `${FLOW}/handoffs/current` })).statusCode).toBe(401);
  });

  it('refuses a body the contract refuses: a QR handoff names no destination', async () => {
    const { sessionToken } = await openFlowSession(api);

    expect(
      (await post('/handoffs', { method: 'qr', destination: 'person@example.test' }, sessionToken))
        .statusCode,
    ).toBe(400);
    expect((await post('/handoffs', { method: 'email' }, sessionToken)).statusCode).toBe(400);
  });

  it('counts an issue under flow-handoffs per session and flow-handoffs-ip per address (C107.3)', async () => {
    const { sessionToken } = await openFlowSession(api);
    const before = api.rateLimiter.calls.length;

    await post('/handoffs', { method: 'qr' }, sessionToken);

    const applied = policiesSince(before);
    expect(applied).toContainEqual({
      name: 'flow-handoffs',
      key: expect.stringMatching(/^iqse_/) as unknown,
      limit: 5,
      windowSeconds: 3600,
    });
    expect(applied).toContainEqual({
      name: 'flow-handoffs-ip',
      key: '127.0.0.1',
      limit: 10,
      windowSeconds: 3600,
    });
  });

  it('counts no issue for continue-here, the current state or a rejection', async () => {
    const { sessionToken } = await openFlowSession(api);
    const before = api.rateLimiter.calls.length;

    await post('/handoffs/continue-here', {}, sessionToken);
    await post('/handoffs/current/reject', {}, sessionToken);
    await api.app.inject({ url: `${FLOW}/handoffs/current`, headers: bearer(sessionToken) });

    const names = policiesSince(before).map((call) => call.name);
    expect(names).not.toContain('flow-handoffs');
    expect(names).not.toContain('flow-handoffs-ip');
  });
});

describe("the phone's handoff routes (C96.3, P15, V04)", () => {
  it.each(['preview', 'decline', 'redeem'])(
    '%s takes no session token, answers an unknown token with the uniform 410, and is counted under one-time-link-redeem',
    async (route) => {
      const before = api.rateLimiter.calls.length;

      const response = await post(`/handoffs/${route}`, TOKEN_BODY());
      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({ code: 'handoff_token_invalid' });
      expect(policiesSince(before)).toContainEqual({
        name: 'one-time-link-redeem',
        key: '127.0.0.1',
        limit: 30,
        windowSeconds: 60,
      });
    },
  );

  it.each(['preview', 'decline', 'redeem'])(
    '%s refuses a body without a well-formed token (400)',
    async (route) => {
      expect(
        (await post(`/handoffs/${route}`, { ...TOKEN_BODY(), 'handoff-token': 'ovh_short' }))
          .statusCode,
      ).toBe(400);
    },
  );
});

describe('GET /flow/session: handoff and handoff-context (C96.3, F01, F30)', () => {
  it('serves both from flowSessionHandoffOf, given the pinned flow and the session', async () => {
    const { sessionToken } = await openFlowSession(api);
    const read = async () =>
      expectStatus(
        await api.app.inject({ url: `${FLOW}/session`, headers: bearer(sessionToken) }),
        200,
      ) as unknown as Record<string, unknown>;

    expect(await read()).toMatchObject({ handoff: null, 'handoff-context': null });
    control.serve = true;
    expect(await read()).toMatchObject({
      handoff: { 'step-id': 'device_handoff', state: 'pending' },
      'handoff-context': { 'organization-display-name': 'Example Verification Ltd' },
    });
    expect(control.built.at(-1)).toMatchObject({
      stepTypes: expect.arrayContaining(['consent', 'selfie']) as unknown,
      sessionId: expect.stringMatching(/^iqse_/) as unknown,
    });
  });
});

describe('assertSessionNotHandedOff (C96.3, F13)', () => {
  const ID = 'ver_01M5CK16P0D13FXHZSS4TCFBVH';
  const PUBLIC = new Set([
    'POST /api/v1/flow/one-time-links/redeem',
    'POST /api/v1/flow/handoffs/preview',
    'POST /api/v1/flow/handoffs/decline',
    'POST /api/v1/flow/handoffs/redeem',
  ]);

  async function flowRoutes(): Promise<{ method: string; path: string }[]> {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, unknown>>;
    }>();
    return Object.entries(document.paths)
      .filter(([path]) => path.startsWith(`${FLOW}/`))
      .flatMap(([path, operations]) =>
        Object.keys(operations).map((method) => ({ method: method.toUpperCase(), path })),
      );
  }

  const call = (route: { method: string; path: string }, token: string) =>
    api.app.inject({
      method: route.method as 'GET' | 'POST',
      url: route.path.replace(/\{[^}]+\}/g, ID),
      headers: bearer(token),
      ...(route.method === 'GET' ? {} : { payload: {} }),
    });

  it('refuses every non-GET flow route of a handed-off session with 409 session_handed_off, except the handoff routes', async () => {
    const { sessionToken } = await openFlowSession(api);
    expectStatus(
      await api.app.inject({ url: `${FLOW}/session`, headers: bearer(sessionToken) }),
      200,
    );
    control.handedOff = true;
    const routes = (await flowRoutes()).filter(
      (route) => !PUBLIC.has(`${route.method} ${route.path}`),
    );
    const writes = routes.filter(
      (route) => route.method !== 'GET' && !route.path.startsWith(`${FLOW}/handoffs`),
    );
    expect(writes.map((route) => route.path)).toEqual(
      expect.arrayContaining([
        `${FLOW}/consent`,
        `${FLOW}/verifications`,
        `${FLOW}/verifications/{id}/files`,
        `${FLOW}/signals`,
      ]),
    );

    for (const route of writes) {
      const response = await call(route, sessionToken);
      expect(response.statusCode, `${route.method} ${route.path}`).toBe(409);
      expect(response.json(), `${route.method} ${route.path}`).toMatchObject({
        code: 'session_handed_off',
      });
    }
    for (const route of routes.filter((each) => each.path.startsWith(`${FLOW}/handoffs`))) {
      // Built by flow-handoff, the handoff routes answer their own codes (a flow without the step
      // has none waiting, 409 handoff_not_available), never the lock's.
      expect((await call(route, sessionToken)).json(), route.path).not.toMatchObject({
        code: 'session_handed_off',
      });
    }
    expect(
      (await api.app.inject({ url: `${FLOW}/session`, headers: bearer(sessionToken) })).statusCode,
    ).toBe(200);
    expect(control.guarded.length).toBeGreaterThanOrEqual(writes.length);
  });

  it('lets every route through while the session is not handed off', async () => {
    const { sessionToken } = await openFlowSession(api);

    const response = await post('/consent', {}, sessionToken);

    expect(response.statusCode).toBe(400);
    expect(control.guarded).toHaveLength(1);
  });
});
