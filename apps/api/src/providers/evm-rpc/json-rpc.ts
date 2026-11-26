/**
 * C57.5: the `json-rpc` EVM provider, the operator's own node per chain
 * (`OPENVERIFY_EVM_RPC_URLS`): `eth_getCode` and `eth_call` as JSON-RPC 2.0 POSTs through the
 * C54.6 outbound client, 10 s each, with a 4 KiB answer cap for `eth_call` and room for the
 * largest deployable code for `eth_getCode` (EIP-170: 24,576 bytes, so 64 KiB as JSON). Private
 * networks (and `http:`) only with `OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS` (decision 22); a
 * redirect is an answer, never followed. No public RPC ships (decision 23).
 *
 * Failures are `ProviderError`s with a code and `retryable` only, never a URL (which often holds
 * an API key), a body or an address: a chain without a URL is `chain_not_configured` (the check
 * then answers `provider_not_configured`); a 429 or 5xx, a timeout or a network failure is
 * retryable; a JSON-RPC error (a revert included) or a malformed answer is not.
 */
import {
  OutboundHttpError,
  type OutboundHttp,
  type OutboundHttpClient,
  type OutboundHttpResponse,
} from '../../http/index.js';
import type { EvmCallRequest, EvmRpcProvider } from '../../ports.js';
import { ProviderError } from '../errors.js';
import type { EvmRpcSettings } from './index.js';

/** C57.5: the deadline of each RPC request. */
export const EVM_RPC_TIMEOUT_MS = 10_000;
/** C54.6: the answer cap of `eth_call` (one 32-byte word, as JSON). */
export const EVM_RPC_CALL_MAX_RESPONSE_BYTES = 4 * 1024;
/** The answer cap of `eth_getCode`: EIP-170's 24,576-byte code is 49,152 hex digits. */
export const EVM_RPC_CODE_MAX_RESPONSE_BYTES = 64 * 1024;

const ADDRESS = /^0x[\da-f]{40}$/u;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const CALL_DATA = /^0x(?:[\da-fA-F]{2})*$/u;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const RESULT = /^0x(?:[\da-fA-F]{2})*$/u;
/** The most gas a call may name: the job sends 500,000 (C57.5). */
const MAX_GAS = 30_000_000;

const fail = (code: string, retryable: boolean) =>
  new ProviderError(`The EVM RPC failed (${code})`, { retryable, code });

/** The `result` of a JSON-RPC 2.0 answer to request `id`, lower-cased hex. */
function resultOf(response: OutboundHttpResponse, id: number): string {
  const { status } = response;
  if (status === 429 || (status >= 500 && status <= 599)) {
    throw fail('rpc_unavailable', true);
  }
  if (status < 200 || status > 299) {
    throw fail('rpc_refused', false);
  }
  let answer: unknown;
  try {
    answer = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body));
  } catch {
    throw fail('rpc_malformed', false);
  }
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
    throw fail('rpc_malformed', false);
  }
  const { jsonrpc, id: answered, result, error } = answer as Record<string, unknown>;
  if (jsonrpc !== '2.0' || answered !== id) {
    throw fail('rpc_malformed', false);
  }
  if (error !== undefined) {
    // A revert, an unknown method, a node that refused the call: retrying cannot help.
    throw fail('rpc_error', false);
  }
  if (typeof result !== 'string' || !RESULT.test(result)) {
    throw fail('rpc_malformed', false);
  }
  return result.toLowerCase();
}

/** The `json-rpc` provider over `settings`, its requests through `outboundHttp`. */
export function createJsonRpcEvmProvider(
  settings: EvmRpcSettings,
  outboundHttp: OutboundHttp | undefined,
): EvmRpcProvider {
  const clients = new Map<number, OutboundHttpClient>();
  /** One client per answer cap, made on first use. */
  const clientFor = (maxResponseBytes: number): OutboundHttpClient | null => {
    if (outboundHttp === undefined) {
      return null;
    }
    let client = clients.get(maxResponseBytes);
    if (client === undefined) {
      client = outboundHttp.client({
        name: 'evm-rpc',
        contentTypes: ['application/json'],
        maxResponseBytes,
        timeoutMs: EVM_RPC_TIMEOUT_MS,
        allowPrivateNetworks: settings.allowPrivateNetworks,
        allowPlainHttp: settings.allowPrivateNetworks,
      });
      clients.set(maxResponseBytes, client);
    }
    return client;
  };
  let nextId = 1;

  async function send(
    chainId: string,
    method: 'eth_getCode' | 'eth_call',
    params: readonly unknown[],
    maxResponseBytes: number,
  ): Promise<string> {
    const url = settings.urls.get(chainId);
    if (url === undefined) {
      throw fail('chain_not_configured', false);
    }
    const client = clientFor(maxResponseBytes);
    if (client === null) {
      throw fail('not_configured', false);
    }
    const id = nextId;
    nextId += 1;
    let response: OutboundHttpResponse;
    try {
      response = await client.request({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
    } catch (error) {
      if (error instanceof OutboundHttpError) {
        throw fail(error.code, error.retryable);
      }
      throw fail('network', true);
    }
    return resultOf(response, id);
  }

  return {
    id: 'json-rpc',
    sandbox: false,
    async getCode(chainId, address) {
      if (!ADDRESS.test(address)) {
        throw fail('invalid_request', false);
      }
      return send(chainId, 'eth_getCode', [address, 'latest'], EVM_RPC_CODE_MAX_RESPONSE_BYTES);
    },
    async call(chainId, request: EvmCallRequest) {
      if (
        !ADDRESS.test(request.to) ||
        !CALL_DATA.test(request.data) ||
        !Number.isSafeInteger(request.gas) ||
        request.gas < 1 ||
        request.gas > MAX_GAS
      ) {
        throw fail('invalid_request', false);
      }
      const call = { to: request.to, data: request.data, gas: `0x${request.gas.toString(16)}` };
      return send(chainId, 'eth_call', [call, 'latest'], EVM_RPC_CALL_MAX_RESPONSE_BYTES);
    },
  };
}
