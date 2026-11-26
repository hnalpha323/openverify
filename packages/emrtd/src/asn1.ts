/**
 * C62.1: asn1js 3.1.0 behind the bounded pre-scan. {@link decodeAsn1} pre-scans the bytes within
 * the caps, then hands them to asn1js with the same caps and `parseEmbedded: false` (an OCTET
 * STRING's contents stay bytes until a parser asks for them), and refuses trailing bytes; an
 * exception asn1js throws while decoding is `chip_data_malformed` too. The readers below take
 * one asn1js block and refuse anything else with `chip_data_malformed`, so a parser never works
 * on a value of the wrong type. Every block keeps its original bytes (`valueBeforeDecodeView`,
 * {@link encodedOf}).
 */
import * as asn1js from 'asn1js';
import { EmrtdError } from './errors.js';
import { EMRTD_LIMITS } from './limits.js';
import { prescanTlv, type TlvLimits } from './tlv.js';

export type Asn1 = asn1js.AsnType;

/** asn1js' caps beside the pre-scan's. */
export interface Asn1Limits extends TlvLimits {
  /** The largest value asn1js may read. */
  readonly maxContentLength: number;
}

/**
 * The caps of a chip file and of everything it nests (`EMRTD_LIMITS`); no single value of a chip
 * file comes near 2 MiB (C52.4 caps DG2 at 1 MiB and every other chip file at 64 KiB).
 */
export const CHIP_ASN1_LIMITS: Asn1Limits = Object.freeze({
  maxDepth: EMRTD_LIMITS.tlvMaxDepth,
  maxNodes: EMRTD_LIMITS.tlvMaxNodes,
  maxContentLength: 2 * 1024 * 1024,
});

const UNIVERSAL = 1;
const CONTEXT = 3;

function malformed(step: string): never {
  throw new EmrtdError('chip_data_malformed', step);
}

/** One DER/BER value filling `bytes`, pre-scanned and decoded within `limits`. */
export function decodeAsn1(
  bytes: Uint8Array,
  step: string,
  limits: Asn1Limits = CHIP_ASN1_LIMITS,
): Asn1 {
  let scan;
  try {
    scan = prescanTlv(bytes, limits);
  } catch (error) {
    throw error instanceof EmrtdError ? new EmrtdError(error.code, step) : error;
  }
  if (scan.end !== bytes.length) {
    malformed(step);
  }
  let decoded: ReturnType<typeof asn1js.fromBER>;
  try {
    decoded = asn1js.fromBER(bytes, {
      maxDepth: limits.maxDepth,
      maxNodes: limits.maxNodes,
      maxContentLength: limits.maxContentLength,
      parseEmbedded: false,
    });
  } catch {
    // Workflow 5C review P002: asn1js throws (rather than answering an error) for a BMPString
    // of odd length, a UniversalString whose length is no multiple of 4 or a GeneralizedTime
    // that is no time; every caller handles EmrtdError only.
    malformed(step);
  }
  if (decoded.offset !== bytes.length) {
    malformed(step);
  }
  return decoded.result;
}

export function isUniversal(block: Asn1, tagNumber: number): boolean {
  return block.idBlock.tagClass === UNIVERSAL && block.idBlock.tagNumber === tagNumber;
}

export function isContext(block: Asn1, tagNumber: number): boolean {
  return block.idBlock.tagClass === CONTEXT && block.idBlock.tagNumber === tagNumber;
}

/** The members of a constructed block (SEQUENCE, SET or a tagged constructed value). */
export function childrenOf(block: Asn1, step: string): Asn1[] {
  const value: unknown = (block.valueBlock as { value?: unknown }).value;
  if (!block.idBlock.isConstructed || !Array.isArray(value)) {
    malformed(step);
  }
  return value as Asn1[];
}

export function oidOf(block: Asn1, step: string): string {
  return block instanceof asn1js.ObjectIdentifier ? block.getValue() : malformed(step);
}

export function bigintOf(block: Asn1, step: string): bigint {
  return block instanceof asn1js.Integer ? block.toBigInt() : malformed(step);
}

/** An OCTET STRING's contents (BER constructed pieces joined), or an implicit primitive's. */
export function octetsOf(block: Asn1, step: string): Uint8Array {
  if (block instanceof asn1js.OctetString) {
    return new Uint8Array(block.getValue());
  }
  if (block instanceof asn1js.Primitive && block.idBlock.tagClass === CONTEXT) {
    return new Uint8Array(block.valueBlock.valueHexView);
  }
  return malformed(step);
}

/** A BIT STRING's contents; it must leave no bit unused. */
export function bitStringOf(block: Asn1, step: string): Uint8Array {
  if (
    !(block instanceof asn1js.BitString) ||
    block.idBlock.isConstructed ||
    block.valueBlock.unusedBits !== 0
  ) {
    malformed(step);
  }
  return new Uint8Array(block.valueBlock.valueHexView);
}

export function booleanOf(block: Asn1, step: string): boolean {
  return block instanceof asn1js.Boolean ? block.getValue() : malformed(step);
}

/** A UTCTime or GeneralizedTime. */
export function dateOf(block: Asn1, step: string): Date {
  if (!(block instanceof asn1js.UTCTime)) {
    malformed(step);
  }
  const date = block.toDate();
  return Number.isNaN(date.getTime()) ? malformed(step) : date;
}

/** Any of the ASN.1 character string types. */
export function textOf(block: Asn1, step: string): string {
  return block instanceof asn1js.BaseStringBlock ? block.getValue() : malformed(step);
}

/** The block's original encoding, tag and length included. */
export function encodedOf(block: Asn1): Uint8Array {
  return new Uint8Array(block.valueBeforeDecodeView);
}
