/**
 * C62.2, C62.7: certificates, CRLs and master lists, parsed with their original bytes over pkijs
 * and verified through `node:crypto` (never pkijs' WebCrypto `verify()`, which refuses explicit EC
 * parameters). Passive Authentication uses them, and so does `api-nfc`'s trust-store sync, so the
 * sync and PA share one verifier.
 *
 * Extensions are read one by one, each in its own guard (real master lists hold a certificate
 * whose SKI does not parse, research §1.4): an extension that cannot be read is absent, unless it
 * is critical, when it is listed in `unknownCriticalExtensions` with every critical extension the
 * verifier does not know (Doc 9303-12 App. D.1.1.3: a profile defect).
 */
import { createHash } from 'node:crypto';
import * as asn1js from 'asn1js';
import * as pkijs from 'pkijs';
import {
  bitStringOf,
  booleanOf,
  childrenOf,
  decodeAsn1,
  encodedOf,
  isContext,
  isUniversal,
  octetsOf,
  oidOf,
  type Asn1,
} from './asn1.js';
import { equalBytes, toHex } from './bytes.js';
import { readSignedData, signerMatches, type SignedDataValue } from './cms.js';
import { EmrtdError } from './errors.js';
import { nameOf, serialHex } from './names.js';
import { importPublicKey, type PublicKeyImport } from './keys.js';
import { MASTER_LIST_LIMITS } from './limits.js';
import { ICAO_OIDS } from './oids.js';
import {
  checkSignature,
  hashAlgorithmOf,
  readAlgorithmIdentifier,
  type SignatureOutcome,
} from './signatures.js';
import type {
  MasterListFailure,
  MasterListVerification,
  ParsedCertificate,
  ParsedCrl,
  ParsedMasterList,
} from './types.js';

/** Options of the signature checks; SHA-1 is accepted unless `acceptSha1` is false. */
export interface SignatureCheckOptions {
  readonly acceptSha1?: boolean | undefined;
}

const SEQUENCE = 16;

const EXTENSIONS = Object.freeze({
  subjectKeyIdentifier: '2.5.29.14',
  keyUsage: '2.5.29.15',
  privateKeyUsagePeriod: '2.5.29.16',
  subjectAltName: '2.5.29.17',
  issuerAltName: '2.5.29.18',
  basicConstraints: '2.5.29.19',
  crlNumber: '2.5.29.20',
  crlDistributionPoints: '2.5.29.31',
  certificatePolicies: '2.5.29.32',
  authorityKeyIdentifier: '2.5.29.35',
  extendedKeyUsage: '2.5.29.37',
  /** Doc 9303-12 §7.1.1.2: a CSCA name change, and a DSC's document types. */
  nameChange: '2.23.136.1.1.6.1',
  documentTypeList: '2.23.136.1.1.6.2',
});

/** The extensions the verifier understands, read or not (C62.2). */
const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set(Object.values(EXTENSIONS));

/** RFC 5280 §4.2.1.3, by bit. */
const KEY_USAGES = [
  'digitalSignature',
  'nonRepudiation',
  'keyEncipherment',
  'dataEncipherment',
  'keyAgreement',
  'keyCertSign',
  'cRLSign',
  'encipherOnly',
  'decipherOnly',
] as const;

function malformed(step: string): never {
  throw new EmrtdError('chip_data_malformed', step);
}

function namedBits(value: Uint8Array, step: string): string[] {
  const block = decodeAsn1(value, step);
  if (!(block instanceof asn1js.BitString)) {
    malformed(step);
  }
  const bytes = block.valueBlock.valueHexView;
  const usable = bytes.length * 8 - block.valueBlock.unusedBits;
  return KEY_USAGES.filter(
    (_name, bit) =>
      bit < usable && (((bytes[Math.floor(bit / 8)] ?? 0) >> (7 - (bit % 8))) & 1) === 1,
  );
}

function sequenceItems(value: Uint8Array, step: string): Asn1[] {
  const block = decodeAsn1(value, step);
  return isUniversal(block, SEQUENCE) ? childrenOf(block, step) : malformed(step);
}

