/** C10 `POST /api/v1/flow/one-time-links/redeem`: single use, no auth, one generic 401. */
import {
  defaultInquiryTemplateAttributes,
  flowRedeemOneTimeLinkResponseSchema,
  generateOneTimeLinkDocumentSchema,
  newOneTimeLinkToken,
  parseOneTimeLinkFragment,
  RATE_LIMIT_DEFAULTS_PER_MINUTE,
} from '@openverify/contracts';
import { hashSessionToken, transitionInquiryStatus } from '@openverify/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { createAllowAllRateLimiter, createDenyRateLimiter } from '../../test-support/fakes.js';
import {
  bearer,
  createInquiry,
  createTemplate,
  expectStatus,
  FLOW_ORIGIN,
  PROBLEM_JSON,
} from '../../test-support/harness.js';
import type { RateLimiter } from '../../ports.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

const REDEEM = '/api/v1/flow/one-time-links/redeem';

/** A one-time link for `inquiryId`: its credentials as the flow reads them from the fragment. */
async function linkFor(inquiryId: string, meta?: Record<string, unknown>, target = api) {
  const response = await target.app.inject({
    method: 'POST',
    url: `/api/v1/inquiries/${inquiryId}/generate-one-time-link`,
    headers: bearer(target.token),
    ...(meta === undefined ? {} : { payload: { meta } }),
  });
  const document = generateOneTimeLinkDocumentSchema.parse(expectStatus(response, 200));
  const credentials = parseOneTimeLinkFragment(new URL(document.meta['one-time-link']).hash);
  if (credentials === null) {
    throw new Error('the one-time link carries no credentials');
  }
  return credentials;
}

function redeem(
  body: { inquiryId: string; oneTimeToken: string },
  options: { target?: InquiryTestApi; remoteAddress?: string; origin?: string } = {},
) {
  return (options.target ?? api).app.inject({
    method: 'POST',
    url: REDEEM,
    payload: { 'inquiry-id': body.inquiryId, 'one-time-token': body.oneTimeToken },
    remoteAddress: options.remoteAddress ?? '203.0.113.9',
    ...(options.origin === undefined ? {} : { headers: { origin: options.origin } }),
  });
}

function expectGenericRefusal(response: Awaited<ReturnType<typeof redeem>>) {
  expect(response.statusCode).toBe(401);
  expect(response.headers['content-type']).toBe(PROBLEM_JSON);
  const problem = response.json<Record<string, unknown>>();
  expect({ type: problem.type, title: problem.title, detail: problem.detail }).toEqual({
    type: 'about:blank',
    title: 'Unauthorized',
    detail: 'The one-time link is not valid or has expired.',
  });
  expect(problem.code).toBeUndefined();
}

