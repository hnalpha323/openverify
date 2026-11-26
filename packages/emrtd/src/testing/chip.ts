/**
 * C65.3: whole synthetic chips. DG1 holds the MRZ given, DG2 an ISO/IEC 19794-5 (or 39794-5)
 * record around the portrait given, DG14 the Active Authentication algorithm of an EC key, DG15
 * the AA key, EF.COM the data-group tags, and EF.SOD the LDS security object the DSC signs
 * (CMS `SignedData`, Doc 9303-10 §4.6.2). Each variant changes one thing, so one test proves one
 * answer of the verifier.
 */
import { constants, createHash, privateEncrypt } from 'node:crypto';
import { concatBytes, toHex, utf8 } from '../bytes.js';
import {
  algorithmIdentifier,
  explicit,
  implicitPrimitive,
  integer,
  objectIdentifier,
  octetString,
  printableString,
  sequence,
  setOf,
  tlv,
} from '../der.js';
import {
  ACTIVE_AUTHENTICATION_PROTOCOL_OID,
  CMS_OIDS,
  ECDSA_PLAIN_SIGNATURE_OIDS,
  HASH_ALGORITHM_OIDS,
  ICAO_OIDS,
} from '../oids.js';
import type { ChipFiles, DataGroupNumber, HashAlgorithm } from '../types.js';
import {
  seededBytes,
  testKeyPair,
  testSign,
  type TestKeyPair,
  type TestKeySpec,
  type TestSignatureScheme,
} from './keys.js';
import type { TestCertificate } from './x509.js';

/** The variants of C65.3 a chip can be built with, beside the well-formed one. */
export const TEST_CHIP_VARIANTS = [
  'tampered-dg1',
  'tampered-dg2',
  'malformed-sod',
  'trailing-bytes',
  'sod-v0',
  'sha1',
  'dsc-not-embedded',
  'issuer-and-serial-sid',
  'dg1-issuer-mismatch',
  'aa-wrong-key',
  /** The SignerInfo signature changed after signing. */
  'tampered-sod-signature',
  /** The LDS security object changed after its `messageDigest` was signed. */
  'message-digest-mismatch',
  /** The signed `contentType` attribute names another type than the eContent's. */
  'content-type-mismatch',
  /** The SignerInfo names a key identifier no embedded certificate has. */
  'wrong-signer-identifier',
  /** DG15 is uploaded but the SOD does not list it. */
  'unlisted-dg15',
] as const;
export type TestChipVariant = (typeof TEST_CHIP_VARIANTS)[number];

export interface TestChipOptions {
  readonly dsc: TestCertificate;
  /** The MRZ lines DG1 holds (synthetic; the e2e uses the TD3 page's). */
  readonly mrzLines: readonly string[];
  /** The DG2 face image bytes (JPEG or JPEG 2000), their type and, optionally, their size. */
  readonly portrait: {
    readonly bytes: Uint8Array;
    readonly mimeType: 'image/jpeg' | 'image/jp2';
    readonly width?: number | undefined;
    readonly height?: number | undefined;
  };
  /** ISO/IEC 19794-5 (the default) or 39794-5. */
  readonly portraitFormat?: 'iso19794-5' | 'iso39794-5' | undefined;
  /** An Active Authentication key: DG15 is written and listed only with one. */
  readonly activeAuthentication?: TestKeySpec | undefined;
  readonly seed: string;
  readonly variants?: readonly TestChipVariant[] | undefined;
  /** Data groups the SOD lists that the upload leaves out (C65.3: withheld DG15). */
  readonly withhold?: readonly DataGroupNumber[] | undefined;
  /** The LDS and SignerInfo digest (SHA-256 by default; `sha1` with the `sha1` variant). */
  readonly hash?: HashAlgorithm | undefined;
  /** How the DSC signs the SOD (its digest is the LDS digest). */
  readonly sodSignature?: TestSignatureScheme | undefined;
}

export interface TestChip {
  readonly files: ChipFiles;
  /** The AA key, `null` without DG15. */
  readonly activeAuthenticationKey: TestKeyPair | null;
}

