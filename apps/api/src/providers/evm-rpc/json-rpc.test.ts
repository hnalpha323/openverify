/**
 * C57.5, C54.6: the `json-rpc` EVM provider. Most cases answer through a recording outbound
 * client; the last ones go through the real outbound client to a local server on 127.0.0.1, whose
 * host name an injected resolver answers, so nothing touches the internet or real DNS. URLs and
 * keys are synthetic.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  OutboundHttpError,
  createOutboundHttp,
  type OutboundHttp,
  type OutboundHttpClientOptions,
  type OutboundHttpRequest,
  type OutboundHttpResponse,
} from '../../http/index.js';
import { ProviderError } from '../errors.js';
import {
  EVM_RPC_CALL_MAX_RESPONSE_BYTES,
  EVM_RPC_CODE_MAX_RESPONSE_BYTES,
  EVM_RPC_TIMEOUT_MS,
  createJsonRpcEvmProvider,
} from './json-rpc.js';

const SECRET_URL = 'https://rpc.example.test/v1/synthetic-api-key';
const ADDRESS = `0x${'ab'.repeat(20)}`;
const SETTINGS = {
  urls: new Map([
    ['eip155:1', SECRET_URL],
    ['eip155:8453', 'https://base.rpc.example.test/'],
  ]),
  allowPrivateNetworks: false,
};

interface Recorded {
  client: OutboundHttpClientOptions;
  request: OutboundHttpRequest;
}

/** An outbound factory whose clients answer with `answer`, recording every request. */
function recordingOutbound(
  answer: (request: OutboundHttpRequest) => Promise<OutboundHttpResponse>,
): OutboundHttp & { recorded: Recorded[]; clients: OutboundHttpClientOptions[] } {
  const recorded: Recorded[] = [];
  const clients: OutboundHttpClientOptions[] = [];
  return {
    recorded,
    clients,
    client(options) {
      clients.push(options);
      return {
        request(request) {
          recorded.push({ client: options, request });
          return answer(request);
        },
      };
    },
    close: () => Promise.resolve(),
  };
}

const encoder = new TextEncoder();
const answerJson = (body: unknown, status = 200): Promise<OutboundHttpResponse> =>
  Promise.resolve({
    status,
    contentType: status === 200 ? 'application/json' : null,
    body: status === 200 ? encoder.encode(JSON.stringify(body)) : new Uint8Array(),
  });

/** Answers each request with its own id and `result`. */
const answering = (result: unknown) => (request: OutboundHttpRequest) => {
  const { id } = JSON.parse(String(request.body)) as { id: unknown };
  return answerJson({ jsonrpc: '2.0', id, result });
};

const bodyOf = (recorded: Recorded | undefined) =>
  JSON.parse(String(recorded?.request.body)) as Record<string, unknown>;

async function providerError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a ProviderError');
}

