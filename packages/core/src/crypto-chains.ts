/**
 * The crypto chains Phase 5 knows (C57.1), by CAIP-2 chain id. Each id was checked against the
 * ChainAgnostic namespaces repository at commit 463bae5 (2026-09-03):
 * - `eip155:<n>`: the decimal EIP-155 chain id (`eip155/caip2.md`);
 * - `bip122:<hash>`: the first 32 lowercase hex characters of the genesis block hash
 *   (`bip122/caip2.md`, which lists Bitcoin, its testnet, Litecoin and Dogecoin);
 * - `solana:<hash>`: the first 32 characters of the base58 genesis hash (`solana/caip2.md`);
 * - `tron:<n>`: the decimal chain id (`tron/caip2.md`). The plan named the hexadecimal
 *   `tron:0x2b6653dc`, which that file now calls a deprecated alias to accept on input and
 *   normalise; {@link normalizeCryptoChainId} does so, and every schema takes the decimal form;
 * - `xrpl:<n>`: the network id, 0 for the main network (`xrpl/caip2.md`).
 *
 * Validity and ownership are implemented in `packages/checks/src/crypto` (C57); this module only
 * names the chains, the signature schemes each accepts and the input bounds.
 */
import { z } from 'zod';

/** How a signature over our challenge is encoded (C57.3 `scheme`). */
export const CRYPTO_SIGNATURE_SCHEMES = [
  'eip191',
  'bip137',
  'bip322-simple',
  'bip322-legacy',
  'solana-ed25519',
  'tron-v2',
] as const;
export const cryptoSignatureSchemeSchema = z.enum(CRYPTO_SIGNATURE_SCHEMES);
export type CryptoSignatureScheme = z.infer<typeof cryptoSignatureSchemeSchema>;

/** The address and signature family of a chain. */
export const CRYPTO_CHAIN_FAMILIES = [
  'evm',
  'bitcoin',
  'litecoin',
  'dogecoin',
  'solana',
  'tron',
  'xrpl',
] as const;
export type CryptoChainFamily = (typeof CRYPTO_CHAIN_FAMILIES)[number];

/** One chain with a fixed CAIP-2 id. */
export interface CryptoChain {
  readonly id: string;
  readonly family: CryptoChainFamily;
  readonly name: string;
  /** The ownership proofs it accepts (C57.1); empty when none exists. */
  readonly schemes: readonly CryptoSignatureScheme[];
}

const BITCOIN_SCHEMES: readonly CryptoSignatureScheme[] = Object.freeze([
  'bip137',
  'bip322-simple',
  'bip322-legacy',
]);

function chain(
  id: string,
  family: CryptoChainFamily,
  name: string,
  schemes: readonly CryptoSignatureScheme[],
): CryptoChain {
  return Object.freeze({ id, family, name, schemes: Object.freeze([...schemes]) });
}

/**
 * The chains with a fixed id, in the C57.1 order. EVM chains are a pattern
 * ({@link EVM_CHAIN_ID_PATTERN}), so a template names the ones it offers.
 */
export const CRYPTO_CHAINS: readonly CryptoChain[] = Object.freeze([
  chain('bip122:000000000019d6689c085ae165831e93', 'bitcoin', 'Bitcoin', BITCOIN_SCHEMES),
  chain('bip122:000000000933ea01ad0ee984209779ba', 'bitcoin', 'Bitcoin testnet', BITCOIN_SCHEMES),
  chain('bip122:12a765e31ffd4059bada1e25190f6e98', 'litecoin', 'Litecoin', ['bip137']),
  chain('bip122:1a91e3dace36e2be3bf030a65679fe82', 'dogecoin', 'Dogecoin', ['bip137']),
  chain('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'solana', 'Solana', ['solana-ed25519']),
  chain('tron:728126428', 'tron', 'TRON', ['tron-v2']),
  // Validity only: no ownership proof exists for it (C50.4 refuses it in a required flow).
  chain('xrpl:0', 'xrpl', 'XRP Ledger', []),
]);

/**
 * An EVM chain: `eip155:` and a positive decimal chain id without leading zeros, at most 32
 * characters (the CAIP-2 reference bound).
 */
export const EVM_CHAIN_ID_PATTERN = /^eip155:[1-9][0-9]{0,31}$/;

/** The proof an EVM chain accepts: EIP-191 over an EIP-4361 message (C57.1). */
const EVM_SCHEMES: readonly CryptoSignatureScheme[] = Object.freeze(['eip191']);

const BY_ID: ReadonlyMap<string, CryptoChain> = new Map(
  CRYPTO_CHAINS.map((entry) => [entry.id, entry]),
);

/** Deprecated aliases a chain id may still arrive in, and the id each stands for. */
const ALIASES: ReadonlyMap<string, string> = new Map([['tron:0x2b6653dc', 'tron:728126428']]);

/** Whether `value` is the CAIP-2 id of a chain Phase 5 knows, in its canonical form. */
export function isCryptoChainId(value: unknown): value is string {
  return typeof value === 'string' && (BY_ID.has(value) || EVM_CHAIN_ID_PATTERN.test(value));
}

/** The family of a chain, or `null` for one Phase 5 does not know. */
export function cryptoChainFamily(chainId: string): CryptoChainFamily | null {
  if (EVM_CHAIN_ID_PATTERN.test(chainId)) {
    return 'evm';
  }
  return BY_ID.get(chainId)?.family ?? null;
}

/** The ownership proofs a chain accepts; empty for a chain without one or not known. */
export function cryptoChainSchemes(chainId: string): readonly CryptoSignatureScheme[] {
  if (EVM_CHAIN_ID_PATTERN.test(chainId)) {
    return EVM_SCHEMES;
  }
  return BY_ID.get(chainId)?.schemes ?? [];
}

/**
 * The canonical form of a chain id that may arrive as a deprecated alias (the hexadecimal TRON
 * id); any other value is returned as it is.
 */
export function normalizeCryptoChainId(value: string): string {
  return ALIASES.get(value) ?? value;
}

/** A CAIP-2 chain id Phase 5 knows, in its canonical form (templates, bodies, attributes). */
export const cryptoChainIdSchema = z
  .string()
  .max(64)
  .refine(isCryptoChainId, 'must be a supported CAIP-2 chain id');
export type CryptoChainId = z.infer<typeof cryptoChainIdSchema>;

/** C57.1 bounds on what a client sends: the address, the signature and the signed message. */
export const CRYPTO_INPUT_LIMITS = Object.freeze({
  addressMaxLength: 128,
  signatureMaxLength: 1024,
  messageMaxBytes: 4096,
});
