// @vitest-environment node
/**
 * C157.1, C157.2 (Workflow 9A, flow-server-embed): the flow server on a real socket over a synthetic
 * `dist/`: each entry with its headers, `dist/` served with path traversal refused, known
 * extensions only, `nosniff`, immutable hashed assets and `no-store` documents; the embed entry's
 * id checked before anything else and a per-client limit before any lookup; an access log with
 * the entry and the status, never the path. Paths are sent raw (`node:http`), so the client
 * normalises nothing.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PREVIEW_CONSOLE_ORIGIN_META,
  startFlowServer,
  type AccessLogLine,
  type FlowServerConfig,
  type RunningFlowServer,
} from '../../server.ts';

/** The URL a fetch was called with. */
const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

const TOKEN = 'synthetic-flow-server-token-current-0123456789';
const INQUIRY_ID = 'inq_01M5CJXHG07XPHF3HRM6NREDH7';
const UNKNOWN_ID = 'inq_01M5CK16P0D13FXHZSS4TCFBVH';
const SHOP = 'https://shop.example.com';
const CONSOLE = 'https://console.example.com';
const SECRET = 'outside-dist-synthetic-secret';

interface Answer {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

function send(
  server: RunningFlowServer,
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<Answer> {
  const url = new URL(server.url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: url.hostname,
        port: url.port,
        path,
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const frameAncestors = (answer: Answer): string | undefined =>
  String(answer.headers['content-security-policy'])
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('frame-ancestors'));

let root: string;
let dist: string;
let server: RunningFlowServer;
let otherServer: RunningFlowServer;
const log: AccessLogLine[] = [];
const fetchPolicy = vi.fn((input: string | URL | Request) => {
  const id = decodeURIComponent(urlOf(input).split('/').pop() ?? '');
  return Promise.resolve(
    id === INQUIRY_ID
      ? new Response(
          JSON.stringify({
            'inquiry-id': INQUIRY_ID,
            'template-id': 'itmpl_01M5CJXHG07XPHF3HRM6NREDH7',
            'environment-id': 'env_01M5CJXHG07XPHF3HRM6NREDH7',
            'frame-ancestors': [SHOP],
          }),
          { status: 200 },
        )
      : new Response('{}', { status: 404 }),
  );
});

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'openverify-flow-server-'));
  dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  mkdirSync(join(dist, 'guidance'));
  mkdirSync(join(dist, 'licenses', 'example'), { recursive: true });
  writeFileSync(
    join(dist, 'index.html'),
    '<!doctype html><html><head></head><body>hosted</body></html>',
  );
  writeFileSync(
    join(dist, 'preview.html'),
    '<!doctype html><html><head><title>p</title></head><body>preview</body></html>',
  );
  writeFileSync(join(dist, 'assets', 'index-Abc123de.js'), 'export {};');
  writeFileSync(join(dist, 'assets', 'index-Abc123de.css'), 'body{}');
  writeFileSync(join(dist, 'assets', 'notes.exe'), 'MZ');
  writeFileSync(join(dist, 'guidance', 'model.onnx'), 'onnx');
  writeFileSync(join(dist, 'licenses', 'example', 'LICENSE'), 'MIT');
  writeFileSync(join(root, 'secret.txt'), SECRET);

  const config: FlowServerConfig = {
    distDir: dist,
    apiOrigin: 'https://api.example.com',
    consoleOrigin: CONSOLE,
    lookup: { apiUrl: 'http://api.internal:3000', token: TOKEN },
    trustedProxyHops: 1,
  };
  const start = (fetch: typeof globalThis.fetch) =>
    startFlowServer({
      config,
      hostname: '127.0.0.1',
      port: 0,
      fetch,
      now: () => 1_000_000,
      log: (line) => log.push(line),
    });
  server = await start(fetchPolicy);
  otherServer = await start(fetchPolicy);
});

afterAll(async () => {
  await server.close();
  await otherServer.close();
  rmSync(root, { recursive: true, force: true });
});

