/**
 * Byte helpers the parsers, the verifier and the test builders share. Nothing here logs or
 * echoes a byte (C53.8).
 */

// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const HEX = /^(?:[0-9a-f]{2})*$/i;

/** Lower-case hex of `bytes`. */
export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');
}

/** The bytes of an even-length hex string (either case). @throws {RangeError} otherwise. */
export function fromHex(hex: string): Uint8Array {
  if (!HEX.test(hex)) {
    throw new RangeError('expected an even number of hex digits');
  }
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

/** One array holding every part, in order. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Whether two byte arrays hold the same bytes. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && compareBytes(a, b) === 0;
}

/** Lexicographic order of two byte arrays (a shorter prefix first), as DER sorts a SET OF. */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return a.length - b.length;
}

/** The UTF-8 bytes of `text`. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** The unsigned big-endian bytes of `value`, minimal or left-padded to `length`. */
export function unsignedBytes(value: bigint, length?: number): Uint8Array {
  if (value < 0n) {
    throw new RangeError('expected a non-negative integer');
  }
  let digits = value.toString(16);
  if (digits.length % 2 === 1) {
    digits = `0${digits}`;
  }
  if (length !== undefined) {
    if (digits.length > length * 2) {
      throw new RangeError(`the integer does not fit in ${String(length)} bytes`);
    }
    digits = digits.padStart(length * 2, '0');
  }
  return fromHex(digits);
}

/** The unsigned big-endian integer `bytes` holds. */
export function bytesToBigInt(bytes: Uint8Array): bigint {
  return bytes.length === 0 ? 0n : BigInt(`0x${toHex(bytes)}`);
}

/** The number of bits of a non-negative integer (0 for 0). */
export function bitLength(value: bigint): number {
  return value === 0n ? 0 : value.toString(2).length;
}
