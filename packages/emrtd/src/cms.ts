/**
 * C62.2, C62.7: the CMS `SignedData` an EF.SOD and a CSCA master list are (RFC 5652, Doc 9303-10
 * Table 37), read with asn1js and kept as received: the encapsulated content, every embedded
 * certificate's original DER, and the first SignerInfo with its signed attributes as signed
 * (their original bytes, the `[0] IMPLICIT` tag re-tagged as `SET OF`, RFC 5652 §5.4), so a
 * signature is verified over exactly what the signer signed, never over a re-encoding.
 */
import { createHash } from 'node:crypto';
import type * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import {
  CHIP_ASN1_LIMITS,
  bitStringOf,
  childrenOf,
  dateOf,
  decodeAsn1,
  encodedOf,
  isContext,
  isUniversal,
  octetsOf,
  oidOf,
  type Asn1,
  type Asn1Limits,
} from './asn1.js';
import { toHex } from './bytes.js';
import { EmrtdError } from './errors.js';
import { nameOf, serialHex } from './names.js';
import { CMS_OIDS } from './oids.js';
import { readAlgorithmIdentifier } from './signatures.js';
import type { AlgorithmIdentifierValue, ParsedCertificate } from './types.js';

/** How a SignerInfo names its certificate. */
export type SignerIdentifierValue =
  | { readonly kind: 'subject_key_identifier'; readonly ski: string }
  | {
      readonly kind: 'issuer_and_serial';
      /** The issuer's DN key (`names.ts`) and the serial as lower-case hex. */
      readonly issuerDnKey: string;
      readonly serialNumber: string;
    };

export interface SignerInfoValue {
  readonly sid: SignerIdentifierValue;
  readonly digestAlgorithm: AlgorithmIdentifierValue;
  /** The signed attributes as signed (`SET OF`), or `null` when the SignerInfo has none. */
  readonly signedAttributes: Uint8Array | null;
  /** The signed `contentType` attribute's OID, `null` when absent. */
  readonly contentType: string | null;
  /** The signed `messageDigest` attribute, `null` when absent. */
  readonly messageDigest: Uint8Array | null;
  readonly signingTime: Date | null;
  readonly signatureAlgorithm: AlgorithmIdentifierValue;
  readonly signature: Uint8Array;
}

export interface SignedDataValue {
  readonly eContentType: string;
  readonly eContent: Uint8Array;
  /** Each embedded certificate's original DER. */
  readonly certificates: readonly Uint8Array[];
  /** The first SignerInfo (Doc 9303-10 recommends exactly one). */
  readonly signer: SignerInfoValue;
}

const SEQUENCE = 16;
const SET = 17;

function malformed(step: string): never {
  throw new EmrtdError('chip_data_malformed', step);
}

function sequenceOf(block: Asn1 | undefined, step: string): Asn1[] {
  return block !== undefined && isUniversal(block, SEQUENCE)
    ? childrenOf(block, step)
    : malformed(step);
}

function signerIdentifier(block: Asn1, step: string): SignerIdentifierValue {
  if (isContext(block, 0)) {
    return { kind: 'subject_key_identifier', ski: toHex(octetsOf(block, step)) };
  }
  const [issuer, serial] = sequenceOf(block, step);
  if (issuer === undefined || serial === undefined) {
    malformed(step);
  }
  let name: pkijs.RelativeDistinguishedNames;
  try {
    name = new pkijs.RelativeDistinguishedNames({ schema: issuer });
  } catch {
    return malformed(step);
  }
  if (!isUniversal(serial, 2)) {
    malformed(step);
  }
  return {
    kind: 'issuer_and_serial',
    issuerDnKey: nameOf(name, step).key,
    serialNumber: serialHex(serial as asn1js.Integer),
  };
}

interface SignedAttributes {
  readonly bytes: Uint8Array | null;
  readonly contentType: string | null;
  readonly messageDigest: Uint8Array | null;
  readonly signingTime: Date | null;
}

