/**
 * C92.2, the C85.1 amendment: the network-source clients share the stream client, and TorDNSEL's
 * exit list answers without a `Content-Type`. Only a client that names
 * {@link STREAM_NO_CONTENT_TYPE} accepts such an answer; a typed answer still has to match. A local
 * server on 127.0.0.1 answers synthetic bodies, reached through an injected resolver.
 */
import { createServer, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OutboundHttpError, createOutboundHttp, type OutboundHttp } from './index.js';
import { STREAM_NO_CONTENT_TYPE } from './stream.js';

let server: Server;
let port = 0;
let answer: (response: ServerResponse) => void = (response) => response.end();
let http: OutboundHttp;

beforeAll(async () => {
  server = createServer((_request, response) => {
    answer(response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  http = createOutboundHttp({
    resolve: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
  });
});

afterAll(async () => {
  await http.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function stream(contentTypes: string[]) {
  if (http.streamClient === undefined) {
    throw new Error('the outbound client has no stream form');
  }
  const chunks: Uint8Array[] = [];
  return http
    .streamClient({
      name: 'synthetic-exit-list',
      contentTypes,
      timeoutMs: 5_000,
      allowPrivateNetworks: true,
      allowPlainHttp: true,
    })
    .stream(
      { method: 'GET', url: `http://exits.example.test:${String(port)}/exit-addresses` },
      {
        write(chunk) {
          chunks.push(chunk);
          return Promise.resolve();
        },
      },
    )
    .then((response) => ({ response, body: Buffer.concat(chunks).toString('utf8') }));
}

describe('an answer without a Content-Type', () => {
  it('is taken only by a client that names STREAM_NO_CONTENT_TYPE', async () => {
    answer = (response) => {
      response.writeHead(200);
      response.end('ExitNode synthetic\n');
    };
    const { response, body } = await stream(['text/plain', STREAM_NO_CONTENT_TYPE]);
    expect(response.status).toBe(200);
    expect(response.contentType).toBeNull();
    expect(body).toBe('ExitNode synthetic\n');
    await expect(stream(['text/plain'])).rejects.toMatchObject({ code: 'content_type' });
  });

  it('does not let a wrong type through', async () => {
    answer = (response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html></html>');
    };
    const refused = await stream(['text/plain', STREAM_NO_CONTENT_TYPE]).catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(OutboundHttpError);
    expect(refused).toMatchObject({ code: 'content_type' });
  });
});
