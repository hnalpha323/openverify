/**
 * C62.1: asn1js behind the pre-scan. Values are decoded within the chip caps with embedded
 * parsing off, trailing bytes are refused, and each reader refuses a value of another type.
 */
import { describe, expect, it } from 'vitest';
import {
  CHIP_ASN1_LIMITS,
  bigintOf,
  bitStringOf,
  booleanOf,
  childrenOf,
  dateOf,
  decodeAsn1,
  encodedOf,
  isContext,
  isUniversal,
  octetsOf,
  oidOf,
  textOf,
} from './asn1.js';
import { concatBytes, fromHex, toHex, utf8 } from './bytes.js';
import {
  bitString,
  booleanValue,
  explicit,
  generalizedTime,
  ia5String,
  implicitPrimitive,
  integer,
  nullValue,
  objectIdentifier,
  octetString,
  printableString,
  sequence,
  utcTime,
  utf8String,
} from './der.js';
import { EmrtdError } from './errors.js';
import { EMRTD_LIMITS } from './limits.js';

function codeOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    if (error instanceof EmrtdError) {
      return error.code;
    }
    throw error;
  }
  return 'none';
}

const nested = (levels: number): Uint8Array =>
  levels === 0 ? nullValue() : sequence(nested(levels - 1));

describe('decodeAsn1 (C62.1)', () => {
  it('uses the chip caps', () => {
    expect(CHIP_ASN1_LIMITS).toMatchObject({
      maxDepth: EMRTD_LIMITS.tlvMaxDepth,
      maxNodes: EMRTD_LIMITS.tlvMaxNodes,
    });
  });

  it('decodes one value that fills the bytes and keeps its original encoding', () => {
    const der = sequence(integer(5), octetString(sequence(nullValue())));
    const block = decodeAsn1(der, 'test');
    expect(isUniversal(block, 16)).toBe(true);
    expect(toHex(encodedOf(block))).toBe(toHex(der));
    const [five, octets] = childrenOf(block, 'test');
    expect(five === undefined ? null : bigintOf(five, 'test')).toBe(5n);
    // Embedded parsing is off: the OCTET STRING's contents stay bytes.
    expect(octets === undefined ? '' : toHex(octetsOf(octets, 'test'))).toBe('30020500');
  });

  it.each([
    ['trailing bytes', concatBytes(nullValue(), new Uint8Array([0]))],
    ['a malformed header', fromHex('3005')],
    ['nothing', new Uint8Array()],
  ])('refuses %s as malformed', (_label, bytes) => {
    expect(codeOf(() => decodeAsn1(bytes, 'test'))).toBe('chip_data_malformed');
  });

  // Workflow 5C review P002: asn1js throws (rather than answering an error) for these, past the
  // pre-scan; every parser must still throw only EmrtdError.
  it.each([
    ['a BMPString of odd length', '1e03414243'],
    ['a UniversalString whose length is no multiple of 4', '1c025554'],
    ['a GeneralizedTime that is not a time', '1803414243'],
    ['one inside a constructed value', '77051e03414243'],
  ])('refuses %s as malformed, never with asn1js’ own error', (_label, hex) => {
    expect(codeOf(() => decodeAsn1(fromHex(hex), 'test'))).toBe('chip_data_malformed');
  });

  it('refuses a value beyond the caps before asn1js reads it', () => {
    expect(codeOf(() => decodeAsn1(nested(40), 'test'))).toBe('limit_exceeded');
    expect(
      codeOf(() =>
        decodeAsn1(octetString(new Uint8Array(64)), 'test', {
          maxDepth: 4,
          maxNodes: 4,
          maxContentLength: 16,
        }),
      ),
    ).toBe('chip_data_malformed');
  });
});

describe('the asn1js readers', () => {
  const decoded = (bytes: Uint8Array) => decodeAsn1(bytes, 'test');

  it('read each type', () => {
    expect(oidOf(decoded(objectIdentifier('2.23.136.1.1.1')), 'test')).toBe('2.23.136.1.1.1');
    expect(bigintOf(decoded(integer(2n ** 80n)), 'test')).toBe(2n ** 80n);
    expect(toHex(bitStringOf(decoded(bitString(fromHex('abcd'))), 'test'))).toBe('abcd');
    expect(booleanOf(decoded(booleanValue(true)), 'test')).toBe(true);
    expect(booleanOf(decoded(booleanValue(false)), 'test')).toBe(false);
    expect(dateOf(decoded(utcTime(new Date('2026-10-23T01:02:03Z'))), 'test')).toEqual(
      new Date('2026-10-23T01:02:03Z'),
    );
    expect(dateOf(decoded(generalizedTime(new Date('2051-01-02T03:04:05Z'))), 'test')).toEqual(
      new Date('2051-01-02T03:04:05Z'),
    );
    for (const text of [printableString('UT'), utf8String('Ü tö'), ia5String('a@b')]) {
      expect(textOf(decoded(text), 'test')).toBe(new TextDecoder().decode(text.subarray(2)));
    }
  });

  it('read context-specific values', () => {
    const tagged = decoded(sequence(explicit(0, integer(1)), implicitPrimitive(1, utf8('ski'))));
    const [zero, one] = childrenOf(tagged, 'test');
    expect(zero !== undefined && isContext(zero, 0)).toBe(true);
    expect(one !== undefined && isContext(one, 1)).toBe(true);
    expect(zero !== undefined && isContext(zero, 1)).toBe(false);
    expect(zero === undefined ? null : childrenOf(zero, 'test')).toHaveLength(1);
    expect(one === undefined ? '' : new TextDecoder().decode(octetsOf(one, 'test'))).toBe('ski');
  });

  it('joins the pieces of a BER constructed OCTET STRING', () => {
    expect(toHex(octetsOf(decoded(fromHex('24800401aa0401bb0000')), 'test'))).toBe('aabb');
  });

  it('refuse a value of another type as malformed', () => {
    const anInteger = decoded(integer(1));
    expect(codeOf(() => oidOf(anInteger, 'test'))).toBe('chip_data_malformed');
    expect(codeOf(() => bigintOf(decoded(nullValue()), 'test'))).toBe('chip_data_malformed');
    expect(codeOf(() => octetsOf(anInteger, 'test'))).toBe('chip_data_malformed');
    expect(codeOf(() => bitStringOf(anInteger, 'test'))).toBe('chip_data_malformed');
    expect(codeOf(() => bitStringOf(decoded(bitString(fromHex('f0'), 4)), 'test'))).toBe(
      'chip_data_malformed',
    );
    expect(codeOf(() => booleanOf(anInteger, 'test'))).toBe('chip_data_malformed');
    expect(codeOf(() => dateOf(anInteger, 'test'))).toBe('chip_data_malformed');
    expect(codeOf(() => textOf(anInteger, 'test'))).toBe('chip_data_malformed');
    expect(codeOf(() => childrenOf(anInteger, 'test'))).toBe('chip_data_malformed');
    expect(isUniversal(anInteger, 3)).toBe(false);
    expect(isContext(anInteger, 2)).toBe(false);
  });
});
