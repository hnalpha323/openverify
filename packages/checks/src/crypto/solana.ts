/**
 * Solana ownership (C57.1): an ed25519 signature (RFC 8032, `zip215: false`) by the address's own
 * key over the bytes the wallet signed. An address that is not an ed25519 point is a
 * program-derived account, which no key controls: its ownership cannot be proven.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { decodeBase64 } from './bytes.js';

const SIGNATURE_BYTES = 64;
/** A base58 64-byte value is at most 88 characters; base64 is exactly 88. */
const SIGNATURE_MAX_LENGTH = 88;

/**
 * Whether 32 bytes decode to an ed25519 point, as Solana's `isOnCurve` (curve25519-dalek's
 * decompression, which, like ZIP-215, takes a non-canonical `y`) decides.
 */
export function isOnEd25519Curve(publicKey: Uint8Array): boolean {
  if (publicKey.length !== 32) {
    return false;
  }
  try {
    ed25519.Point.fromBytes(publicKey, true);
    return true;
  } catch {
    return false;
  }
}

/** The 64 bytes of a Solana signature in base58 or padded base64, or `null`. */
export function decodeSolanaSignature(signature: string): Uint8Array | null {
  if (signature.length === 0 || signature.length > SIGNATURE_MAX_LENGTH) {
    return null;
  }
  const fromBase64 = decodeBase64(signature, SIGNATURE_BYTES);
  if (fromBase64?.length === SIGNATURE_BYTES) {
    return fromBase64;
  }
  try {
    const bytes = base58.decode(signature);
    return bytes.length === SIGNATURE_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** Whether `signature` is the key's strict RFC 8032 signature of `message`. */
export function verifySolanaSignature(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, message, publicKey, { zip215: false });
  } catch {
    return false;
  }
}