describe('the hosted entry', () => {
  it('serves index.html at / and at any route, with the hosted headers', async () => {
    for (const path of ['/', '/index.html', '/anything/else?language=ar']) {
      const answer = await send(server, path);
      expect(answer.status, path).toBe(200);
      expect(answer.body).toContain('hosted');
      expect(answer.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(frameAncestors(answer)).toBe("frame-ancestors 'none'");
      expect(answer.headers['x-frame-options']).toBe('DENY');
      expect(answer.headers['cache-control']).toBe('no-store');
      expect(answer.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('answers HEAD with the headers and no body, and 405 to other methods', async () => {
    const head = await send(server, '/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['x-frame-options']).toBe('DENY');

    const post = await send(server, '/', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe('GET, HEAD');
    expect(frameAncestors(post)).toBe("frame-ancestors 'none'");
  });
});

describe('dist/ (C157.1)', () => {
  it('serves hashed assets immutable, other files revalidated, each with nosniff', async () => {
    const script = await send(server, '/assets/index-Abc123de.js');
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(script.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(script.headers['x-content-type-options']).toBe('nosniff');

    const style = await send(server, '/assets/index-Abc123de.css');
    expect(style.headers['content-type']).toBe('text/css; charset=utf-8');

    const model = await send(server, '/guidance/model.onnx');
    expect(model.status).toBe(200);
    expect(model.headers['content-type']).toBe('application/octet-stream');
    expect(model.headers['cache-control']).toBe('no-cache');

    const licence = await send(server, '/licenses/example/LICENSE');
    expect(licence.status).toBe(200);
    expect(licence.headers['content-type']).toBe('text/plain; charset=utf-8');
  });

  it('refuses an unknown extension and a missing file with 404', async () => {
    for (const path of ['/assets/notes.exe', '/assets/missing-Abc123de.js', '/server.ts']) {
      const answer = await send(server, path);
      expect(answer.status, path).toBe(404);
      expect(frameAncestors(answer)).toBe("frame-ancestors 'none'");
    }
  });

  it('refuses path traversal however it is spelt, and never serves outside dist', async () => {
    for (const path of [
      '/../secret.txt',
      '/assets/../../secret.txt',
      '/%2e%2e/secret.txt',
      '/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
      '/assets/..%5c..%5csecret.txt',
      '/%00.js',
      '/assets/%E0%A4%A.js',
      '//secret.txt',
    ]) {
      const answer = await send(server, path);
      expect([400, 404], path).toContain(answer.status);
      expect(answer.body, path).not.toContain(SECRET);
    }
  });
});

describe('the preview entry (C156.3)', () => {
  it('serves preview.html with the preview headers and the console origin for the protocol', async () => {
    for (const path of ['/preview', '/preview.html']) {
      const answer = await send(server, path);
      expect(answer.status, path).toBe(200);
      expect(answer.body).toContain('preview');
      expect(answer.body).toContain(
        `<meta name="${PREVIEW_CONSOLE_ORIGIN_META}" content="${CONSOLE}">`,
      );
      expect(frameAncestors(answer)).toBe(`frame-ancestors ${CONSOLE}`);
      expect(String(answer.headers['content-security-policy'])).toContain("connect-src 'none'");
      expect(answer.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
      expect(answer.headers['cache-control']).toBe('no-store');
    }
  });
});

describe('the embed entry (C157.1, C157.2)', () => {
  it("frames the inquiry's origins only", async () => {
    const answer = await send(server, `/embed/${INQUIRY_ID}`);
    expect(answer.status).toBe(200);
    expect(answer.body).toContain('hosted');
    expect(frameAncestors(answer)).toBe(`frame-ancestors ${SHOP}`);
    expect(answer.headers['x-frame-options']).toBeUndefined();
    expect(answer.headers['cache-control']).toBe('no-store');
  });

  it("answers an unknown inquiry the same 200 with 'none'", async () => {
    const answer = await send(server, `/embed/${UNKNOWN_ID}`);
    expect(answer.status).toBe(200);
    expect(frameAncestors(answer)).toBe("frame-ancestors 'none'");
  });

  it("answers a malformed id 404 with 'none' and makes no lookup", async () => {
    fetchPolicy.mockClear();
    for (const path of ['/embed/inq_short', `/embed/${INQUIRY_ID}/more`, '/embed/']) {
      const answer = await send(server, path);
      expect(answer.status, path).toBe(404);
      expect(frameAncestors(answer), path).toBe("frame-ancestors 'none'");
    }
    // A traversal spelt into the id is refused with the other traversals, before the entry.
    const traversal = await send(server, '/embed/..%2f..%2fadmin');
    expect(traversal.status).toBe(400);
    expect(frameAncestors(traversal)).toBe("frame-ancestors 'none'");
    expect(fetchPolicy).not.toHaveBeenCalled();
  });

  it("limits each client before any lookup, leaving another client's header alone", async () => {
    fetchPolicy.mockClear();
    const burst = { 'x-forwarded-for': '203.0.113.66' };
    const answers: Answer[] = [];
    for (let i = 0; i < 61; i += 1) {
      answers.push(await send(otherServer, `/embed/${UNKNOWN_ID}`, { headers: burst }));
    }
    const limited = answers.at(-1);
    expect(answers.slice(0, 60).every((answer) => answer.status === 200)).toBe(true);
    expect(limited?.status).toBe(429);
    expect(limited?.headers['retry-after']).toBe('1');
    expect(limited === undefined ? undefined : frameAncestors(limited)).toBe(
      "frame-ancestors 'none'",
    );
    // The 60 refusals were cached: one lookup for the unknown id.
    expect(fetchPolicy).toHaveBeenCalledTimes(1);

    const other = await send(otherServer, `/embed/${INQUIRY_ID}`, {
      headers: { 'x-forwarded-for': '198.51.100.20' },
    });
    expect(other.status).toBe(200);
    expect(frameAncestors(other)).toBe(`frame-ancestors ${SHOP}`);
  });
});

describe('the access log (C157.1)', () => {
  it('names the entry and the status, never the path, the id or the address', async () => {
    log.length = 0;
    await send(server, `/embed/${INQUIRY_ID}`, { headers: { 'x-forwarded-for': '203.0.113.99' } });
    await send(server, '/preview');
    await send(server, '/assets/index-Abc123de.js');
    await send(server, '/../secret.txt');

    expect(log).toEqual([
      { entry: 'embed', status: 200 },
      { entry: 'preview', status: 200 },
      { entry: 'asset', status: 200 },
      { entry: 'refused', status: 400 },
    ]);
    expect(JSON.stringify(log)).not.toMatch(/inq_|203\.0\.113|secret|assets/);
  });
});
