/**
 * C65.3: synthetic X.509 for the Utopia PKI (Doc 9303-12 §7.1 profiles): self-signed CSCAs, Document
 * Signer certificates, link certificates and v2 CRLs, written with the DER writer and signed with
 * the seeded test keys. Every builder takes the `now` it builds around; nothing here is real
 * issuer data.
 */
import { createHash } from 'node:crypto';
import { bytesToBigInt, toHex, unsignedBytes, utf8 } from '../bytes.js';
import {
  bitString,
  booleanValue,
  explicit,
  generalizedTime,
  implicitPrimitive,
  integer,
  namedBits,
  objectIdentifier,
  octetString,
  printableString,
  sequence,
  setOf,
  tlv,
  utf8String,
  x509Time,
} from '../der.js';
import { readTlv, tlvChildren, tlvValue } from '../tlv.js';
import {
  seededBytes,
  testKeyPair,
  testSign,
  testSignatureAlgorithm,
  type TestKeyPair,
  type TestKeySpec,
  type TestSignatureScheme,
} from './keys.js';

/** A synthetic certificate with the key it certifies. */
export interface TestCertificate {
  readonly der: Uint8Array;
  readonly key: TestKeyPair;
  /** The subject Name, DER (a link certificate's is its new CSCA's). */
  readonly subjectName: Uint8Array;
  /** The issuer Name, DER (a SignerInfo's `issuerAndSerialNumber` names it). */
  readonly issuerName: Uint8Array;
  /** The subject key identifier: SHA-1 of the subject public key bits (RFC 5280 §4.2.1.2). */
  readonly keyIdentifier: Uint8Array;
  /** Lower-case hex, without leading zero bytes, as `parseCertificate` reads it. */
  readonly serialNumber: string;
  readonly country: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
}

/** An extension written as given (C65.3 profile defects). */
export interface TestExtension {
  readonly oid: string;
  readonly critical: boolean;
  /** The extension's value, DER (the contents of `extnValue`). */
  readonly value: Uint8Array;
}

/** What every certificate builder may override. */
export interface TestCertificateOverrides {
  /** The subject's common name; CSCAs default to `CSCA Utopia`, so two seeds share one DN. */
  readonly commonName?: string | undefined;
  readonly notBefore?: Date | undefined;
  readonly notAfter?: Date | undefined;
  /** How the issuer signs the certificate. */
  readonly signature?: TestSignatureScheme | undefined;
  /** RFC 5280 key usage names, replacing the profile's. */
  readonly keyUsage?: readonly string[] | undefined;
  readonly extendedKeyUsage?: readonly string[] | undefined;
  /** A CRL distribution point URL; none by default. */
  readonly crlDistributionPoint?: string | undefined;
  /** Leave the SKI out (an old profile). */
  readonly omitSubjectKeyIdentifier?: boolean | undefined;
  readonly extraExtensions?: readonly TestExtension[] | undefined;
}

export interface TestCscaOptions extends TestCertificateOverrides {
  readonly seed: string;
  readonly now: Date;
  /** Defaults to brainpoolP256r1 with explicit parameters (Doc 9303-12 §4.1.6.3). */
  readonly key?: TestKeySpec | undefined;
  /** Defaults to `UT`. */
  readonly country?: string | undefined;
  /** Days of validity after `now`, which `notBefore` precedes by a day (15 years by default). */
  readonly validityDays?: number | undefined;
}

export interface TestDscOptions extends TestCertificateOverrides {
  readonly seed: string;
  readonly issuer: TestCertificate;
  readonly now: Date;
  /** Defaults to brainpoolP256r1 with explicit parameters. */
  readonly key?: TestKeySpec | undefined;
  /** Defaults to the issuer's. */
  readonly country?: string | undefined;
  /** Days of validity after `now` (ten years and three months by default). */
  readonly validityDays?: number | undefined;
  /** Leave the AKI out (C65.3: a CSCA rollover without AKI). */
  readonly omitAuthorityKeyIdentifier?: boolean | undefined;
  /** A profile defect (C65.3: a DSC with `cA` true). */
  readonly ca?: boolean | undefined;
}

