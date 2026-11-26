/**
 * C57.5, C63: the EVM RPC factory binds `json-rpc` (the operator's node per chain) or `sandbox`,
 * synchronously, so a worker starts with either bound. Every URL is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { createRefusingOutboundHttp } from '../../test-support/fakes.js';
import { ProviderError } from '../errors.js';
import { createEvmRpcProvider } from './index.js';
import { SANDBOX_CONTRACT_WALLET } from './sandbox.js';

const SETTINGS = {
  urls: new Map([['eip155:1', 'https://rpc.example.test/synthetic-key']]),
  allowPrivateNetworks: false,
};

describe('createEvmRpcProvider (C57.5)', () => {
  it('binds json-rpc to the operator’s nodes, through the outbound client', async () => {
    const outboundHttp = createRefusingOutboundHttp();
    const rpc = createEvmRpcProvider('json-rpc', { settings: SETTINGS, outboundHttp });

    expect({ id: rpc.id, sandbox: rpc.sandbox }).toEqual({ id: 'json-rpc', sandbox: false });
    await expect(rpc.getCode('eip155:1', `0x${'0'.repeat(40)}`)).rejects.toMatchObject({
      code: 'blocked',
    });
    expect(outboundHttp.requests.map((sent) => [sent.client, sent.request.url])).toEqual([
      ['evm-rpc', 'https://rpc.example.test/synthetic-key'],
    ]);
  });

  it('refuses json-rpc without its node URLs', () => {
    expect(() => createEvmRpcProvider('json-rpc')).toThrow('OPENVERIFY_EVM_RPC_URLS');
  });

  it('binds json-rpc without an outbound client, every call then refused', async () => {
    const rpc = createEvmRpcProvider('json-rpc', { settings: SETTINGS });

    await expect(rpc.getCode('eip155:1', `0x${'0'.repeat(40)}`)).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it('binds the sandbox, which needs no settings and makes no request', async () => {
    const outboundHttp = createRefusingOutboundHttp();
    const rpc = createEvmRpcProvider('sandbox', { outboundHttp });

    expect({ id: rpc.id, sandbox: rpc.sandbox }).toEqual({ id: 'sandbox', sandbox: true });
    expect(await rpc.getCode('eip155:1', SANDBOX_CONTRACT_WALLET)).not.toBe('0x');
    expect(outboundHttp.requests).toEqual([]);
  });
});
