/**
 * Deterministic test wallets and signers for the crypto wallet checks (C65.4). Every key comes
 * from a fixed label through SHA-256, so no key is committed; nothing here is imported by runtime
 * code. The signers build their digests on their own (and the BIP-322 signer signs through
 * `@scure/btc-signer`'s transaction signer), so a verifier is never checked against itself.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { base58, base64, createBase58check, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';
import type { CryptoWalletCheckInput } from './inputs.js';

const encoder = new TextEncoder();
const base58check = createBase58check(sha256);
/** The secp256k1 group order. */
const CURVE_ORDER = secp256k1.Point.CURVE().n;

export const BITCOIN_CHAIN = 'bip122:000000000019d6689c085ae165831e93';
export const BITCOIN_TESTNET_CHAIN = 'bip122:000000000933ea01ad0ee984209779ba';
export const LITECOIN_CHAIN = 'bip122:12a765e31ffd4059bada1e25190f6e98';
export const DOGECOIN_CHAIN = 'bip122:1a91e3dace36e2be3bf030a65679fe82';
export const SOLANA_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const TRON_CHAIN = 'tron:728126428';
export const XRPL_CHAIN = 'xrpl:0';
export const ETHEREUM_CHAIN = 'eip155:1';

/** C57.5: the address the sandbox `evmRpc` provider serves as a contract wallet. */
export const SANDBOX_CONTRACT_WALLET = '0x00000000000000000000000000000000000c0de5';

export const BITCOIN_NETWORKS = Object.freeze({
  bitcoin: btc.NETWORK,
  testnet: btc.TEST_NETWORK,
  litecoin: { bech32: 'ltc', pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0 },
  dogecoin: { bech32: 'doge', pubKeyHash: 0x1e, scriptHash: 0x16, wif: 0x9e },
});
export type BitcoinNetworkName = keyof typeof BITCOIN_NETWORKS;

const utf8 = (text: string): Uint8Array => encoder.encode(text);

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A 32-byte secret derived from a label: the same label always gives the same key. */
export function testPrivateKey(label: string): Uint8Array {
  return sha256(utf8(`openverify/test-wallet/${label}`));
}

/** `r‖s‖v` (v 27 or 28) of an ECDSA signature of `digest`, optionally with `s` flipped high. */
function signRecoverable(
  digest: Uint8Array,
  privateKey: Uint8Array,
  highS: boolean,
): { r: Uint8Array; s: Uint8Array; recovery: number } {
  const recovered = secp256k1.sign(digest, privateKey, { prehash: false, format: 'recovered' });
  const recovery = recovered[0] ?? 0;
  const r = recovered.slice(1, 33);
  const s = recovered.slice(33, 65);
  if (!highS) {
    return { r, s, recovery };
  }
  const flipped = CURVE_ORDER - BigInt(`0x${hex.encode(s)}`);
  return { r, s: hex.decode(flipped.toString(16).padStart(64, '0')), recovery: recovery ^ 1 };
}

// EVM ------------------------------------------------------------------------------------------

/** The lower-case `0x` address of a key. */
export function evmTestAddress(privateKey: Uint8Array): string {
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  return `0x${hex.encode(keccak_256(publicKey.slice(1)).slice(12))}`;
}

/** `personal_sign`: a `0x` hex `r‖s‖v` signature (v 27/28, or 0/1 with `yParity`). */
export function signPersonalMessage(
  message: Uint8Array,
  privateKey: Uint8Array,
  options: { highS?: boolean; yParity?: boolean } = {},
): string {
  const prefix = utf8(
    `${String.fromCharCode(0x19)}Ethereum Signed Message:\n${String(message.length)}`,
  );
  const { r, s, recovery } = signRecoverable(
    keccak_256(concat(prefix, message)),
    privateKey,
    options.highS === true,
  );
  const v = options.yParity === true ? recovery : recovery + 27;
  return `0x${hex.encode(concat(r, s, new Uint8Array([v])))}`;
}

// TRON -----------------------------------------------------------------------------------------

export function tronTestAddress(privateKey: Uint8Array): string {
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  return base58check.encode(
    concat(new Uint8Array([0x41]), keccak_256(publicKey.slice(1)).slice(12)),
  );
}

