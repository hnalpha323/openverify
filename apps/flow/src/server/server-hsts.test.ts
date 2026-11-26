// @vitest-environment node
/**
 * C255.1 (decision 40; Phase 11, Workflow 11B, platform-ops): for an install whose TLS terminator
 * cannot add headers, `OPENVERIFY_HSTS_MAX_AGE` (0 = off, the default; at most 63,072,000) makes
 * the flow server send `Strict-Transport-Security: max-age=<n>; includeSubDomains` on every
 * response, on top of Phase 7's `FLOW_RESPONSE_HEADERS` (never a second list). Every origin is a
 * reserved name.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  embedHeaders,
  FlowServerConfigError,
  HSTS_MAX_AGE_LIMIT,
  hostedHeaders,
  previewHeaders,
  readFlowServerConfig,
  startFlowServer,
  type RunningFlowServer,
} from '../../server.ts';
import { FLOW_RESPONSE_HEADERS } from '../security/response-headers';

const API = 'https://api.example.com';
const CONSOLE = 'https://console.example.com';
const YEAR = 31_536_000;
const HSTS = `max-age=${String(YEAR)}; includeSubDomains`;

describe('OPENVERIFY_HSTS_MAX_AGE (C255.1)', () => {
  it('is 0, off, by default, and read from 0 to two years', () => {
    expect(readFlowServerConfig({}, '/dist').hstsMaxAge).toBe(0);
    expect(readFlowServerConfig({ OPENVERIFY_HSTS_MAX_AGE: '0' }, '/dist').hstsMaxAge).toBe(0);
    expect(
      readFlowServerConfig({ OPENVERIFY_HSTS_MAX_AGE: String(YEAR) }, '/dist').hstsMaxAge,
    ).toBe(YEAR);
    expect(
      readFlowServerConfig({ OPENVERIFY_HSTS_MAX_AGE: String(HSTS_MAX_AGE_LIMIT) }, '/dist')
        .hstsMaxAge,
    ).toBe(63_072_000);
  });

  it.each(['-1', '63072001', '1e5', 'one-year', '12.5'])(
    'refuses %s, naming the variable',
    (value) => {
      let refusal: unknown;
      try {
        readFlowServerConfig({ OPENVERIFY_HSTS_MAX_AGE: value }, '/dist');
      } catch (error) {
        refusal = error;
      }
      expect(refusal).toBeInstanceOf(FlowServerConfigError);
      expect((refusal as FlowServerConfigError).issues).toEqual([
        'OPENVERIFY_HSTS_MAX_AGE: must be a whole number of seconds from 0 to 63072000',
      ]);
    },
  );
});

describe("the entries' headers (C255.1)", () => {
  it('add Strict-Transport-Security above 0, on top of FLOW_RESPONSE_HEADERS', () => {
    for (const headers of [
      hostedHeaders({ apiOrigin: API, hstsMaxAge: YEAR }),
      embedHeaders({ apiOrigin: API, hstsMaxAge: YEAR }, ['https://shop.example.com']),
      previewHeaders({ consoleOrigin: CONSOLE, hstsMaxAge: YEAR }),
    ]) {
      expect(headers['Strict-Transport-Security']).toBe(HSTS);
      expect(headers['Referrer-Policy']).toBe(FLOW_RESPONSE_HEADERS['Referrer-Policy']);
    }
    expect(FLOW_RESPONSE_HEADERS['Strict-Transport-Security']).toBeUndefined();
  });

  it('send none at 0 or when unset', () => {
    for (const headers of [
      hostedHeaders({ apiOrigin: API }),
      hostedHeaders({ apiOrigin: API, hstsMaxAge: 0 }),
      embedHeaders({ apiOrigin: API, hstsMaxAge: 0 }, []),
      previewHeaders({ consoleOrigin: CONSOLE }),
    ]) {
      expect(headers['Strict-Transport-Security']).toBeUndefined();
    }
  });
});

describe('every response of a running flow server (C255.1)', () => {
  let root: string;
  let withHsts: RunningFlowServer;
  let without: RunningFlowServer;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'openverify-flow-hsts-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(
      join(root, 'index.html'),
      '<!doctype html><html><head></head><body></body></html>',
    );
    writeFileSync(
      join(root, 'preview.html'),
      '<!doctype html><html><head></head><body></body></html>',
    );
    writeFileSync(join(root, 'assets', 'index-Abc123de.js'), 'export {};');
    const start = (hstsMaxAge: number) =>
      startFlowServer({
        config: {
          distDir: root,
          apiOrigin: API,
          consoleOrigin: CONSOLE,
          lookup: null,
          trustedProxyHops: 0,
          hstsMaxAge,
        },
        hostname: '127.0.0.1',
        port: 0,
        now: () => 1_000_000,
        log: () => undefined,
      });
    withHsts = await start(YEAR);
    without = await start(0);
  });

  afterAll(async () => {
    await withHsts.close();
    await without.close();
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ['/', 200],
    ['/preview', 200],
    ['/embed/inq_01M5CJXHG07XPHF3HRM6NREDH7', 200],
    ['/assets/index-Abc123de.js', 200],
    ['/assets/missing.js', 404],
  ])('sends it on %s (%i) and only when set', async (path, status) => {
    const on = await fetch(new URL(path, withHsts.url));
    const off = await fetch(new URL(path, without.url));

    expect(on.status).toBe(status);
    expect(on.headers.get('strict-transport-security')).toBe(HSTS);
    expect(off.headers.get('strict-transport-security')).toBeNull();
  });

  it('sends it on a refused method too', async () => {
    const refused = await fetch(new URL('/', withHsts.url), { method: 'POST' });

    expect(refused.status).toBe(405);
    expect(refused.headers.get('strict-transport-security')).toBe(HSTS);
  });
});
