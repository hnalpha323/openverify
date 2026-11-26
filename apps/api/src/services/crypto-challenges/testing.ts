/**
 * Deterministic EVM test wallets for the API's crypto wallet tests (C65.4). Only tests import
 * this file.
 *
 * Each key is the SHA-256 of `openverify/test-wallet/<label>`, the derivation the checks
 * package's test wallets use, so no key is committed and a label names the same wallet there, in
 * the API and in the e2e (for example {@link SANDBOX_CONTRACT_WALLET_OWNER_LABEL}). The API has no
 * curve library of its own, so this signs with a small textbook secp256k1 ECDSA over `bigint`
 * (deterministic nonces, low s, `v` 27 or 28): test code only, never constant-time, and checked
 * by the checks package's independent recovery (`recoverEvmSigner`) in every test that uses it.
 */
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import {
  defaultInquiryTemplateAttributes,
  type CreateInquiryTemplateAttributes,
} from '@openverify/contracts';
import { eip191Digest, evmAddressOfPublicKey } from '@openverify/checks';
import { defaultTemplateConfig, type VerificationTemplateConfig } from '@openverify/core';

/** The secp256k1 field prime, group order and generator. */
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G: Point = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};

type Point = { x: bigint; y: bigint } | null;

const mod = (value: bigint, modulus: bigint): bigint => {
  const rest = value % modulus;
  return rest >= 0n ? rest : rest + modulus;
};

/** The inverse of `value` modulo a prime, by the extended Euclidean algorithm. */
function inverse(value: bigint, modulus: bigint): bigint {
  let [previous, current] = [0n, 1n];
  let [remainder, next] = [modulus, mod(value, modulus)];
  while (next !== 0n) {
    const quotient = remainder / next;
    [previous, current] = [current, previous - quotient * current];
    [remainder, next] = [next, remainder - quotient * next];
  }
  return mod(previous, modulus);
}

function add(a: Point, b: Point): Point {
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  let slope: bigint;
  if (a.x === b.x) {
    if (mod(a.y + b.y, P) === 0n) {
      return null;
    }
    slope = mod(3n * a.x * a.x * inverse(2n * a.y, P), P);
  } else {
    slope = mod((b.y - a.y) * inverse(b.x - a.x, P), P);
  }
  const x = mod(slope * slope - a.x - b.x, P);
  return { x, y: mod(slope * (a.x - x) - a.y, P) };
}

function multiply(scalar: bigint, point: Point): Point {
  let result: Point = null;
  let addend = point;
  for (let rest = scalar; rest > 0n; rest >>= 1n) {
    if ((rest & 1n) === 1n) {
      result = add(result, addend);
    }
    addend = add(addend, addend);
  }
  return result;
}

const sha256 = (...parts: (Uint8Array | string)[]): Uint8Array => {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
  }
  return new Uint8Array(hash.digest());
};

const toBigInt = (bytes: Uint8Array): bigint =>
  bytes.length === 0 ? 0n : BigInt(`0x${Buffer.from(bytes).toString('hex')}`);

const toWord = (value: bigint): Uint8Array =>
  new Uint8Array(Buffer.from(value.toString(16).padStart(64, '0'), 'hex'));

/** The private scalar of a test wallet. */
function keyOf(label: string): bigint {
  const key = mod(toBigInt(sha256(`openverify/test-wallet/${label}`)), N);
  if (key === 0n) {
    throw new Error('the label gives no key');
  }
  return key;
}

/** The uncompressed public key of a test wallet (`04 ‖ x ‖ y`). */
export function testWalletPublicKey(label: string): Uint8Array {
  const point = multiply(keyOf(label), G);
  if (point === null) {
    throw new Error('the label gives no key');
  }
  return new Uint8Array([4, ...toWord(point.x), ...toWord(point.y)]);
}

/** The lower-case `0x` EVM address of a test wallet. */
export function testWalletAddress(label: string): string {
  return evmAddressOfPublicKey(testWalletPublicKey(label));
}

