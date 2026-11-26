/**
 * C124.2 (Workflow 8A): the HTTPS action's client, built on `createOutboundHttp()`, opt-in per client.
 * A local server on 127.0.0.1 answers: `allowPlainHttp` reaches it, and `allowLoopback` opens the
 * guard, both set by the test alone. Host names resolve through an injected resolver, so nothing here
 * touches the internet or real DNS. Every value is synthetic.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  OutboundHttpError,
  createOutboundHttp,
  type OutboundHttp,
  type OutboundHttpPolicyClient,
  type OutboundHttpPolicyClientOptions,
} from './index.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

let server: Server;
let port = 0;
let handler: Handler = (_request, response) => response.end();
const hits: { method: string; url: string; headers: IncomingMessage['headers'] }[] = [];
let answers: { address: string; family: number }[] = [{ address: '127.0.0.1', family: 4 }];
const resolved: string[] = [];
let http: OutboundHttp;

beforeAll(async () => {
  server = createServer((request, response) => {
    hits.push({
      method: request.method ?? '',
      url: request.url ?? '',
      headers: request.headers,
    });
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  http = createOutboundHttp({
    resolve: (hostname) => {
      resolved.push(hostname);
      return Promise.resolve(answers);
    },
  });
});

afterEach(() => {
  hits.length = 0;
  resolved.length = 0;
  answers = [{ address: '127.0.0.1', family: 4 }];
  handler = (_request, response) => response.end();
});

afterAll(async () => {
  await http.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const OPTIONS: OutboundHttpPolicyClientOptions = {
  name: 'https-action',
  contentTypes: ['application/json', 'text/plain'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  portPolicy: { allowed: [] },
  headerPolicy: { refused: ['host', 'connection'], refusedPrefixes: ['proxy-'] },
  refuseContentEncoding: true,
  allowPlainHttp: true,
  networkPolicy: { allowLoopback: true },
  exposeHeaders: ['content-type', 'location', 'retry-after', 'etag'],
};

const clientOf = (options: Partial<OutboundHttpPolicyClientOptions> = {}) => {
  const client = http.policyClient?.({
    ...OPTIONS,
    portPolicy: { allowed: [port] },
    ...options,
  });
  if (client === undefined) {
    throw new Error('createOutboundHttp makes a policy client');
  }
  return client;
};

const local = (path = '/x') => `http://127.0.0.1:${String(port)}${path}`;

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

const json =
  (status: number, body: unknown, headers: Record<string, string> = {}): Handler =>
  (_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers });
    response.end(JSON.stringify(body));
  };

describe('methods (C124.2)', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)('sends %s', async (method) => {
    handler = json(200, { ok: true });

    const answer = await clientOf().request({ method, url: local() });

    expect(answer.status).toBe(200);
    expect(hits.map((hit) => hit.method)).toEqual([method]);
  });

  it('refuses a method outside its own list, connecting nowhere', async () => {
    const error = await failure(
      clientOf({ methods: ['GET'] }).request({ method: 'DELETE', url: local() }),
    );

    expect(error).toMatchObject({ code: 'method_refused', retryable: false });
    expect(hits).toEqual([]);
  });

  it('leaves an ordinary client at GET and POST by type', () => {
    const client = http.client({ name: 'ordinary', contentTypes: ['application/json'] });

    expect(Object.keys(client)).toEqual(['request']);
  });
});

describe('the port policy (C124.3)', () => {
  it('refuses a port outside the list', async () => {
    const error = await failure(
      clientOf({ portPolicy: { allowed: [443] } }).request({ method: 'GET', url: local() }),
    );

    expect(error).toMatchObject({ code: 'port_refused', retryable: false });
    expect(hits).toEqual([]);
  });

  it('reads no port in the URL as 443', async () => {
    const client = clientOf({
      allowPlainHttp: false,
      portPolicy: { allowed: [8443] },
    });

    const error = await failure(client.request({ method: 'GET', url: 'https://a.example.test/' }));

    expect(error.code).toBe('port_refused');
    expect(resolved).toEqual([]);
  });
});

describe('the header policy (C124.4)', () => {
  it.each(['Host', 'host', 'Connection', 'Proxy-Authorization', 'proxy-x'])(
    'refuses %s',
    async (name) => {
      const error = await failure(
        clientOf().request({ method: 'GET', url: local(), headers: { [name]: 'synthetic' } }),
      );

      expect(error).toMatchObject({ code: 'header_refused', retryable: false });
      expect(hits).toEqual([]);
    },
  );

  it.each(['na me', 'a:b', '', 'é'])('refuses a name that is no HTTP token: %j', async (name) => {
    const error = await failure(
      clientOf().request({ method: 'GET', url: local(), headers: { [name]: 'x' } }),
    );

    expect(error.code).toBe('header_refused');
  });

  it.each(['a\r\nx: y', 'a\nb', 'a\0b'])('refuses a value with %j', async (value) => {
    const error = await failure(
      clientOf().request({ method: 'GET', url: local(), headers: { 'x-a': value } }),
    );

    expect(error.code).toBe('header_refused');
  });

  it('sends what the policy allows', async () => {
    await clientOf().request({
      method: 'GET',
      url: local(),
      headers: { authorization: 'Bearer change-me-synthetic' },
    });

    expect(hits[0]?.headers.authorization).toBe('Bearer change-me-synthetic');
  });
});

describe('the guard, inside the vetted lookup (C124.2)', () => {
  it('refuses a private answer with no connection', async () => {
    answers = [{ address: '10.0.0.1', family: 4 }];
    const client = clientOf({ networkPolicy: {} });

    const error = await failure(
      client.request({ method: 'GET', url: `http://hook.example.test:${String(port)}/x` }),
    );

    expect(error).toMatchObject({ code: 'blocked', retryable: false });
    expect(resolved).toEqual(['hook.example.test']);
    expect(hits).toEqual([]);
  });

  it('refuses a mixed answer, never filters it', async () => {
    answers = [
      { address: '127.0.0.1', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ];

    const error = await failure(
      clientOf().request({ method: 'GET', url: `http://hook.example.test:${String(port)}/x` }),
    );

    expect(error.code).toBe('blocked');
    expect(hits).toEqual([]);
  });

  it('connects to the vetted address, keeping the URL’s host', async () => {
    await clientOf().request({
      method: 'GET',
      url: `http://hook.example.test:${String(port)}/x`,
    });

    expect(hits[0]?.headers.host).toBe(`hook.example.test:${String(port)}`);
  });

  it('refuses a literal private address before connecting', async () => {
    const error = await failure(
      clientOf({ networkPolicy: {} }).request({ method: 'GET', url: local() }),
    );

    expect(error.code).toBe('blocked');
    expect(hits).toEqual([]);
  });

  it('refuses a metadata name whatever else a policy lifts', async () => {
    answers = [{ address: '169.254.169.254', family: 4 }];
    const client = clientOf({
      networkPolicy: { allowLoopback: true, allowCidrs: ['10.0.0.0/8', '169.254.0.0/16'] },
    });

    const error = await failure(
      client.request({ method: 'GET', url: `http://meta.example.test:${String(port)}/x` }),
    );

    expect(error.code).toBe('blocked');
  });

  it('never reads the EVM flag: a policy client takes no private networks', async () => {
    const client = clientOf({ networkPolicy: {}, allowPrivateNetworks: true });

    const error = await failure(client.request({ method: 'GET', url: local() }));

    expect(error.code).toBe('blocked');
  });

  it('refuses credentials in the URL', async () => {
    const error = await failure(
      clientOf().request({
        method: 'GET',
        url: `http://user:pass@127.0.0.1:${String(port)}/`,
      }),
    );

    expect(error.code).toBe('invalid_url');
  });

  it('refuses plain http unless a test opts in', async () => {
    const error = await failure(
      clientOf({ allowPlainHttp: false }).request({ method: 'GET', url: local() }),
    );

    expect(error.code).toBe('invalid_url');
  });
});

describe('redirects and error answers (C124.2, C124.5)', () => {
  it('returns a 3xx with its location and follows nothing', async () => {
    handler = (_request, response) => {
      response.writeHead(302, { location: 'https://elsewhere.example.test/' });
      response.end();
    };

    const answer = await clientOf().request({ method: 'GET', url: local() });

    expect(answer.status).toBe(302);
    expect(answer.headers.location).toBe('https://elsewhere.example.test/');
    expect(hits).toHaveLength(1);
  });

  it('keeps no location on a 200', async () => {
    handler = json(200, {}, { location: 'https://elsewhere.example.test/' });

    const answer = await clientOf().request({ method: 'GET', url: local() });

    expect(answer.headers).not.toHaveProperty('location');
  });

  it('returns a non-2xx by status alone, its body discarded', async () => {
    handler = json(500, { detail: 'synthetic' });

    const answer = await clientOf().request({ method: 'GET', url: local() });

    expect(answer.status).toBe(500);
    expect(answer.body).toHaveLength(0);
  });

  it('captures a non-2xx body up to the cap a request names, cut there', async () => {
    handler = (_request, response) => {
      response.writeHead(400, { 'content-type': 'text/plain' });
      response.end('x'.repeat(5_000));
    };

    const answer = await clientOf().request({
      method: 'POST',
      url: local(),
      captureErrorBodyBytes: 100,
    });

    expect(answer.status).toBe(400);
    expect(answer.body).toHaveLength(100);
  });

  it('exposes only the listed headers', async () => {
    handler = json(429, {}, { 'retry-after': '7', etag: '"a"', 'set-cookie': 'a=b' });

    const answer = await clientOf().request({ method: 'GET', url: local() });

    expect(answer.headers).toEqual({
      'content-type': 'application/json',
      'retry-after': '7',
      etag: '"a"',
    });
  });
});

describe('response bodies (C124.5)', () => {
  it('returns a 2xx body within the cap', async () => {
    handler = json(200, { ok: true });

    const answer = await clientOf().request({ method: 'GET', url: local() });

    expect(new TextDecoder().decode(answer.body)).toBe('{"ok":true}');
    expect(answer.contentType).toBe('application/json');
  });

  it('refuses a body over the cap', async () => {
    handler = json(200, 'x'.repeat(2_000));

    const error = await failure(
      clientOf({ maxResponseBytes: 1_000 }).request({ method: 'GET', url: local() }),
    );

    expect(error.code).toBe('too_large');
  });

  it('takes an empty 2xx with no type', async () => {
    handler = (_request, response) => {
      response.writeHead(204);
      response.end();
    };

    const answer = await clientOf().request({ method: 'DELETE', url: local() });

    expect(answer).toMatchObject({ status: 204, contentType: null });
    expect(answer.body).toHaveLength(0);
  });

  it('refuses a body with no type', async () => {
    handler = (_request, response) => {
      response.removeHeader('content-type');
      response.end('synthetic');
    };

    const error = await failure(clientOf().request({ method: 'GET', url: local() }));

    expect(error.code).toBe('content_type');
  });

  it('refuses a type outside the list', async () => {
    handler = (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<p>synthetic</p>');
    };

    const error = await failure(clientOf().request({ method: 'GET', url: local() }));

    expect(error.code).toBe('content_type');
  });

  it.each(['gzip', 'br', 'deflate'])('refuses a %s body', async (encoding) => {
    handler = json(200, {}, { 'content-encoding': encoding });

    const error = await failure(clientOf().request({ method: 'GET', url: local() }));

    expect(error).toMatchObject({ code: 'content_encoding', retryable: false });
  });

  it('takes identity, which is no encoding', async () => {
    handler = json(200, {}, { 'content-encoding': 'identity' });

    const answer = await clientOf().request({ method: 'GET', url: local() });

    expect(answer.status).toBe(200);
  });

  it('takes an encoded body when the client did not opt in', async () => {
    handler = json(200, {}, { 'content-encoding': 'gzip' });

    const answer = await clientOf({ refuseContentEncoding: false }).request({
      method: 'GET',
      url: local(),
    });

    expect(answer.status).toBe(200);
  });
});

describe('time (C124.1)', () => {
  it('stops at the deadline a request names', async () => {
    handler = () => undefined;

    const error = await failure(clientOf().request({ method: 'GET', url: local(), timeoutMs: 50 }));

    expect(error).toMatchObject({ code: 'timeout', retryable: true });
  });

  it('stops when its caller aborts', async () => {
    handler = () => undefined;
    const abort = new AbortController();
    const pending = failure(
      clientOf().request({ method: 'GET', url: local(), signal: abort.signal }),
    );
    abort.abort();

    expect((await pending).retryable).toBe(true);
  });
});

describe('a refused connection (C126.5)', () => {
  it('is told apart: nothing was sent', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const { port: unused } = closed.address() as AddressInfo;
    await new Promise((resolve) => closed.close(resolve));

    const error = await failure(
      clientOf({ portPolicy: { allowed: [unused] } }).request({
        method: 'GET',
        url: `http://127.0.0.1:${String(unused)}/x`,
      }),
    );

    expect(error).toMatchObject({ code: 'connection_refused', retryable: true });
  });
});

describe('errors (C53.8)', () => {
  it('carry no URL and no body', async () => {
    answers = [{ address: '10.0.0.1', family: 4 }];
    const url = `http://hook.example.test:${String(port)}/secret-path?token=synthetic`;

    const error = await failure(
      clientOf({ networkPolicy: {} }).request({ method: 'POST', url, body: 'synthetic-body' }),
    );

    expect(String(error)).not.toContain('secret-path');
    expect(String(error)).not.toContain('synthetic-body');
  });
});

describe('close (C124.2)', () => {
  it('releases its own connection and stops', async () => {
    const client: OutboundHttpPolicyClient = clientOf();
    await client.request({ method: 'GET', url: local() });

    await client.close();

    await expect(client.request({ method: 'GET', url: local() })).rejects.toThrow(
      OutboundHttpError,
    );
  });

  it('leaves another client open', async () => {
    const first = clientOf();
    const second = clientOf();
    await first.close();

    await expect(second.request({ method: 'GET', url: local() })).resolves.toMatchObject({
      status: 200,
    });
  });
});
