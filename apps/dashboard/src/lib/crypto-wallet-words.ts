/**
 * The crypto wallet verification in words (C57, C66): what a pass means, the chain, the signature
 * scheme, the address type and checksum `crypto_wallet_validity_detection` records, and the flags
 * of the address and statement checks (`high-s`, `bip137-loose`, `contract-wallet`, `on-curve`,
 * `envelope`). No value names an address, a signature or a message: the checks record none
 * (C51.4).
 */
import { CRYPTO_CHAINS, EVM_CHAIN_ID_PATTERN, type CryptoSignatureScheme } from '@openverify/core';
import type { WordsText } from './selfie-words';

/**
 * C66: what a passed crypto wallet verification means, as `docs/checks/crypto-wallet.md` says it
 * (its test checks every sentence against that page).
 */
export const CRYPTO_WALLET_PASS_MEANS =
  "Whoever answered the challenge controlled the claimed address's key at signing time: the signature verifies, over exactly the message our server issued for this verification, for the address the user claimed, within ten minutes, once. " +
  'It is not proof of who the person is, nor that they still control the key, nor that the wallet holds any funds.';

/** The chains with a fixed id, by the name core gives them (C57.1). */
const CHAIN_NAMES: ReadonlyMap<string, string> = new Map(
  CRYPTO_CHAINS.map((chain) => [chain.id, chain.name]),
);

/** C57.3: how the signature over the challenge is encoded. */
const SCHEME_WORDS: Readonly<Record<CryptoSignatureScheme, string>> = Object.freeze({
  eip191: 'EIP-191 personal message',
  bip137: 'BIP-137 signed message',
  'bip322-simple': 'BIP-322 simple',
  'bip322-legacy': 'BIP-322 legacy',
  'solana-ed25519': 'Solana ed25519 signature',
  'tron-v2': 'TRON signMessageV2',
});
const SCHEMES: ReadonlyMap<string, string> = new Map(Object.entries(SCHEME_WORDS));

/** The script or account kind an address encodes (`address-type`, C57.1). */
const ADDRESS_TYPE_WORDS: ReadonlyMap<string, string> = new Map([
  ['evm', 'EVM account'],
  ['p2pkh', 'Pay to public key hash (P2PKH)'],
  ['p2sh', 'Pay to script hash (P2SH)'],
  ['p2wpkh', 'Native segwit key hash (P2WPKH)'],
  ['p2wsh', 'Native segwit script hash (P2WSH)'],
  ['p2tr', 'Taproot (P2TR)'],
  ['witness_unknown', 'Segwit version 2 to 16'],
  ['solana', 'Solana account'],
  ['tron', 'TRON account'],
  ['xrpl', 'XRP Ledger account'],
]);

/** The address's checksum (`checksum`, C57.1). */
const CHECKSUM_WORDS: ReadonlyMap<string, WordsText> = new Map<string, WordsText>([
  ['valid', { words: 'Valid' }],
  [
    'absent',
    {
      words: 'Absent',
      explanation:
        'A single-case EVM address carries no EIP-55 checksum, so a typo in it cannot be caught; it passes unless the template requires the checksum.',
    },
  ],
  ['none', { words: 'None in this format', explanation: 'A Solana address has no checksum.' }],
]);

/** The flags, keyed `<flag>=<value>`, for each value that raises one (C57.4). */
const FLAG_WORDS: ReadonlyMap<string, WordsText> = new Map<string, WordsText>([
  [
    'high-s=true',
    {
      words: 'High-s signature',
      explanation:
        'The ECDSA signature has a high s value: valid over a message, though EIP-2 refuses it in transactions; it passes while the template allows high-s signatures.',
    },
  ],
  [
    'bip137-loose=true',
    {
      words: 'Loose BIP-137 header',
      explanation:
        "The signature's header byte did not name the address's script type, so the type was taken from the claimed address, as the loose BIP-137 mode allows.",
    },
  ],
  [
    'contract-wallet=true',
    {
      words: 'Contract wallet (ERC-1271)',
      explanation:
        'The address holds contract code that answered for the signature: it proves control of a contract, not of a person.',
    },
  ],
  [
    'on-curve=true',
    {
      words: 'On the ed25519 curve',
      explanation: 'The Solana address is a public key, so a signature can prove its control.',
    },
  ],
  [
    'on-curve=false',
    {
      words: 'Off the ed25519 curve',
      explanation:
        'The Solana address is a program account, not a key, so no signature can prove its control.',
    },
  ],
  ...[0, 1].map((version): [string, WordsText] => [
    `envelope=solana-offchain-v${String(version)}`,
    {
      words: `Solana off-chain message, version ${String(version)}`,
      explanation:
        'The wallet wrapped the challenge in a Solana off-chain message; the server unwrapped it and compared the challenge inside.',
    },
  ]),
]);

/** A CAIP-2 chain id in words; the id itself for a chain Phase 5 does not know. */
export function cryptoChainText(chainId: string): string {
  if (EVM_CHAIN_ID_PATTERN.test(chainId)) {
    return `EVM network ${chainId.slice('eip155:'.length)}`;
  }
  return CHAIN_NAMES.get(chainId) ?? chainId;
}

/** A signature scheme (C57.3) in words. */
export function signatureSchemeText(scheme: unknown): string | undefined {
  return typeof scheme === 'string' ? SCHEMES.get(scheme) : undefined;
}

/** The address kind `crypto_wallet_validity_detection` records (`address-type`), in words. */
export function addressTypeText(kind: unknown): string | undefined {
  return typeof kind === 'string' ? ADDRESS_TYPE_WORDS.get(kind) : undefined;
}

/** The checksum state `crypto_wallet_validity_detection` records (`checksum`), in words. */
export function checksumText(state: unknown): WordsText | undefined {
  return typeof state === 'string' ? CHECKSUM_WORDS.get(state) : undefined;
}

/**
 * One flag a crypto wallet check records, with its value, in words; `undefined` for a value that
 * raises no flag (a low-s signature) or one it does not know.
 */
export function cryptoFlagText(flag: string, value: unknown): WordsText | undefined {
  if (typeof value !== 'string' && typeof value !== 'boolean') {
    return undefined;
  }
  return FLAG_WORDS.get(`${flag}=${String(value)}`);
}

/** ADR 0002 §3d, C57.5: the sandbox EVM RPC, named beside the evidence. */
export const SANDBOX_RPC_TEXT =
  'The sandbox EVM RPC answers for a fixed test contract, never a real chain, and is refused in production.';