/** TronWeb `signMessageV2`: a `0x` hex signature with v 27/28. */
export function signTronMessage(message: Uint8Array, privateKey: Uint8Array): string {
  const prefix = utf8(
    `${String.fromCharCode(0x19)}TRON Signed Message:\n${String(message.length)}`,
  );
  const { r, s, recovery } = signRecoverable(
    keccak_256(concat(prefix, message)),
    privateKey,
    false,
  );
  return `0x${hex.encode(concat(r, s, new Uint8Array([recovery + 27])))}`;
}

// Bitcoin, Litecoin, Dogecoin ------------------------------------------------------------------

export interface BitcoinTestAddresses {
  p2pkh: string;
  p2pkhUncompressed: string;
  p2shP2wpkh: string;
  p2wpkh: string;
  p2wsh: string;
  p2tr: string;
}

/** Every single-key address of a key on a network (P2WSH is a 1-of-1 multisig script). */
export function bitcoinTestAddresses(
  privateKey: Uint8Array,
  network: BitcoinNetworkName,
): BitcoinTestAddresses {
  const params = BITCOIN_NETWORKS[network];
  const compressed = secp256k1.getPublicKey(privateKey, true);
  const address = (payment: { address?: string | undefined }): string => payment.address ?? '';
  return {
    p2pkh: address(btc.p2pkh(compressed, params)),
    p2pkhUncompressed: address(btc.p2pkh(secp256k1.getPublicKey(privateKey, false), params)),
    p2shP2wpkh: address(btc.p2sh(btc.p2wpkh(compressed, params), params)),
    p2wpkh: address(btc.p2wpkh(compressed, params)),
    p2wsh: address(btc.p2wsh(btc.p2ms(1, [compressed]), params)),
    p2tr: address(btc.p2tr(schnorr.getPublicKey(privateKey), undefined, params)),
  };
}

const BIP137_MAGIC = Object.freeze({
  bitcoin: 'Bitcoin Signed Message:\n',
  litecoin: 'Litecoin Signed Message:\n',
  dogecoin: 'Dogecoin Signed Message:\n',
});

/** The header base of each BIP-137 address type. */
export const BIP137_HEADER_BASE = Object.freeze({
  p2pkhUncompressed: 27,
  p2pkh: 31,
  p2shP2wpkh: 35,
  p2wpkh: 39,
});

/** A base64 BIP-137 signature with the header of `header`. */
export function signBip137(
  family: keyof typeof BIP137_MAGIC,
  message: Uint8Array,
  privateKey: Uint8Array,
  header: keyof typeof BIP137_HEADER_BASE,
  options: { highS?: boolean } = {},
): string {
  const magic = utf8(BIP137_MAGIC[family]);
  const digest = sha256(
    sha256(concat(new Uint8Array([magic.length]), magic, compactSizeOf(message.length), message)),
  );
  const { r, s, recovery } = signRecoverable(digest, privateKey, options.highS === true);
  return base64.encode(concat(new Uint8Array([BIP137_HEADER_BASE[header] + recovery]), r, s));
}

function compactSizeOf(length: number): Uint8Array {
  if (length < 0xfd) {
    return new Uint8Array([length]);
  }
  return new Uint8Array([0xfd, length & 0xff, length >> 8]);
}

function taggedHash(tag: string, message: Uint8Array): Uint8Array {
  const tagHash = sha256(utf8(tag));
  return sha256(concat(tagHash, tagHash, message));
}

/** BIP-322 simple, `smp`-prefixed: the witness `@scure/btc-signer` produces when it signs `to_sign`. */
export function signBip322Simple(
  kind: 'p2wpkh' | 'p2tr',
  message: Uint8Array,
  privateKey: Uint8Array,
  network: BitcoinNetworkName = 'bitcoin',
): string {
  const params = BITCOIN_NETWORKS[network];
  const payment =
    kind === 'p2wpkh'
      ? btc.p2wpkh(secp256k1.getPublicKey(privateKey, true), params)
      : btc.p2tr(schnorr.getPublicKey(privateKey), undefined, params);
  const options = { allowUnknownOutputs: true, allowUnknownInputs: true, disableScriptCheck: true };
  const toSpend = new btc.Transaction({ ...options, version: 0 });
  toSpend.addOutput({ script: payment.script, amount: 0n });
  toSpend.addInput({
    txid: new Uint8Array(32),
    index: 0xffffffff,
    sequence: 0,
    finalScriptSig: concat(
      new Uint8Array([0x00, 0x20]),
      taggedHash('BIP0322-signed-message', message),
    ),
  });
  const toSign = new btc.Transaction({ ...options, version: 0 });
  toSign.addInput({
    txid: toSpend.id,
    index: 0,
    sequence: 0,
    witnessUtxo: { script: payment.script, amount: 0n },
    ...('tapInternalKey' in payment ? { tapInternalKey: payment.tapInternalKey } : {}),
  });
  toSign.addOutput({ script: new Uint8Array([0x6a]), amount: 0n });
  toSign.signIdx(privateKey, 0, [kind === 'p2tr' ? btc.SigHash.DEFAULT : btc.SigHash.ALL]);
  toSign.finalizeIdx(0);
  return `smp${base64.encode(encodeWitness(toSign.getInput(0).finalScriptWitness ?? []))}`;
}