/** ISO/IEC 9796-2 trailers (Doc 9303-11 §6.1.2): implicit SHA-1, else the hash identifier. */
const TRAILERS: Readonly<Record<HashAlgorithm, readonly number[]>> = {
  sha1: [0xbc],
  sha224: [0x38, 0xcc],
  sha256: [0x34, 0xcc],
  sha384: [0x36, 0xcc],
  sha512: [0x35, 0xcc],
};

const PADDING = new Uint8Array([0, 0, 0, 0]);

const u16 = (value: number) => new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
const u32 = (value: number) => concatBytes(u16(Math.floor(value / 65_536)), u16(value % 65_536));
const digest = (hash: HashAlgorithm, bytes: Uint8Array) =>
  new Uint8Array(createHash(hash).update(bytes).digest());

/** DG1 (Doc 9303-10 §4.7.1): `61` → `5F1F` → the MRZ as one string. */
function dg1File(lines: readonly string[]): Uint8Array {
  return tlv(0x61, tlv(0x5f1f, utf8(lines.join(''))));
}

/** An ISO/IEC 19794-5:2005 face record around the image (no feature points). */
function faceRecord(portrait: TestChipOptions['portrait']): Uint8Array {
  const block = 20 + 12 + portrait.bytes.length;
  return concatBytes(
    utf8('FAC\u0000010\u0000'),
    u32(14 + block),
    u16(1),
    u32(block),
    u16(0),
    new Uint8Array(14),
    // Full frontal; 0 JPEG, 1 JPEG 2000; width; height; colour space, source, device, quality.
    new Uint8Array([1, portrait.mimeType === 'image/jp2' ? 1 : 0]),
    u16(portrait.width ?? 0),
    u16(portrait.height ?? 0),
    new Uint8Array([1, 2, 0, 0, 0, 0]),
    portrait.bytes,
  );
}

/** ISO/IEC 39794-5: version, then representation blocks → representation → image data. */
function faceBlock(portrait: TestChipOptions['portrait']): Uint8Array {
  return tlv(
    0x7f2e,
    tlv(0xa0, implicitPrimitive(0, new Uint8Array([1]))),
    tlv(0xa1, sequence(tlv(0xa1, tlv(0xa0, tlv(0xa0, implicitPrimitive(0, portrait.bytes)))))),
  );
}

/** DG2 (Doc 9303-10 §4.7.2): `75` → `7F61` → one `7F60` with its header and data block. */
function dg2File(options: TestChipOptions): Uint8Array {
  const iso39794 = options.portraitFormat === 'iso39794-5';
  const header = tlv(
    0xa1,
    tlv(0x80, new Uint8Array([1, 1])),
    tlv(0x81, new Uint8Array([2])),
    tlv(0x87, new Uint8Array([1, 1])),
    tlv(0x88, iso39794 ? new Uint8Array([0, 0x40]) : new Uint8Array([0, 8])),
  );
  const data = iso39794 ? faceBlock(options.portrait) : tlv(0x5f2e, faceRecord(options.portrait));
  return tlv(0x75, tlv(0x7f61, tlv(0x02, new Uint8Array([1])), tlv(0x7f60, header, data)));
}

/** DG14: the ActiveAuthenticationInfo of a plain-ECDSA AA key (Doc 9303-11 §6.1). */
function dg14File(hash: HashAlgorithm): Uint8Array {
  return tlv(
    0x6e,
    setOf([
      sequence(
        objectIdentifier(ACTIVE_AUTHENTICATION_PROTOCOL_OID),
        integer(1),
        objectIdentifier(ECDSA_PLAIN_SIGNATURE_OIDS[hash]),
      ),
    ]),
  );
}

/** EF.COM (Doc 9303-10 §4.6.1): LDS 1.7, Unicode 4.0.0, the data-group tags. Unsigned. */
function comFile(groups: readonly DataGroupNumber[]): Uint8Array {
  const tags: Readonly<Record<number, number>> = { 1: 0x61, 2: 0x75, 14: 0x6e, 15: 0x6f };
  return tlv(
    0x60,
    tlv(0x5f01, utf8('0107')),
    tlv(0x5f36, utf8('040000')),
    tlv(0x5c, new Uint8Array(groups.map((group) => tags[group] ?? 0))),
  );
}

