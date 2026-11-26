/**
 * Ownership of a claimed address by a signature over our challenge (C57.3, C57.4): one dispatch
 * over the chain's family and the submitted scheme, so the job and the evaluators read one answer.
 *
 * Encodings (a C57.3 amendment, recorded in the plan):
 * - `signature`: EVM and TRON `0x` hex (TRON may omit `0x`), 65 bytes for a key, any length for
 *   an EVM contract wallet; BIP-137 and BIP-322 legacy base64 of 65 bytes; BIP-322 simple base64
 *   prefixed `smp` (or bare); Solana base58 or padded base64 of 64 bytes;
 * - `signed-message`: padded base64 of the exact bytes the wallet signed, when the wallet wrapped
 *   the challenge (a Solana off-chain envelope); without it the challenge's UTF-8 bytes are signed.
 *
 * Without a scheme it is inferred from the chain (and, for Bitcoin, from the signature's shape). A
 * scheme the chain does not accept is invalid. The XRP Ledger has no ownership proof, and a
 * Solana address off the ed25519 curve has no key: both are `unsupported`.
 *
 * An EVM signature that does not recover the claimed address may still come from a contract
 * wallet: such a result carries the {@link EvmContractCheck} the job asks the `evmRpc` provider
 * (`eth_getCode`, then ERC-1271 `isValidSignature`).
 */
import {
  CRYPTO_INPUT_LIMITS,
  cryptoChainSchemes,
  type CryptoChainFamily,
  type CryptoSignatureScheme,
} from '@openverify/core';
import type { CryptoAddress } from './addresses.js';
import { verifyBip137, type Bip137Mode } from './bip137.js';
import { verifyBip322Simple } from './bip322.js';
import { decodeBase64, decodeHex, equalBytes, utf8 } from './bytes.js';
import { eip191Digest, recoverEvmSigner } from './eip191.js';
import { decodeSolanaSignature, verifySolanaSignature } from './solana.js';
import { recoverTronSigner, tronMessageDigest } from './tron.js';

/** What the `evmRpc` provider is asked: the contract's code, then `isValidSignature(digest, signature)`. */
export interface EvmContractCheck {
  /** The claimed address, lower-case `0x` hex. */
  address: string;
  /** The EIP-191 digest of the signed bytes (ERC-1271's `bytes32 hash`). */
  digest: Uint8Array;
  /** The signature bytes as submitted. */
  signature: Uint8Array;
}

export interface WalletSignatureInput {
  /** A valid, decoded claimed address. */
  address: CryptoAddress;
  /** The challenge message we issued. */
  message: string;
  signature: string;
  signedMessage?: string | null | undefined;
  scheme?: CryptoSignatureScheme | null | undefined;
  /** `bip137-mode` (C51.3). */
  bip137Mode: Bip137Mode;
}

export type WalletSignatureVerification =
  | {
      outcome: 'verified';
      scheme: CryptoSignatureScheme;
      /** The bytes the signature covers: the decoded `signed-message`, else the challenge. */
      signedBytes: Uint8Array;
      highS: boolean;
      bip137Loose: boolean;
    }
  | {
      /** A valid signature by another key; an EVM one may still be a contract wallet's. */
      outcome: 'address_mismatch';
      scheme: CryptoSignatureScheme;
      signedBytes: Uint8Array;
      highS: boolean;
      contractCheck: EvmContractCheck | null;
    }
  | {
      /** EVM: the bytes are no recoverable 65-byte signature; only a contract can accept them. */
      outcome: 'not_recovered';
      scheme: 'eip191';
      signedBytes: Uint8Array;
      contractCheck: EvmContractCheck;
    }
  | { outcome: 'invalid'; scheme: CryptoSignatureScheme | null }
  | { outcome: 'inconclusive'; scheme: CryptoSignatureScheme | null }
  | { outcome: 'unsupported'; scheme: null };

/** Verifies a submitted signature for a claimed address. Never throws on hostile input. */
export function verifyWalletSignature(input: WalletSignatureInput): WalletSignatureVerification {
  const { address } = input;
  if (address.family === 'xrpl' || (address.family === 'solana' && address.onCurve !== true)) {
    return { outcome: 'unsupported', scheme: null };
  }
  const scheme = input.scheme ?? inferScheme(address.family, input.signature);
  if (!cryptoChainSchemes(address.chainId).includes(scheme)) {
    return { outcome: 'invalid', scheme };
  }
  const signedBytes =
    input.signedMessage === null || input.signedMessage === undefined
      ? utf8(input.message)
      : decodeBase64(input.signedMessage, CRYPTO_INPUT_LIMITS.messageMaxBytes);
  if (signedBytes === null) {
    return { outcome: 'invalid', scheme };
  }
  try {
    return verifyScheme(scheme, address, signedBytes, input);
  } catch {
    return { outcome: 'invalid', scheme };
  }
}

