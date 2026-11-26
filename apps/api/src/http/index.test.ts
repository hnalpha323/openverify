/**
 * C54.6 (P07): the outbound HTTP client. A local server on 127.0.0.1 answers; to reach it a
 * client must be created with `allowPrivateNetworks` (as only the EVM RPC client is), which also
 * proves every other client is refused it. Host names resolve through an injected resolver, so
 * nothing here touches the internet or real DNS. Every value is synthetic.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  OutboundHttpError,
  createOutboundHttp,
  type OutboundHttp,
  type OutboundHttpClientOptions,
} from './index.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let server: Server;
let port = 0;
let handler: Handler = (_request, response) => response.end();
const hits: string[] = [];
const resolved: string[] = [];
let http: OutboundHttp;

beforeAll(async () => {
  server = createServer((request, response) => {
    hits.push(`${request.method ?? ''} ${request.url ?? ''}`);
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  http = createOutboundHttp({
    resolve: (hostname) => {
      resolved.push(hostname);
      return Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
    },
  });
});

afterEach(() => {
  hits.length = 0;
  resolved.length = 0;
  delete process.env.HTTP_PROXY;
  delete process.env.HTTPS_PROXY;
});

afterAll(async () => {
  await http.close();
  await new Promise((resolve) => server.close(resolve));
});

/** A client allowed onto the loopback server: the EVM RPC client's settings (decision 22). */
const rpcLike = (options: Partial<OutboundHttpClientOptions> = {}) =>
  http.client({
    name: 'synthetic-rpc',
    contentTypes: ['application/json'],
    allowPrivateNetworks: true,
    allowPlainHttp: true,
    ...options,
  });

const json =
  (status: number, body: unknown): Handler =>
  (_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  };

async function failure(promise: Promise<unknown>): Promise<OutboundHttpError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OutboundHttpError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an OutboundHttpError');
}

describe('the vetted lookup and private networks (P07)', () => {
  it('resolves the name through the vetted lookup and refuses a private answer, connecting nowhere', async () => {
    const client = http.client({ name: 'rdap', contentTypes: ['application/rdap+json'] });

    const error = await failure(
      client.request({ method: 'GET', url: `https://rdap.example.test:${String(port)}/domain/x` }),
    );

    expect(error).toMatchObject({ code: 'blocked', retryable: false });
    expect(resolved).toEqual(['rdap.example.test']);
    expect(hits).toEqual([]);
  });

  it('refuses a literal private address before connecting', async () => {
    const client = http.client({ name: 'gleif', contentTypes: ['application/json'] });

    const error = await failure(
      client.request({ method: 'GET', url: `https://127.0.0.1:${String(port)}/x` }),
    );

    expect(error.code).toBe('blocked');
    expect(hits).toEqual([]);
  });

  it('reaches a private network only for a client created to, through the same lookup', async () => {
    handler = json(200, { result: '0x' });

    const response = await rpcLike().request({
      method: 'POST',
      url: `http://rpc.example.test:${String(port)}/`,
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"eth_getCode"}',
    });

    expect(response.status).toBe(200);
    expect(response.contentType).toBe('application/json');
    expect(JSON.parse(new TextDecoder().decode(response.body))).toEqual({ result: '0x' });
    expect(resolved).toEqual(['rpc.example.test']);
    expect(hits).toEqual(['POST /']);
  });

  it('ignores HTTP_PROXY and HTTPS_PROXY', async () => {
    handler = json(200, {});
    process.env.HTTP_PROXY = 'http://proxy.invalid:1';
    process.env.HTTPS_PROXY = 'http://proxy.invalid:1';

    const response = await rpcLike().request({
      method: 'GET',
      url: `http://rpc.example.test:${String(port)}/direct`,
    });

    expect(response.status).toBe(200);
    expect(hits).toEqual(['GET /direct']);
  });
});