describe('the json-rpc EVM provider (C57.5)', () => {
  it('is a real provider', () => {
    const rpc = createJsonRpcEvmProvider(SETTINGS, recordingOutbound(answering('0x')));

    expect({ id: rpc.id, sandbox: rpc.sandbox }).toEqual({ id: 'json-rpc', sandbox: false });
  });

  it('asks the chain’s node for eth_getCode at the latest block, as JSON-RPC 2.0', async () => {
    const outbound = recordingOutbound(answering('0x6080604052AB'));
    const rpc = createJsonRpcEvmProvider(SETTINGS, outbound);

    expect(await rpc.getCode('eip155:1', ADDRESS)).toBe('0x6080604052ab');
    const [sent] = outbound.recorded;
    expect(sent?.request).toMatchObject({
      method: 'POST',
      url: SECRET_URL,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
    });
    expect(bodyOf(sent)).toEqual({
      jsonrpc: '2.0',
      id: expect.any(Number) as unknown,
      method: 'eth_getCode',
      params: [ADDRESS, 'latest'],
    });
    expect(sent?.client).toEqual({
      name: 'evm-rpc',
      contentTypes: ['application/json'],
      maxResponseBytes: EVM_RPC_CODE_MAX_RESPONSE_BYTES,
      timeoutMs: EVM_RPC_TIMEOUT_MS,
      allowPrivateNetworks: false,
      allowPlainHttp: false,
    });
  });

  it('sends eth_call with its gas in hex, through a client capped at 4 KiB', async () => {
    const outbound = recordingOutbound(answering(`0x1626ba7e${'0'.repeat(56)}`));
    const rpc = createJsonRpcEvmProvider(SETTINGS, outbound);

    expect(await rpc.call('eip155:8453', { to: ADDRESS, data: '0x1626ba7e00', gas: 500_000 })).toBe(
      `0x1626ba7e${'0'.repeat(56)}`,
    );
    const [sent] = outbound.recorded;
    expect(sent?.request.url).toBe('https://base.rpc.example.test/');
    expect(bodyOf(sent)).toMatchObject({
      method: 'eth_call',
      params: [{ to: ADDRESS, data: '0x1626ba7e00', gas: '0x7a120' }, 'latest'],
    });
    expect(sent?.client).toMatchObject({
      maxResponseBytes: EVM_RPC_CALL_MAX_RESPONSE_BYTES,
      timeoutMs: 10_000,
    });
    expect(EVM_RPC_CALL_MAX_RESPONSE_BYTES).toBe(4096);
  });

  it('lets an operator’s node be on a private network, over http, only when the flag is set', async () => {
    const outbound = recordingOutbound(answering('0x'));
    const rpc = createJsonRpcEvmProvider({ ...SETTINGS, allowPrivateNetworks: true }, outbound);

    await rpc.getCode('eip155:1', ADDRESS);

    expect(outbound.recorded[0]?.client).toMatchObject({
      allowPrivateNetworks: true,
      allowPlainHttp: true,
    });
  });

  it('answers chain_not_configured for a chain without a URL, asking nothing', async () => {
    const outbound = recordingOutbound(answering('0x'));
    const rpc = createJsonRpcEvmProvider(SETTINGS, outbound);

    expect(await providerError(rpc.getCode('eip155:10', ADDRESS))).toMatchObject({
      code: 'chain_not_configured',
      retryable: false,
    });
    expect(outbound.recorded).toEqual([]);
  });

  it('refuses an address or call that is not one, asking nothing', async () => {
    const outbound = recordingOutbound(answering('0x'));
    const rpc = createJsonRpcEvmProvider(SETTINGS, outbound);

    for (const call of [
      rpc.getCode('eip155:1', 'not-an-address'),
      rpc.call('eip155:1', { to: ADDRESS, data: 'nothex', gas: 1 }),
      rpc.call('eip155:1', { to: ADDRESS, data: '0x', gas: 0 }),
    ]) {
      expect(await providerError(call)).toMatchObject({
        code: 'invalid_request',
        retryable: false,
      });
    }
    expect(outbound.recorded).toEqual([]);
  });

  it.each([429, 500, 502, 503, 504])('retries a %i answer (rpc_unavailable)', async (status) => {
    const rpc = createJsonRpcEvmProvider(
      SETTINGS,
      recordingOutbound(() => answerJson({}, status)),
    );

    expect(await providerError(rpc.getCode('eip155:1', ADDRESS))).toMatchObject({
      code: 'rpc_unavailable',
      retryable: true,
    });
  });

  it.each([301, 302, 400, 401, 403, 404])(
    'never retries a %i answer (rpc_refused), and follows no redirect',
    async (status) => {
      const outbound = recordingOutbound(() => answerJson({}, status));
      const rpc = createJsonRpcEvmProvider(SETTINGS, outbound);

      expect(await providerError(rpc.getCode('eip155:1', ADDRESS))).toMatchObject({
        code: 'rpc_refused',
        retryable: false,
      });
      expect(outbound.recorded).toHaveLength(1);
    },
  );

  it('answers rpc_error, never retried, for a JSON-RPC error such as a revert', async () => {
    const rpc = createJsonRpcEvmProvider(
      SETTINGS,
      recordingOutbound((request) => {
        const { id } = JSON.parse(String(request.body)) as { id: unknown };
        return answerJson({
          jsonrpc: '2.0',
          id,
          error: { code: 3, message: 'execution reverted', data: '0x08c379a0' },
        });
      }),
    );

    expect(
      await providerError(rpc.call('eip155:1', { to: ADDRESS, data: '0x1626ba7e', gas: 500_000 })),
    ).toMatchObject({ code: 'rpc_error', retryable: false });
  });

  it.each([
    [
      'not JSON',
      () =>
        Promise.resolve({
          status: 200,
          contentType: 'application/json',
          body: encoder.encode('{'),
        }),
    ],
    ['another JSON-RPC version', () => answerJson({ jsonrpc: '1.0', id: 1, result: '0x' })],
    ['another request’s id', () => answerJson({ jsonrpc: '2.0', id: -1, result: '0x' })],
    ['a result that is no hex', answering(12)],
    ['a result of odd hex', answering('0x123')],
    ['a result without 0x', answering('6080')],
    [
      'neither a result nor an error',
      (request: OutboundHttpRequest) => {
        const { id } = JSON.parse(String(request.body)) as { id: unknown };
        return answerJson({ jsonrpc: '2.0', id });
      },
    ],
    ['a batch', () => answerJson([])],
  ] as const)('answers rpc_malformed, never retried, for %s', async (_name, answer) => {
    const rpc = createJsonRpcEvmProvider(SETTINGS, recordingOutbound(answer));

    expect(await providerError(rpc.getCode('eip155:1', ADDRESS))).toMatchObject({
      code: 'rpc_malformed',
      retryable: false,
    });
  });

  it.each([
    ['timeout', true],
    ['network', true],
    ['dns', true],
    ['blocked', false],
    ['too_large', false],
    ['content_type', false],
  ] as const)('maps an outbound %s failure, retryable %s', async (code, retryable) => {
    const rpc = createJsonRpcEvmProvider(
      SETTINGS,
      recordingOutbound(() => Promise.reject(new OutboundHttpError('evm-rpc', code))),
    );

    expect(await providerError(rpc.getCode('eip155:1', ADDRESS))).toMatchObject({
      code,
      retryable,
    });
  });

  it('never names the URL, its key or the address in an error', async () => {
    const outbound = recordingOutbound(() => answerJson({}, 500));
    const rpc = createJsonRpcEvmProvider(SETTINGS, outbound);

    const errors = [
      await providerError(rpc.getCode('eip155:1', ADDRESS)),
      await providerError(rpc.getCode('eip155:10', ADDRESS)),
    ];

    for (const error of errors) {
      const text = `${error.message} ${error.code} ${String(error.stack)}`;
      expect(text).not.toContain('synthetic-api-key');
      expect(text).not.toContain('rpc.example.test');
      expect(text).not.toContain(ADDRESS);
    }
  });

  it('refuses every call without an outbound client', async () => {
    const rpc = createJsonRpcEvmProvider(SETTINGS, undefined);

    expect(await providerError(rpc.getCode('eip155:1', ADDRESS))).toMatchObject({
      retryable: false,
    });
  });
});