/** A consensus-encoded witness stack: its item count, then each item with its length. */
export function encodeWitness(items: readonly Uint8Array[]): Uint8Array {
  return concat(
    compactSizeOf(items.length),
    ...items.flatMap((item) => [compactSizeOf(item.length), item]),
  );
}

// Solana ---------------------------------------------------------------------------------------

export interface SolanaTestKey {
  seed: Uint8Array;
  publicKey: Uint8Array;
  address: string;
}

export function solanaTestKey(label: string): SolanaTestKey {
  const seed = testPrivateKey(`solana/${label}`);
  const publicKey = ed25519.getPublicKey(seed);
  return { seed, publicKey, address: base58.encode(publicKey) };
}

/** A base58 ed25519 signature, as Solana wallets return one. */
export function signSolanaMessage(message: Uint8Array, seed: Uint8Array): string {
  return base58.encode(ed25519.sign(message, seed));
}

function onCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.Point.fromBytes(bytes, true);
    return true;
  } catch {
    return false;
  }
}

/** `findProgramAddress`: the first off-curve SHA-256 of the seeds, bump, program and marker. */
export function solanaProgramDerivedAddress(
  seeds: readonly Uint8Array[],
  programId: Uint8Array,
): Uint8Array {
  for (let bump = 255; bump >= 0; bump -= 1) {
    const candidate = sha256(
      concat(...seeds, new Uint8Array([bump]), programId, utf8('ProgramDerivedAddress')),
    );
    if (!onCurve(candidate)) {
      return candidate;
    }
  }
  throw new Error('no program address');
}

const SIGNING_DOMAIN = concat(new Uint8Array([0xff]), utf8('solana offchain'));

/** An off-chain message envelope of version 0 or 1 around `content`. */
export function solanaOffchainEnvelope(
  version: 0 | 1,
  content: Uint8Array,
  signatories: readonly Uint8Array[],
): Uint8Array {
  const count = new Uint8Array([signatories.length]);
  if (version === 1) {
    const sorted = [...signatories].sort((a, b) => hex.encode(a).localeCompare(hex.encode(b)));
    return concat(SIGNING_DOMAIN, new Uint8Array([1]), count, ...sorted, content);
  }
  const length = new Uint8Array([content.length & 0xff, content.length >> 8]);
  return concat(
    SIGNING_DOMAIN,
    new Uint8Array([0]),
    new Uint8Array(32),
    new Uint8Array([0]),
    count,
    ...signatories,
    length,
    content,
  );
}

/** Bitcoin's HASH160, for building expected scripts in tests. */
export function testHash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

// Evaluator inputs -------------------------------------------------------------------------------

/** A challenge text; the evaluators compare bytes, so any text serves. */
export const TEST_CHALLENGE =
  'verify.example.org wants you to sign in with your Ethereum account:\nNonce: a1B2c3D4e5F6g7H8';

/** A genuine EVM submission: the claimed key signed the challenge. */
export function evmCryptoInput(
  label: string,
  overrides: Partial<CryptoWalletCheckInput> = {},
): CryptoWalletCheckInput {
  const key = testPrivateKey(label);
  return {
    chainId: ETHEREUM_CHAIN,
    walletAddress: evmTestAddress(key),
    expectedAddress: null,
    challenge: { message: TEST_CHALLENGE },
    submission: { signature: signPersonalMessage(utf8(TEST_CHALLENGE), key) },
    ...overrides,
  };
}
