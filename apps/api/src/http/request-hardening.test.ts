/**
 * KP11-72 (Workflow 11F; ASVS v5.0.0-13.4.4, 15.3.6, 15.3.7): the API answers a TRACE with a
 * problem and never echoes the request; a body naming `__proto__` or `constructor.prototype` is
 * refused and pollutes no prototype; a repeated query parameter never reaches a handler as an
 * array where the schema reads one value.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApi, type TestApi } from '../test-support/harness.js';

let api: TestApi;
let token: string;

beforeAll(async () => {
  api = await createTestApi();
  ({ token } = await api.newTenant());
});

afterAll(async () => {
  await api.close();
});

describe('TRACE (ASVS v5.0.0-13.4.4)', () => {
  it.each(['/health', '/api/v1/inquiries', '/api/v1/flow/session'])(
    'answers TRACE %s with a problem that echoes nothing of the request',
    async (url) => {
      const reply = await api.app.inject({
        method: 'TRACE',
        url,
        headers: { ...bearer(token), 'x-synthetic-echo': 'synthetic-trace-marker' },
      });

      expect(reply.statusCode).toBe(404);
      expect(reply.headers['content-type']).toMatch(/^application\/problem\+json/u);
      expect(reply.body).not.toContain('synthetic-trace-marker');
      expect(reply.body).not.toContain(token);
    },
  );
});

describe('prototype pollution (ASVS v5.0.0-15.3.6)', () => {
  it.each([
    ['__proto__', '{"data":{"attributes":{"__proto__":{"pollutedSynthetic":true}}}}'],
    ['constructor.prototype', '{"constructor":{"prototype":{"pollutedSynthetic":true}}}'],
  ])('refuses a body naming %s and pollutes no prototype', async (_name, payload) => {
    const reply = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiries',
      headers: { ...bearer(token), 'content-type': 'application/json' },
      payload,
    });

    expect(reply.statusCode).toBe(400);
    expect(reply.headers['content-type']).toMatch(/^application\/problem\+json/u);
    expect(({} as Record<string, unknown>).pollutedSynthetic).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('pollutedSynthetic');
  });
});

describe('a repeated query parameter (ASVS v5.0.0-15.3.7)', () => {
  it('refuses a single-valued parameter given twice, never reading one of them', async () => {
    const reply = await api.app.inject({
      url: '/api/v1/inquiries?filter[list-match]=matched&filter[list-match]=unscreened',
      headers: bearer(token),
    });

    expect(reply.statusCode).toBe(400);
    expect(reply.headers['content-type']).toMatch(/^application\/problem\+json/u);
  });

  it('refuses a repeated page size', async () => {
    const reply = await api.app.inject({
      url: '/api/v1/inquiries?page[size]=1&page[size]=100',
      headers: bearer(token),
    });

    expect(reply.statusCode).toBe(400);
  });
});