describe('the json-rpc EVM provider through the real outbound client (C54.6)', () => {
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

  beforeEach(() => {
    hits.length = 0;
    resolved.length = 0;
  });

  afterAll(async () => {
    await http.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const node = (path: string, allowPrivateNetworks: boolean, scheme = 'http') =>
    createJsonRpcEvmProvider(
      {
        urls: new Map([['eip155:1', `${scheme}://node.example.test:${String(port)}${path}`]]),
        allowPrivateNetworks,
      },
      http,
    );

  it('reaches an operator’s node on a private network with the flag, through the vetted lookup', async () => {
    handler = (request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      request.on('end', () => {
        const { id } = JSON.parse(body) as { id: unknown };
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ jsonrpc: '2.0', id, result: '0x' }));
      });
    };

    expect(await node('/rpc', true).getCode('eip155:1', ADDRESS)).toBe('0x');
    expect(resolved).toEqual(['node.example.test']);
    expect(hits).toEqual(['POST /rpc']);
  });

  it('returns a redirect as a refusal and never follows it', async () => {
    handler = (_request, response) => {
      response.writeHead(302, { location: '/elsewhere' });
      response.end();
    };

    expect(await providerError(node('/moved', true).getCode('eip155:1', ADDRESS))).toMatchObject({
      code: 'rpc_refused',
      retryable: false,
    });
    expect(hits).toEqual(['POST /moved']);
  });

  it('is refused a private address without the flag, connecting nowhere', async () => {
    expect(
      await providerError(node('/rpc', false, 'https').getCode('eip155:1', ADDRESS)),
    ).toMatchObject({ code: 'blocked', retryable: false });
    expect(resolved).toEqual(['node.example.test']);
    expect(hits).toEqual([]);
  });
});