/** The MRZ with another issuer at positions 2-4 of the first line (every format has it there). */
function withIssuer(lines: readonly string[], issuer: string): string[] {
  return lines.map((line, index) =>
    index === 0 ? `${line.slice(0, 2)}${issuer}${line.slice(5)}` : line,
  );
}

/** One letter of the first MRZ line's name changed: the file still parses, its hash differs. */
function tamperedDg1(dg1: Uint8Array): Uint8Array {
  const tampered = new Uint8Array(dg1);
  const at = 5 + 5;
  tampered[at] = tampered[at] === 0x58 ? 0x59 : 0x58;
  return tampered;
}

function flipLast(bytes: Uint8Array): Uint8Array {
  const flipped = new Uint8Array(bytes);
  flipped[flipped.length - 1] = (flipped.at(-1) ?? 0) ^ 1;
  return flipped;
}

interface SodSpec {
  readonly options: TestChipOptions;
  readonly variants: ReadonlySet<TestChipVariant>;
  readonly hash: HashAlgorithm;
  /** The listed data groups and the bytes their hashes are over. */
  readonly listed: ReadonlyMap<DataGroupNumber, Uint8Array>;
}

/** The LDS security object (Doc 9303-10 §4.6.2.2): v1 with version info, or v0 without. */
function ldsSecurityObject({ variants, hash, listed }: SodSpec): Uint8Array {
  const v0 = variants.has('sod-v0');
  return sequence(
    integer(v0 ? 0 : 1),
    algorithmIdentifier(HASH_ALGORITHM_OIDS[hash]),
    sequence(
      ...[...listed].map(([group, file]) =>
        sequence(integer(group), octetString(digest(hash, file))),
      ),
    ),
    ...(v0 ? [] : [sequence(printableString('0107'), printableString('040000'))]),
  );
}

function sodFile(spec: SodSpec): Uint8Array {
  const { options, variants, hash } = spec;
  const { dsc } = options;
  if (variants.has('malformed-sod')) {
    return tlv(
      0x77,
      sequence(objectIdentifier(CMS_OIDS.signedData), explicit(0, sequence(integer(3)))),
    );
  }
  const signedContent = ldsSecurityObject(spec);
  // The eContent changed after its digest was signed: one byte of the last hash.
  const eContent = variants.has('message-digest-mismatch')
    ? flipLast(signedContent)
    : signedContent;
  const attributes = setOf([
    sequence(
      objectIdentifier(CMS_OIDS.contentType),
      setOf([
        objectIdentifier(
          variants.has('content-type-mismatch') ? CMS_OIDS.data : ICAO_OIDS.ldsSecurityObject,
        ),
      ]),
    ),
    sequence(
      objectIdentifier(CMS_OIDS.messageDigest),
      setOf([octetString(digest(hash, signedContent))]),
    ),
  ]);
  const scheme: TestSignatureScheme = { ...options.sodSignature, hash };
  const signed = testSign(dsc.key, attributes, scheme);
  const signature = variants.has('tampered-sod-signature') ? flipLast(signed.value) : signed.value;
  const issuerAndSerial = variants.has('issuer-and-serial-sid');
  const sid = issuerAndSerial
    ? sequence(dsc.issuerName, integer(BigInt(`0x${dsc.serialNumber}`)))
    : implicitPrimitive(
        0,
        variants.has('wrong-signer-identifier')
          ? seededBytes(`${options.seed}/sid`, 20)
          : dsc.keyIdentifier,
      );
  const signerInfo = sequence(
    integer(issuerAndSerial ? 1 : 3),
    sid,
    algorithmIdentifier(HASH_ALGORITHM_OIDS[hash]),
    // The signed attributes under their [0] IMPLICIT tag (RFC 5652 §5.3).
    concatBytes(new Uint8Array([0xa0]), attributes.subarray(1)),
    signed.algorithm,
    octetString(signature),
  );
  const signedData = sequence(
    integer(3),
    setOf([algorithmIdentifier(HASH_ALGORITHM_OIDS[hash])]),
    sequence(objectIdentifier(ICAO_OIDS.ldsSecurityObject), explicit(0, octetString(eContent))),
    ...(variants.has('dsc-not-embedded') ? [] : [explicit(0, dsc.der)]),
    setOf([signerInfo]),
  );
  return tlv(0x77, sequence(objectIdentifier(CMS_OIDS.signedData), explicit(0, signedData)));
}

