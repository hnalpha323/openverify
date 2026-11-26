/**
 * The DER writer and the byte helpers. Expected encodings are X.690's (worked by hand from the
 * standard's rules), and every structure is read back with asn1js as an independent parser.
 */
import * as asn1js from 'asn1js';
import { describe, expect, it } from 'vitest';
import {
  bitLength,
  bytesToBigInt,
  compareBytes,
  concatBytes,
  equalBytes,
  fromHex,
  toHex,
  unsignedBytes,
  utf8,
} from './bytes.js';
import {
  algorithmIdentifier,
  bitString,
  booleanValue,
  encodeLength,
  explicit,
  generalizedTime,
  ia5String,
  implicitPrimitive,
  integer,
  namedBits,
  nullValue,
  objectIdentifier,
  octetString,
  printableString,
  sequence,
  setOf,
  tagBytes,
  tlv,
  utcTime,
  utf8String,
  x509Time,
} from './der.js';

const hex = (bytes: Uint8Array) => toHex(bytes);

describe('the byte helpers', () => {
  it('writes and reads hex in either case', () => {
    expect(toHex(new Uint8Array([0, 1, 0xab, 0xff]))).toBe('0001abff');
    expect(fromHex('0001ABff')).toEqual(new Uint8Array([0, 1, 0xab, 0xff]));
    expect(fromHex('')).toEqual(new Uint8Array());
  });

  it.each(['abc', '0g', 'zz'])('refuses %j as hex', (text) => {
    expect(() => fromHex(text)).toThrow(RangeError);
  });

  it('concatenates, compares and orders bytes', () => {
    expect(concatBytes(new Uint8Array([1]), new Uint8Array(), new Uint8Array([2, 3]))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(equalBytes(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false);
    expect(compareBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBeLessThan(0);
    expect(compareBytes(new Uint8Array([2]), new Uint8Array([1, 9]))).toBeGreaterThan(0);
    expect(compareBytes(new Uint8Array([1]), new Uint8Array([1, 0]))).toBeLessThan(0);
    expect(compareBytes(new Uint8Array([1, 0]), new Uint8Array([1]))).toBeGreaterThan(0);
    expect(compareBytes(new Uint8Array([7]), new Uint8Array([7]))).toBe(0);
  });

  it('encodes UTF-8 and unsigned integers, minimal or padded', () => {
    expect(hex(utf8('Ä<'))).toBe('c3843c');
    expect(hex(unsignedBytes(0n))).toBe('00');
    expect(hex(unsignedBytes(0x1234n))).toBe('1234');
    expect(hex(unsignedBytes(0x1234n, 4))).toBe('00001234');
    expect(() => unsignedBytes(0x123456n, 2)).toThrow(RangeError);
    expect(() => unsignedBytes(-1n)).toThrow(RangeError);
    expect(bytesToBigInt(fromHex('00ff01'))).toBe(0xff01n);
    expect(bytesToBigInt(new Uint8Array())).toBe(0n);
    expect(bitLength(0n)).toBe(0);
    expect(bitLength(1n)).toBe(1);
    expect(bitLength(0x80n)).toBe(8);
    expect(bitLength(2n ** 2048n - 1n)).toBe(2048);
  });
});

describe('the DER writer (X.690)', () => {
  it('writes short and long definite lengths', () => {
    expect(hex(encodeLength(0))).toBe('00');
    expect(hex(encodeLength(127))).toBe('7f');
    expect(hex(encodeLength(128))).toBe('8180');
    expect(hex(encodeLength(300))).toBe('82012c');
    expect(hex(encodeLength(70_000))).toBe('83011170');
    expect(() => encodeLength(-1)).toThrow(RangeError);
  });

  it('writes one- and multi-byte tags', () => {
    expect(hex(tagBytes(0x30))).toBe('30');
    expect(hex(tagBytes(0x5f1f))).toBe('5f1f');
    expect(hex(tagBytes(0x7f61))).toBe('7f61');
    expect(() => tagBytes(0)).toThrow(RangeError);
    expect(hex(tlv(0x5f1f, utf8('AB')))).toBe('5f1f024142');
    expect(hex(tlv(0x04, new Uint8Array(200))).slice(0, 6)).toBe('0481c8');
  });

  it('writes minimal two-s complement integers', () => {
    expect(hex(integer(0))).toBe('020100');
    expect(hex(integer(127))).toBe('02017f');
    expect(hex(integer(128))).toBe('02020080');
    expect(hex(integer(256n))).toBe('02020100');
    expect(() => integer(-1)).toThrow(RangeError);
    expect(() => integer(1.5)).toThrow(RangeError);
  });

  it('writes object identifiers, including arcs above 127', () => {
    expect(hex(objectIdentifier('1.2.840.10045.2.1'))).toBe('06072a8648ce3d0201');
    expect(hex(objectIdentifier('2.23.136.1.1.1'))).toBe('0606678108010101');
    expect(hex(objectIdentifier('2.999'))).toBe('06028837');
    for (const bad of ['1', '3.1', '1.40', '1.2.x', '1..2']) {
      expect(() => objectIdentifier(bad), bad).toThrow(RangeError);
    }
  });

  it('writes the primitive types', () => {
    expect(hex(octetString(fromHex('0102')))).toBe('04020102');
    expect(hex(bitString(fromHex('ff')))).toBe('030200ff');
    expect(hex(bitString(fromHex('f0'), 4))).toBe('030204f0');
    expect(() => bitString(new Uint8Array([1]), 8)).toThrow(RangeError);
    expect(hex(nullValue())).toBe('0500');
    expect(hex(booleanValue(true))).toBe('0101ff');
    expect(hex(booleanValue(false))).toBe('010100');
    expect(hex(printableString('UT'))).toBe('13025554');
    expect(hex(utf8String('Ä'))).toBe('0c02c384');
    expect(hex(ia5String('a:'))).toBe('1602613a');
  });

  it('writes named bit strings with trailing zero bits removed', () => {
    expect(hex(namedBits([]))).toBe('030100');
    expect(hex(namedBits([0]))).toBe('03020780');
    // keyCertSign (5) and cRLSign (6): 0000 0110, one unused bit.
    expect(hex(namedBits([5, 6]))).toBe('03020106');
    expect(hex(namedBits([8]))).toBe('0303070080');
    expect(() => namedBits([-1])).toThrow(RangeError);
  });

  it('writes UTCTime through 2049 and GeneralizedTime from 2050, to the second', () => {
    const date = new Date('2026-10-23T12:34:56.789Z');
    expect(new TextDecoder().decode(utcTime(date).subarray(2))).toBe('261023123456Z');
    expect(new TextDecoder().decode(generalizedTime(date).subarray(2))).toBe('20261023123456Z');
    expect(x509Time(new Date('2049-12-31T23:59:59Z'))[0]).toBe(0x17);
    expect(x509Time(new Date('2050-01-01T00:00:00Z'))[0]).toBe(0x18);
    expect(() => utcTime(new Date('1949-01-01T00:00:00Z'))).toThrow(RangeError);
  });

  it('sorts a SET OF and nests explicit and implicit tags', () => {
    const b = integer(2);
    const a = integer(1);
    expect(hex(setOf([b, a]))).toBe(`3106${hex(a)}${hex(b)}`);
    expect(hex(explicit(0, a))).toBe(`a003${hex(a)}`);
    expect(hex(implicitPrimitive(1, fromHex('ab')))).toBe('8101ab');
    expect(hex(algorithmIdentifier('1.2.840.10045.4.3.2'))).toBe('300a06082a8648ce3d040302');
    expect(hex(algorithmIdentifier('1.2.840.113549.1.1.11', nullValue()))).toBe(
      '300d06092a864886f70d01010b0500',
    );
  });

  it('is read back by asn1js as the same structure', () => {
    const written = sequence(
      integer(2n ** 70n),
      objectIdentifier('1.3.36.3.3.2.8.1.1.7'),
      octetString(utf8('LDS')),
      setOf([printableString('UT'), utf8String('Utopia')]),
      explicit(3, booleanValue(true)),
    );
    const parsed = asn1js.fromBER(written);
    expect(parsed.offset).toBe(written.length);
    const [big, oid, octets, set, tagged] = (parsed.result as asn1js.Sequence).valueBlock.value;
    expect((big as asn1js.Integer).toBigInt()).toBe(2n ** 70n);
    expect((oid as asn1js.ObjectIdentifier).getValue()).toBe('1.3.36.3.3.2.8.1.1.7');
    expect(new TextDecoder().decode((octets as asn1js.OctetString).getValue())).toBe('LDS');
    expect((set as asn1js.Set).valueBlock.value).toHaveLength(2);
    expect(tagged?.idBlock.tagClass).toBe(3);
    expect(tagged?.idBlock.tagNumber).toBe(3);
  });
});
