/**
 * KP11-70 (ASVS v5.0.0-3.4.4; DAST rule 10021 on 2026-11-21): every API answer carries
 * `X-Content-Type-Options: nosniff`, so a browser never sniffs a JSON or problem+json body into
 * something it would render or run. The file routes, which already sent it, keep their headers.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { bearer, createTestApi, type TestApi } from '../test-support/harness.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function bareApp() {
  const app = buildApp({ lookupApiKey: () => Promise.resolve(null), logger: false });
  apps.push(app);
  return app;
}

describe('X-Content-Type-Options on every API answer (KP11-70)', () => {
  it.each([
    ['GET', '/health', 200],
    ['GET', '/no-such-route', 404],
    ['DELETE', '/health', 404],
  ] as const)('is nosniff on %s %s (%i) of the bare app', async (method, url, status) => {
    const reply = await bareApp().inject({ method, url });

    expect(reply.statusCode).toBe(status);
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
  });

  describe('with the server and flow APIs', () => {
    let api: TestApi;

    beforeAll(async () => {
      api = await createTestApi();
    });

    afterAll(async () => {
      await api.close();
    });

    it('is nosniff on an authenticated JSON answer', async () => {
      const { token } = await api.newTenant();

      const reply = await api.app.inject({ url: '/api/v1/rate-limits', headers: bearer(token) });

      expect(reply.statusCode).toBe(200);
      expect(reply.headers['content-type']).toMatch(/^application\/json/u);
      expect(reply.headers['x-content-type-options']).toBe('nosniff');
    });

    it.each([
      ['GET', '/api/v1/rate-limits', 401],
      ['GET', '/api/v1/no-such-route', 404],
      ['GET', '/api/v1/flow/session', 401],
      ['POST', '/api/v1/inquiries', 401],
    ] as const)('is nosniff on the problem of %s %s (%i)', async (method, url, status) => {
      const reply = await api.app.inject({ method, url });

      expect(reply.statusCode).toBe(status);
      expect(reply.headers['content-type']).toMatch(/^application\/problem\+json/u);
      expect(reply.headers['x-content-type-options']).toBe('nosniff');
    });

    it('is nosniff on a validation problem', async () => {
      const { token } = await api.newTenant();

      const reply = await api.app.inject({
        method: 'POST',
        url: '/api/v1/inquiries',
        headers: bearer(token),
        payload: { data: { attributes: { 'inquiry-template-id': 42 } } },
      });

      expect(reply.statusCode).toBe(400);
      expect(reply.headers['x-content-type-options']).toBe('nosniff');
    });
  });
});