/** A whole synthetic chip: DG1, DG2, optionally DG14 and DG15, and the SOD the DSC signs. */
export function buildChip(options: TestChipOptions): TestChip {
  const variants = new Set(options.variants ?? []);
  const hash: HashAlgorithm = variants.has('sha1') ? 'sha1' : (options.hash ?? 'sha256');
  const mrz = variants.has('dg1-issuer-mismatch')
    ? withIssuer(options.mrzLines, 'UTX')
    : options.mrzLines;
  const aaSpec = options.activeAuthentication;
  const aaKey = aaSpec === undefined ? null : testKeyPair(`${options.seed}/aa`, aaSpec);
  const signedGroups = new Map<DataGroupNumber, Uint8Array>([
    [1, dg1File(mrz)],
    [2, dg2File(options)],
  ]);
  if (aaKey !== null) {
    if (aaKey.spec.kind === 'ec') {
      signedGroups.set(14, dg14File('sha256'));
    }
    signedGroups.set(15, tlv(0x6f, aaKey.spki));
  }
  const listed = new Map(signedGroups);
  if (variants.has('unlisted-dg15')) {
    listed.delete(15);
  }
  const sod = sodFile({ options, variants, hash, listed });

  const uploaded = new Map(signedGroups);
  if (variants.has('tampered-dg1')) {
    uploaded.set(1, tamperedDg1(signedGroups.get(1) ?? new Uint8Array()));
  }
  if (variants.has('tampered-dg2')) {
    uploaded.set(2, flipLast(signedGroups.get(2) ?? new Uint8Array()));
  }
  const trailing = variants.has('trailing-bytes');
  if (trailing) {
    uploaded.set(2, concatBytes(uploaded.get(2) ?? new Uint8Array(), PADDING));
  }
  for (const group of options.withhold ?? []) {
    uploaded.delete(group);
  }
  return {
    files: {
      sod: trailing ? concatBytes(sod, PADDING) : sod,
      dataGroups: Object.fromEntries(uploaded),
      com: comFile([...signedGroups.keys()]),
    },
    activeAuthenticationKey:
      aaKey === null || aaSpec === undefined
        ? null
        : variants.has('aa-wrong-key')
          ? testKeyPair(`${options.seed}/aa-wrong`, aaSpec)
          : aaKey,
  };
}

/**
 * The chip's Active Authentication response to `nonce`: ISO/IEC 9796-2 scheme 1 for an RSA key
 * (trailer `0xBC` for SHA-1, `0x34CC` for SHA-256, ...), plain ECDSA for an EC key.
 */
export function signActiveAuthentication(
  key: TestKeyPair,
  nonce: Uint8Array,
  options: { readonly hash?: HashAlgorithm | undefined } = {},
): Uint8Array {
  const hash = options.hash ?? 'sha256';
  if (key.spec.kind === 'ec') {
    return testSign(key, nonce, { ec: 'plain', hash }).value;
  }
  // The stand-in private key of an oversized test key signs at its own (smaller) size.
  const details = key.privateKey.asymmetricKeyDetails;
  const size = Math.ceil((details?.modulusLength ?? 0) / 8);
  const trailer = new Uint8Array(TRAILERS[hash]);
  const recoverable = seededBytes(
    `${key.seed}/aa/${toHex(nonce)}`,
    size - 1 - digest(hash, new Uint8Array()).length - trailer.length,
  );
  const representative = concatBytes(
    new Uint8Array([0x6a]),
    recoverable,
    digest(hash, concatBytes(recoverable, nonce)),
    trailer,
  );
  return new Uint8Array(
    privateEncrypt({ key: key.privateKey, padding: constants.RSA_NO_PADDING }, representative),
  );
}
