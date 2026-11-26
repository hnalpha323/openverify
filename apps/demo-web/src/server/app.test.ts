// @vitest-environment node
/**
 * The sample site's server against a fake API (an injected `fetch`), on a loopback port: it holds
 * the API key and never sends it to the browser or a log, creates an inquiry and its session for
 * the page, verifies each webhook with `@openverify/node` and keeps only its id, status and event,
 * answers the page's result from a verified webhook or else from the API, and serves the built page.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, signWebhookPayload } from '@openverify/node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoHandler, startDemoServer } from './app.ts';
import type { DemoConfig } from './config.ts';

const REPO = join(import.meta.dirname, '../../../..');
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(REPO, 'contracts/fixtures/api', name), 'utf8')) as Record<
    string,
    unknown
  >;

const API_KEY = `ov_sbx_synthetic${'a'.repeat(32)}`;
const WEBHOOK_SECRET = `wbhsec_synthetic${'b'.repeat(32)}`;
const SESSION_TOKEN = `ovs_${'c'.repeat(43)}`;
const NOW = new Date('2026-11-15T12:00:00.000Z');
const inquiry = fixture('inquiry.json') as { data: { id: string } };
const INQUIRY_ID = inquiry.data.id;

interface ApiCall {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
  readonly body: unknown;
}

let staticDir: string;
let server: Server;
let base: string;
let calls: ApiCall[];
let logs: string[];
let apiDown: boolean;

const config = (): DemoConfig => ({
  host: '127.0.0.1',
  port: 0,
  apiUrl: 'http://api.example.test',
  apiKey: API_KEY,
  webhookSecret: WEBHOOK_SECRET,
  flowUrl: 'https://flow.example.test',
  templateId: 'itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6',
  staticDir,
});

/** The fake API: create, resume and retrieve an inquiry, as the contracts' fixtures shape them. */
const fakeFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const text = await request.text();
  calls.push({
    method: request.method,
    path: url.pathname,
    authorization: request.headers.get('authorization'),
    body: text === '' ? undefined : (JSON.parse(text) as unknown),
  });
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  if (apiDown) {
    return json(503, { type: 'about:blank', title: 'Unavailable', status: 503 });
  }
  if (request.method === 'POST' && url.pathname === '/api/v1/inquiries') {
    return json(201, inquiry);
  }
  if (request.method === 'POST' && url.pathname === `/api/v1/inquiries/${INQUIRY_ID}/resume`) {
    return json(200, {
      ...inquiry,
      meta: {
        'session-token': SESSION_TOKEN,
        'flow-url': `https://flow.example.test/#inquiry-id=${INQUIRY_ID}&session-token=${SESSION_TOKEN}`,
      },
    });
  }
  if (request.method === 'GET' && url.pathname === `/api/v1/inquiries/${INQUIRY_ID}`) {
    return json(200, inquiry);
  }
  return json(404, { type: 'about:blank', title: 'Not found', status: 404 });
};

beforeEach(async () => {
  staticDir = mkdtempSync(join(tmpdir(), 'openverify-demo-static-'));
  mkdirSync(join(staticDir, 'assets'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Sample</title>');
  writeFileSync(join(staticDir, 'assets', 'page.js'), 'console.log(1);');
  writeFileSync(join(staticDir, 'assets', 'page.css'), 'body{}');
  calls = [];
  logs = [];
  apiDown = false;
  const client = createClient({
    apiKey: API_KEY,
    baseUrl: 'http://api.example.test',
    fetch: fakeFetch,
    maxRetries: 0,
  });
  server = await startDemoServer({
    config: config(),
    client,
    now: () => NOW,
    log: (line) => logs.push(line),
  });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  rmSync(staticDir, { recursive: true, force: true });
});

const approvedEvent = (): string =>
  JSON.stringify({
    ...fixture('event-inquiry-approved.json'),
  });

async function deliver(body: string, secret = WEBHOOK_SECRET): Promise<Response> {
  return fetch(`${base}/webhooks/openverify`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'openverify-signature': signWebhookPayload(body, secret, Math.floor(NOW.getTime() / 1000)),
    },
    body,
  });
}

describe('the page configuration', () => {
  it('gives the page the flow URL and nothing secret', async () => {
    const response = await fetch(`${base}/api/config`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ flowUrl: 'https://flow.example.test' });
  });
});

