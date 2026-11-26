/** The strict decoders and shared hashes of the crypto wallet checks. */
import { describe, expect, it } from 'vitest';
import {
  compactSize,
  concatBytes,
  decodeBase64,
  decodeHex,
  equalBytes,
  hash160,
  sha256d,
  utf8,
} from './bytes.js';

const hexOf = (bytes: Uint8Array | null) =>
  bytes === null ? null : Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('decodeHex', () => {
  it('reads even-length hex with the prefix it requires', () => {
    expect(hexOf(decodeHex('0x00ff1A', { prefix: 'required', maxBytes: 8 }))).toBe('00ff1a');
    expect(decodeHex('00ff', { prefix: 'required', maxBytes: 8 })).toBeNull();
    expect(hexOf(decodeHex('00ff', { prefix: 'optional', maxBytes: 8 }))).toBe('00ff');
    expect(hexOf(decodeHex('0x00ff', { prefix: 'optional', maxBytes: 8 }))).toBe('00ff');
  });

  it.each(['0x0', '0xgg', '0x 00', '0X00', '0x', '0x00 '])('refuses %j', (text) => {
    expect(decodeHex(text, { prefix: 'required', maxBytes: 8 })).toBeNull();
  });

  it('refuses more bytes than the cap', () => {
    expect(decodeHex(`0x${'00'.repeat(9)}`, { prefix: 'required', maxBytes: 8 })).toBeNull();
  });
});

describe('decodeBase64', () => {
  it('reads padded standard base64', () => {
    expect(hexOf(decodeBase64('AP8=', 4))).toBe('00ff');
    expect(hexOf(decodeBase64('', 4))).toBe('');
  });

  it.each(['AP8', 'AP-_', 'AP9=', 'A P8=', 'AP8=\n', '====', 'AP8=AP8='])(
    'refuses %j: unpadded, URL-safe, non-canonical, spaced or misplaced padding',
    (text) => {
      expect(decodeBase64(text, 16)).toBeNull();
    },
  );

  it('refuses more bytes than the cap', () => {
    expect(decodeBase64('AAAAAA==', 3)).toBeNull();
    expect(hexOf(decodeBase64('AAAA', 3))).toBe('000000');
  });
});

describe('the shared hashes and helpers', () => {
  it('computes double SHA-256 and HASH160', () => {
    expect(hexOf(sha256d(utf8('')))).toBe(
      '5df6e0e2761359d30a8275058e299fcc0381534545f55cf43e41983f5d4c9456',
    );
    // HASH160 of the compressed generator point, the BIP-173 example program.
    const generator = Uint8Array.from(
      '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'.match(/../g) ?? [],
      (pair) => Number.parseInt(pair, 16),
    );
    expect(hexOf(hash160(generator))).toBe('751e76e8199196d454941c45d1b3a323f1433bd6');
  });

  it('encodes CompactSize lengths', () => {
    expect(hexOf(compactSize(0))).toBe('00');
    expect(hexOf(compactSize(0xfc))).toBe('fc');
    expect(hexOf(compactSize(0xfd))).toBe('fdfd00');
    expect(hexOf(compactSize(0xffff))).toBe('fdffff');
    expect(hexOf(compactSize(0x10000))).toBe('fe00000100');
  });

  it('concatenates and compares bytes', () => {
    const joined = concatBytes(utf8('ab'), new Uint8Array(), utf8('c'));
    expect(equalBytes(joined, utf8('abc'))).toBe(true);
    expect(equalBytes(joined, utf8('abd'))).toBe(false);
    expect(equalBytes(joined, utf8('ab'))).toBe(false);
  });
});
