/**
 * A minimal DER writer (ITU-T X.690) for the structures this package builds itself: the
 * self-test's explicit-parameter keys and, in `@openverify/emrtd/testing`, the synthetic
 * certificates, CRLs, master lists and chip files. It writes definite lengths only; a caller
 * that needs DER keeps SET OF members sorted ({@link setOf}). The parsers never use it: they read
 * what they receive through the TLV pre-scan, asn1js and pkijs.
 */
import { compareBytes, concatBytes, unsignedBytes, utf8 } from './bytes.js';

/** A tag as one number of one to four tag bytes: `0x30`, `0x5f1f`, `0x7f61`. */
export type Tag = number;

export function encodeLength(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError('a length is a non-negative integer');
  }
  if (length < 0x80) {
    return new Uint8Array([length]);
  }
  const bytes = unsignedBytes(BigInt(length));
  return concatBytes(new Uint8Array([0x80 | bytes.length]), bytes);
}

export function tagBytes(tag: Tag): Uint8Array {
  if (!Number.isSafeInteger(tag) || tag <= 0 || tag > 0xffffffff) {
    throw new RangeError('a tag is one to four non-zero bytes');
  }
  return unsignedBytes(BigInt(tag));
}

/** One TLV: the tag, the definite length and the concatenated contents. */
export function tlv(tag: Tag, ...contents: readonly Uint8Array[]): Uint8Array {
  const value = concatBytes(...contents);
  return concatBytes(tagBytes(tag), encodeLength(value.length), value);
}

export function sequence(...contents: readonly Uint8Array[]): Uint8Array {
  return tlv(0x30, ...contents);
}

/** A SET OF in DER order: its members sorted by their encodings. */
export function setOf(members: readonly Uint8Array[]): Uint8Array {
  return tlv(0x31, ...[...members].sort(compareBytes));
}

/** An INTEGER, minimal two's complement. @throws {RangeError} for a negative value. */
export function integer(value: bigint | number): Uint8Array {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new RangeError('an INTEGER is a whole number');
  }
  const big = BigInt(value);
  if (big < 0n) {
    throw new RangeError('negative INTEGERs are not written');
  }
  const bytes = unsignedBytes(big);
  return tlv(0x02, (bytes[0] ?? 0) & 0x80 ? concatBytes(new Uint8Array([0]), bytes) : bytes);
}

const ARC = /^(?:0|[1-9]\d*)$/;

function base128(value: bigint): number[] {
  const out = [Number(value & 0x7fn)];
  let rest = value >> 7n;
  while (rest > 0n) {
    out.unshift(Number((rest & 0x7fn) | 0x80n));
    rest >>= 7n;
  }
  return out;
}

/** An OBJECT IDENTIFIER from its dotted form. @throws {RangeError} for a malformed one. */
export function objectIdentifier(dotted: string): Uint8Array {
  const arcs = dotted.split('.');
  if (arcs.length < 2 || !arcs.every((arc) => ARC.test(arc))) {
    throw new RangeError('an OID has at least two numeric arcs');
  }
  const [first, second, ...rest] = arcs.map(BigInt);
  if (first === undefined || second === undefined || first > 2n || (first < 2n && second > 39n)) {
    throw new RangeError('the first two OID arcs are out of range');
  }
  return tlv(0x06, new Uint8Array([...base128(first * 40n + second), ...rest.flatMap(base128)]));
}

export function octetString(bytes: Uint8Array): Uint8Array {
  return tlv(0x04, bytes);
}

export function bitString(bytes: Uint8Array, unusedBits = 0): Uint8Array {
  if (!Number.isInteger(unusedBits) || unusedBits < 0 || unusedBits > 7) {
    throw new RangeError('a BIT STRING leaves 0 to 7 bits unused');
  }
  return tlv(0x03, new Uint8Array([unusedBits]), bytes);
}

/** A named BIT STRING (key usage) with the given bit positions set, trailing zeros removed. */
export function namedBits(positions: readonly number[]): Uint8Array {
  if (!positions.every((position) => Number.isInteger(position) && position >= 0)) {
    throw new RangeError('bit positions are non-negative integers');
  }
  if (positions.length === 0) {
    return bitString(new Uint8Array());
  }
  const highest = Math.max(...positions);
  const bytes = new Uint8Array(Math.floor(highest / 8) + 1);
  for (const position of positions) {
    const index = Math.floor(position / 8);
    bytes[index] = (bytes[index] ?? 0) | (0x80 >> (position % 8));
  }
  return bitString(bytes, 7 - (highest % 8));
}

export function nullValue(): Uint8Array {
  return new Uint8Array([0x05, 0x00]);
}

export function booleanValue(value: boolean): Uint8Array {
  return new Uint8Array([0x01, 0x01, value ? 0xff : 0x00]);
}

export function printableString(text: string): Uint8Array {
  return tlv(0x13, utf8(text));
}

export function utf8String(text: string): Uint8Array {
  return tlv(0x0c, utf8(text));
}

export function ia5String(text: string): Uint8Array {
  return tlv(0x16, utf8(text));
}

/** `YYYYMMDDHHMMSS` of `date` in UTC, to the second. */
function digits(date: Date): string {
  return date.toISOString().slice(0, 19).replaceAll(/[-T:]/g, '');
}

/** `YYMMDDHHMMSSZ`, seconds precision. */
export function utcTime(date: Date): Uint8Array {
  const year = date.getUTCFullYear();
  if (year < 1950 || year > 2049) {
    throw new RangeError('UTCTime covers 1950 to 2049');
  }
  return tlv(0x17, utf8(`${digits(date).slice(2)}Z`));
}

/** `YYYYMMDDHHMMSSZ`, seconds precision. */
export function generalizedTime(date: Date): Uint8Array {
  return tlv(0x18, utf8(`${digits(date)}Z`));
}

/** RFC 5280 §4.1.2.5: UTCTime through 2049, GeneralizedTime from 2050. */
export function x509Time(date: Date): Uint8Array {
  return date.getUTCFullYear() < 2050 ? utcTime(date) : generalizedTime(date);
}

/** `[n]` EXPLICIT (context-specific, constructed). */
export function explicit(tagNumber: number, ...contents: readonly Uint8Array[]): Uint8Array {
  return tlv(0xa0 | tagNumber, ...contents);
}

/** `[n]` IMPLICIT over a primitive value (context-specific, primitive). */
export function implicitPrimitive(tagNumber: number, contents: Uint8Array): Uint8Array {
  return tlv(0x80 | tagNumber, contents);
}

/** An AlgorithmIdentifier: the OID, then the parameters when given. */
export function algorithmIdentifier(oid: string, parameters?: Uint8Array): Uint8Array {
  return parameters === undefined
    ? sequence(objectIdentifier(oid))
    : sequence(objectIdentifier(oid), parameters);
}