function signedAttributes(block: Asn1 | undefined, step: string): SignedAttributes {
  if (block === undefined) {
    return { bytes: null, contentType: null, messageDigest: null, signingTime: null };
  }
  let contentType: string | null = null;
  let messageDigest: Uint8Array | null = null;
  let signingTime: Date | null = null;
  for (const attribute of childrenOf(block, step)) {
    const [type, values] = sequenceOf(attribute, step);
    const [value] =
      values !== undefined && isUniversal(values, SET) ? childrenOf(values, step) : [];
    if (type === undefined || value === undefined) {
      malformed(step);
    }
    switch (oidOf(type, step)) {
      case CMS_OIDS.contentType:
        contentType = oidOf(value, step);
        break;
      case CMS_OIDS.messageDigest:
        messageDigest = octetsOf(value, step);
        break;
      case CMS_OIDS.signingTime:
        signingTime = dateOf(value, step);
        break;
      default:
        break;
    }
  }
  // RFC 5652 §5.4: the signature covers the attributes' encoding with the SET OF tag.
  const bytes = encodedOf(block);
  bytes[0] = 0x31;
  return { bytes, contentType, messageDigest, signingTime };
}

function signerInfo(block: Asn1, step: string): SignerInfoValue {
  const [, sid, digest, ...rest] = sequenceOf(block, step);
  if (sid === undefined || digest === undefined) {
    malformed(step);
  }
  const attributes = rest[0] !== undefined && isContext(rest[0], 0) ? rest[0] : undefined;
  const [algorithm, signature] = attributes === undefined ? rest : rest.slice(1);
  if (algorithm === undefined || signature === undefined) {
    malformed(step);
  }
  const signed = signedAttributes(attributes, step);
  return {
    sid: signerIdentifier(sid, step),
    digestAlgorithm: readAlgorithmIdentifier(digest, step),
    signedAttributes: signed.bytes,
    contentType: signed.contentType,
    messageDigest: signed.messageDigest,
    signingTime: signed.signingTime,
    signatureAlgorithm: readAlgorithmIdentifier(algorithm, step),
    signature: octetsOf(signature, step),
  };
}

/**
 * A `ContentInfo` holding `SignedData`, decoded within `limits`.
 * @throws {EmrtdError} `chip_data_malformed` for anything else, `limit_exceeded` past the caps.
 */
export function readSignedData(
  contentInfo: Uint8Array,
  step: string,
  limits: Asn1Limits = CHIP_ASN1_LIMITS,
): SignedDataValue {
  const [type, wrapped] = sequenceOf(decodeAsn1(contentInfo, step, limits), step);
  if (type === undefined || wrapped === undefined || oidOf(type, step) !== CMS_OIDS.signedData) {
    malformed(step);
  }
  if (!isContext(wrapped, 0)) {
    malformed(step);
  }
  const [, , encapsulated, ...rest] = sequenceOf(childrenOf(wrapped, step)[0], step);
  const signerInfos = rest.at(-1);
  if (signerInfos === undefined || !isUniversal(signerInfos, SET)) {
    malformed(step);
  }
  const [eContentType, eContentWrapper] = sequenceOf(encapsulated, step);
  if (
    eContentType === undefined ||
    eContentWrapper === undefined ||
    !isContext(eContentWrapper, 0)
  ) {
    malformed(step);
  }
  const [eContent] = childrenOf(eContentWrapper, step);
  const certificates = rest.find((block) => isContext(block, 0));
  const [first] = childrenOf(signerInfos, step);
  return {
    eContentType: oidOf(eContentType, step),
    eContent: octetsOf(eContent ?? malformed(step), step),
    certificates:
      certificates === undefined
        ? []
        : childrenOf(certificates, step).map((block) => encodedOf(block)),
    signer: signerInfo(first ?? malformed(step), step),
  };
}

/** RFC 5280 §4.2.1.2 method 1: SHA-1 of the subject public key bits. */
function computedKeyIdentifier(spki: Uint8Array, step: string): string {
  const [, bits] = sequenceOf(decodeAsn1(spki, step), step);
  return createHash('sha1')
    .update(bitStringOf(bits ?? malformed(step), step))
    .digest('hex');
}

/** Whether `certificate` is the one `sid` names (by SKI, else by its computed key identifier). */
export function signerMatches(certificate: ParsedCertificate, sid: SignerIdentifierValue): boolean {
  if (sid.kind === 'issuer_and_serial') {
    return (
      certificate.issuerDnKey === sid.issuerDnKey && certificate.serialNumber === sid.serialNumber
    );
  }
  if (certificate.ski !== null) {
    return certificate.ski === sid.ski;
  }
  try {
    return computedKeyIdentifier(certificate.spki, 'signerMatches') === sid.ski;
  } catch (error) {
    if (error instanceof EmrtdError) {
      return false;
    }
    throw error;
  }
}
