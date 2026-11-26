import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  WebhookRequestError,
  createGuardedWebhookSender,
  createVettedLookup,
  type ResolvedAddress,
  type WebhookSender,
} from './http-sender.js';

interface Received {
  method: string | undefined;
  path: string | undefined;
  host: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
}

let server: Server;
let port: number;
const noContent = (response: ServerResponse) => {
  response.writeHead(204);
  response.end();
};
let respond: (response: ServerResponse) => void = noContent;
const received: Received[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        method: request.method,
        path: request.url,
        host: request.headers.host,
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      respond(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

const senders: WebhookSender[] = [];
function sender(options: Parameters<typeof createGuardedWebhookSender>[0]): WebhookSender {
  const created = createGuardedWebhookSender(options);
  senders.push(created);
  return created;
}

afterEach(async () => {
  received.length = 0;
  respond = noContent;
  await Promise.all(senders.splice(0).map((created) => created.close()));
});

const resolverFor =
  (table: Readonly<Record<string, readonly ResolvedAddress[]>>) =>
  (hostname: string): Promise<ResolvedAddress[]> =>
    Promise.resolve([...(table[hostname] ?? [])]);

const request = (url: string) => ({
  url,
  headers: { 'content-type': 'application/json', 'openverify-event-id': 'evt_TEST' },
  body: '{"data":{}}',
});

async function caught(promise: Promise<unknown>): Promise<WebhookRequestError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WebhookRequestError) return error;
    throw error;
  }
  throw new Error('expected a WebhookRequestError');
}