export interface TestCrlOptions {
  readonly issuer: TestCertificate;
  readonly now: Date;
  /** Lower-case hex serial numbers (`TestCertificate.serialNumber`). */
  readonly revokedSerials?: readonly string[] | undefined;
  /** Defaults to `now`. */
  readonly thisUpdate?: Date | undefined;
  /** Days from `thisUpdate` to `nextUpdate` (30 by default; the seed's CRL: 90). */
  readonly nextUpdateDays?: number | undefined;
  readonly crlNumber?: number | undefined;
  readonly signature?: TestSignatureScheme | undefined;
}

const DAY_MS = 86_400_000;
const CSCA_VALIDITY_DAYS = 5479;
const DSC_VALIDITY_DAYS = 3743;
const DEFAULT_KEY: TestKeySpec = { kind: 'ec', curve: 'brainpoolP256r1', explicitParameters: true };
const ORGANIZATION = 'OpenVerify Test';

const OIDS = Object.freeze({
  country: '2.5.4.6',
  organization: '2.5.4.10',
  commonName: '2.5.4.3',
  subjectKeyIdentifier: '2.5.29.14',
  keyUsage: '2.5.29.15',
  privateKeyUsagePeriod: '2.5.29.16',
  basicConstraints: '2.5.29.19',
  crlNumber: '2.5.29.20',
  crlDistributionPoints: '2.5.29.31',
  authorityKeyIdentifier: '2.5.29.35',
  extendedKeyUsage: '2.5.29.37',
});

const KEY_USAGE_BITS: Readonly<Record<string, number>> = {
  digitalSignature: 0,
  nonRepudiation: 1,
  keyEncipherment: 2,
  dataEncipherment: 3,
  keyAgreement: 4,
  keyCertSign: 5,
  cRLSign: 6,
  encipherOnly: 7,
  decipherOnly: 8,
};

/** A whole second, as X.509 times hold it. */
const second = (date: Date) => new Date(Math.floor(date.getTime() / 1000) * 1000);
const daysAfter = (date: Date, days: number) => second(new Date(date.getTime() + days * DAY_MS));

/** C=, O= and CN=, one attribute per RDN. */
function utopiaName(country: string, commonName: string): Uint8Array {
  const rdn = (oid: string, value: Uint8Array) => setOf([sequence(objectIdentifier(oid), value)]);
  return sequence(
    rdn(OIDS.country, printableString(country)),
    rdn(OIDS.organization, utf8String(ORGANIZATION)),
    rdn(OIDS.commonName, utf8String(commonName)),
  );
}

/** SHA-1 of the subjectPublicKey BIT STRING's contents (RFC 5280 §4.2.1.2, method 1). */
function keyIdentifierOf(spki: Uint8Array): Uint8Array {
  const [, bits] = tlvChildren(spki, readTlv(spki));
  const contents = bits === undefined ? spki : tlvValue(spki, bits).subarray(1);
  return new Uint8Array(createHash('sha1').update(contents).digest());
}

/** A positive serial number from the seed, under 2^63. */
function serialFrom(label: string): bigint {
  return (bytesToBigInt(seededBytes(`${label}/serial`, 8)) >> 1n) | 1n;
}

function extension({ oid, critical, value }: TestExtension): Uint8Array {
  return sequence(
    objectIdentifier(oid),
    ...(critical ? [booleanValue(true)] : []),
    octetString(value),
  );
}

/** PrivateKeyUsagePeriod: `[0]` and `[1]` IMPLICIT GeneralizedTime (Doc 9303-12 Table 6). */
function usagePeriod(notBefore: Date, notAfter: Date): Uint8Array {
  return sequence(
    implicitPrimitive(0, generalizedTime(notBefore).subarray(2)),
    implicitPrimitive(1, generalizedTime(notAfter).subarray(2)),
  );
}

function keyUsage(names: readonly string[]): Uint8Array {
  return namedBits(
    names.map((name) => {
      const bit = KEY_USAGE_BITS[name];
      if (bit === undefined) {
        throw new RangeError('unknown key usage');
      }
      return bit;
    }),
  );
}

function distributionPoint(url: string): Uint8Array {
  return sequence(sequence(tlv(0xa0, tlv(0xa0, implicitPrimitive(6, utf8(url))))));
}

