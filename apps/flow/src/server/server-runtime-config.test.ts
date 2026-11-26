// @vitest-environment node
/**
 * C257.1 (Phase 11, Workflow 11C, images-11c; decision 73, OD-11C-3): the flow server reads the API's
 * URL at start from OPENVERIFY_FLOW_API_URL, falling back to VITE_OPENVERIFY_API_URL, serves it to a
 * bundle built without one as /config.json, and keeps sending connect-src with its origin, so one
 * image serves any install. Every origin is a reserved name.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FlowServerConfigError,
  readFlowServerConfig,
  startFlowServer,
  type RunningFlowServer,
} from '../../server.ts';
import { FLOW_RESPONSE_HEADERS } from '../security/response-headers';

describe('the API URL read at start (C257.1)', () => {
  it('prefers OPENVERIFY_FLOW_API_URL and falls back to VITE_OPENVERIFY_API_URL', () => {
    const both = readFlowServerConfig(
      {
        OPENVERIFY_FLOW_API_URL: 'https://api-b.example.com/openverify/',
        VITE_OPENVERIFY_API_URL: 'https://api-a.example.com',
      },
      '/dist',
    );
    expect(both.apiOrigin).toBe('https://api-b.example.com');
    expect(both.apiBaseUrl).toBe('https://api-b.example.com/openverify');
    const fallback = readFlowServerConfig(
      { VITE_OPENVERIFY_API_URL: 'https://api-a.example.com' },
      '/dist',
    );
    expect(fallback.apiOrigin).toBe('https://api-a.example.com');
    expect(fallback.apiBaseUrl).toBe('https://api-a.example.com');
    const neither = readFlowServerConfig({}, '/dist');
    expect(neither.apiOrigin).toBeNull();
    expect(neither.apiBaseUrl).toBe('');
  });

  it('names the variable it read in a refusal, never the value', () => {
    for (const [name, other] of [
      ['OPENVERIFY_FLOW_API_URL', {}],
      ['VITE_OPENVERIFY_API_URL', {}],
    ] as const) {
      let refusal: unknown;
      try {
        readFlowServerConfig({ [name]: 'ftp://secret-host.example.com', ...other }, '/dist');
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(FlowServerConfigError);
      expect((refusal as FlowServerConfigError).issues).toEqual([
        `${name}: must be an absolute http(s) URL without query or credentials`,
      ]);
    }
  });
});

describe('/config.json (C257.1)', () => {
  let dist: string;
  const servers: RunningFlowServer[] = [];

  beforeAll(() => {
    dist = mkdtempSync(join(tmpdir(), 'openverify-flow-config-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(
      join(dist, 'index.html'),
      '<!doctype html><html><head></head><body></body></html>',
    );
    writeFileSync(join(dist, 'preview.html'), '<!doctype html><html><head></head></html>');
  });

  afterAll(async () => {
    await Promise.all(servers.map((server) => server.close()));
    rmSync(dist, { recursive: true, force: true });
  });

  const start = async (env: Record<string, string>) => {
    const server = await startFlowServer({
      config: readFlowServerConfig(env, dist),
      hostname: '127.0.0.1',
      port: 0,
      log: () => undefined,
    });
    servers.push(server);
    return server;
  };

  it('serves one image against two API URLs without a rebuild', async () => {
    for (const api of ['https://api-a.example.com', 'https://api-b.example.com/openverify']) {
      const server = await start({ OPENVERIFY_FLOW_API_URL: api });
      const config = await fetch(`${server.url}/config.json`);
      expect(config.status).toBe(200);
      expect(config.headers.get('content-type')).toBe('application/json');
      expect(config.headers.get('cache-control')).toBe('no-store');
      expect(config.headers.get('referrer-policy')).toBe(FLOW_RESPONSE_HEADERS['Referrer-Policy']);
      expect(await config.json()).toEqual({ 'api-url': api });
      const index = await fetch(`${server.url}/`);
      expect(index.headers.get('content-security-policy')).toContain(
        `connect-src 'self' ${new URL(api).origin};`,
      );
    }
  });

  it("serves the flow's own origin as '' when no URL is set, and answers HEAD", async () => {
    const server = await start({});
    expect(await (await fetch(`${server.url}/config.json`)).json()).toEqual({ 'api-url': '' });
    const head = await fetch(`${server.url}/config.json`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });
});
