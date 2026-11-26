/**
 * C254.2 (Workflow 11B, ingestion-11b; decision 39): the list stream client and conditional requests.
 * A check sends `If-None-Match` or `If-Modified-Since` on its first hop; a `304 Not Modified` is
 * the publisher's answer, never a redirect: it comes back as status 304 with the exposed validators
 * and nothing written, where it was refused as a redirect (`blocked`) before. The one redirect still
 * keeps the request's scheme, host rule and port and carries no request header over (owner decision
 * 20 after Workflow 6B), so a validator never reaches the storage host. A local receiver on loopback
 * only; no publisher is called.
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

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let server: Server;
let port = 0;
let handler: Handler = (_request, response) => response.end();
const hits: { host: string; headers: IncomingMessage['headers'] }[] = [];
let http: OutboundHttp;

beforeAll(async () => {
  server = createServer((request, response) => {
    hits.push({ host: request.headers.host ?? '', headers: request.headers });
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

const LIST = () => `http://lists.example.test:${String(port)}/docs/LIST.XML`;
const ETAG = '"synthetic-etag-1"';
const LAST_MODIFIED = 'Fri, 13 Nov 2026 09:00:00 GMT';

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
    exposeHeaders: ['etag', 'last-modified'],
    ...options,
  });
}

function sink(): OutboundStreamSink & { chunks: Uint8Array[] } {
  const chunks: Uint8Array[] = [];
  return {
    chunks,
    write(chunk) {
      chunks.push(chunk);
      return Promise.resolve();
    },
  };
}

describe('a conditional list request (C254.2)', () => {
  it('answers a 304 as status 304 with its validators, writing nothing', async () => {
    handler = (_request, response) => {
      response.writeHead(304, { etag: ETAG, 'last-modified': LAST_MODIFIED }).end();
    };
    const body = sink();

    const answer = await client().stream(
      {
        method: 'GET',
        url: LIST(),
        headers: { 'if-none-match': ETAG, 'if-modified-since': LAST_MODIFIED },
      },
      body,
    );

    expect(answer).toMatchObject({
      status: 304,
      bytes: 0,
      headers: { etag: ETAG, 'last-modified': LAST_MODIFIED },
    });
    expect(body.chunks).toEqual([]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.headers['if-none-match']).toBe(ETAG);
    expect(hits[0]?.headers['if-modified-since']).toBe(LAST_MODIFIED);
  });

  it('answers a 304 without following anything, even for a client that may redirect', async () => {
    handler = (_request, response) => {
      response.writeHead(304, { location: `http://storage.example.test:${String(port)}/x` }).end();
    };

    const answer = await client({ redirect: { maxHops: 1, host: 'storage.example.test' } }).stream(
      { method: 'GET', url: LIST(), headers: { 'if-none-match': ETAG } },
      sink(),
    );

    expect(answer.status).toBe(304);
    expect(hits).toHaveLength(1);
  });

  it('still follows its one redirect without carrying a validator over, keeping the port', async () => {
    handler = (request, response) => {
      if (request.headers.host?.startsWith('lists.') === true) {
        response
          .writeHead(302, { location: `http://storage.example.test:${String(port)}/blob` })
          .end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/xml', etag: ETAG }).end('<list/>');
    };
    const body = sink();

    const answer = await client({ redirect: { maxHops: 1, host: 'storage.example.test' } }).stream(
      { method: 'GET', url: LIST(), headers: { 'if-none-match': ETAG } },
      body,
    );

    expect(answer.status).toBe(200);
    expect(hits.map((hit) => hit.host)).toEqual([
      `lists.example.test:${String(port)}`,
      `storage.example.test:${String(port)}`,
    ]);
    expect(hits[1]?.headers['if-none-match']).toBeUndefined();
  });

  it('still refuses a redirect to another port', async () => {
    handler = (_request, response) => {
      response
        .writeHead(302, { location: `http://storage.example.test:${String(port + 1)}/blob` })
        .end();
    };

    await expect(
      client({ redirect: { maxHops: 1, host: 'storage.example.test' } }).stream(
        { method: 'GET', url: LIST() },
        sink(),
      ),
    ).rejects.toMatchObject({ code: 'blocked' } satisfies Partial<OutboundHttpError>);
  });
});