describe('POST /api/v1/flow/one-time-links/redeem', () => {
  it('exchanges the link for a session token that the flow API accepts', async () => {
    const inquiryId = await createInquiry(api);
    const credentials = await linkFor(inquiryId);

    const response = await redeem(credentials);

    const body = flowRedeemOneTimeLinkResponseSchema.parse(expectStatus(response, 200));
    expect(response.headers['cache-control']).toBe('no-store');
    expect(body['expires-at']).toBe(new Date(api.clock.now().getTime() + 86_400_000).toISOString());
    const session = await api.app.inject({
      url: '/api/v1/flow/session',
      headers: bearer(body['session-token']),
    });
    expect(expectStatus(session, 200)).toMatchObject({ inquiry: { id: inquiryId } });
    const { rows } = await api.database.client.query<{ token_hash: string; used: boolean }>(
      'select token_hash, used_at is not null as used from one_time_links where inquiry_id = $1',
      [inquiryId],
    );
    expect(rows).toEqual([{ token_hash: hashSessionToken(credentials.oneTimeToken), used: true }]);
  });

  it("gives the session the template's session-expiration-seconds", async () => {
    const templateId = await createTemplate(api, api.token, {
      ...defaultInquiryTemplateAttributes(),
      settings: { 'session-expiration-seconds': 1800 },
    });
    const credentials = await linkFor(await createInquiry(api, { templateId }));

    const body = flowRedeemOneTimeLinkResponseSchema.parse(
      expectStatus(await redeem(credentials), 200),
    );

    expect(body['expires-at']).toBe(new Date(api.clock.now().getTime() + 1_800_000).toISOString());
  });

  it('succeeds exactly once', async () => {
    const credentials = await linkFor(await createInquiry(api));
    expectStatus(await redeem(credentials), 200);

    expectGenericRefusal(await redeem(credentials));
  });

  it('answers the same 401 for an unknown token, another inquiry, a revoked or an expired link', async () => {
    const inquiryId = await createInquiry(api);
    const older = await linkFor(inquiryId);
    const newer = await linkFor(inquiryId);
    const otherInquiry = await createInquiry(api);
    const short = await linkFor(otherInquiry, { 'expires-in-seconds': 300 });

    expectGenericRefusal(await redeem({ inquiryId, oneTimeToken: newOneTimeLinkToken() }));
    expectGenericRefusal(
      await redeem({ inquiryId: otherInquiry, oneTimeToken: newer.oneTimeToken }),
    );
    expectGenericRefusal(await redeem(older));
    const issuedAt = api.clock.now();
    api.clock.advance(300_000);
    try {
      expectGenericRefusal(await redeem(short));
    } finally {
      api.clock.set(issuedAt);
    }
    expectStatus(await redeem(newer), 200);
  });

  it('answers the same 401 once the inquiry is no longer created or pending', async () => {
    const inquiryId = await createInquiry(api);
    const credentials = await linkFor(inquiryId);
    const { db } = api.database;
    await transitionInquiryStatus(db, api.environmentId, inquiryId, {
      from: 'created',
      to: 'pending',
    });
    await transitionInquiryStatus(db, api.environmentId, inquiryId, {
      from: 'pending',
      to: 'completed',
    });

    expectGenericRefusal(await redeem(credentials));
  });

  it('refuses a link of an inquiry that expired, with the same 401', async () => {
    const inquiryId = await createInquiry(api);
    const credentials = await linkFor(inquiryId);
    expectStatus(
      await api.app.inject({
        method: 'POST',
        url: `/api/v1/inquiries/${inquiryId}/expire`,
        headers: bearer(api.token),
      }),
      200,
    );

    expectGenericRefusal(await redeem(credentials));
  });

  it('needs no credentials and ignores an Authorization header', async () => {
    const credentials = await linkFor(await createInquiry(api));

    const response = await api.app.inject({
      method: 'POST',
      url: REDEEM,
      headers: bearer('ovs_not-a-session'),
      payload: { 'inquiry-id': credentials.inquiryId, 'one-time-token': credentials.oneTimeToken },
    });

    expect(response.statusCode).toBe(200);
  });

  it.each([
    ['no body', undefined],
    [
      'a session token instead',
      { 'inquiry-id': 'inq_01M5CJXHG07XPHF3HRM6NREDH7', 'one-time-token': 'ovs_x' },
    ],
    [
      'an unknown member',
      {
        'inquiry-id': 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
        'one-time-token': newOneTimeLinkToken(),
        extra: 1,
      },
    ],
  ])('answers 400 for %s', async (_label, payload) => {
    const response = await api.app.inject({
      method: 'POST',
      url: REDEEM,
      ...(payload === undefined ? {} : { payload }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('allows the flow origin (CORS)', async () => {
    const credentials = await linkFor(await createInquiry(api));

    const response = await redeem(credentials, { origin: FLOW_ORIGIN });

    expect(response.headers['access-control-allow-origin']).toBe(FLOW_ORIGIN);
  });
});

describe('rate limiting of the redeem (C12 one-time-link-redeem)', () => {
  it('counts every attempt per client IP under its policy', async () => {
    const credentials = await linkFor(await createInquiry(api));
    const before = api.rateLimiter.calls.length;

    await redeem(credentials, { remoteAddress: '192.0.2.44' });
    await redeem(
      { ...credentials, oneTimeToken: newOneTimeLinkToken() },
      { remoteAddress: '192.0.2.44' },
    );

    const redeemPolicy = {
      name: 'one-time-link-redeem',
      limit: RATE_LIMIT_DEFAULTS_PER_MINUTE['one-time-link-redeem'],
      windowSeconds: 60,
    };
    expect(
      api.rateLimiter.calls
        .slice(before)
        .filter((call) => call.policy.name === 'one-time-link-redeem'),
    ).toEqual([
      { key: '192.0.2.44', policy: redeemPolicy },
      { key: '192.0.2.44', policy: redeemPolicy },
    ]);
  });

  it('answers 429 rate-limited with Retry-After over the limit, without redeeming', async () => {
    const deny = createDenyRateLimiter(42);
    const allow = createAllowAllRateLimiter();
    const redeemOnly: RateLimiter = {
      consume: (key, policy) =>
        policy.name === 'one-time-link-redeem'
          ? deny.consume(key, policy)
          : allow.consume(key, policy),
    };
    const limited = await createInquiryTestApi({ rateLimiter: redeemOnly });
    try {
      const credentials = await linkFor(
        await createInquiry(limited, { token: limited.token }),
        undefined,
        limited,
      );

      const response = await redeem(credentials, { target: limited });

      expect(response.statusCode).toBe(429);
      expect(response.headers['content-type']).toBe(PROBLEM_JSON);
      expect(response.headers['retry-after']).toBe('42');
      expect(response.json<{ type: string }>().type).toBe(
        'https://openverify.dev/problems/rate-limited',
      );
      const { rows } = await limited.database.client.query<{ used: boolean }>(
        'select used_at is not null as used from one_time_links where inquiry_id = $1',
        [credentials.inquiryId],
      );
      expect(rows).toEqual([{ used: false }]);
    } finally {
      await limited.close();
    }
  });

  it('fails open when the rate limiter is unavailable', async () => {
    const allow = createAllowAllRateLimiter();
    const unavailable: RateLimiter = {
      consume: (key, policy) =>
        policy.name === 'one-time-link-redeem'
          ? Promise.reject(new Error('valkey down'))
          : allow.consume(key, policy),
    };
    const open = await createInquiryTestApi({ rateLimiter: unavailable });
    try {
      const credentials = await linkFor(
        await createInquiry(open, { token: open.token }),
        undefined,
        open,
      );

      expect((await redeem(credentials, { target: open })).statusCode).toBe(200);
    } finally {
      await open.close();
    }
  });
});
