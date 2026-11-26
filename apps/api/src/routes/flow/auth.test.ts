import { eventPayloadSchema, problemSchema } from '@openverify/contracts';
import { cancelInquirySessions, revokeInquirySessions } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import {
  bearer,
  createInquiry,
  expectStatus,
  FLOW_ORIGIN,
  openFlowSession,
  PROBLEM_JSON,
  seedVerification,
} from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const SESSION = '/api/v1/flow/session';

describe('flow session token authentication', () => {
  it('accepts a session token from resume', async () => {
    const { sessionToken } = await openFlowSession(api);

    const response = await api.app.inject({ url: SESSION, headers: bearer(sessionToken) });

    expect(response.statusCode).toBe(200);
  });

  it('rejects a request without a token with a Bearer challenge', async () => {
    const response = await api.app.inject({ url: SESSION });

    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.headers['www-authenticate']).toBe('Bearer realm="openverify"');
  });

  it.each([
    ['a malformed token', 'ovs_short'],
    ['an unknown token', `ovs_${'A'.repeat(43)}`],
    ['a user session token', `ovu_${'A'.repeat(43)}`],
  ])('rejects %s', async (_label, token) => {
    const response = await api.app.inject({ url: SESSION, headers: bearer(token) });

    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('rejects an API key: the flow API only takes session tokens', async () => {
    const response = await api.app.inject({ url: SESSION, headers: bearer(api.token) });

    expect(response.statusCode).toBe(401);
  });

  it('does not accept a session token on the server API', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);

    const response = await api.app.inject({
      url: `/api/v1/inquiries/${inquiryId}`,
      headers: bearer(sessionToken),
    });

    expect(response.statusCode).toBe(401);
  });

  it('expires the token 24 hours after resume', async () => {
    const { sessionToken } = await openFlowSession(api);
    const issuedAt = api.clock.now();

    api.clock.advance(24 * 60 * 60 * 1000);
    const response = await api.app.inject({ url: SESSION, headers: bearer(sessionToken) });
    api.clock.set(issuedAt);

    expect(response.statusCode).toBe(401);
  });

  it('rejects a revoked session', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await revokeInquirySessions(api.database.db, api.environmentId, inquiryId);

    const response = await api.app.inject({ url: SESSION, headers: bearer(sessionToken) });

    expect(response.statusCode).toBe(401);
  });

  it('binds the token to its inquiry: another inquiry verification answers 404', async () => {
    const { sessionToken } = await openFlowSession(api);
    const otherInquiry = await createInquiry(api);
    const foreign = await seedVerification(api, api.environmentId, otherInquiry);

    const response = await api.app.inject({
      url: `/api/v1/flow/verifications/${foreign.id}`,
      headers: bearer(sessionToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it('binds the token to its environment', async () => {
    const other = await api.newTenant();
    const otherInquiry = await createInquiry(api, { token: other.token });
    const foreign = await seedVerification(api, other.environmentId, otherInquiry);
    const { sessionToken } = await openFlowSession(api);

    const response = await api.app.inject({
      url: `/api/v1/flow/verifications/${foreign.id}`,
      headers: bearer(sessionToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it('marks every flow response no-store, errors included', async () => {
    const { sessionToken } = await openFlowSession(api);

    const ok = await api.app.inject({ url: SESSION, headers: bearer(sessionToken) });
    const denied = await api.app.inject({ url: SESSION });

    expect(ok.headers['cache-control']).toBe('no-store');
    expect(denied.headers['cache-control']).toBe('no-store');
  });
});

describe('inactive sessions (C10)', () => {
  const simulate = (inquiryId: string, types: string[]) =>
    api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiries/${inquiryId}/perform-simulate-actions`,
      headers: bearer(api.token),
      payload: { meta: { actions: types.map((type) => ({ type })) } },
    });

  function expectInactive(response: Awaited<ReturnType<typeof api.app.inject>>, code: string) {
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
    expect(response.json<{ code: string }>().code).toBe(code);
  }

  it('answers session_expired once the TTL has passed', async () => {
    const { sessionToken } = await openFlowSession(api);
    const issuedAt = api.clock.now();

    api.clock.advance(24 * 60 * 60 * 1000);
    const response = await api.app.inject({ url: SESSION, headers: bearer(sessionToken) });
    api.clock.set(issuedAt);

    expectInactive(response, 'session_expired');
  });

  it('answers session_canceled once the inquiry expired', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    expectStatus(await simulate(inquiryId, ['expire_inquiry']), 200);

    expectInactive(
      await api.app.inject({ url: SESSION, headers: bearer(sessionToken) }),
      'session_canceled',
    );
  });

  it('answers session_canceled for a revoked session', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    await revokeInquirySessions(api.database.db, api.environmentId, inquiryId);

    expectInactive(
      await api.app.inject({ url: SESSION, headers: bearer(sessionToken) }),
      'session_canceled',
    );
  });

  it('refuses a session revoked before Phase 2 tracked cancellation times', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    expectStatus(await simulate(inquiryId, ['start_inquiry', 'complete_inquiry']), 200);
    await api.database.client.query(
      `update inquiry_sessions set status = 'active', canceled_at = null, revoked_at = now()
        where inquiry_id = $1`,
      [inquiryId],
    );

    expectInactive(
      await api.app.inject({ url: SESSION, headers: bearer(sessionToken) }),
      'session_canceled',
    );
  });

  it('lets a session canceled by its finished inquiry read the outcome for 15 minutes', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    const verification = await seedVerification(api, api.environmentId, inquiryId, {
      status: 'submitted',
    });
    expectStatus(await simulate(inquiryId, ['start_inquiry', 'complete_inquiry']), 200);
    const canceledAt = api.clock.now();

    const session = await api.app.inject({ url: SESSION, headers: bearer(sessionToken) });
    expect(expectStatus(session, 200)).toMatchObject({ inquiry: { status: 'completed' } });
    expectStatus(
      await api.app.inject({
        url: `/api/v1/flow/verifications/${verification.id}`,
        headers: bearer(sessionToken),
      }),
      200,
    );
    expectInactive(
      await api.app.inject({
        method: 'POST',
        url: '/api/v1/flow/verifications',
        headers: bearer(sessionToken),
        payload: { type: 'selfie' },
      }),
      'session_canceled',
    );

    api.clock.advance(15 * 60 * 1000);
    const later = await api.app.inject({ url: SESSION, headers: bearer(sessionToken) });
    api.clock.set(canceledAt);
    expectInactive(later, 'session_canceled');
  });
});

describe('why a session was canceled (C25.8, Workflow 2E)', () => {
  const simulate = (inquiryId: string, types: string[]) =>
    api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiries/${inquiryId}/perform-simulate-actions`,
      headers: bearer(api.token),
      payload: { meta: { actions: types.map((type) => ({ type })) } },
    });
  const write = (sessionToken: string) =>
    api.app.inject({
      method: 'POST',
      url: '/api/v1/flow/verifications',
      headers: bearer(sessionToken),
      payload: { type: 'selfie' },
    });

  function expectCanceled(response: Awaited<ReturnType<typeof api.app.inject>>, reason: string) {
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(problemSchema.parse(response.json())).toMatchObject({
      code: 'session_canceled',
      reason,
    });
  }

  it('answers inquiry_expired when the inquiry expired', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    expectStatus(await simulate(inquiryId, ['expire_inquiry']), 200);

    expectCanceled(
      await api.app.inject({ url: SESSION, headers: bearer(sessionToken) }),
      'inquiry_expired',
    );
  });

  it('answers inquiry_finished when the inquiry was completed or decided', async () => {
    const completed = await openFlowSession(api);
    const approved = await openFlowSession(api);
    expectStatus(await simulate(completed.inquiryId, ['start_inquiry', 'complete_inquiry']), 200);
    expectStatus(
      await simulate(approved.inquiryId, ['start_inquiry', 'complete_inquiry', 'approve_inquiry']),
      200,
    );

    expectCanceled(await write(completed.sessionToken), 'inquiry_finished');
    expectCanceled(await write(approved.sessionToken), 'inquiry_finished');
    const finishedAt = api.clock.now();
    api.clock.advance(15 * 60 * 1000);
    const later = await api.app.inject({ url: SESSION, headers: bearer(completed.sessionToken) });
    api.clock.set(finishedAt);
    expectCanceled(later, 'inquiry_finished');
  });

  it('answers inquiry_redacted when the inquiry was redacted, whatever its status', async () => {
    const open = await openFlowSession(api);
    const finished = await openFlowSession(api);
    expectStatus(await simulate(finished.inquiryId, ['start_inquiry', 'fail_inquiry']), 200);
    for (const { inquiryId } of [open, finished]) {
      await cancelInquirySessions(api.database.db, api.environmentId, inquiryId, api.clock.now());
      await api.database.client.query('update inquiries set redacted_at = now() where id = $1', [
        inquiryId,
      ]);
    }

    expectCanceled(
      await api.app.inject({ url: SESSION, headers: bearer(open.sessionToken) }),
      'inquiry_redacted',
    );
    expectCanceled(await write(finished.sessionToken), 'inquiry_redacted');
  });

  it('gives session_expired no reason', async () => {
    const { sessionToken } = await openFlowSession(api);
    const issuedAt = api.clock.now();

    api.clock.advance(24 * 60 * 60 * 1000);
    const response = await api.app.inject({ url: SESSION, headers: bearer(sessionToken) });
    api.clock.set(issuedAt);

    const problem = problemSchema.parse(response.json());
    expect(problem.code).toBe('session_expired');
    expect(problem).not.toHaveProperty('reason');
  });
});

describe('session start (C10 inquiry-session.started)', () => {
  it("records the first call's time, address and user agent and emits the event once", async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    const call = () =>
      api.app.inject({
        url: SESSION,
        headers: { ...bearer(sessionToken), 'user-agent': 'SyntheticBrowser/2.0' },
        remoteAddress: '192.0.2.10',
      });

    expectStatus(await call(), 200);
    expectStatus(await call(), 200);

    const started = api.events.named('inquiry-session.started').filter((event) => {
      const { data } = event.payload;
      return data.type === 'inquiry-session' && data.relationships.inquiry.data.id === inquiryId;
    });
    expect(started).toHaveLength(1);
    expect(eventPayloadSchema.parse(started[0]?.payload).data).toMatchObject({
      type: 'inquiry-session',
      attributes: {
        status: 'active',
        'started-at': api.clock.now().toISOString(),
        'ip-address': '192.0.2.10',
        'user-agent': 'SyntheticBrowser/2.0',
      },
    });
    const { rows } = await api.database.client.query<Record<string, unknown>>(
      'select * from inquiry_sessions where inquiry_id = $1',
      [inquiryId],
    );
    expect(JSON.stringify(rows)).not.toContain('SyntheticBrowser/2.0');
    expect(JSON.stringify(rows)).not.toContain('192.0.2.10');
  });

  it('does not start a session that is refused', async () => {
    const { inquiryId, sessionToken } = await openFlowSession(api);
    expectStatus(await simulate(inquiryId, ['expire_inquiry']), 200);

    await api.app.inject({ url: SESSION, headers: bearer(sessionToken) });

    const { rows } = await api.database.client.query<{ started: boolean }>(
      'select started_at is not null as started from inquiry_sessions where inquiry_id = $1',
      [inquiryId],
    );
    expect(rows).toEqual([{ started: false }]);
  });

  function simulate(inquiryId: string, types: string[]) {
    return api.app.inject({
      method: 'POST',
      url: `/api/v1/inquiries/${inquiryId}/perform-simulate-actions`,
      headers: bearer(api.token),
      payload: { meta: { actions: types.map((type) => ({ type })) } },
    });
  }
});

describe('CORS', () => {
  const preflight = (origin: string, url = SESSION) =>
    api.app.inject({
      method: 'OPTIONS',
      url,
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });

  it('answers a preflight from the flow origin without credentials', async () => {
    const response = await preflight(FLOW_ORIGIN);

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(FLOW_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toBe('GET, POST');
    expect(response.headers['access-control-allow-headers']).toBe(
      'authorization, content-type, x-request-id, openverify-flow-spec',
    );
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('does not allow any other origin', async () => {
    const response = await preflight('https://attacker.example.test');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('adds the allow-origin header to flow responses for the flow origin', async () => {
    const { sessionToken } = await openFlowSession(api);

    const response = await api.app.inject({
      url: SESSION,
      headers: { ...bearer(sessionToken), origin: FLOW_ORIGIN },
    });

    expect(response.headers['access-control-allow-origin']).toBe(FLOW_ORIGIN);
    expect(response.headers['access-control-expose-headers']).toBe(
      'x-request-id, openverify-flow-spec',
    );
  });

  it('never enables CORS on the server API', async () => {
    const response = await api.app.inject({
      url: '/api/v1/inquiries',
      headers: { ...bearer(api.token), origin: FLOW_ORIGIN },
    });
    const server = await preflight(FLOW_ORIGIN, '/api/v1/inquiries');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(server.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('OpenAPI', () => {
  it('documents the flow routes under the session token scheme', async () => {
    const document = (await api.app.inject({ url: '/openapi.json' })).json<{
      paths: Record<string, Record<string, { tags?: string[]; security?: unknown }>>;
      components: { securitySchemes: Record<string, { type: string; scheme: string }> };
    }>();

    expect(document.components.securitySchemes.sessionToken).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    const operations = [
      ['get', '/api/v1/flow/session'],
      ['post', '/api/v1/flow/consent'],
      ['post', '/api/v1/flow/verifications'],
      ['post', '/api/v1/flow/verifications/{id}/files'],
      ['post', '/api/v1/flow/verifications/{id}/submit'],
      ['get', '/api/v1/flow/verifications/{id}'],
    ] as const;
    for (const [method, path] of operations) {
      const operation = document.paths[path]?.[method];
      expect(operation?.tags, `${method} ${path}`).toEqual(['flow']);
      expect(operation?.security, `${method} ${path}`).toEqual([{ sessionToken: [] }]);
    }
    expect(Object.keys(document.paths).filter((path) => path.startsWith('/api/v1/flow/*'))).toEqual(
      [],
    );
  });
});
