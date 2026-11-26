/**
 * C62.1 (P19): the bounded BER-TLV pre-scan and reader. The pre-scan walks every nested TLV
 * within depth 32 and 20,000 nodes before asn1js or a data-group parser sees a chip file; the
 * reader keeps original byte ranges. The inputs are written by hand or by the DER writer.
 */
import { describe, expect, it } from 'vitest';
import { concatBytes, fromHex, toHex } from './bytes.js';
import { nullValue, sequence, tlv } from './der.js';
import { EmrtdError } from './errors.js';
import { EMRTD_LIMITS } from './limits.js';
import { prescanTlv as exportedPrescan } from './parse.js';
import { findChild, prescanTlv, readTlv, tlvBytes, tlvChildren, tlvValue } from './tlv.js';

function refusal(call: () => unknown): EmrtdError {
  try {
    call();
  } catch (error) {
    if (error instanceof EmrtdError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an EmrtdError');
}

const nested = (levels: number): Uint8Array =>
  levels === 0 ? nullValue() : sequence(nested(levels - 1));

describe('prescanTlv (C62.1)', () => {
  it('is the pre-scan the parsers module exports', () => {
    expect(exportedPrescan).toBe(prescanTlv);
  });

  it('counts every nested TLV and the deepest nesting of a DG1-shaped file', () => {
    const dg1 = tlv(0x61, tlv(0x5f1f, new Uint8Array(88).fill(0x3c)));
    expect(prescanTlv(dg1)).toEqual({ depth: 2, nodes: 2, end: dg1.length });
  });

  it('reports where the outer TLV ends and leaves trailing bytes to the caller', () => {
    const file = concatBytes(tlv(0x77, sequence(nullValue())), new Uint8Array([0, 0, 0xff]));
    expect(prescanTlv(file)).toEqual({ depth: 3, nodes: 3, end: file.length - 3 });
  });

  it('reads non-minimal long-form lengths (BER)', () => {
    expect(prescanTlv(fromHex('3081020500'))).toEqual({ depth: 2, nodes: 2, end: 5 });
    expect(prescanTlv(fromHex('04840000000101'))).toEqual({ depth: 1, nodes: 1, end: 7 });
  });

  it('reads an indefinite length inside a constructed TLV up to its end-of-contents', () => {
    // SEQUENCE (indefinite) { NULL, SEQUENCE (indefinite) { NULL } } and trailing bytes.
    const file = fromHex('30800500308005000000000099');
    expect(prescanTlv(file)).toEqual({ depth: 3, nodes: 4, end: 12 });
  });

  it.each([
    ['an empty file', ''],
    ['a lone tag byte', '30'],
    ['a length past the end', '30050500'],
    ['a child past its parent', '30020403010203'],
    ['a parent its children do not fill', '3003050001'],
    ['an indefinite primitive', '04800000'],
    ['an indefinite length without end-of-contents', '30800500'],
    ['a length of more than four bytes', '0485000000000100'],
    ['a tag of more than four bytes', '5f8181817f00'],
    ['a tag cut short', '5f'],
    ['an end-of-contents where a TLV belongs', '0000'],
    ['an end-of-contents inside a definite value', '30020000'],
  ])('refuses %s as malformed', (_label, hex) => {
    const error = refusal(() => prescanTlv(fromHex(hex)));
    expect(error.code).toBe('chip_data_malformed');
    expect(error.message).toBe('prescanTlv: chip_data_malformed');
  });

  it('takes 32 levels and refuses a 33rd', () => {
    expect(prescanTlv(nested(EMRTD_LIMITS.tlvMaxDepth - 1)).depth).toBe(32);
    expect(refusal(() => prescanTlv(nested(EMRTD_LIMITS.tlvMaxDepth))).code).toBe('limit_exceeded');
  });

  it('takes 20,000 TLVs and refuses one more', () => {
    const nulls = (count: number) => sequence(...Array.from({ length: count }, nullValue));
    expect(prescanTlv(nulls(EMRTD_LIMITS.tlvMaxNodes - 1)).nodes).toBe(20_000);
    expect(refusal(() => prescanTlv(nulls(EMRTD_LIMITS.tlvMaxNodes))).code).toBe('limit_exceeded');
  });

  it('applies the caps it is given instead of the chip caps', () => {
    expect(refusal(() => prescanTlv(nested(2), { maxDepth: 2, maxNodes: 10 })).code).toBe(
      'limit_exceeded',
    );
    expect(refusal(() => prescanTlv(nested(2), { maxDepth: 5, maxNodes: 2 })).code).toBe(
      'limit_exceeded',
    );
    expect(prescanTlv(nested(2), { maxDepth: 3, maxNodes: 3 })).toEqual({
      depth: 3,
      nodes: 3,
      end: 6,
    });
  });
});

describe('the TLV reader', () => {
  const dg2 = tlv(
    0x75,
    tlv(0x7f61, tlv(0x02, new Uint8Array([1])), tlv(0x7f60, tlv(0xa1, tlv(0x80, fromHex('0101'))))),
  );

  it('reads multi-byte tags with their byte ranges', () => {
    const outer = readTlv(dg2);
    expect(outer).toMatchObject({ tag: 0x75, constructed: true, start: 0, end: dg2.length });
    const [group] = tlvChildren(dg2, outer);
    expect(group?.tag).toBe(0x7f61);
    const children = group === undefined ? [] : tlvChildren(dg2, group);
    expect(children.map((child) => child.tag)).toEqual([0x02, 0x7f60]);
    const count = children[0];
    expect(count === undefined ? '' : toHex(tlvValue(dg2, count))).toBe('01');
    expect(count === undefined ? '' : toHex(tlvBytes(dg2, count))).toBe('020101');
    expect(group === undefined ? null : findChild(dg2, group, 0x7f60)?.tag).toBe(0x7f60);
    expect(group === undefined ? 'none' : findChild(dg2, group, 0x5f2e)).toBeNull();
  });

  it('reads a TLV at an offset within a limit', () => {
    const two = concatBytes(fromHex('0500'), fromHex('040101'));
    expect(readTlv(two, 2)).toMatchObject({ tag: 0x04, valueStart: 4, valueEnd: 5, end: 5 });
    expect(refusal(() => readTlv(two, 2, 4)).code).toBe('chip_data_malformed');
  });

  it('reads an indefinite TLV and its children', () => {
    const file = fromHex('308005000401aa0000');
    const node = readTlv(file);
    expect(node).toMatchObject({ valueStart: 2, valueEnd: 7, end: 9 });
    expect(tlvChildren(file, node).map((child) => child.tag)).toEqual([0x05, 0x04]);
  });

  it('gives a primitive TLV no children', () => {
    const file = fromHex('0401aa');
    expect(refusal(() => tlvChildren(file, readTlv(file))).code).toBe('chip_data_malformed');
  });
});