function distributionPoints(value: Uint8Array, step: string): string[] {
  const urls: string[] = [];
  for (const point of sequenceItems(value, step)) {
    for (const name of childrenOf(point, step).filter((item) => isContext(item, 0))) {
      for (const full of childrenOf(name, step).filter((item) => isContext(item, 0))) {
        for (const general of childrenOf(full, step).filter((item) => isContext(item, 6))) {
          urls.push(new TextDecoder().decode(octetsOf(general, step)));
        }
      }
    }
  }
  return urls;
}

interface ReadExtensions {
  ski: string | null;
  aki: string | null;
  isCa: boolean;
  keyUsage: string[];
  extendedKeyUsage: string[];
  crlDistributionPoints: string[];
  crlNumber: string | null;
  unknownCriticalExtensions: string[];
}

function readExtensions(extensions: readonly pkijs.Extension[], step: string): ReadExtensions {
  const read: ReadExtensions = {
    ski: null,
    aki: null,
    isCa: false,
    keyUsage: [],
    extendedKeyUsage: [],
    crlDistributionPoints: [],
    crlNumber: null,
    unknownCriticalExtensions: [],
  };
  for (const extension of extensions) {
    const id = extension.extnID;
    const value = new Uint8Array(extension.extnValue.valueBlock.valueHexView);
    try {
      switch (id) {
        case EXTENSIONS.subjectKeyIdentifier:
          read.ski = toHex(octetsOf(decodeAsn1(value, step), step));
          break;
        case EXTENSIONS.authorityKeyIdentifier: {
          const keyId = sequenceItems(value, step).find((item) => isContext(item, 0));
          read.aki = keyId === undefined ? null : toHex(octetsOf(keyId, step));
          break;
        }
        case EXTENSIONS.basicConstraints: {
          const [first] = sequenceItems(value, step);
          read.isCa = first !== undefined && isUniversal(first, 1) && booleanOf(first, step);
          break;
        }
        case EXTENSIONS.keyUsage:
          read.keyUsage = namedBits(value, step);
          break;
        case EXTENSIONS.extendedKeyUsage:
          read.extendedKeyUsage = sequenceItems(value, step).map((item) => oidOf(item, step));
          break;
        case EXTENSIONS.crlDistributionPoints:
          read.crlDistributionPoints = distributionPoints(value, step);
          break;
        case EXTENSIONS.crlNumber: {
          const number = decodeAsn1(value, step);
          read.crlNumber =
            number instanceof asn1js.Integer ? number.toBigInt().toString() : malformed(step);
          break;
        }
        default:
          if (extension.critical && !KNOWN_EXTENSIONS.has(id)) {
            read.unknownCriticalExtensions.push(id);
          }
      }
    } catch (error) {
      if (!(error instanceof EmrtdError)) {
        throw error;
      }
      // An extension that cannot be read is absent; a critical one is not understood.
      if (extension.critical) {
        read.unknownCriticalExtensions.push(id);
      }
    }
  }
  return read;
}

/** A pkijs object from an asn1js block, or `chip_data_malformed`. */
function pkiObject<T>(build: () => T, step: string): T {
  try {
    return build();
  } catch {
    return malformed(step);
  }
}

export function parseCertificate(der: Uint8Array): ParsedCertificate {
  const step = 'parseCertificate';
  const block = decodeAsn1(der, step);
  const certificate = pkiObject(() => new pkijs.Certificate({ schema: block }), step);
  const [tbsBlock, algorithmBlock, signatureBlock] = childrenOf(block, step);
  if (tbsBlock === undefined || algorithmBlock === undefined || signatureBlock === undefined) {
    malformed(step);
  }
  const tbsItems = childrenOf(tbsBlock, step);
  const offset = tbsItems[0] !== undefined && isContext(tbsItems[0], 0) ? 1 : 0;
  const spkiBlock = tbsItems[offset + 5] ?? malformed(step);
  const subject = nameOf(certificate.subject, step);
  const issuer = nameOf(certificate.issuer, step);
  const extensions = readExtensions(certificate.extensions ?? [], step);
  return {
    der: new Uint8Array(der),
    sha256: createHash('sha256').update(der).digest('hex'),
    subjectDn: subject.dn,
    issuerDn: issuer.dn,
    subjectDnKey: subject.key,
    issuerDnKey: issuer.key,
    country: subject.country,
    serialNumber: serialHex(certificate.serialNumber),
    ski: extensions.ski,
    aki: extensions.aki,
    notBefore: certificate.notBefore.value,
    notAfter: certificate.notAfter.value,
    isCa: extensions.isCa,
    keyUsage: extensions.keyUsage,
    extendedKeyUsage: extensions.extendedKeyUsage,
    crlDistributionPoints: extensions.crlDistributionPoints,
    unknownCriticalExtensions: extensions.unknownCriticalExtensions,
    tbs: encodedOf(tbsBlock),
    signatureAlgorithm: readAlgorithmIdentifier(algorithmBlock, step),
    signatureValue: bitStringOf(signatureBlock, step),
    spki: encodedOf(spkiBlock),
  };
}