interface CertificateSpec {
  readonly serial: bigint;
  readonly issuerName: Uint8Array;
  readonly issuerKey: TestKeyPair;
  readonly subjectName: Uint8Array;
  readonly subjectKey: TestKeyPair;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly authorityKeyIdentifier: Uint8Array | null;
  /** A CA's basic constraints (path length 0), a DSC's `cA` defect without one, or none. */
  readonly basicConstraints: 'ca' | 'ca-defect' | null;
  readonly keyUsage: readonly string[];
  readonly overrides: TestCertificateOverrides;
}

function writeCertificate(spec: CertificateSpec): { der: Uint8Array; keyIdentifier: Uint8Array } {
  const { overrides } = spec;
  const keyIdentifier = keyIdentifierOf(spec.subjectKey.spki);
  const extensions: TestExtension[] = [];
  if (spec.authorityKeyIdentifier !== null) {
    extensions.push({
      oid: OIDS.authorityKeyIdentifier,
      critical: false,
      value: sequence(implicitPrimitive(0, spec.authorityKeyIdentifier)),
    });
  }
  if (overrides.omitSubjectKeyIdentifier !== true) {
    extensions.push({
      oid: OIDS.subjectKeyIdentifier,
      critical: false,
      value: octetString(keyIdentifier),
    });
  }
  extensions.push(
    { oid: OIDS.keyUsage, critical: true, value: keyUsage(overrides.keyUsage ?? spec.keyUsage) },
    {
      oid: OIDS.privateKeyUsagePeriod,
      critical: false,
      value: usagePeriod(spec.notBefore, spec.notAfter),
    },
  );
  if (spec.basicConstraints !== null) {
    extensions.push({
      oid: OIDS.basicConstraints,
      critical: true,
      value:
        spec.basicConstraints === 'ca'
          ? sequence(booleanValue(true), integer(0))
          : sequence(booleanValue(true)),
    });
  }
  if (overrides.extendedKeyUsage !== undefined) {
    extensions.push({
      oid: OIDS.extendedKeyUsage,
      critical: false,
      value: sequence(...overrides.extendedKeyUsage.map(objectIdentifier)),
    });
  }
  if (overrides.crlDistributionPoint !== undefined) {
    extensions.push({
      oid: OIDS.crlDistributionPoints,
      critical: false,
      value: distributionPoint(overrides.crlDistributionPoint),
    });
  }
  extensions.push(...(overrides.extraExtensions ?? []));
  const algorithm = testSignatureAlgorithm(spec.issuerKey, overrides.signature);
  const tbs = sequence(
    explicit(0, integer(2)),
    integer(spec.serial),
    algorithm,
    spec.issuerName,
    sequence(x509Time(spec.notBefore), x509Time(spec.notAfter)),
    spec.subjectName,
    spec.subjectKey.spki,
    explicit(3, sequence(...extensions.map(extension))),
  );
  const signature = testSign(spec.issuerKey, tbs, overrides.signature);
  return { der: sequence(tbs, algorithm, bitString(signature.value)), keyIdentifier };
}

/** A self-signed CSCA (`cA` true with path length 0, `keyCertSign`, `cRLSign`). */
export function buildCsca(options: TestCscaOptions): TestCertificate {
  const key = testKeyPair(options.seed, options.key ?? DEFAULT_KEY);
  const country = options.country ?? 'UT';
  const notBefore = second(options.notBefore ?? daysAfter(options.now, -1));
  const notAfter = second(
    options.notAfter ?? daysAfter(options.now, options.validityDays ?? CSCA_VALIDITY_DAYS),
  );
  const subjectName = utopiaName(country, options.commonName ?? 'CSCA Utopia');
  const serial = serialFrom(`${options.seed}/csca`);
  const keyIdentifier = keyIdentifierOf(key.spki);
  const { der } = writeCertificate({
    serial,
    issuerName: subjectName,
    issuerKey: key,
    subjectName,
    subjectKey: key,
    notBefore,
    notAfter,
    authorityKeyIdentifier: keyIdentifier,
    basicConstraints: 'ca',
    keyUsage: ['keyCertSign', 'cRLSign'],
    overrides: options,
  });
  return {
    der,
    key,
    subjectName,
    issuerName: subjectName,
    keyIdentifier,
    serialNumber: toHex(unsignedBytes(serial)),
    country,
    notBefore,
    notAfter,
  };
}

