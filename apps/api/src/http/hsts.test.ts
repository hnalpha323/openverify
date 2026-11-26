/**
 * C255.1 (decision 40; Phase 11, Workflow 11B, platform-ops): `OPENVERIFY_HSTS_MAX_AGE` above 0
 * makes the API send `Strict-Transport-Security: max-age=<n>; includeSubDomains` on every answer:
 * a route's, a 404, an error and a preflight; 0 (the default) sends none.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerHsts } from './hsts.js';

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function appWith(maxAgeSeconds: number): FastifyInstance {
  const app = Fastify();
  apps.push(app);
  registerHsts(app, maxAgeSeconds);
  app.get('/ok', () => ({ ok: true }));
  app.get('/fails', () => {
    throw new Error('synthetic failure');
  });
  void app.register(
    (scope, _options, done) => {
      scope.get('/scoped', () => ({ ok: true }));
      done();
    },
    { prefix: '/api/v1' },
  );
  return app;
}

describe('the API HSTS header (C255.1)', () => {
  it.each([
    ['GET', '/ok', 200],
    ['GET', '/api/v1/scoped', 200],
    ['GET', '/missing', 404],
    ['GET', '/fails', 500],
    ['DELETE', '/ok', 404],
  ] as const)('sends it on %s %s (%i) above 0', async (method, url, status) => {
    const reply = await appWith(31_536_000).inject({ method, url });

    expect(reply.statusCode).toBe(status);
    expect(reply.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  it('sends none at 0', async () => {
    const app = appWith(0);

    for (const url of ['/ok', '/missing']) {
      expect((await app.inject({ method: 'GET', url })).headers['strict-transport-security']).toBe(
        undefined,
      );
    }
  });
});
