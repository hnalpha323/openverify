/**
 * C62.1: the chip file parsers. Every chip file passes the bounded TLV pre-scan
 * ({@link prescanTlv}: depth and node caps of `EMRTD_LIMITS`) before asn1js sees it; parsers keep
 * the original byte ranges. Each throws `EmrtdError` (`chip_data_malformed`, `limit_exceeded`,
 * and `algorithm_unsupported` for a DG15 key outside the bounds) and never returns a partial
 * reading. Bytes after a file's outer TLV (a reader's padding) are ignored and reported.
 */
import {
  bigintOf,
  childrenOf,
  decodeAsn1,
  isUniversal,
  octetsOf,
  oidOf,
  type Asn1,
} from './asn1.js';
import { readSignedData, signerMatches, type SignedDataValue } from './cms.js';
import { EmrtdError } from './errors.js';
import { importPublicKey } from './keys.js';
import {
  ACTIVE_AUTHENTICATION_PROTOCOL_OID,
  ECDSA_PLAIN_SIGNATURE_OIDS,
  ICAO_OIDS,
} from './oids.js';
import { parseCertificate } from './pki.js';
import { hashAlgorithmOf } from './signatures.js';
import {
  findChild,
  prescanTlv,
  readTlv,
  tlvBytes,
  tlvChildren,
  tlvValue,
  type TlvNode,
} from './tlv.js';
import type {
  DataGroupNumber,
  HashAlgorithm,
  ParsedDg1,
  ParsedDg15,
  ParsedDg2,
  ParsedSod,
} from './types.js';

export { prescanTlv, type TlvScan } from './tlv.js';

/** EF.SOD with everything Passive Authentication reads (C62.2). */
export interface SodContents {
  readonly parsed: ParsedSod;
  /** Each listed data group's hash, as the signed LDS security object holds it. */
  readonly hashes: ReadonlyMap<DataGroupNumber, Uint8Array>;
  /** The LDS security object's hash algorithm OID (named or not). */
  readonly hashOid: string;
  readonly signedData: SignedDataValue;
  /** Bytes followed the SOD's `77` TLV. */
  readonly trailingBytes: boolean;
}

/** The length of each digest's output. */
export const DIGEST_LENGTHS: Readonly<Record<HashAlgorithm, number>> = Object.freeze({
  sha1: 20,
  sha224: 28,
  sha256: 32,
  sha384: 48,
  sha512: 64,
});

const TAGS = Object.freeze({
  sod: 0x77,
  dg1: 0x61,
  mrz: 0x5f1f,
  dg2: 0x75,
  biometricGroup: 0x7f61,
  biometricTemplate: 0x7f60,
  faceRecord19794: 0x5f2e,
  faceBlock39794: 0x7f2e,
  dg14: 0x6e,
  dg15: 0x6f,
});

const SEQUENCE = 16;
const SET = 17;

function malformed(step: string): never {
  throw new EmrtdError('chip_data_malformed', step);
}

/** Runs a parser, giving every refusal the parser's step. */
function asStep<T>(step: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof EmrtdError && !error.message.startsWith(`${step}:`)) {
      throw new EmrtdError(error.code, step);
    }
    throw error;
  }
}

/** The outer TLV of a chip file, after the pre-scan, with `tag`. */
function outerTlv(bytes: Uint8Array, tag: number, step: string): TlvNode {
  prescanTlv(bytes);
  const outer = readTlv(bytes);
  return outer.tag === tag ? outer : malformed(step);
}

function sequenceOf(block: Asn1 | undefined, step: string): Asn1[] {
  return block !== undefined && isUniversal(block, SEQUENCE)
    ? childrenOf(block, step)
    : malformed(step);
}

function dataGroupNumber(block: Asn1, step: string): DataGroupNumber {
  const number = bigintOf(block, step);
  return number >= 1n && number <= 16n ? (Number(number) as DataGroupNumber) : malformed(step);
}

