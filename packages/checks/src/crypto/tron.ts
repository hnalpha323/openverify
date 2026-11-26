/**
 * TRON `signMessageV2` (TronWeb `utils/message.ts`): Keccak-256 of
 * `"\x19TRON Signed Message:\n"`, the decimal byte length and the message, signed as EIP-191 is.
 * The address is base58check of `0x41` and the last 20 bytes of the Keccak-256 of the key.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { createBase58check } from '@scure/base';
import { concatBytes, utf8 } from './bytes.js';
import { evmAccountOfPublicKey, recoverSecp256k1Key, type RecoveredSigner } from './eip191.js';

const TRON_PREFIX = `${String.fromCharCode(0x19)}TRON Signed Message:\n`;
const base58check = createBase58check(sha256);

export function tronMessageDigest(message: Uint8Array): Uint8Array {
  return keccak_256(concatBytes(utf8(`${TRON_PREFIX}${String(message.length)}`), message));
}

/** The TRON address of a 21-byte `0x41`-prefixed account: base58check. */
export function tronAddressOf(account: Uint8Array): string {
  return base58check.encode(account);
}

/** The TRON address that signed `digest` with a 65-byte signature, or `null`. */
export function recoverTronSigner(
  digest: Uint8Array,
  signature: Uint8Array,
): RecoveredSigner | null {
  const recovered = recoverSecp256k1Key(digest, signature);
  if (recovered === null) {
    return null;
  }
  const account = concatBytes(Uint8Array.of(0x41), evmAccountOfPublicKey(recovered.publicKey));
  return { address: tronAddressOf(account), highS: recovered.highS };
}
