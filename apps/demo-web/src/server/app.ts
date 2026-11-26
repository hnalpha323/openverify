/**
 * The sample site's small server (plan C266.3): it creates an inquiry with the API key it holds,
 * receives the API's webhooks and verifies them with `@openverify/node`, and serves the built page.
 *
 * | Route                                  | What it does                                          |
 * | -------------------------------------- | ----------------------------------------------------- |
 * | `GET /api/config`                      | the flow URL the page embeds from                     |
 * | `POST /api/inquiries`                  | creates an inquiry and its session for the page       |
 * | `GET /api/inquiries/:id/result`        | the result from a verified webhook, else from the API |
 * | `POST /webhooks/openverify`            | the API's webhook, verified before anything is kept   |
 * | `GET /`, `GET /assets/*`               | the built page                                        |
 *
 * The API key and the webhook secret never reach the browser or a log line. Of a webhook only the
 * inquiry id, its status and the event name are kept (in memory): never a field, a name or a
 * document value. The flow's completion in the browser is a hint; the server decides.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import {
  createClient,
  OPENVERIFY_SIGNATURE_HEADER,
  verifyWebhookSignature,
  type OpenVerifyClient,
} from '@openverify/node';
import type { DemoConfig } from './config.ts';

/** What the server keeps of a verified webhook: never a field, a name or a document value. */
export interface DemoResult {
  readonly inquiryId: string;
  readonly status: string;
  readonly event: string;
  readonly source: 'webhook' | 'api';
}

export interface DemoServerOptions {
  readonly config: DemoConfig;
  readonly client?: OpenVerifyClient;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
}

export type DemoHandler = (request: IncomingMessage, response: ServerResponse) => void;

const MAX_BODY_BYTES = 1024 * 1024;
const INQUIRY_ID = /^inq_[0-9A-HJKMNP-TV-Z]{26}$/;
const RESULT_PATH = /^\/api\/inquiries\/([^/]+)\/result$/;
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

class BodyTooLargeError extends Error {}

