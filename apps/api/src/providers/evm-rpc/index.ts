/**
 * C57.5, C63: the EVM RPC, bound by `OPENVERIFY_PROVIDER_EVM_RPC_{SANDBOX,PRODUCTION}` in the
 * worker: `json-rpc` (`eth_call` and `eth_getCode` through the outbound client, a URL per chain
 * from `OPENVERIFY_EVM_RPC_URLS`, 10 s, a 4 KiB response cap; private networks only with
 * `OPENVERIFY_EVM_RPC_ALLOW_PRIVATE_NETWORKS`, decision 22) or `sandbox` (sandbox kind only).
 * Workflow 5A Stage 1b wrote this factory; `api-crypto` built the providers it binds
 * (`json-rpc.ts`, `sandbox.ts`) and the ERC-1271 encoding the job sends (`erc1271.ts`).
 */
import type { OutboundHttp } from '../../http/index.js';
import type { EvmRpcProvider } from '../../ports.js';
import { createJsonRpcEvmProvider } from './json-rpc.js';
import { createSandboxEvmRpcProvider } from './sandbox.js';

/** C57.5: the worker's RPC settings (`jobs/worker-config.ts`). */
export interface EvmRpcSettings {
  /** CAIP-2 `eip155:<n>` to its node URL. Secret: URLs often carry an API key. */
  urls: ReadonlyMap<string, string>;
  allowPrivateNetworks: boolean;
}

export interface EvmRpcOptions {
  /** Required for `json-rpc`; the worker refuses to start without it. */
  settings?: EvmRpcSettings | null | undefined;
  outboundHttp?: OutboundHttp | undefined;
}

/**
 * The RPC `name` binds, constructed synchronously so the worker starts with it bound.
 * @throws {Error} for `json-rpc` without its node URLs (`OPENVERIFY_EVM_RPC_URLS`).
 */
export function createEvmRpcProvider(
  name: 'json-rpc' | 'sandbox',
  options: EvmRpcOptions = {},
): EvmRpcProvider {
  if (name === 'sandbox') {
    return createSandboxEvmRpcProvider();
  }
  if (options.settings == null) {
    throw new Error('json-rpc needs its node URLs (OPENVERIFY_EVM_RPC_URLS)');
  }
  return createJsonRpcEvmProvider(options.settings, options.outboundHttp);
}