/** EF.SOD in full (C62.2). */
export function readSod(bytes: Uint8Array): SodContents {
  const step = 'parseSod';
  return asStep(step, () => {
    const outer = outerTlv(bytes, TAGS.sod, step);
    const signedData = readSignedData(tlvValue(bytes, outer), step);
    if (signedData.eContentType !== ICAO_OIDS.ldsSecurityObject) {
      malformed(step);
    }
    // LDSSecurityObject: version, hashAlgorithm, dataGroupHashValues, ldsVersionInfo (v1 only).
    const [version, algorithm, groups] = sequenceOf(decodeAsn1(signedData.eContent, step), step);
    if (version === undefined || algorithm === undefined || groups === undefined) {
      malformed(step);
    }
    const ldsVersion = bigintOf(version, step);
    if (ldsVersion !== 0n && ldsVersion !== 1n) {
      malformed(step);
    }
    const hashOid = oidOf(sequenceOf(algorithm, step)[0] ?? malformed(step), step);
    const hashAlgorithm = hashAlgorithmOf(hashOid);
    const hashes = new Map<DataGroupNumber, Uint8Array>();
    for (const entry of sequenceOf(groups, step)) {
      const [number, hash] = sequenceOf(entry, step);
      if (number === undefined || hash === undefined) {
        malformed(step);
      }
      const group = dataGroupNumber(number, step);
      const value = octetsOf(hash, step);
      if (
        hashes.has(group) ||
        (hashAlgorithm !== null && value.length !== DIGEST_LENGTHS[hashAlgorithm])
      ) {
        malformed(step);
      }
      hashes.set(group, value);
    }
    const { sid } = signedData.signer;
    const embedsDsc = signedData.certificates.some((der) => {
      try {
        return signerMatches(parseCertificate(der), sid);
      } catch (error) {
        if (error instanceof EmrtdError) {
          return false;
        }
        throw error;
      }
    });
    return {
      parsed: {
        version: ldsVersion === 0n ? 0 : 1,
        hashAlgorithm,
        listedDataGroups: [...hashes.keys()].sort((a, b) => a - b),
        signerIdentifier: sid.kind,
        embedsDsc,
        signature: signedData.signer.signature,
      },
      hashes,
      hashOid,
      signedData,
      trailingBytes: outer.end < bytes.length,
    };
  });
}

/** EF.SOD: what the submit guard (C62.5) and the reuse lookup (C62.6) read. */
export function parseSod(bytes: Uint8Array): ParsedSod {
  return readSod(bytes).parsed;
}

/** TD3 (2 × 44), TD2 (2 × 36), TD1 (3 × 30): Doc 9303-10 §4.7.1. */
const MRZ_SHAPES: Readonly<Record<number, readonly [lines: number, length: number]>> = {
  88: [2, 44],
  72: [2, 36],
  90: [3, 30],
};
const MRZ_TEXT = /^[A-Z0-9<]+$/;

/** DG1: the MRZ lines, exact. */
export function parseDg1(bytes: Uint8Array): ParsedDg1 {
  const step = 'parseDg1';
  return asStep(step, () => {
    const outer = outerTlv(bytes, TAGS.dg1, step);
    const mrz = findChild(bytes, outer, TAGS.mrz) ?? malformed(step);
    const text = Buffer.from(tlvValue(bytes, mrz)).toString('latin1');
    const shape = MRZ_SHAPES[text.length];
    if (shape === undefined || !MRZ_TEXT.test(text)) {
      malformed(step);
    }
    const [count, length] = shape;
    return {
      mrzLines: Array.from({ length: count }, (_line, index) =>
        text.slice(index * length, (index + 1) * length),
      ),
    };
  });
}

const JPEG = [0xff, 0xd8, 0xff];
const JP2 = [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a];
const J2K = [0xff, 0x4f, 0xff, 0x51];

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) =>
  prefix.every((byte, index) => bytes[index] === byte);

/** The image type by its bytes (C60.4: vision sniffs them too). */
function imageType(image: Uint8Array, step: string): ParsedDg2['mimeType'] {
  if (startsWith(image, JPEG)) {
    return 'image/jpeg';
  }
  return startsWith(image, JP2) || startsWith(image, J2K) ? 'image/jp2' : malformed(step);
}

const u16 = (bytes: Uint8Array, at: number) => ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
const u32 = (bytes: Uint8Array, at: number) => u16(bytes, at) * 65_536 + u16(bytes, at + 2);

/**
 * ISO/IEC 19794-5:2005 (Doc 9303-10 §4.7.2): the `FAC\0` `010\0` header, then the first facial
 * record: its 20-byte information block, 8 bytes per feature point, a 12-byte image information
 * block (width and height at bytes 2-5), and the image.
 */
