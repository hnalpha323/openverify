/**
 * C85.1 (F18): the streaming form of the outbound client, made only by the watchlist clients. A
 * local server on 127.0.0.1 answers, reached by clients created with `allowPrivateNetworks` and
 * `allowPlainHttp` (as no list client is: those two settings only let these tests reach the
 * loopback server); host names resolve through an injected resolver, so nothing here touches the
 * internet or real DNS. Every body is synthetic.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  OutboundHttpError,
  createOutboundHttp,
  type OutboundHttp,
  type OutboundStreamClientOptions,
  type OutboundStreamSink,
} from './index.js';
import { followableRedirect } from './stream.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let server: Server;
let port = 0;
let handler: Handler = (_request, response) => response.end();
const hits: { host: string; url: string; headers: IncomingMessage['headers'] }[] = [];
let http: OutboundHttp;

beforeAll(async () => {
  server = createServer((request, response) => {
    hits.push({
      host: request.headers.host ?? '',
      url: request.url ?? '',
      headers: request.headers,
    });
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  http = createOutboundHttp({
    resolve: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
  });
});

afterEach(() => {
  hits.length = 0;
});

afterAll(async () => {
  await http.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const LIST = () => `http://lists.example.test:${String(port)}/export/LIST.XML`;
const STORAGE = 'storage.example.test';

function client(options: Partial<OutboundStreamClientOptions> = {}) {
  if (http.streamClient === undefined) {
    throw new Error('the outbound client has no stream form');
  }
  return http.streamClient({
    name: 'synthetic-list',
    contentTypes: ['application/xml', 'text/xml'],
    timeoutMs: 5_000,
    allowPrivateNetworks: true,
    allowPlainHttp: true,
    ...options,
  });
}

function sink(): OutboundStreamSink & { chunks: Uint8Array[]; text(): string } {
  const chunks: Uint8Array[] = [];
  return {
    chunks,
    write(chunk) {
      chunks.push(chunk);
      return Promise.resolve();
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
  };
}

const xml =
  (body: string, headers: Record<string, string> = {}): Handler =>
  (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/xml; charset=utf-8', ...headers });
    response.end(body);
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

describe('streaming a list file (C85.1)', () => {
  it('writes the body to the sink, counts its bytes and returns only the headers it names', async () => {
    handler = xml('<synthetic-list/>', {
      etag: '"synthetic-etag"',
      'x-amz-meta-publication-id': '1075',
      'set-cookie': 'session=synthetic',
    });
    const out = sink();

    const response = await client({ exposeHeaders: ['etag', 'x-amz-meta-publication-id'] }).stream(
      { method: 'GET', url: LIST() },
      out,
    );

    expect(response).toEqual({
      status: 200,
      contentType: 'text/xml',
      headers: { etag: '"synthetic-etag"', 'x-amz-meta-publication-id': '1075' },
      bytes: 17,
    });
    expect(out.text()).toBe('<synthetic-list/>');
  });

  it('answers an error status with no body written', async () => {
    handler = (_request, response) => {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('synthetic not found');
    };
    const out = sink();

    const response = await client().stream({ method: 'GET', url: LIST() }, out);

    expect(response).toEqual({ status: 404, contentType: null, headers: {}, bytes: 0 });
    expect(out.chunks).toEqual([]);
  });

  it('refuses a 2xx answer of another content type before writing anything', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html>');
    };
    const out = sink();

    expect((await failure(client().stream({ method: 'GET', url: LIST() }, out))).code).toBe(
      'content_type',
    );
    expect(out.chunks).toEqual([]);
  });

  it('aborts a body over the cap, having written no more than the cap', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.end('x'.repeat(64 * 1024));
    };
    const out = sink();

    const error = await failure(
      client({ maxResponseBytes: 1024 }).stream({ method: 'GET', url: LIST() }, out),
    );

    expect(error.code).toBe('too_large');
    expect(Buffer.concat(out.chunks).byteLength).toBeLessThanOrEqual(1024);
  });

  it('completes a slow body within the deadline', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.write('<a>');
      setTimeout(() => response.end('</a>'), 150);
    };
    const out = sink();

    await client({ timeoutMs: 2_000, idleTimeoutMs: 1_000 }).stream(
      { method: 'GET', url: LIST() },
      out,
    );

    expect(out.text()).toBe('<a></a>');
  });

  it('aborts a body that runs past the whole request’s deadline, retryably', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' });
      const timer = setInterval(() => response.write('<a/>'), 50);
      response.on('close', () => {
        clearInterval(timer);
      });
    };

    const error = await failure(
      client({ timeoutMs: 400, idleTimeoutMs: 5_000 }).stream(
        { method: 'GET', url: LIST() },
        sink(),
      ),
    );

    expect(error).toMatchObject({ code: 'timeout', retryable: true });
  });

  it('aborts a body that stalls past the idle timeout', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.write('<a>');
    };

    const error = await failure(
      client({ timeoutMs: 5_000, idleTimeoutMs: 300 }).stream(
        { method: 'GET', url: LIST() },
        sink(),
      ),
    );

    expect(error.code).toBe('timeout');
  });
});

describe('the one allowed redirect (C85.1)', () => {
  const redirectTo =
    (location: string): Handler =>
    (request, response) => {
      if ((request.headers.host ?? '').startsWith(STORAGE)) {
        xml('<from-storage/>')(request, response);
        return;
      }
      response.writeHead(302, { location });
      response.end();
    };
  const storage = (path = '/Published/synthetic/LIST.XML?X-Amz-Signature=synthetic') =>
    `http://${STORAGE}:${String(port)}${path}`;

  it('follows one 302 to the exact allowed host, carrying no request header over', async () => {
    handler = redirectTo(storage());
    const out = sink();

    const response = await client({ redirect: { maxHops: 1, host: STORAGE } }).stream(
      { method: 'GET', url: LIST(), headers: { 'x-synthetic-credential': 'change-me-synthetic' } },
      out,
    );

    expect(response.status).toBe(200);
    expect(out.text()).toBe('<from-storage/>');
    expect(hits.map(({ host }) => host.split(':')[0])).toEqual(['lists.example.test', STORAGE]);
    expect(hits[0]?.headers['x-synthetic-credential']).toBe('change-me-synthetic');
    expect(hits[1]?.headers['x-synthetic-credential']).toBeUndefined();
  });

  it('refuses a redirect to another host without requesting it, and never names the location', async () => {
    handler = redirectTo(
      `http://elsewhere.example.test:${String(port)}/secret?X-Amz-Signature=synthetic`,
    );

    const error = await failure(
      client({ redirect: { maxHops: 1, host: STORAGE } }).stream(
        { method: 'GET', url: LIST() },
        sink(),
      ),
    );

    expect(error.code).toBe('blocked');
    expect(error.message).not.toMatch(/elsewhere|secret|Signature/);
    expect(hits).toHaveLength(1);
  });

  it('refuses a redirect to the allowed host on another port, without requesting it (owner decision 20 after 6B)', async () => {
    let otherHits = 0;
    const other = createServer((request, response) => {
      otherHits += 1;
      xml('<other-port/>')(request, response);
    });
    await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
    const otherPort = (other.address() as AddressInfo).port;
    try {
      handler = redirectTo(
        `http://${STORAGE}:${String(otherPort)}/Published/LIST.XML?X-Amz-Signature=synthetic`,
      );

      const error = await failure(
        client({ redirect: { maxHops: 1, host: STORAGE } }).stream(
          { method: 'GET', url: LIST() },
          sink(),
        ),
      );

      expect(error.code).toBe('blocked');
      expect(error.message).not.toMatch(/Published|Signature|\d{4,5}/);
      expect(otherHits).toBe(0);
      expect(hits).toHaveLength(1);
    } finally {
      other.closeAllConnections();
      await new Promise((resolve) => other.close(resolve));
    }
  });

  it('refuses a second hop', async () => {
    handler = (request, response) => {
      response.writeHead(302, {
        location: (request.headers.host ?? '').startsWith(STORAGE) ? LIST() : storage(),
      });
      response.end();
    };

    const error = await failure(
      client({ redirect: { maxHops: 1, host: STORAGE } }).stream(
        { method: 'GET', url: LIST() },
        sink(),
      ),
    );

    expect(error.code).toBe('blocked');
    expect(hits).toHaveLength(2);
  });

  it('refuses any redirect for a client that allows none', async () => {
    handler = redirectTo(storage());

    expect((await failure(client().stream({ method: 'GET', url: LIST() }, sink()))).code).toBe(
      'blocked',
    );
    expect(hits).toHaveLength(1);
  });

  it('decides which locations may be followed: HTTPS, the exact host, no credentials', () => {
    const base = new URL('https://lists.example.test/export/LIST.XML');
    const rule = { host: STORAGE, allowPlainHttp: false };

    expect(followableRedirect(`https://${STORAGE}/Published/LIST.XML`, base, rule)?.hostname).toBe(
      STORAGE,
    );
    expect(followableRedirect(`https://${STORAGE.toUpperCase()}/x`, base, rule)?.hostname).toBe(
      STORAGE,
    );
    expect(followableRedirect(`http://${STORAGE}/x`, base, rule)).toBeNull();
    expect(followableRedirect(`https://user:pass@${STORAGE}/x`, base, rule)).toBeNull();
    expect(followableRedirect(`https://sub.${STORAGE}/x`, base, rule)).toBeNull();
    expect(followableRedirect('/relative/on/the/same/host', base, rule)).toBeNull();
    expect(followableRedirect('not a url at all', base, rule)).toBeNull();
    expect(followableRedirect(undefined, base, rule)).toBeNull();
    const plainBase = new URL('http://lists.example.test/export/LIST.XML');
    expect(
      followableRedirect(`http://${STORAGE}/x`, plainBase, { ...rule, allowPlainHttp: true }),
    ).not.toBeNull();
  });

  it('keeps the scheme, the host and the port (owner decision 20 after 6B)', () => {
    const base = new URL('https://lists.example.test/export/LIST.XML');
    const rule = { host: STORAGE, allowPlainHttp: false };

    // The scheme's default port, written or not, is the same port.
    expect(followableRedirect(`https://${STORAGE}:443/x`, base, rule)?.hostname).toBe(STORAGE);
    expect(followableRedirect(`https://${STORAGE}:8443/x`, base, rule)).toBeNull();
    expect(followableRedirect(`https://${STORAGE}:80/x`, base, rule)).toBeNull();
    const onPort = new URL('https://lists.example.test:8443/export/LIST.XML');
    expect(followableRedirect(`https://${STORAGE}:8443/x`, onPort, rule)?.port).toBe('8443');
    expect(followableRedirect(`https://${STORAGE}/x`, onPort, rule)).toBeNull();
    // A client allowed plain HTTP still never changes scheme on the redirect, either way.
    const plain = { ...rule, allowPlainHttp: true };
    expect(followableRedirect(`http://${STORAGE}/x`, base, plain)).toBeNull();
    const plainBase = new URL('http://lists.example.test/export/LIST.XML');
    expect(followableRedirect(`https://${STORAGE}/x`, plainBase, plain)).toBeNull();
  });
});

describe('URLs', () => {
  it('refuses a URL with credentials, and a literal private address for a client without the allowance', async () => {
    expect(
      (
        await failure(
          client().stream({ method: 'GET', url: 'https://user:pass@lists.example.test/x' }, sink()),
        )
      ).code,
    ).toBe('invalid_url');
    expect(
      (
        await failure(
          client({ allowPrivateNetworks: false }).stream(
            { method: 'GET', url: `http://127.0.0.1:${String(port)}/x` },
            sink(),
          ),
        )
      ).code,
    ).toBe('blocked');
    expect(hits).toEqual([]);
  });
});