/** A 65-byte `r ‖ s ‖ v` signature of a 32-byte digest by a test wallet (low s, `v` 27 or 28). */
export function signTestDigest(digest: Uint8Array, label: string): Uint8Array {
  const key = keyOf(label);
  const z = toBigInt(digest);
  for (let counter = 0; counter < 256; counter += 1) {
    const nonce = mod(toBigInt(sha256(toWord(key), digest, String(counter))), N);
    const point = nonce === 0n ? null : multiply(nonce, G);
    if (point === null || point.x >= N) {
      continue;
    }
    const r = point.x;
    let s = mod(inverse(nonce, N) * (z + r * key), N);
    if (r === 0n || s === 0n) {
      continue;
    }
    let recovery = Number(point.y & 1n);
    if (s > N / 2n) {
      s = N - s;
      recovery ^= 1;
    }
    return new Uint8Array([...toWord(r), ...toWord(s), 27 + recovery]);
  }
  throw new Error('no signature');
}

/** `personal_sign` (EIP-191) of `message` by a test wallet: `0x` hex `r ‖ s ‖ v`. */
export function signTestPersonalMessage(message: string, label: string): string {
  const digest = eip191Digest(new TextEncoder().encode(message));
  return `0x${Buffer.from(signTestDigest(digest, label)).toString('hex')}`;
}

// Solana ---------------------------------------------------------------------------------------

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** The PKCS #8 header of an Ed25519 private key, before its 32-byte seed (RFC 8410). */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Bitcoin-alphabet base58, as Solana writes keys and signatures. */
export function base58(bytes: Uint8Array): string {
  let value = toBigInt(bytes);
  let text = '';
  while (value > 0n) {
    text = `${BASE58[Number(value % 58n)] ?? ''}${text}`;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }
    text = `1${text}`;
  }
  return text;
}

export interface TestSolanaWallet {
  /** The base58 public key. */
  address: string;
  /** A base58 Ed25519 signature of the UTF-8 bytes of `message`, as a wallet returns one. */
  sign(message: string): string;
}

/**
 * A Solana test wallet: its seed is the SHA-256 of `openverify/test-wallet/solana/<label>`, as the
 * checks package's `solanaTestKey(label)`; Node signs Ed25519 itself.
 */
export function testSolanaWallet(label: string): TestSolanaWallet {
  const seed = sha256(`openverify/test-wallet/solana/${label}`);
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return {
    address: base58(new Uint8Array(publicKey.subarray(-32))),
    sign: (message) => base58(new Uint8Array(sign(null, Buffer.from(message, 'utf8'), privateKey))),
  };
}

// Templates ------------------------------------------------------------------------------------

/** Every chain a crypto wallet test offers: EVM, Bitcoin, Solana and TRON. */
export const TEST_CHAINS = Object.freeze({
  ethereum: 'eip155:1',
  base: 'eip155:8453',
  bitcoin: 'bip122:000000000019d6689c085ae165831e93',
  solana: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  tron: 'tron:728126428',
});

export interface CryptoWalletTemplateOptions {
  chains?: readonly string[];
  signing?: readonly ('wallet' | 'paste')[];
  maxAttempts?: number;
  /** Changes the registry defaults of the `crypto-wallet` configuration. */
  config?: (config: VerificationTemplateConfig) => VerificationTemplateConfig;
}

/** Consent, one crypto wallet step (`wallet`), completion and failure, with its configuration. */
export function cryptoWalletTemplateAttributes(
  options: CryptoWalletTemplateOptions = {},
): CreateInquiryTemplateAttributes {
  const attributes = defaultInquiryTemplateAttributes();
  attributes.name = 'Crypto wallet';
  const kept = attributes.flow.steps.filter(
    (step) => step.type === 'consent' || step.type === 'completion' || step.type === 'failure',
  );
  const [consent, ...ends] = kept;
  attributes.flow.steps = [
    ...(consent === undefined ? [] : [consent]),
    {
      id: 'wallet',
      type: 'crypto_wallet',
      chains: [...(options.chains ?? Object.values(TEST_CHAINS))],
      signing: [...(options.signing ?? ['wallet', 'paste'])],
      ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    },
    ...ends,
  ];
  attributes.flow.transitions = [
    { from: 'wallet', to: 'failure', condition: { '==': [{ var: 'inquiry.status' }, 'failed'] } },
  ];
  const config = defaultTemplateConfig('crypto_wallet');
  attributes['verification-config'] = {
    'crypto-wallet': options.config === undefined ? config : options.config(config),
  };
  return attributes;
}
