// @vitest-environment node
/**
 * C157.2 (Workflow 9A, flow-server-embed; reviews P05, P10, F03): the per-client token bucket, the
 * expiring caches, and the embed-policy lookup through the API's internal route: the id encoded,
 * the answer guarded by `parseEmbedPolicyAnswer` with every origin re-checked, 60 s by inquiry id,
 * negative answers 60 s, and `'none'` (an empty list) on every failure. Time is the test's clock.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createEmbedPolicyLookup,
  ExpiringCache,
  FLOW_SERVER_LIMITS,
  TokenBucketLimiter,
} from '../../server.ts';

/** The URL a fetch was called with. */
const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const TOKEN = 'synthetic-flow-server-token-current-0123456789';
const INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const OTHER_ID = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';
const TEMPLATE_ID = 'itmpl_01M5CJXHG07XPHF3HRM6NREDH7';
const ENVIRONMENT_ID = 'env_01M5CJXHG07XPHF3HRM6NREDH7';
const SHOP = 'https://shop.example.com';

class Clock {
  ms = 1_000_000;
  readonly now = (): number => this.ms;
}

const answer = (inquiryId: string, origins: readonly string[]) => ({
  'inquiry-id': inquiryId,
  'template-id': TEMPLATE_ID,
  'environment-id': ENVIRONMENT_ID,
  'frame-ancestors': origins,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('TokenBucketLimiter (C157.2: 60 a minute per client, provisional)', () => {
  it('takes the capacity at once, then one a second, per client', () => {
    const clock = new Clock();
    const limiter = new TokenBucketLimiter({
      capacity: 60,
      refillPerSecond: 1,
      maxClients: 100,
      now: clock.now,
    });
    for (let i = 0; i < 60; i += 1) {
      expect(limiter.take('203.0.113.9')).toBe(true);
    }
    expect(limiter.take('203.0.113.9')).toBe(false);
    expect(limiter.retryAfterSeconds('203.0.113.9')).toBe(1);
    expect(limiter.take('198.51.100.7')).toBe(true);

    clock.ms += 1_000;
    expect(limiter.take('203.0.113.9')).toBe(true);
    expect(limiter.take('203.0.113.9')).toBe(false);
  });

  it('holds at most maxClients buckets, forgetting the least recently seen', () => {
    const clock = new Clock();
    const limiter = new TokenBucketLimiter({
      capacity: 1,
      refillPerSecond: 1 / 60,
      maxClients: 2,
      now: clock.now,
    });
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('b')).toBe(true);
    expect(limiter.take('a')).toBe(false);
    expect(limiter.take('c')).toBe(true);
    // 'b' was the least recently seen bucket when 'c' arrived.
    expect(limiter.take('b')).toBe(true);
    expect(limiter.take('a')).toBe(true);
  });

  it('uses the plan values by default', () => {
    expect(FLOW_SERVER_LIMITS.embedRequestsPerMinute).toBe(60);
    expect(FLOW_SERVER_LIMITS.policyCacheEntries).toBe(10_000);
    expect(FLOW_SERVER_LIMITS.policyCacheSeconds).toBe(60);
    expect(FLOW_SERVER_LIMITS.negativeCacheSeconds).toBe(60);
  });
});

describe('ExpiringCache', () => {
  it('forgets an entry after its time and the least recently used past its size', () => {
    const clock = new Clock();
    const cache = new ExpiringCache<string>({ maxEntries: 2, ttlMs: 60_000, now: clock.now });
    cache.set('a', 'A');
    cache.set('b', 'B');
    expect(cache.get('a')).toBe('A');
    cache.set('c', 'C');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(2);

    clock.ms += 60_000;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBeUndefined();
  });

  it('deletes the entries a predicate matches', () => {
    const cache = new ExpiringCache<number>({ maxEntries: 10, ttlMs: 1_000, now: () => 0 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.deleteWhere((value) => value === 1);
    expect([cache.get('a'), cache.get('b')]).toEqual([undefined, 2]);
  });
});

describe('createEmbedPolicyLookup (C157.2)', () => {
  const setup = (respond: (url: string, init: RequestInit | undefined) => Promise<Response>) => {
    const clock = new Clock();
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) =>
      respond(urlOf(input), init),
    );
    const lookup = createEmbedPolicyLookup({
      apiUrl: 'http://api.internal:3000/base',
      token: TOKEN,
      fetch: fetch,
      now: clock.now,
    });
    return { clock, fetch, lookup };
  };

  it('asks the internal route with the token and answers the origins', async () => {
    const { fetch, lookup } = setup(() => Promise.resolve(json(answer(INQUIRY_ID, [SHOP]))));

    expect(await lookup(INQUIRY_ID)).toEqual([SHOP]);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`http://api.internal:3000/base/api/v1/internal/embed-policies/${INQUIRY_ID}`);
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(init?.redirect).toBe('error');
  });

  it('caches an answer by inquiry id for 60 s, and invalidates by template or environment', async () => {
    const { clock, fetch, lookup } = setup(() => Promise.resolve(json(answer(INQUIRY_ID, [SHOP]))));
    await lookup(INQUIRY_ID);
    await lookup(INQUIRY_ID);
    expect(fetch).toHaveBeenCalledTimes(1);

    clock.ms += 60_000;
    await lookup(INQUIRY_ID);
    expect(fetch).toHaveBeenCalledTimes(2);

    lookup.invalidate({ templateId: TEMPLATE_ID });
    await lookup(INQUIRY_ID);
    lookup.invalidate({ environmentId: ENVIRONMENT_ID });
    await lookup(INQUIRY_ID);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('caches a 404 as none for 60 s', async () => {
    const { clock, fetch, lookup } = setup(() => Promise.resolve(json({ status: 404 }, 404)));
    expect(await lookup(INQUIRY_ID)).toEqual([]);
    expect(await lookup(INQUIRY_ID)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    clock.ms += 60_000;
    await lookup(INQUIRY_ID);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('answers none for a malicious or mismatched answer', async () => {
    for (const body of [
      answer(INQUIRY_ID, ["https://shop.example.com; script-src 'unsafe-inline'"]),
      answer(INQUIRY_ID, ['https://shop.example.com\r\nSet-Cookie: x=1']),
      answer(OTHER_ID, [SHOP]),
      { ...answer(INQUIRY_ID, [SHOP]), extra: true },
      'not json',
    ]) {
      const { lookup } = setup(() =>
        Promise.resolve(
          typeof body === 'string' ? new Response(body, { status: 200 }) : json(body),
        ),
      );
      expect(await lookup(INQUIRY_ID), JSON.stringify(body)).toEqual([]);
    }
  });

  it('answers none for an answer larger than its cap', async () => {
    const { lookup } = setup(() =>
      Promise.resolve(
        new Response('x'.repeat(FLOW_SERVER_LIMITS.lookupAnswerBytes + 1), { status: 200 }),
      ),
    );
    expect(await lookup(INQUIRY_ID)).toEqual([]);
  });

  it('answers none when the API fails, and asks again next time', async () => {
    let calls = 0;
    const { fetch, lookup } = setup(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new TypeError('connection refused'))
        : Promise.resolve(json({}, 503));
    });
    expect(await lookup(INQUIRY_ID)).toEqual([]);
    expect(await lookup(INQUIRY_ID)).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares one request among concurrent lookups of one id', async () => {
    let release: (response: Response) => void = () => undefined;
    const { fetch, lookup } = setup(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = lookup(INQUIRY_ID);
    const second = lookup(INQUIRY_ID);
    release(json(answer(INQUIRY_ID, [SHOP])));
    expect(await Promise.all([first, second])).toEqual([[SHOP], [SHOP]]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never asks for an id outside the inquiry grammar, and encodes the path', async () => {
    const { fetch, lookup } = setup(() => Promise.resolve(json(answer(INQUIRY_ID, [SHOP]))));
    expect(await lookup('../../admin')).toEqual([]);
    expect(await lookup('inq_/%2e%2e')).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