/** A Document Signer certificate issued by `issuer` (`digitalSignature`, not a CA). */
export function buildDsc(options: TestDscOptions): TestCertificate {
  const key = testKeyPair(options.seed, options.key ?? DEFAULT_KEY);
  const country = options.country ?? options.issuer.country;
  const notBefore = second(options.notBefore ?? daysAfter(options.now, -1));
  const notAfter = second(
    options.notAfter ?? daysAfter(options.now, options.validityDays ?? DSC_VALIDITY_DAYS),
  );
  const label = createHash('sha256').update(options.seed).digest('hex').slice(0, 8);
  const subjectName = utopiaName(country, options.commonName ?? `Utopia Document Signer ${label}`);
  const serial = serialFrom(`${options.seed}/dsc`);
  const { der, keyIdentifier } = writeCertificate({
    serial,
    issuerName: options.issuer.subjectName,
    issuerKey: options.issuer.key,
    subjectName,
    subjectKey: key,
    notBefore,
    notAfter,
    authorityKeyIdentifier:
      options.omitAuthorityKeyIdentifier === true ? null : options.issuer.keyIdentifier,
    basicConstraints: options.ca === true ? 'ca-defect' : null,
    keyUsage: ['digitalSignature'],
    overrides: options,
  });
  return {
    der,
    key,
    subjectName,
    issuerName: options.issuer.subjectName,
    keyIdentifier,
    serialNumber: toHex(unsignedBytes(serial)),
    country,
    notBefore,
    notAfter,
  };
}

/** A link certificate: the new CSCA key certified by the old one (C65.3 link rollover). */
export function buildLinkCertificate(options: {
  readonly from: TestCertificate;
  readonly to: TestCertificate;
  readonly now: Date;
}): TestCertificate {
  const { from, to } = options;
  const notBefore = daysAfter(options.now, -1);
  const serial = serialFrom(`${toHex(to.keyIdentifier)}/link`);
  const { der } = writeCertificate({
    serial,
    issuerName: from.subjectName,
    issuerKey: from.key,
    subjectName: to.subjectName,
    subjectKey: to.key,
    notBefore,
    notAfter: to.notAfter,
    authorityKeyIdentifier: from.keyIdentifier,
    basicConstraints: 'ca',
    keyUsage: ['keyCertSign', 'cRLSign'],
    overrides: {},
  });
  return {
    der,
    key: to.key,
    subjectName: to.subjectName,
    issuerName: from.subjectName,
    keyIdentifier: to.keyIdentifier,
    serialNumber: toHex(unsignedBytes(serial)),
    country: to.country,
    notBefore,
    notAfter: to.notAfter,
  };
}

/** A v2 CRL signed by `issuer`, with its AKI and `cRLNumber` (Doc 9303-12 §7.1.4). */
export function buildCrl(options: TestCrlOptions): Uint8Array {
  const { issuer } = options;
  const thisUpdate = second(options.thisUpdate ?? options.now);
  const nextUpdate = daysAfter(thisUpdate, options.nextUpdateDays ?? 30);
  const revoked = options.revokedSerials ?? [];
  const algorithm = testSignatureAlgorithm(issuer.key, options.signature);
  const tbs = sequence(
    integer(1),
    algorithm,
    issuer.subjectName,
    x509Time(thisUpdate),
    x509Time(nextUpdate),
    ...(revoked.length === 0
      ? []
      : [
          sequence(
            ...revoked.map((serial) =>
              sequence(integer(BigInt(`0x${serial}`)), x509Time(daysAfter(thisUpdate, -1))),
            ),
          ),
        ]),
    explicit(
      0,
      sequence(
        extension({
          oid: OIDS.authorityKeyIdentifier,
          critical: false,
          value: sequence(implicitPrimitive(0, issuer.keyIdentifier)),
        }),
        extension({ oid: OIDS.crlNumber, critical: false, value: integer(options.crlNumber ?? 1) }),
      ),
    ),
  );
  const signature = testSign(issuer.key, tbs, options.signature);
  return sequence(tbs, algorithm, bitString(signature.value));
}