describe('createGuardedWebhookSender', () => {
  it('posts the body and headers to an allowed receiver and reports the status', async () => {
    const result = await sender({ policy: { allowPrivateNetworks: true } }).send(
      request(`http://127.0.0.1:${String(port)}/hooks?x=1`),
    );
    expect(result.status).toBe(204);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(received).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/hooks?x=1',
        body: '{"data":{}}',
      }),
    ]);
    expect(received[0]?.headers).toMatchObject({
      'content-type': 'application/json',
      'openverify-event-id': 'evt_TEST',
    });
  });

  it('refuses a loopback receiver when private networks are not allowed, without connecting', async () => {
    const error = await caught(
      sender({ policy: { allowPrivateNetworks: false } }).send(
        request(`http://127.0.0.1:${String(port)}/`),
      ),
    );
    expect(error).toMatchObject({ kind: 'blocked', retryable: false });
    expect(received).toEqual([]);
  });

  it.each([
    '[::1]',
    '[::ffff:127.0.0.1]',
    '[::ffff:a9fe:a9fe]',
    '0.0.0.0',
    '169.254.169.254',
    '2130706433',
    '0x7f.1',
  ])('refuses the literal host %s', async (host) => {
    const error = await caught(
      sender({ policy: { allowPrivateNetworks: false } }).send(
        request(`http://${host}:${String(port)}/`),
      ),
    );
    expect(error.kind).toBe('blocked');
    expect(received).toEqual([]);
  });

  it('refuses "localhost" through the system resolver', async () => {
    const error = await caught(
      sender({ policy: { allowPrivateNetworks: false } }).send(
        request(`http://localhost:${String(port)}/`),
      ),
    );
    expect(error.kind).toBe('blocked');
    expect(received).toEqual([]);
  });

  it('connects to the address it vetted, keeping the hostname for Host', async () => {
    const resolve = vi.fn(
      resolverFor({ 'hooks.example.test': [{ address: '127.0.0.1', family: 4 }] }),
    );
    const result = await sender({ policy: { allowPrivateNetworks: true }, resolve }).send(
      request(`http://hooks.example.test:${String(port)}/in`),
    );
    expect(result.status).toBe(204);
    expect(received[0]?.host).toBe(`hooks.example.test:${String(port)}`);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('hooks.example.test');
  });

  it('refuses a name when any of its addresses is blocked (DNS rebinding answers)', async () => {
    const resolve = resolverFor({
      'rebind.example.test': [
        { address: '93.184.215.14', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    });
    const error = await caught(
      sender({ policy: { allowPrivateNetworks: false }, resolve }).send(
        request(`http://rebind.example.test:${String(port)}/`),
      ),
    );
    expect(error).toMatchObject({ kind: 'blocked', retryable: false });
    expect(received).toEqual([]);
  });

  it('keeps metadata endpoints blocked even when private networks are allowed', async () => {
    const resolve = resolverFor({
      'metadata.example.test': [{ address: '169.254.169.254', family: 4 }],
    });
    const error = await caught(
      sender({ policy: { allowPrivateNetworks: true }, resolve }).send(
        request('http://metadata.example.test/latest/meta-data/'),
      ),
    );
    expect(error.kind).toBe('blocked');
  });

  it('does not follow redirects', async () => {
    respond = (response) => {
      response.writeHead(302, { location: `http://127.0.0.1:${String(port)}/elsewhere` });
      response.end('moved');
    };
    const result = await sender({ policy: { allowPrivateNetworks: true } }).send(
      request(`http://127.0.0.1:${String(port)}/start`),
    );
    expect(result.status).toBe(302);
    expect(received.map((entry) => entry.path)).toEqual(['/start']);
  });

  it('times out a receiver that does not answer', async () => {
    respond = () => {
      // Never answers.
    };
    const error = await caught(
      sender({ policy: { allowPrivateNetworks: true }, timeoutMs: 100 }).send(
        request(`http://127.0.0.1:${String(port)}/slow`),
      ),
    );
    expect(error).toMatchObject({ kind: 'timeout', retryable: true });
  });

  it('reports a refused connection as a retryable network error', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => {
      closed.close(() => {
        resolve();
      });
    });
    const error = await caught(
      sender({ policy: { allowPrivateNetworks: true } }).send(
        request(`http://127.0.0.1:${String(closedPort)}/`),
      ),
    );
    expect(error).toMatchObject({ kind: 'network', retryable: true });
  });

  it.each([
    ['no address', resolverFor({})],
    [
      'a resolver failure',
      () =>
        Promise.reject(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })),
    ],
  ])('reports %s as a retryable DNS error', async (_label, resolve) => {
    const error = await caught(
      sender({ policy: { allowPrivateNetworks: false }, resolve }).send(
        request('https://unknown.example.test/'),
      ),
    );
    expect(error).toMatchObject({ kind: 'dns', retryable: true });
  });

  it.each([
    'ftp://hooks.example.test/',
    'http://user:pass@hooks.example.test/',
    'not a url',
    'file:///etc/passwd',
  ])('refuses the URL %j', async (url) => {
    const error = await caught(
      sender({ policy: { allowPrivateNetworks: true } }).send(request(url)),
    );
    expect(error).toMatchObject({ kind: 'invalid_url', retryable: false });
  });

  it('never echoes the URL in its error messages', async () => {
    const error = await caught(
      sender({ policy: { allowPrivateNetworks: false } }).send(
        request(`http://127.0.0.1:${String(port)}/secret-path?token=abc`),
      ),
    );
    expect(error.message).not.toContain('secret-path');
    expect(error.message).not.toContain('127.0.0.1');
  });

  it('rejects a non-positive timeout', () => {
    expect(() =>
      createGuardedWebhookSender({ policy: { allowPrivateNetworks: false }, timeoutMs: 0 }),
    ).toThrow(TypeError);
  });
});

describe('createVettedLookup', () => {
  const lookup = createVettedLookup(
    { allowPrivateNetworks: false },
    resolverFor({
      'public.example.test': [
        { address: '2606:4700:4700::1111', family: 6 },
        { address: '1.1.1.1', family: 4 },
      ],
      'private.example.test': [{ address: '10.0.0.5', family: 4 }],
    }),
  );

  function call(hostname: string, all: boolean) {
    return new Promise<{ error: unknown; address: unknown; family: unknown }>((resolve) => {
      lookup(hostname, { all }, (error, address, family) => {
        resolve({ error, address, family });
      });
    });
  }

  it('answers a single-address lookup with the first vetted address', async () => {
    expect(await call('public.example.test', false)).toEqual({
      error: null,
      address: '2606:4700:4700::1111',
      family: 6,
    });
  });

  it('answers an all-addresses lookup with only the first vetted address', async () => {
    expect(await call('public.example.test', true)).toEqual({
      error: null,
      address: [{ address: '2606:4700:4700::1111', family: 6 }],
      family: undefined,
    });
  });

  it('fails a lookup for a blocked address', async () => {
    const { error } = await call('private.example.test', true);
    expect(error).toBeInstanceOf(WebhookRequestError);
    expect(error).toMatchObject({ kind: 'blocked' });
  });
});
