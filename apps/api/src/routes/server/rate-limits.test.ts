import { rateLimitListDocumentSchema } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RateLimitDecision, RateLimitRule } from '../../ports.js';
import { createAllowAllRateLimiter, T0 } from '../../test-support/fakes.js';
import {
  bearer,
  createTestApi,
  expectStatus,
  PROBLEM_JSON,
  type TestApi,
} from '../../test-support/harness.js';

const URL = '/api/v1/rate-limits';

describe('GET /api/v1/rate-limits', () => {
  let api: TestApi;

  beforeAll(async () => {
    api = await createTestApi();
  });

  afterAll(async () => {
    await api.close();
  });

  it("lists the caller's api limit with the state after this request", async () => {
    const { token } = await api.newTenant();
    await api.app.inject({ url: URL, headers: bearer(token) });

    const response = await api.app.inject({ url: URL, headers: bearer(token) });

    const document = rateLimitListDocumentSchema.parse(expectStatus(response, 200));
    expect(document).toEqual({
      data: [
        {
          type: 'rate-limit',
          id: 'api',
          attributes: {
            name: 'api',
            limit: 300,
            'window-seconds': 60,
            remaining: 298,
            'reset-at': new Date(T0.getTime() + 60_000).toISOString(),
          },
        },
      ],
      links: { next: null },
    });
    expect(response.headers['ratelimit-remaining']).toBe('298');
  });

  it('serves any principal, including a user session without permissions', async () => {
    const userToken = api.newUserToken(api.environmentId, { permissions: [] });

    const response = await api.app.inject({ url: URL, headers: bearer(userToken) });

    const document = rateLimitListDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data.map((limit) => limit.id)).toEqual(['api']);
  });

  it('keeps each principal to its own limit', async () => {
    const first = await api.newTenant();
    const second = await api.newTenant();
    for (let index = 0; index < 3; index += 1) {
      await api.app.inject({ url: URL, headers: bearer(first.token) });
    }

    const response = await api.app.inject({ url: URL, headers: bearer(second.token) });

    expect(expectStatus(response, 200).data).toBeDefined();
    expect(response.headers['ratelimit-remaining']).toBe('299');
  });

  it('requires a principal', async () => {
    const response = await api.app.inject({ url: URL });

    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/v1/rate-limits while the limiter is unavailable', () => {
  let api: TestApi;

  beforeAll(async () => {
    api = await createTestApi({
      rateLimiter: { consume: () => Promise.reject(new Error('Valkey is unavailable')) },
    });
  });

  afterAll(async () => {
    await api.close();
  });

  it('answers 503 instead of inventing the remaining quota', async () => {
    const response = await api.app.inject({ url: URL, headers: bearer(api.token) });

    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toBe(PROBLEM_JSON);
    expect(response.json()).toMatchObject({ status: 503, title: 'Service Unavailable' });
  });
});

/**
 * C240.3, amendment 22 (KP11-11; integration-11b): while the install allows Connect, the list also
 * shows the caller's `connect-redeem` and `connect-peek` buckets for the environment it acts in, read
 * with `peek` (never counted), keyed as `connectRateLimitKey` keys them (one bucket per principal and
 * environment). A failed peek leaves the Connect entries out and the 200 stands; `account-export` is
 * never listed.
 */
describe('GET /api/v1/rate-limits with Connect on (KP11-11)', () => {
  let api: TestApi;
  const peeks: { key: string; rule: RateLimitRule }[] = [];
  let peekFails = false;

  beforeAll(async () => {
    api = await createTestApi((defaults) => {
      const counting = createAllowAllRateLimiter(defaults.clock);
      return {
        connect: { enabled: true },
        rateLimiter: {
          ...counting,
          consume: (key, rule) => counting.consume(key, rule),
          peek: (key, rule): Promise<RateLimitDecision> => {
            peeks.push({ key, rule });
            if (peekFails) {
              return Promise.reject(new Error('synthetic store outage'));
            }
            return Promise.resolve({
              allowed: true,
              limit: rule.limit,
              remaining: rule.limit - 2,
              resetAt: new Date(T0.getTime() + 2_000),
              retryAfterSeconds: 0,
            });
          },
        },
      };
    });
  });

  afterAll(async () => {
    await api.close();
  });

  it("lists the API key's two Connect buckets for its environment, peeked, beside api", async () => {
    peeks.length = 0;
    const response = await api.app.inject({ url: URL, headers: bearer(api.token) });

    const document = rateLimitListDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data.map((limit) => limit.id)).toEqual([
      'api',
      'connect-redeem',
      'connect-peek',
    ]);
    expect(document.data[1]?.attributes).toEqual({
      name: 'connect-redeem',
      limit: 60,
      'window-seconds': 60,
      remaining: 58,
      'reset-at': new Date(T0.getTime() + 2_000).toISOString(),
    });
    expect(peeks.map((peek) => peek.rule.name)).toEqual(['connect-redeem', 'connect-peek']);
    expect(peeks[0]?.key).toMatch(new RegExp(`^key_[0-9A-Za-z]+:${api.environmentId}$`));
    expect(peeks[0]?.key).toBe(peeks[1]?.key);
  });

  it("keys a user session's buckets by its session and environment, never the user alone", async () => {
    peeks.length = 0;
    const userToken = api.newUserToken(api.environmentId, { permissions: [] });

    const response = await api.app.inject({ url: URL, headers: bearer(userToken) });

    const document = rateLimitListDocumentSchema.parse(expectStatus(response, 200));
    expect(document.data.map((limit) => limit.id)).toEqual([
      'api',
      'connect-redeem',
      'connect-peek',
    ]);
    expect(peeks[0]?.key.endsWith(`:${api.environmentId}`)).toBe(true);
    expect(peeks[0]?.key.startsWith('key_')).toBe(false);
  });

  it('leaves the Connect entries out when the peek fails, and still answers 200', async () => {
    peekFails = true;
    try {
      const response = await api.app.inject({ url: URL, headers: bearer(api.token) });

      const document = rateLimitListDocumentSchema.parse(expectStatus(response, 200));
      expect(document.data.map((limit) => limit.id)).toEqual(['api']);
    } finally {
      peekFails = false;
    }
  });
});
