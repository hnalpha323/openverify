/**
 * The words for the CAIP-2 chains a step may offer (C57.1). The ids are the canonical ones of
 * `CRYPTO_CHAINS` in `@openverify/core` (a test keeps the two in step); EVM chains are a pattern,
 * so the common networks have a name and any other is named by its number.
 */

/** Message keys under `cryptoWallet.chains`, by chain id. */
const CHAIN_NAMES = {
  'bip122:000000000019d6689c085ae165831e93': 'bitcoin',
  'bip122:000000000933ea01ad0ee984209779ba': 'bitcoinTestnet',
  'bip122:12a765e31ffd4059bada1e25190f6e98': 'litecoin',
  'bip122:1a91e3dace36e2be3bf030a65679fe82': 'dogecoin',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'solana',
  'tron:728126428': 'tron',
  'xrpl:0': 'xrpl',
  'eip155:1': 'ethereum',
  'eip155:10': 'optimism',
  'eip155:56': 'bnb',
  'eip155:137': 'polygon',
  'eip155:8453': 'base',
  'eip155:42161': 'arbitrum',
  'eip155:11155111': 'sepolia',
} as const;

export type ChainNameKey = (typeof CHAIN_NAMES)[keyof typeof CHAIN_NAMES];

/** The chain ids with a name of their own. */
export const NAMED_CHAIN_IDS: readonly string[] = Object.keys(CHAIN_NAMES);

const EVM_CHAIN = /^eip155:([1-9][0-9]{0,31})$/u;

/** C57.1: `eip155:<n>`, the chains a browser wallet signs for through EIP-1193. */
export function isEvmChain(chainId: string): boolean {
  return EVM_CHAIN.test(chainId);
}

/** A Solana wallet may sign wrapped bytes, which the user can paste with the signature (C57.3). */
export function isSolanaChain(chainId: string): boolean {
  return chainId.startsWith('solana:');
}

/** How to name a chain: its own message, an EVM network's number, or its id as a last resort. */
export type ChainName =
  | { readonly key: ChainNameKey }
  | { readonly key: 'evm'; readonly number: string }
  | { readonly key: null; readonly id: string };

export function chainName(chainId: string): ChainName {
  const key = (CHAIN_NAMES as Readonly<Record<string, ChainNameKey>>)[chainId];
  if (key !== undefined) {
    return { key };
  }
  const evm = EVM_CHAIN.exec(chainId);
  return evm?.[1] === undefined ? { key: null, id: chainId } : { key: 'evm', number: evm[1] };
}
