/**
 * Byte helpers of the crypto wallet checks (C57): strict decoders that refuse rather than guess,
 * and the hashes the chains share. Every decoder caps its input first (base58 is quadratic).
 */
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64 } from '@scure/base';

const encoder = new TextEncoder();
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const HEX_DIGITS = /^(?:[\da-f]{2})*$/iu;

/** UTF-8 bytes of a string. */
export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** The bytes of `0x`-prefixed (or, with `prefix: 'optional'`, bare) even-length hex; `null` otherwise. */
export function decodeHex(
  text: string,
  options: { prefix: 'required' | 'optional'; maxBytes: number },
): Uint8Array | null {
  const prefixed = text.startsWith('0x');
  if (!prefixed && options.prefix === 'required') {
    return null;
  }
  const digits = prefixed ? text.slice(2) : text;
  if (digits.length === 0 || digits.length > options.maxBytes * 2 || !HEX_DIGITS.test(digits)) {
    return null;
  }
  const bytes = new Uint8Array(digits.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** The bytes of padded standard base64 that re-encodes to the same text; `null` otherwise. */
export function decodeBase64(text: string, maxBytes: number): Uint8Array | null {
  if (text.length > Math.ceil(maxBytes / 3) * 4) {
    return null;
  }
  let bytes: Uint8Array;
  try {
    bytes = base64.decode(text);
  } catch {
    return null;
  }
  return bytes.length <= maxBytes && base64.encode(bytes) === text ? bytes : null;
}

/** Concatenates byte arrays. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Whether two byte arrays are equal. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/** Bitcoin's double SHA-256. */
export function sha256d(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes));
}

/** Bitcoin's HASH160: RIPEMD-160 of SHA-256. */
export function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

/** Bitcoin's CompactSize length prefix. */
export function compactSize(length: number): Uint8Array {
  if (length < 0xfd) {
    return Uint8Array.of(length);
  }
  if (length <= 0xffff) {
    return Uint8Array.of(0xfd, length & 0xff, length >>> 8);
  }
  return Uint8Array.of(
    0xfe,
    length & 0xff,
    (length >>> 8) & 0xff,
    (length >>> 16) & 0xff,
    length >>> 24,
  );
}