describe('creating an inquiry', () => {
  it('creates it with the template and a synthetic reference, then its session, for the page', async () => {
    const response = await fetch(`${base}/api/inquiries`, { method: 'POST' });
    expect(response.status).toBe(201);
    const headers = JSON.stringify([...response.headers.entries()]);
    const body = await response.text();
    expect(JSON.parse(body) as unknown).toEqual({
      inquiryId: INQUIRY_ID,
      sessionToken: SESSION_TOKEN,
    });
    expect(`${headers}${body}`).not.toContain(API_KEY);
    expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /api/v1/inquiries',
      `POST /api/v1/inquiries/${INQUIRY_ID}/resume`,
    ]);
    expect(calls.every(({ authorization }) => authorization === `Bearer ${API_KEY}`)).toBe(true);
    const created = calls[0]?.body as { data: { attributes: Record<string, unknown> } };
    expect(created.data.attributes['inquiry-template-id']).toBe('itmpl_01M5A0GTG0RSTVX9PHA0V7P3X6');
    expect(created.data.attributes['reference-id']).toMatch(/^demo-[0-9a-f]{16}$/);
    expect(Object.keys(created.data.attributes).sort()).toEqual([
      'inquiry-template-id',
      'reference-id',
    ]);
  });

  it('answers 502 when the API fails, and logs no secret', async () => {
    apiDown = true;
    const response = await fetch(`${base}/api/inquiries`, { method: 'POST' });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'api_unavailable' });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain(API_KEY);
    expect(logs.join('\n')).not.toContain(WEBHOOK_SECRET);
  });
});

describe('webhooks and the result', () => {
  it('keeps a verified webhook as the result: its id, status and event only', async () => {
    const before = await fetch(`${base}/api/inquiries/${INQUIRY_ID}/result`);
    expect(await before.json()).toEqual({
      inquiryId: INQUIRY_ID,
      status: 'created',
      event: null,
      source: 'api',
    });

    const delivered = await deliver(approvedEvent());
    expect(delivered.status).toBe(204);
    const after = await fetch(`${base}/api/inquiries/${INQUIRY_ID}/result`);
    const text = await after.text();
    expect(JSON.parse(text)).toEqual({
      inquiryId: INQUIRY_ID,
      status: 'approved',
      event: 'inquiry.approved',
      source: 'webhook',
    });
    expect(text).not.toContain('Jane');
    expect(logs.join('\n')).not.toContain('Jane');
    expect(logs).toContain(`webhook inquiry.approved for ${INQUIRY_ID}`);
  });

  it('refuses a webhook whose signature does not verify, and keeps nothing of it', async () => {
    const refused = await deliver(approvedEvent(), `wbhsec_synthetic${'z'.repeat(32)}`);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'invalid_signature' });
    const unsigned = await fetch(`${base}/webhooks/openverify`, {
      method: 'POST',
      body: approvedEvent(),
    });
    expect(unsigned.status).toBe(400);
    const result = await fetch(`${base}/api/inquiries/${INQUIRY_ID}/result`);
    expect(((await result.json()) as { source: string }).source).toBe('api');
  });

  it('ignores a verified event that is not about an inquiry', async () => {
    const event = JSON.stringify({
      data: {
        type: 'event',
        id: 'evt_01M5CKFVE0A1DPCWBWGY99VA5K',
        attributes: {
          name: 'account.created',
          payload: {
            data: { type: 'account', id: 'acc_01M5CJXJF84MR3PHJHBHKQ4ZC8', attributes: {} },
          },
        },
      },
    });
    expect((await deliver(event)).status).toBe(204);
    expect((await deliver('not json')).status).toBe(400);
  });

  it('refuses a body over 1 MiB and a malformed inquiry id', async () => {
    const huge = await deliver('x'.repeat(1024 * 1024 + 1));
    expect(huge.status).toBe(413);
    const malformed = await fetch(`${base}/api/inquiries/not-an-id/result`);
    expect(malformed.status).toBe(400);
  });

  it('answers 502 for the result when the API fails and no webhook came', async () => {
    apiDown = true;
    const response = await fetch(`${base}/api/inquiries/${INQUIRY_ID}/result`);
    expect(response.status).toBe(502);
  });
});

describe('the page', () => {
  it('serves the built page with headers that allow framing only the flow', async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('frame-src https://flow.example.test');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await response.text()).toContain('<title>Sample</title>');
  });

  it('serves assets with their types and nothing outside the build', async () => {
    const script = await fetch(`${base}/assets/page.js`);
    expect(script.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    const style = await fetch(`${base}/assets/page.css`);
    expect(style.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/assets/%2e%2e/%2e%2e/etc/passwd`)).status).toBe(404);
    expect((await fetch(`${base}/assets`)).status).toBe(404);
    const outside = mkdtempSync(join(tmpdir(), 'openverify-demo-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'outside the build');
    symlinkSync(join(outside, 'secret.txt'), join(staticDir, 'assets', 'linked.txt'));
    expect((await fetch(`${base}/assets/linked.txt`)).status).toBe(404);
    rmSync(outside, { recursive: true, force: true });
    expect((await fetch(`${base}/`, { method: 'DELETE' })).status).toBe(405);
  });
});

describe('createDemoHandler', () => {
  it('builds its own client from the configuration when none is given', () => {
    expect(typeof createDemoHandler({ config: config() })).toBe('function');
  });
});
