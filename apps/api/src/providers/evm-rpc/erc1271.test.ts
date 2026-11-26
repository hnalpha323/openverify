/**
 * C57.4, C57.5: the ERC-1271 call data the job sends and the one answer that accepts a
 * signature. Every digest and signature is synthetic.
 */
import { describe, expect, it } from 'vitest';
import {
  ERC1271_CALL_GAS,
  ERC1271_MAGIC_VALUE,
  decodeIsValidSignatureCall,
  encodeIsValidSignatureCall,
  holdsContractCode,
  isErc1271MagicResult,
} from './erc1271.js';

const DIGEST = new Uint8Array(32).map((_, index) => index + 1);
const SIGNATURE = new Uint8Array(65).map((_, index) => 0xa0 + (index % 16));
const word = (value: number) => value.toString(16).padStart(64, '0');
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

describe('isValidSignature call data (ERC-1271)', () => {
  it('is the selector, the digest, the offset, the length and the signature padded to a word', () => {
    expect(ERC1271_MAGIC_VALUE).toBe('0x1626ba7e');
    expect(ERC1271_CALL_GAS).toBe(500_000);
    expect(encodeIsValidSignatureCall(DIGEST, SIGNATURE)).toBe(
      `0x1626ba7e${hex(DIGEST)}${word(0x40)}${word(65)}${hex(SIGNATURE)}${'00'.repeat(31)}`,
    );
    expect(encodeIsValidSignatureCall(DIGEST, new Uint8Array(64).fill(1))).toBe(
      `0x1626ba7e${hex(DIGEST)}${word(0x40)}${word(64)}${'01'.repeat(64)}`,
    );
  });

  it('decodes what it encodes, of any signature length', () => {
    for (const signature of [SIGNATURE, new Uint8Array(0), new Uint8Array(200).fill(7)]) {
      expect(decodeIsValidSignatureCall(encodeIsValidSignatureCall(DIGEST, signature))).toEqual({
        digest: DIGEST,
        signature,
      });
    }
  });

  it('decodes nothing but exactly one isValidSignature call', () => {
    const good = encodeIsValidSignatureCall(DIGEST, SIGNATURE);
    const body = good.slice(10);
    for (const data of [
      `0x20c13b0b${body}`,
      `0x1626ba7e${hex(DIGEST)}${word(0x60)}${body.slice(128)}`,
      `0x1626ba7e${hex(DIGEST)}${word(0x40)}${word(200)}${body.slice(192)}`,
      good.slice(0, -2),
      `${good}00`,
      `${good.slice(0, -2)}zz`,
      good.toUpperCase(),
      '0x1626ba7e',
      '',
    ]) {
      expect(decodeIsValidSignatureCall(data)).toBeNull();
    }
  });
});

describe('the ERC-1271 answer', () => {
  it('accepts only the magic value padded to one 32-byte word, in either case', () => {
    expect(isErc1271MagicResult(`0x1626ba7e${'0'.repeat(56)}`)).toBe(true);
    expect(isErc1271MagicResult(`0x1626BA7E${'0'.repeat(56)}`)).toBe(true);
  });

  it.each([
    ['the bare value', '0x1626ba7e'],
    ['two words', `0x1626ba7e${'0'.repeat(120)}`],
    ['another value', `0xffffffff${'0'.repeat(56)}`],
    ['the value right-aligned', `0x${'0'.repeat(56)}1626ba7e`],
    ['a non-zero tail', `0x1626ba7e${'0'.repeat(55)}1`],
    ['nothing', '0x'],
    ['not hex', 'magic'],
  ])('refuses %s', (_name, result) => {
    expect(isErc1271MagicResult(result)).toBe(false);
  });
});

describe('eth_getCode answers', () => {
  it('hold code when they carry any byte', () => {
    expect(holdsContractCode('0x00')).toBe(true);
    expect(holdsContractCode('0x6080604052')).toBe(true);
  });

  it.each(['0x', '', '0x0', 'zz', '6080'])('hold none in %j', (code) => {
    expect(holdsContractCode(code)).toBe(false);
  });
});
