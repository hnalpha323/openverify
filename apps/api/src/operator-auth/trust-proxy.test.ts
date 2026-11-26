import type { FastifyPluginCallback } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { fastifyTrustProxy, type TrustProxySetting } from './settings.js';

const apps: { close(): Promise<unknown> }[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const probe: FastifyPluginCallback = (app, _options, done) => {
  app.get('/probe/ip', { config: { public: true } }, (request) => ({ ip: request.ip }));
  done();
};

async function clientIp(trustProxy: TrustProxySetting, forwardedFor: string, peer = '10.0.0.2') {
  const app = buildApp({
    lookupApiKey: () => Promise.resolve(null),
    logger: false,
    mode: 'test',
    trustProxy,
  });
  apps.push(app);
  await app.register(probe);
  await app.ready();
  const response = await app.inject({
    url: '/probe/ip',
    headers: { 'x-forwarded-for': forwardedFor },
    remoteAddress: peer,
  });
  return response.json<{ ip: string }>().ip;
}

describe('fastifyTrustProxy', () => {
  it('passes booleans and address lists through, and turns a hop count into a trust function', () => {
    expect(fastifyTrustProxy(false)).toBe(false);
    expect(fastifyTrustProxy(true)).toBe(true);
    expect(fastifyTrustProxy(['10.0.0.0/8'])).toEqual(['10.0.0.0/8']);
    const hops = fastifyTrustProxy(2);
    expect(typeof hops).toBe('function');
    if (typeof hops === 'function') {
      expect([0, 1, 2].map((hop) => hops('192.0.2.1', hop))).toEqual([true, true, false]);
    }
  });
});

describe('request.ip with OPENVERIFY_TRUST_PROXY (C15)', () => {
  it('is the socket peer when no proxy is trusted, whatever the client claims', async () => {
    expect(await clientIp(false, '203.0.113.9')).toBe('10.0.0.2');
  });

  it('skips exactly the trusted hops', async () => {
    // The peer is the one trusted proxy; the client is the address it forwarded.
    expect(await clientIp(1, '198.51.100.7, 203.0.113.9')).toBe('203.0.113.9');
    expect(await clientIp(2, '198.51.100.7, 203.0.113.9')).toBe('198.51.100.7');
  });

  it('trusts only proxies inside the CIDR list', async () => {
    expect(await clientIp(['10.0.0.0/8'], '203.0.113.9')).toBe('203.0.113.9');
    expect(await clientIp(['10.0.0.0/8'], '203.0.113.9', '192.0.2.50')).toBe('192.0.2.50');
  });
});