/** The issuer's key, or `null` when it is outside the C62.1 bounds or cannot be read. */
export function issuerKeyOf(issuer: ParsedCertificate, step: string): PublicKeyImport | null {
  try {
    return importPublicKey(issuer.spki, step);
  } catch (error) {
    if (error instanceof EmrtdError) {
      return null;
    }
    throw error;
  }
}

/** The certificate's signature under `key`, over its original TBS bytes. */
export function checkCertificateSignature(
  certificate: Pick<ParsedCertificate, 'tbs' | 'signatureAlgorithm' | 'signatureValue'>,
  key: PublicKeyImport,
  acceptSha1: boolean,
): SignatureOutcome {
  return checkSignature({
    algorithm: certificate.signatureAlgorithm,
    key,
    data: certificate.tbs,
    signature: certificate.signatureValue,
    acceptSha1,
  });
}

/**
 * Whether `issuer`'s key verifies `certificate`'s signature over its original TBS bytes. A key
 * outside the C62.1 bounds or an unsupported algorithm verifies nothing.
 */
export function verifyCertificateSignature(
  certificate: ParsedCertificate,
  issuer: ParsedCertificate,
  options: SignatureCheckOptions = {},
): boolean {
  const key = issuerKeyOf(issuer, 'verifyCertificateSignature');
  return (
    key !== null &&
    checkCertificateSignature(certificate, key, options.acceptSha1 ?? true).check === 'valid'
  );
}

export function parseCrl(der: Uint8Array): ParsedCrl {
  const step = 'parseCrl';
  const block = decodeAsn1(der, step);
  const crl = pkiObject(() => new pkijs.CertificateRevocationList({ schema: block }), step);
  const [tbsBlock, algorithmBlock, signatureBlock] = childrenOf(block, step);
  if (tbsBlock === undefined || algorithmBlock === undefined || signatureBlock === undefined) {
    malformed(step);
  }
  const issuer = nameOf(crl.issuer, step);
  const extensions = readExtensions(crl.crlExtensions?.extensions ?? [], step);
  return {
    der: new Uint8Array(der),
    issuerDn: issuer.dn,
    issuerDnKey: issuer.key,
    issuerCountry: issuer.country,
    issuerKeyId: extensions.aki,
    thisUpdate: crl.thisUpdate.value,
    nextUpdate: crl.nextUpdate?.value ?? null,
    crlNumber: extensions.crlNumber,
    revokedSerials: (crl.revokedCertificates ?? []).map((entry) =>
      serialHex(entry.userCertificate),
    ),
    tbs: encodedOf(tbsBlock),
    signatureAlgorithm: readAlgorithmIdentifier(algorithmBlock, step),
    signatureValue: bitStringOf(signatureBlock, step),
  };
}

/** Whether `issuer`'s key verifies the CRL's signature (C62.7). */
export function verifyCrlSignature(
  crl: ParsedCrl,
  issuer: ParsedCertificate,
  options: SignatureCheckOptions = {},
): boolean {
  const key = issuerKeyOf(issuer, 'verifyCrlSignature');
  return (
    key !== null &&
    checkCertificateSignature(crl, key, options.acceptSha1 ?? true).check === 'valid'
  );
}

const MASTER_LIST_ASN1_LIMITS = Object.freeze({
  maxDepth: MASTER_LIST_LIMITS.maxDepth,
  maxNodes: MASTER_LIST_LIMITS.maxNodes,
  maxContentLength: MASTER_LIST_LIMITS.maxBytes,
});

/** The SignedData of a master list, within the master list caps. */
function masterListSignedData(der: Uint8Array, step: string): SignedDataValue {
  if (der.length > MASTER_LIST_LIMITS.maxBytes) {
    throw new EmrtdError('limit_exceeded', step);
  }
  return readSignedData(der, step, MASTER_LIST_ASN1_LIMITS);
}

