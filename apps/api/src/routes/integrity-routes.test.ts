/**
 * Workflow 10B Stage 1b (I) (C211.3, C221.7; `foundation-10b`): the frozen integrity routes of the flow
 * API, registered as a plugin with their contract schemas (built by `api-integrity`, whose own tests
 * cover their answers), and in the OpenAPI document:
 *
 * - `POST /api/v1/flow/integrity-challenges` (`{}`, 201 with the challenge);
 * - `POST /api/v1/flow/integrity-tokens` (`{challenge-id, token}`, 202; the token at most 16 KiB);
 *
 * both under session authentication (built by `api-integrity`: with no provider bound, 409
 * `integrity_challenge_invalid`; `routes/flow/integrity.test.ts` covers the rest), under the C12 policy
 * `flow-integrity` (5 an hour per inquiry, both routes together) beside `flow-session`. A refused
 * body never echoes its token. `GET /api/v1/flow/session` leaves its `integrity` member out where no
 * `deviceIntegrity` provider is bound (`services/device-integrity/session-member.ts`).
 */
import { INTEGRITY_TOKEN_MAX_LENGTH } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../services/inquiries.test-support.js';
import { bearer, expectStatus, openFlowSession } from '../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const CHALLENGES = '/api/v1/flow/integrity-challenges';
const TOKENS = '/api/v1/flow/integrity-tokens';
const CHALLENGE_ID = 'ich_01M5CK16P0D13FXHZSS4TCFBVH';
const SYNTHETIC_TOKEN = 'synthetic-integrity-token-value';

const post = (url: string, token: string | null, payload: unknown) =>
  api.app.inject({
    method: 'POST',
    url,
    ...(token === null ? {} : { headers: bearer(token) }),
    payload: payload as Record<string, unknown>,
  });

describe('POST /api/v1/flow/integrity-challenges (C211.3)', () => {
  it('takes an empty body under session authentication; with no provider bound, 409', async () => {
    const { sessionToken } = await openFlowSession(api);

    const response = await post(CHALLENGES, sessionToken, {});

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect((await post(CHALLENGES, null, {})).statusCode).toBe(401);
  });

  it('refuses a body with any member (400)', async () => {
    const { sessionToken } = await openFlowSession(api);

    expect((await post(CHALLENGES, sessionToken, { nonce: 'abc' })).statusCode).toBe(400);
  });
});

describe('POST /api/v1/flow/integrity-tokens (C211.3)', () => {
  it('takes a challenge id and a token under session authentication; an unknown challenge is 409', async () => {
    const { sessionToken } = await openFlowSession(api);

    const response = await post(TOKENS, sessionToken, {
      'challenge-id': CHALLENGE_ID,
      token: SYNTHETIC_TOKEN,
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).not.toContain(SYNTHETIC_TOKEN);
    expect(
      (await post(TOKENS, null, { 'challenge-id': CHALLENGE_ID, token: SYNTHETIC_TOKEN }))
        .statusCode,
    ).toBe(401);
  });

  it('refuses a malformed body (400) without echoing the token, and one over its cap (413)', async () => {
    const { sessionToken } = await openFlowSession(api);

    const wrongId = await post(TOKENS, sessionToken, {
      'challenge-id': 'chc_01M5CK16P0D13FXHZSS4TCFBVH',
      token: SYNTHETIC_TOKEN,
    });
    expect(wrongId.statusCode).toBe(400);
    expect(wrongId.body).not.toContain(SYNTHETIC_TOKEN);
    const tooLong = 'synthetic'.repeat(Math.ceil((INTEGRITY_TOKEN_MAX_LENGTH + 1) / 9));
    const overLength = await post(TOKENS, sessionToken, {
      'challenge-id': CHALLENGE_ID,
      token: tooLong.slice(0, INTEGRITY_TOKEN_MAX_LENGTH + 1),
    });
    expect(overLength.statusCode).toBe(400);
    expect(overLength.body).not.toContain('syntheticsynthetic');
    expect((await post(TOKENS, sessionToken, { 'challenge-id': CHALLENGE_ID })).statusCode).toBe(
      400,
    );
    expect(
      (
        await post(TOKENS, sessionToken, {
          'challenge-id': CHALLENGE_ID,
          token: 'x'.repeat(INTEGRITY_TOKEN_MAX_LENGTH * 2),
        })
      ).statusCode,
    ).toBe(413);
  });
});

describe('the flow-integrity policy (C221.7)', () => {
  it('counts both routes per inquiry, 5 an hour, beside flow-session', async () => {
    const { sessionToken, inquiryId } = await openFlowSession(api);
    const before = api.rateLimiter.calls.length;

    await post(CHALLENGES, sessionToken, {});
    await post(TOKENS, sessionToken, { 'challenge-id': CHALLENGE_ID, token: SYNTHETIC_TOKEN });

    const calls = api.rateLimiter.calls.slice(before);
    const integrity = calls.filter((call) => (call.policy.name as string) === 'flow-integrity');
    expect(integrity.map((call) => call.key)).toEqual([inquiryId, inquiryId]);
    expect(integrity[0]?.policy).toMatchObject({ limit: 5, windowSeconds: 3600 });
    expect(calls.filter((call) => call.policy.name === 'flow-session')).toHaveLength(2);
  });

  it('counts no other flow route', async () => {
    const { sessionToken } = await openFlowSession(api);
    const before = api.rateLimiter.calls.length;

    await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(sessionToken) });

    expect(
      api.rateLimiter.calls
        .slice(before)
        .filter((call) => (call.policy.name as string) === 'flow-integrity'),
    ).toEqual([]);
  });
});

describe('the OpenAPI document (C221.10)', () => {
  it('lists both routes under the flow API with their bodies and answers', async () => {
    const document = expectStatus(
      await api.app.inject({ url: '/openapi.json' }),
      200,
    ) as unknown as {
      paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
    };

    const challenges = document.paths[CHALLENGES]?.post;
    const tokens = document.paths[TOKENS]?.post;
    expect(Object.keys(challenges?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '401', '409', '429']),
    );
    expect(Object.keys(tokens?.responses ?? {})).toEqual(
      expect.arrayContaining(['202', '401', '409', '413', '429']),
    );
    // Workflow 10B Stage 3 (integration-10b): built by api-integrity, so neither documents the frozen 501.
    expect(Object.keys(challenges?.responses ?? {})).not.toContain('501');
    expect(Object.keys(tokens?.responses ?? {})).not.toContain('501');
  });
});

describe('GET /api/v1/flow/session: the integrity member (C211.3)', () => {
  it('is left out where no deviceIntegrity provider is bound', async () => {
    const { sessionToken } = await openFlowSession(api);

    const body = expectStatus(
      await api.app.inject({ url: '/api/v1/flow/session', headers: bearer(sessionToken) }),
      200,
    );

    expect(body).not.toHaveProperty('integrity');
  });
});