function face19794(record: Uint8Array, step: string): ParsedDg2 {
  const header = Buffer.from(record.subarray(0, 8)).toString('latin1');
  if (record.length < 14 + 20 + 12 || header !== 'FAC\u0000010\u0000') {
    malformed(step);
  }
  const block = u32(record, 14);
  const featurePoints = u16(record, 18);
  const imageInfo = 14 + 20 + 8 * featurePoints;
  const imageStart = imageInfo + 12;
  const imageEnd = 14 + block;
  if (u16(record, 12) < 1 || imageEnd > record.length || imageEnd <= imageStart) {
    malformed(step);
  }
  const image = record.slice(imageStart, imageEnd);
  const width = u16(record, imageInfo + 2);
  const height = u16(record, imageInfo + 4);
  return {
    format: 'iso19794-5',
    mimeType: imageType(image, step),
    image,
    width: width === 0 ? null : width,
    height: height === 0 ? null : height,
  };
}

/**
 * ISO/IEC 39794-5 (Doc 9303-10 §4.5.6): the face image block's first representation, at
 * representation blocks `[1]` → representation → image representation `[1]` → `[0]` → `[0]` →
 * the image data `[0]` (research note §5). The application tag `65` may wrap the block.
 */
function face39794(bytes: Uint8Array, bdb: TlvNode, step: string): ParsedDg2 {
  const children = tlvChildren(bytes, bdb);
  const [only] = children;
  const block = children.length === 1 && only?.tag === 0x65 ? only : bdb;
  const representations = findChild(bytes, block, 0xa1) ?? malformed(step);
  const representation = tlvChildren(bytes, representations).find((child) => child.tag === 0x30);
  let node: TlvNode | null = representation ?? null;
  for (const tag of [0xa1, 0xa0, 0xa0, 0x80]) {
    node = !node?.constructed ? null : findChild(bytes, node, tag);
  }
  const image = node === null ? malformed(step) : tlvValue(bytes, node).slice();
  return {
    format: 'iso39794-5',
    mimeType: imageType(image, step),
    image,
    width: null,
    height: null,
  };
}

/** DG2: the face image of ISO/IEC 19794-5 or 39794-5. Decode it only after PA (C60.4). */
export function parseDg2(bytes: Uint8Array): ParsedDg2 {
  const step = 'parseDg2';
  return asStep(step, () => {
    const outer = outerTlv(bytes, TAGS.dg2, step);
    const group = findChild(bytes, outer, TAGS.biometricGroup) ?? malformed(step);
    const template = findChild(bytes, group, TAGS.biometricTemplate) ?? malformed(step);
    const record = findChild(bytes, template, TAGS.faceRecord19794);
    if (record !== null) {
      return face19794(tlvValue(bytes, record), step);
    }
    const block = findChild(bytes, template, TAGS.faceBlock39794);
    return block === null ? malformed(step) : face39794(bytes, block, step);
  });
}

/** DG15: the Active Authentication key, within the C62.1 key and curve bounds. */
export function parseDg15(bytes: Uint8Array): ParsedDg15 {
  const step = 'parseDg15';
  return asStep(step, () => {
    const outer = outerTlv(bytes, TAGS.dg15, step);
    const children = tlvChildren(bytes, outer);
    const [key] = children;
    if (children.length !== 1 || key === undefined) {
      malformed(step);
    }
    const spki = tlvBytes(bytes, key).slice();
    return { keyAlgorithm: importPublicKey(spki, step).kind, spki };
  });
}

const PLAIN_ECDSA = new Map<string, HashAlgorithm>(
  Object.entries(ECDSA_PLAIN_SIGNATURE_OIDS).map(([hash, oid]) => [oid, hash as HashAlgorithm]),
);

/**
 * DG14's `ActiveAuthenticationInfo` (Doc 9303-11 §6.1): the digest of a plain-ECDSA Active
 * Authentication, or `null` when DG14 names none or cannot be read (a hint only: the DG15 key
 * still has to verify the response).
 */
export function activeAuthenticationHashOf(dg14: Uint8Array): HashAlgorithm | null {
  const step = 'activeAuthenticationHashOf';
  try {
    const outer = outerTlv(dg14, TAGS.dg14, step);
    const infos = decodeAsn1(tlvValue(dg14, outer), step);
    for (const info of isUniversal(infos, SET) ? childrenOf(infos, step) : []) {
      const [protocol, , algorithm] = sequenceOf(info, step);
      if (protocol !== undefined && oidOf(protocol, step) === ACTIVE_AUTHENTICATION_PROTOCOL_OID) {
        return algorithm === undefined ? null : (PLAIN_ECDSA.get(oidOf(algorithm, step)) ?? null);
      }
    }
    return null;
  } catch (error) {
    if (error instanceof EmrtdError) {
      return null;
    }
    throw error;
  }
}