/** Parses each DER, skipping (and counting) the ones that cannot be read. */
function readableCertificates(ders: readonly Uint8Array[]): {
  certificates: ParsedCertificate[];
  unreadable: number;
} {
  const certificates: ParsedCertificate[] = [];
  let unreadable = 0;
  for (const der of ders) {
    try {
      certificates.push(parseCertificate(der));
    } catch (error) {
      if (!(error instanceof EmrtdError)) {
        throw error;
      }
      unreadable += 1;
    }
  }
  return { certificates, unreadable };
}

export function parseMasterList(der: Uint8Array): ParsedMasterList {
  const step = 'parseMasterList';
  const signedData = masterListSignedData(der, step);
  let listed: Uint8Array[] = [];
  if (signedData.eContentType === ICAO_OIDS.cscaMasterList) {
    // CscaMasterList ::= SEQUENCE { version INTEGER (v0), certList SET OF Certificate }
    const content = decodeAsn1(signedData.eContent, step, MASTER_LIST_ASN1_LIMITS);
    const [, certList] = isUniversal(content, SEQUENCE)
      ? childrenOf(content, step)
      : malformed(step);
    listed = childrenOf(certList ?? malformed(step), step).map((block) => encodedOf(block));
  }
  const { certificates, unreadable } = readableCertificates(listed);
  const embedded = readableCertificates(signedData.certificates).certificates;
  return {
    der: new Uint8Array(der),
    eContentType: signedData.eContentType,
    signingTime: signedData.signer.signingTime,
    signer:
      embedded.find((certificate) => signerMatches(certificate, signedData.signer.sid)) ?? null,
    certificates,
    unreadableCertificates: unreadable,
  };
}

/**
 * C62.7: a master list against its pinned root: the eContentType, the signer's EKU
 * (2.23.136.1.1.3) and key usage, its AKI to the root (or a verified link), `messageDigest`, and
 * the signature over the original signed-attribute bytes, at `now`.
 */
export function verifyMasterList(
  list: ParsedMasterList,
  root: ParsedCertificate,
  options: { now: Date },
): MasterListVerification {
  const step = 'verifyMasterList';
  const refuse = (failure: MasterListFailure): MasterListVerification => ({
    verified: false,
    failure,
  });
  const { signer: info, eContent, eContentType } = masterListSignedData(list.der, step);
  if (eContentType !== ICAO_OIDS.cscaMasterList || info.contentType !== ICAO_OIDS.cscaMasterList) {
    return refuse('content_type_invalid');
  }
  const signer = list.signer;
  if (signer === null) {
    return refuse('signer_missing');
  }
  if (
    signer.isCa ||
    !signer.keyUsage.includes('digitalSignature') ||
    !signer.extendedKeyUsage.includes(ICAO_OIDS.cscaMasterListSigningKey)
  ) {
    return refuse('signer_profile_invalid');
  }
  const at = list.signingTime ?? options.now;
  if (at.getTime() < signer.notBefore.getTime() || at.getTime() > signer.notAfter.getTime()) {
    return refuse('signer_expired');
  }
  // The root, or a CSCA the root certifies through a link certificate the list carries.
  const issuers = [
    root,
    ...list.certificates.filter(
      (certificate) =>
        certificate.isCa &&
        certificate.sha256 !== root.sha256 &&
        verifyCertificateSignature(certificate, root),
    ),
  ];
  const issued = issuers.some(
    (issuer) =>
      (signer.aki === null || issuer.ski === null || signer.aki === issuer.ski) &&
      verifyCertificateSignature(signer, issuer),
  );
  if (!issued) {
    return refuse('signer_not_issued_by_root');
  }
  const digest = hashAlgorithmOf(info.digestAlgorithm.oid);
  if (
    digest === null ||
    info.messageDigest === null ||
    !equalBytes(new Uint8Array(createHash(digest).update(eContent).digest()), info.messageDigest)
  ) {
    return refuse('message_digest_mismatch');
  }
  const key = issuerKeyOf(signer, step);
  const valid =
    key !== null &&
    info.signedAttributes !== null &&
    checkSignature({
      algorithm: info.signatureAlgorithm,
      digest,
      key,
      data: info.signedAttributes,
      signature: info.signature,
      acceptSha1: true,
    }).check === 'valid';
  return valid ? { verified: true } : refuse('signature_invalid');
}
