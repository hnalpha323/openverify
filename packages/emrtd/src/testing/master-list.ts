/**
 * C65.3, C62.7: synthetic CSCA master lists for the trust-store sync's tests: CMS `SignedData`
 * with eContentType `2.23.136.1.1.2` over `CscaMasterList { version 0, certList }`, signed by a
 * master list signer (EKU `2.23.136.1.1.3`) the pinned root issued (Doc 9303-12 §5.3, §9).
 */
import { createHash } from 'node:crypto';
import { concatBytes } from '../bytes.js';
import {
  algorithmIdentifier,
  explicit,
  implicitPrimitive,
  integer,
  objectIdentifier,
  octetString,
  sequence,
  setOf,
  utcTime,
} from '../der.js';
import { CMS_OIDS, HASH_ALGORITHM_OIDS, ICAO_OIDS } from '../oids.js';
import { testSign } from './keys.js';
import { buildDsc, type TestCertificate } from './x509.js';

/** One defect each, so one test proves one refusal of `verifyMasterList`. */
export const TEST_MASTER_LIST_VARIANTS = [
  /** The eContentType is not a master list's. */
  'wrong-content-type',
  /** The signer lacks the master list signer EKU. */
  'signer-without-eku',
  /** The list changed after its `messageDigest` was signed. */
  'tampered-content',
  /** The signature changed after signing. */
  'bad-signature',
  /** The list does not embed its signer. */
  'signer-not-embedded',
] as const;
export type TestMasterListVariant = (typeof TEST_MASTER_LIST_VARIANTS)[number];

export interface TestMasterListOptions {
  readonly signerSeed: string;
  /** The pinned root the signer chains to. */
  readonly root: TestCertificate;
  readonly certificates: readonly TestCertificate[];
  readonly signingTime: Date;
  /** Who issues the signer (the root by default; a newer CSCA its link certifies, or another). */
  readonly signerIssuer?: TestCertificate | undefined;
  /** The signer's validity end (two years after `signingTime` by default). */
  readonly signerNotAfter?: Date | undefined;
  readonly variants?: readonly TestMasterListVariant[] | undefined;
}

const TWO_YEARS_MS = 2 * 365 * 86_400_000;

const flipLast = (bytes: Uint8Array) => {
  const flipped = new Uint8Array(bytes);
  flipped[flipped.length - 1] = (flipped.at(-1) ?? 0) ^ 1;
  return flipped;
};

/** A CSCA master list (CMS `SignedData`, eContentType 2.23.136.1.1.2), for the sync's tests. */
export function buildMasterList(options: TestMasterListOptions): Uint8Array {
  const variants = new Set(options.variants ?? []);
  const issuer = options.signerIssuer ?? options.root;
  const signer = buildDsc({
    seed: options.signerSeed,
    issuer,
    now: options.signingTime,
    commonName: 'Master List Signer',
    notAfter: options.signerNotAfter ?? new Date(options.signingTime.getTime() + TWO_YEARS_MS),
    extendedKeyUsage: variants.has('signer-without-eku')
      ? undefined
      : [ICAO_OIDS.cscaMasterListSigningKey],
  });
  const eContentType = variants.has('wrong-content-type')
    ? ICAO_OIDS.ldsSecurityObject
    : ICAO_OIDS.cscaMasterList;
  const signedContent = sequence(
    integer(0),
    setOf(options.certificates.map((certificate) => certificate.der)),
  );
  const eContent = variants.has('tampered-content') ? flipLast(signedContent) : signedContent;
  const attributes = setOf([
    sequence(objectIdentifier(CMS_OIDS.contentType), setOf([objectIdentifier(eContentType)])),
    sequence(objectIdentifier(CMS_OIDS.signingTime), setOf([utcTime(options.signingTime)])),
    sequence(
      objectIdentifier(CMS_OIDS.messageDigest),
      setOf([octetString(new Uint8Array(createHash('sha256').update(signedContent).digest()))]),
    ),
  ]);
  const signature = testSign(signer.key, attributes, { hash: 'sha256' });
  const signerInfo = sequence(
    integer(3),
    implicitPrimitive(0, signer.keyIdentifier),
    algorithmIdentifier(HASH_ALGORITHM_OIDS.sha256),
    concatBytes(new Uint8Array([0xa0]), attributes.subarray(1)),
    signature.algorithm,
    octetString(variants.has('bad-signature') ? flipLast(signature.value) : signature.value),
  );
  const signedData = sequence(
    integer(3),
    setOf([algorithmIdentifier(HASH_ALGORITHM_OIDS.sha256)]),
    sequence(objectIdentifier(eContentType), explicit(0, octetString(eContent))),
    ...(variants.has('signer-not-embedded') ? [] : [explicit(0, signer.der)]),
    setOf([signerInfo]),
  );
  return sequence(objectIdentifier(CMS_OIDS.signedData), explicit(0, signedData));
}
