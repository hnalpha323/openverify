/**
 * EIP-191 `personal_sign` (version 0x45) over the challenge bytes: Keccak-256 of
 * `"\x19Ethereum Signed Message:\n"`, the decimal byte length and the message. A 65-byte `r‖s‖v`
 * signature with `v` in {0, 1, 27, 28} recovers a secp256k1 key, whose address is the last 20
 * bytes of the Keccak-256 of the uncompressed key. EIP-2's low-s rule binds transactions only,
 * so a high-s message signature is reported, not refused, here.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hex } from '@scure/base';
import { concatBytes, utf8 } from './bytes.js';

const EIP191_PREFIX = `${String.fromCharCode(0x19)}Ethereum Signed Message:\n`;

/** The digest `personal_sign` signs, and the hash ERC-1271 `isValidSignature` receives. */
export function eip191Digest(message: Uint8Array): Uint8Array {
  return keccak_256(concatBytes(utf8(`${EIP191_PREFIX}${String(message.length)}`), message));
}

/** A key recovered from a 65-byte signature. */
export interface RecoveredSigner {
  /** The signer's address, lower-case `0x` hex (EVM) or base58check (TRON). */
  address: string;
  /** `s` lies in the upper half of the curve order. */
  highS: boolean;
}

/**
 * The EVM address that signed `digest` with a 65-byte `r‖s‖v` signature; `null` when the bytes
 * are not such a signature or recover no key.
 */
export function recoverEvmSigner(
  digest: Uint8Array,
  signature: Uint8Array,
): RecoveredSigner | null {
  const recovered = recoverSecp256k1Key(digest, signature);
  return recovered === null
    ? null
    : { address: evmAddressOfPublicKey(recovered.publicKey), highS: recovered.highS };
}

/** The EVM address of a secp256k1 public key (compressed or not), lower-case `0x` hex. */
export function evmAddressOfPublicKey(publicKey: Uint8Array): string {
  return `0x${hex.encode(evmAccountOfPublicKey(publicKey))}`;
}

/** The 20-byte account of a secp256k1 public key: the last 20 bytes of its Keccak-256. */
export function evmAccountOfPublicKey(publicKey: Uint8Array): Uint8Array {
  const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false);
  return keccak_256(uncompressed.slice(1)).slice(12);
}

/**
 * The key and the high-s flag of a 65-byte `r‖s‖v` signature with `v` in {0, 1, 27, 28}, or
 * `null` (wrong length or `v`, `r` or `s` out of range, no point).
 */
export function recoverSecp256k1Key(
  digest: Uint8Array,
  signature: Uint8Array,
): { publicKey: Uint8Array; highS: boolean } | null {
  if (signature.length !== 65) {
    return null;
  }
  const v = signature[64] ?? -1;
  const recovery = v >= 27 ? v - 27 : v;
  if (recovery !== 0 && recovery !== 1) {
    return null;
  }
  try {
    const parsed = secp256k1.Signature.fromBytes(signature.slice(0, 64), 'compact');
    const point = parsed.addRecoveryBit(recovery).recoverPublicKey(digest);
    return { publicKey: point.toBytes(true), highS: parsed.hasHighS() };
  } catch {
    return null;
  }
}