describe('redirects, caps and content types', () => {
  it('returns a 302 without following it, its body discarded and its location kept (K2)', async () => {
    handler = (request, response) => {
      if (request.url === '/moved') {
        response.writeHead(302, {
          location: `/target`,
          'content-type': 'text/html',
          'set-cookie': 'session=synthetic',
        });
        response.end('<a href="/target">moved</a>');
        return;
      }
      json(200, { followed: true })(request, response);
    };

    const response = await rpcLike().request({
      method: 'GET',
      url: `http://rpc.example.test:${String(port)}/moved`,
    });

    expect(response).toEqual({
      status: 302,
      contentType: null,
      body: new Uint8Array(),
      headers: { location: '/target' },
    });
    expect(hits).toEqual(['GET /moved']);
  });

  it('keeps a 2xx answer’s expires and cache-control, and no other header (K5)', async () => {
    handler = (_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/json',
        expires: 'Sat, 26 Oct 2026 12:00:00 GMT',
        'cache-control': 'max-age=172800',
        'set-cookie': 'session=synthetic',
        etag: '"synthetic"',
      });
      response.end('{}');
    };

    const response = await rpcLike().request({
      method: 'GET',
      url: `http://rpc.example.test:${String(port)}/dns.json`,
    });

    expect(response.headers).toEqual({
      expires: 'Sat, 26 Oct 2026 12:00:00 GMT',
      'cache-control': 'max-age=172800',
    });
  });

  it('gives a 2xx answer without those headers none', async () => {
    handler = json(200, {});

    const response = await rpcLike().request({
      method: 'GET',
      url: `http://rpc.example.test:${String(port)}/`,
    });

    expect(response).toEqual({
      status: 200,
      contentType: 'application/json',
      body: new TextEncoder().encode('{}'),
    });
  });

  it('discards the body of any answer that is not 2xx', async () => {
    handler = json(503, { error: 'synthetic provider detail' });

    const response = await rpcLike().request({
      method: 'GET',
      url: `http://rpc.example.test:${String(port)}/`,
    });

    expect(response).toEqual({ status: 503, contentType: null, body: new Uint8Array() });
  });

  it('refuses an answer larger than the client’s cap, 1 MiB by default', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(`"${'x'.repeat(4096)}"`);
    };

    expect(DEFAULT_MAX_RESPONSE_BYTES).toBe(1_048_576);
    const error = await failure(
      rpcLike({ maxResponseBytes: 1024 }).request({
        method: 'GET',
        url: `http://rpc.example.test:${String(port)}/big`,
      }),
    );
    expect(error).toMatchObject({ code: 'too_large', retryable: false });
  });

  it('refuses a 2xx answer of a content type the client does not accept', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html></html>');
    };

    const error = await failure(
      rpcLike().request({ method: 'GET', url: `http://rpc.example.test:${String(port)}/` }),
    );
    expect(error.code).toBe('content_type');
  });

  // Workflow 5C review K3: the Netherlands and Swiss master lists come without a Content-Type.
  describe('a 2xx answer without a Content-Type', () => {
    const untyped: Handler = (_request, response) => {
      response.writeHead(200);
      response.end(Buffer.from([0x30, 0x03, 0x02, 0x01, 0x01]));
    };

    it('is refused by default', async () => {
      handler = untyped;

      const error = await failure(
        rpcLike().request({ method: 'GET', url: `http://rpc.example.test:${String(port)}/ml` }),
      );
      expect(error.code).toBe('content_type');
    });

    it('is taken by a client that opts in, its content type null', async () => {
      handler = untyped;

      const response = await rpcLike({ acceptMissingContentType: true }).request({
        method: 'GET',
        url: `http://rpc.example.test:${String(port)}/ml`,
      });
      expect(response).toEqual({
        status: 200,
        contentType: null,
        body: new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01]),
      });
    });

    it('still refuses a wrong Content-Type, and the cap, for a client that opts in', async () => {
      handler = (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<html></html>');
      };
      const wrong = await failure(
        rpcLike({ acceptMissingContentType: true }).request({
          method: 'GET',
          url: `http://rpc.example.test:${String(port)}/ml`,
        }),
      );
      expect(wrong.code).toBe('content_type');

      handler = (_request, response) => {
        response.writeHead(200);
        response.end(Buffer.alloc(2048));
      };
      const big = await failure(
        rpcLike({ acceptMissingContentType: true, maxResponseBytes: 1024 }).request({
          method: 'GET',
          url: `http://rpc.example.test:${String(port)}/ml`,
        }),
      );
      expect(big.code).toBe('too_large');
    });

    it('is opted into by the trust-store sync alone', () => {
      const root = path.resolve(import.meta.dirname, '..');
      const sources = (readdirSync(root, { recursive: true }) as string[])
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
        .filter((file) =>
          readFileSync(path.join(root, file), 'utf8').includes('acceptMissingContentType'),
        )
        .map((file) => file.split(path.sep).join('/'))
        .sort();
      expect(sources).toEqual(['http/index.ts', 'trust-anchors/sync.ts']);
    });
  });

  it('times out, retryably', async () => {
    handler = (_request, response) => {
      setTimeout(() => response.end('{}'), 1_000).unref();
    };

    const error = await failure(
      rpcLike({ timeoutMs: 100 }).request({
        method: 'GET',
        url: `http://rpc.example.test:${String(port)}/slow`,
      }),
    );
    expect(error).toMatchObject({ code: 'timeout', retryable: true });
  });
});

describe('URLs and error messages', () => {
  it.each([
    ['plain http without allowPlainHttp', 'http://registry.example.test/x'],
    ['credentials in the URL', 'https://user:synthetic-secret@registry.example.test/x'],
    ['another scheme', 'ftp://registry.example.test/x'],
    ['no URL at all', 'not a url'],
  ])('refuses %s', async (_label, url) => {
    const client = http.client({ name: 'registry', contentTypes: ['application/json'] });

    const error = await failure(client.request({ method: 'GET', url }));

    expect(error.code).toBe('invalid_url');
    expect(hits).toEqual([]);
  });

  it('never puts the URL, its query or a body in an error', async () => {
    const client = http.client({ name: 'twilio', contentTypes: ['application/json'] });
    const url = `https://secret-host.example.test:${String(port)}/Accounts/AC-synthetic?To=%2B15550100014`;

    const error = await failure(
      client.request({ method: 'POST', url, body: 'Body=synthetic-code-123456' }),
    );

    expect(error.message).toBe('twilio: outbound request failed (blocked)');
    for (const leaked of ['secret-host', 'AC-synthetic', '15550100014', '123456']) {
      expect(error.message).not.toContain(leaked);
      expect(JSON.stringify(error)).not.toContain(leaked);
    }
  });
});