/** ERC-6492's magic suffix: a signature wrapped for a contract not yet deployed. */
const ERC6492_SUFFIX = new Uint8Array(32).map((_, index) => (index % 2 === 0 ? 0x64 : 0x92));
/** At most 1,024 characters of `0x` hex. */
const EVM_SIGNATURE_MAX_BYTES = Math.floor((CRYPTO_INPUT_LIMITS.signatureMaxLength - 2) / 2);

function verifyScheme(
  scheme: CryptoSignatureScheme,
  address: CryptoAddress,
  signedBytes: Uint8Array,
  input: WalletSignatureInput,
): WalletSignatureVerification {
  switch (scheme) {
    case 'eip191':
      return verifyEip191(address, signedBytes, input.signature);
    case 'tron-v2':
      return verifyTron(address, signedBytes, input.signature);
    case 'bip137':
    case 'bip322-legacy': {
      const result = verifyBip137(address, signedBytes, input.signature, {
        mode: input.bip137Mode,
        legacyOnly: scheme === 'bip322-legacy',
      });
      switch (result.outcome) {
        case 'verified':
          return {
            outcome: 'verified',
            scheme,
            signedBytes,
            highS: result.highS,
            bip137Loose: result.loose,
          };
        case 'address_mismatch':
          return {
            outcome: 'address_mismatch',
            scheme,
            signedBytes,
            highS: result.highS,
            contractCheck: null,
          };
        default:
          return { outcome: result.outcome, scheme };
      }
    }
    case 'bip322-simple': {
      const result = verifyBip322Simple(address, signedBytes, input.signature);
      switch (result.outcome) {
        case 'verified':
          return { outcome: 'verified', scheme, signedBytes, highS: false, bip137Loose: false };
        case 'address_mismatch':
          return {
            outcome: 'address_mismatch',
            scheme,
            signedBytes,
            highS: false,
            contractCheck: null,
          };
        default:
          return { outcome: result.outcome, scheme };
      }
    }
    case 'solana-ed25519': {
      const signature = decodeSolanaSignature(input.signature);
      return signature !== null && verifySolanaSignature(address.payload, signedBytes, signature)
        ? { outcome: 'verified', scheme, signedBytes, highS: false, bip137Loose: false }
        : { outcome: 'invalid', scheme };
    }
  }
}

function verifyEip191(
  address: CryptoAddress,
  signedBytes: Uint8Array,
  text: string,
): WalletSignatureVerification {
  const signature = decodeHex(text, { prefix: 'required', maxBytes: EVM_SIGNATURE_MAX_BYTES });
  if (signature === null) {
    return { outcome: 'invalid', scheme: 'eip191' };
  }
  if (signature.length >= 32 && equalBytes(signature.slice(-32), ERC6492_SUFFIX)) {
    return { outcome: 'inconclusive', scheme: 'eip191' };
  }
  const digest = eip191Digest(signedBytes);
  const contractCheck = { address: address.canonical, digest, signature };
  const recovered = recoverEvmSigner(digest, signature);
  if (recovered === null) {
    return { outcome: 'not_recovered', scheme: 'eip191', signedBytes, contractCheck };
  }
  return recovered.address === address.canonical
    ? {
        outcome: 'verified',
        scheme: 'eip191',
        signedBytes,
        highS: recovered.highS,
        bip137Loose: false,
      }
    : {
        outcome: 'address_mismatch',
        scheme: 'eip191',
        signedBytes,
        highS: recovered.highS,
        contractCheck,
      };
}

function verifyTron(
  address: CryptoAddress,
  signedBytes: Uint8Array,
  text: string,
): WalletSignatureVerification {
  const signature = decodeHex(text, { prefix: 'optional', maxBytes: 65 });
  const recovered =
    signature === null ? null : recoverTronSigner(tronMessageDigest(signedBytes), signature);
  if (recovered === null) {
    return { outcome: 'invalid', scheme: 'tron-v2' };
  }
  return recovered.address === address.canonical
    ? {
        outcome: 'verified',
        scheme: 'tron-v2',
        signedBytes,
        highS: recovered.highS,
        bip137Loose: false,
      }
    : {
        outcome: 'address_mismatch',
        scheme: 'tron-v2',
        signedBytes,
        highS: recovered.highS,
        contractCheck: null,
      };
}

/** The scheme a chain's signature is in when the client named none. */
function inferScheme(family: CryptoChainFamily, signature: string): CryptoSignatureScheme {
  switch (family) {
    case 'evm':
      return 'eip191';
    case 'tron':
      return 'tron-v2';
    case 'solana':
      return 'solana-ed25519';
    case 'bitcoin': {
      if (
        signature.startsWith('smp') ||
        signature.startsWith('ful') ||
        signature.startsWith('pof')
      ) {
        return 'bip322-simple';
      }
      const bytes = decodeBase64(signature, 65);
      const header = bytes?.[0] ?? 0;
      return bytes?.length === 65 && header >= 27 && header <= 42 ? 'bip137' : 'bip322-simple';
    }
    default:
      return 'bip137';
  }
}
