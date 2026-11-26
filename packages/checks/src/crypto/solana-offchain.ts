/**
 * Solana off-chain message envelopes (sRFC 3, as `@solana/offchain-messages` encodes them): the
 * signing domain `\xffsolana offchain`, a version byte, then for version 0 a 32-byte application
 * domain, a format byte, the signatories and a 16-bit length, and for version 1 the signatories
 * alone, then the UTF-8 content. A wallet may sign such an envelope around our challenge; the
 * statement comparison unwraps it (C57.4) and requires the claimed key among its signatories.
 */
import { concatBytes, equalBytes, utf8 } from './bytes.js';

export interface SolanaOffchainMessage {
  version: 0 | 1;
  /** The 32-byte public keys the envelope names as required signers. */
  signatories: readonly Uint8Array[];
  /** The content bytes (UTF-8 text). */
  content: Uint8Array;
}

/** Whether `bytes` start with the off-chain signing domain. */
export function isSolanaOffchainEnvelope(bytes: Uint8Array): boolean {
  return (
    bytes.length >= SIGNING_DOMAIN.length &&
    equalBytes(bytes.slice(0, SIGNING_DOMAIN.length), SIGNING_DOMAIN)
  );
}

/** Decodes a version 0 or 1 envelope; `null` when it is not one or is malformed. */
export function unwrapSolanaOffchainMessage(bytes: Uint8Array): SolanaOffchainMessage | null {
  if (!isSolanaOffchainEnvelope(bytes)) {
    return null;
  }
  let offset = SIGNING_DOMAIN.length;
  const version = bytes[offset];
  offset += 1;
  if (version === 0) {
    // The application domain (32 bytes) and the content format (1 byte) come first in v0.
    offset += 33;
  } else if (version !== 1) {
    return null;
  }
  const count = bytes[offset] ?? 0;
  offset += 1;
  if (count === 0 || offset + count * KEY_BYTES > bytes.length) {
    return null;
  }
  const signatories: Uint8Array[] = [];
  for (let index = 0; index < count; index += 1) {
    signatories.push(bytes.slice(offset, offset + KEY_BYTES));
    offset += KEY_BYTES;
  }
  if (version === 1 && !strictlyAscending(signatories)) {
    // v1 requires sorted, unique signatories.
    return null;
  }
  if (version === 0) {
    const length = (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
    offset += 2;
    if (offset + length !== bytes.length) {
      return null;
    }
  }
  const content = bytes.slice(offset);
  return content.length === 0 ? null : { version, signatories, content };
}

/** The string `\xffsolana offchain`. */
const SIGNING_DOMAIN = concatBytes(Uint8Array.of(0xff), utf8('solana offchain'));
const KEY_BYTES = 32;

function strictlyAscending(keys: readonly Uint8Array[]): boolean {
  return keys.every((key, index) => index === 0 || compareBytes(keys[index - 1] ?? key, key) < 0);
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return a.length - b.length;
}
