/**
 * C250.1 (Phase 11, Workflow 11B, platform-ops): `GET /ready` over the API's own stores. 200
 * `{status: 'ready'}` while Postgres answers `SELECT 1` and Valkey answers a read through the API's
 * cache client; 503 naming the store that did not, with no error text; public and never
 * rate-limited (the limiter is not asked, whatever credential the request carries). An app built
 * without stores (no `api`) is not ready. Every value is synthetic.
 */
import { notReadyResponseSchema } from '@openverify/contracts';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import type { KeyValueCache, RateLimiter } from '../ports.js';
import type { ApiDependencies } from '../services/context.js';
import { createTestApi } from '../test-support/harness.js';

const STORE_DOWN = 'synthetic: connect ECONNREFUSED 192.0.2.10:6379';

function failing<T extends object>(target: T, method: string): T {
  return new Proxy(target, {
    get: (object, property, receiver) =>
      property === method
        ? () => Promise.reject(new Error(STORE_DOWN))
        : (Reflect.get(object, property, receiver) as unknown),
  });
}

describe('GET /ready (C250.1)', () => {
  it('answers 200 ready while Postgres and Valkey answer, without a credential and unlimited', async () => {
    const consume = vi.fn<RateLimiter['consume']>();
    const api = await createTestApi((defaults: ApiDependencies) => ({
      rateLimiter: {
        consume: (key, rule) => {
          void consume(key, rule);
          return defaults.rateLimiter.consume(key, rule);
        },
      },
    }));
    try {
      const ready = await api.app.inject({ method: 'GET', url: '/ready' });
      const withKey = await api.app.inject({
        method: 'GET',
        url: '/ready',
        headers: { authorization: `Bearer ${api.token}` },
      });

      expect(ready.statusCode, ready.body).toBe(200);
      expect(ready.json()).toEqual({ status: 'ready' });
      expect(withKey.statusCode).toBe(200);
      expect(consume).not.toHaveBeenCalled();
    } finally {
      await api.close();
    }
  });

  it('answers 503 naming Valkey when the cache client cannot read, with no error text', async () => {
    const api = await createTestApi((defaults: ApiDependencies) => ({
      cache: failing<KeyValueCache>(defaults.cache, 'get'),
    }));
    try {
      const response = await api.app.inject({ method: 'GET', url: '/ready' });

      expect(response.statusCode).toBe(503);
      expect(notReadyResponseSchema.parse(response.json())).toEqual({
        status: 'not_ready',
        checks: { postgres: 'ok', valkey: 'unavailable' },
      });
      expect(response.body).not.toContain('ECONNREFUSED');
    } finally {
      await api.close();
    }
  });

  it('answers 503 naming Postgres when SELECT 1 fails', async () => {
    const api = await createTestApi((defaults: ApiDependencies) => ({
      db: failing(defaults.db, 'execute'),
    }));
    try {
      const response = await api.app.inject({ method: 'GET', url: '/ready' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        status: 'not_ready',
        checks: { postgres: 'unavailable', valkey: 'ok' },
      });
    } finally {
      await api.close();
    }
  });

  it('is not ready in an app built without stores', async () => {
    const app = buildApp({ lookupApiKey: () => Promise.resolve(null), logger: false });
    try {
      const response = await app.inject({ method: 'GET', url: '/ready' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        status: 'not_ready',
        checks: { postgres: 'unavailable', valkey: 'unavailable' },
      });
    } finally {
      await app.close();
    }
  });
});