/** The request body, refused past `MAX_BODY_BYTES`. */
function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError());
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { ...BASE_HEADERS, 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

/** The member at `path` of a parsed JSON value, if every step is an object. */
function memberAt(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Why a call to the API failed, without its message (which could echo a request). */
const failureOf = (error: unknown): string => {
  const name = error instanceof Error ? error.name : typeof error;
  const status = memberAt(error, ['status']);
  return typeof status === 'number' ? `${name} ${String(status)}` : name;
};

export function createDemoHandler(options: DemoServerOptions): DemoHandler {
  const { config } = options;
  const client = options.client ?? createClient({ apiKey: config.apiKey, baseUrl: config.apiUrl });
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const results = new Map<string, DemoResult>();
  const flowOrigin = new URL(config.flowUrl).origin;
  const pageHeaders = {
    ...BASE_HEADERS,
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      `frame-src ${flowOrigin}`,
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  };

  const createInquiry = async (response: ServerResponse): Promise<void> => {
    try {
      const { data } = await client.inquiries.create({
        'inquiry-template-id': config.templateId,
        'reference-id': `demo-${randomBytes(8).toString('hex')}`,
      });
      const { meta } = await client.inquiries.resume(data.id);
      log(`inquiry ${data.id} created`);
      sendJson(response, 201, { inquiryId: data.id, sessionToken: meta['session-token'] });
    } catch (error) {
      log(`inquiry creation failed: ${failureOf(error)}`);
      sendJson(response, 502, { error: 'api_unavailable' });
    }
  };

  const result = async (response: ServerResponse, inquiryId: string): Promise<void> => {
    if (!INQUIRY_ID.test(inquiryId)) {
      sendJson(response, 400, { error: 'invalid_inquiry_id' });
      return;
    }
    const fromWebhook = results.get(inquiryId);
    if (fromWebhook !== undefined) {
      sendJson(response, 200, fromWebhook);
      return;
    }
    try {
      const { data } = await client.inquiries.retrieve(inquiryId);
      sendJson(response, 200, {
        inquiryId,
        status: data.attributes.status,
        event: null,
        source: 'api',
      });
    } catch (error) {
      log(`inquiry ${inquiryId} could not be read: ${failureOf(error)}`);
      sendJson(response, 502, { error: 'api_unavailable' });
    }
  };

  const webhook = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    let body: Buffer;
    try {
      body = await readBody(request);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        sendJson(response, 413, { error: 'body_too_large' });
        return;
      }
      throw error;
    }
    try {
      verifyWebhookSignature({
        body,
        header: request.headers[OPENVERIFY_SIGNATURE_HEADER],
        secrets: config.webhookSecret,
        now: now(),
      });
    } catch {
      log('webhook refused: its signature did not verify');
      sendJson(response, 400, { error: 'invalid_signature' });
      return;
    }
    let event: unknown;
    try {
      event = JSON.parse(body.toString('utf8'));
    } catch {
      sendJson(response, 400, { error: 'invalid_event' });
      return;
    }
    const name = memberAt(event, ['data', 'attributes', 'name']);
    const subject = memberAt(event, ['data', 'attributes', 'payload', 'data']);
    const inquiryId = memberAt(subject, ['id']);
    const status = memberAt(subject, ['attributes', 'status']);
    if (
      typeof name === 'string' &&
      memberAt(subject, ['type']) === 'inquiry' &&
      typeof inquiryId === 'string' &&
      INQUIRY_ID.test(inquiryId) &&
      typeof status === 'string'
    ) {
      results.set(inquiryId, { inquiryId, status, event: name, source: 'webhook' });
      log(`webhook ${name} for ${inquiryId}`);
    }
    response.writeHead(204, BASE_HEADERS);
    response.end();
  };

  const page = (request: IncomingMessage, response: ServerResponse, path: string): void => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { ...BASE_HEADERS, allow: 'GET, HEAD' });
      response.end();
      return;
    }
    let relative: string;
    try {
      relative = path === '/' ? 'index.html' : decodeURIComponent(path).replace(/^\/+/, '');
    } catch {
      relative = '';
    }
    // The real path, links resolved, must stay inside the build's real path.
    const file = normalize(join(config.staticDir, relative));
    const real = existsSync(file) ? realpathSync(file) : '';
    const inside = real.startsWith(`${realpathSync(config.staticDir)}${sep}`);
    if (relative === '' || !inside || !statSync(real).isFile()) {
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    const type = CONTENT_TYPES[extname(real)] ?? 'application/octet-stream';
    response.writeHead(200, {
      ...(type.startsWith('text/html') ? pageHeaders : BASE_HEADERS),
      'content-type': type,
    });
    response.end(request.method === 'HEAD' ? undefined : readFileSync(real));
  };

  return (request, response) => {
    const path = new URL(request.url ?? '/', 'http://demo.invalid').pathname;
    const method = request.method ?? 'GET';
    const resultMatch = RESULT_PATH.exec(path);
    let work: Promise<void> | undefined;
    if (method === 'GET' && path === '/api/config') {
      sendJson(response, 200, { flowUrl: config.flowUrl });
    } else if (method === 'POST' && path === '/api/inquiries') {
      request.resume();
      work = createInquiry(response);
    } else if (method === 'GET' && resultMatch !== null) {
      work = result(response, resultMatch[1] ?? '');
    } else if (method === 'POST' && path === '/webhooks/openverify') {
      work = webhook(request, response);
    } else if (path.startsWith('/api/') || path.startsWith('/webhooks/')) {
      request.resume();
      sendJson(response, 404, { error: 'not_found' });
    } else {
      page(request, response, path);
    }
    work?.catch((error: unknown) => {
      log(`request failed: ${failureOf(error)}`);
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'internal_error' });
      }
    });
  };
}

export function startDemoServer(options: DemoServerOptions): Promise<Server> {
  const server = createServer(createDemoHandler(options));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.config.port, options.config.host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
