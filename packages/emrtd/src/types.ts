/**
 * The report types of the eMRTD verifier (plan C62.1-C62.6). They are what `emrtd` returns, what
 * the NFC evaluators in `packages/checks/src/nfc/` judge, and what `api-nfc` stores (a non-PII
 * summary in `chip_reads.pa_summary`). Every member is a measurement; the outcome of a check is
 * the evaluator's (C62.3, C62.4, C62.6). Chip data groups, the SOD and the AA response are PII and
 * biometric data: never log them (C53.8, the `chipFile` and `aaResponse` log keys).
 */

/** An ICAO LDS data group number (Doc 9303-10): DG1 to DG16. */
export type DataGroupNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16;

/** The data groups Phase 5 takes (C52.4): DG11 and DG12 are not taken. */
export const TAKEN_DATA_GROUPS: readonly DataGroupNumber[] = Object.freeze([1, 2, 14, 15]);

/** The digest algorithms an LDS security object may name (SHA-1 only with `accept-sha1`). */
export const HASH_ALGORITHMS = ['sha1', 'sha224', 'sha256', 'sha384', 'sha512'] as const;
export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

/** What the client uploaded for one NFC verification (C52.4), as raw bytes. */
export interface ChipFiles {
  /** EF.SOD (tag `77`). */
  readonly sod: Uint8Array;
  /** The data groups as read (DG1 `61`, DG2 `75`, DG14 `6E`, DG15 `6F`). */
  readonly dataGroups: Readonly<Partial<Record<DataGroupNumber, Uint8Array>>>;
  /** EF.CardSecurity, EF.CardAccess and EF.COM, when uploaded; not evidence in Phase 5. */
  readonly cardSecurity?: Uint8Array | undefined;
  readonly cardAccess?: Uint8Array | undefined;
  readonly com?: Uint8Array | undefined;
}

/** EF.SOD parsed (bounded, C62.1): what the submit guard and the reuse lookup read. */
export interface ParsedSod {
  /** `LDSSecurityObject` version: 0, or 1 with the LDS version info. */
  readonly version: 0 | 1;
  /** `null` when the SOD names a digest outside {@link HASH_ALGORITHMS}. */
  readonly hashAlgorithm: HashAlgorithm | null;
  /** The data groups the signed SOD lists, ascending (C62.2, C62.5). */
  readonly listedDataGroups: readonly DataGroupNumber[];
  /** How the SignerInfo names its DSC. */
  readonly signerIdentifier: 'subject_key_identifier' | 'issuer_and_serial';
  /** Whether the SOD embeds its DSC (C65.3: "DSC embedded or missing"). */
  readonly embedsDsc: boolean;
  /**
   * The SignerInfo signature value, as signed. Its blind index (`openverify/chip-sod/v1`) is the
   * sighting key of `id_nfc_repeat_detection` (C53.3, C62.6). PII-equivalent: never log it.
   */
  readonly signature: Uint8Array;
}

/** DG1: the MRZ exactly as the chip stores it (C62.1; the job calls `parseMrz`, no OCR fixes). */
export interface ParsedDg1 {
  /** 3 lines of 30 (TD1), 2 of 36 (TD2) or 2 of 44 (TD3). */
  readonly mrzLines: readonly string[];
}

/** DG2's face image (ISO/IEC 19794-5 or 39794-5), decoded by vision only after PA (C60.4). */
export interface ParsedDg2 {
  readonly format: 'iso19794-5' | 'iso39794-5';
  /**
   * `image/jpeg`, or `image/jp2` for JPEG 2000 (a JP2 file or a raw J2K codestream: vision
   * sniffs the bytes).
   */
  readonly mimeType: 'image/jpeg' | 'image/jp2';
  readonly image: Uint8Array;
  /** As the biometric header states them, `null` when it does not. */
  readonly width: number | null;
  readonly height: number | null;
}

/** DG15: the Active Authentication public key (C62.6). */
export interface ParsedDg15 {
  readonly keyAlgorithm: 'rsa' | 'ec';
  /** `SubjectPublicKeyInfo`, DER, as the chip stores it. */
  readonly spki: Uint8Array;
}

/**
 * One trust anchor as the repository's loader returns it (C62.8): already filtered for the
 * environment's kind (`sandbox_only` rows only for sandbox environments). `emrtd` never reads the
 * database and never fetches anything (C62.7).
 */
export interface TrustAnchor {
  readonly id: string;
  /** The CSCA (or verified link) certificate, DER. */
  readonly certificate: Uint8Array;
  /** ISO 3166-1 alpha-2 of the CSCA. */
  readonly country: string;
  /** Subject and authority key identifiers, lower-case hex; `null` when absent. */
  readonly ski: string | null;
  readonly aki: string | null;
  readonly isLink: boolean;
  readonly sandboxOnly: boolean;
  /** No enabled source lists it any more (C62.7): PA answers `trust_anchor_withdrawn`. */
  readonly withdrawn: boolean;
}

/** One CRL as the store holds it (C62.7), its signature already verified by the sync. */
export interface TrustCrl {
  readonly der: Uint8Array;
  readonly issuerCountry: string;
  /** The issuing CSCA key's identifier (AKI of the CRL), lower-case hex; `null` when absent. */
  readonly issuerKeyId: string | null;
  readonly thisUpdate: Date;
  readonly nextUpdate: Date | null;
}

/** What PA verifies against: the anchors and CRLs of the store, as loaded for this environment. */
export interface TrustStore {
  readonly anchors: readonly TrustAnchor[];
  readonly crls: readonly TrustCrl[];
}

/** C62.2: whether the data are the issuer's, judged apart from revocation. */
export const INTEGRITY_STATES = ['established', 'broken', 'not_established'] as const;
export type Integrity = (typeof INTEGRITY_STATES)[number];

/**
 * C62.2, C62.3: why integrity is `broken` (proven tampering: `failed`), or why it is not
 * established (a gap on our side or an issuer defect: review, never `failed`).
 */
export const INTEGRITY_BREAKS = ['sod_signature_invalid', 'dg_hash_mismatch'] as const;
export const INTEGRITY_GAPS = [
  /** DG1 was not uploaded, so its issuer cannot be checked against the DSC's country. */
  'input_missing',
  'trust_anchor_unavailable',
  'trust_anchor_withdrawn',
  'dsc_missing',
  'certificate_expired',
  'certificate_profile_invalid',
  'issuer_country_inconsistent',
  'algorithm_unsupported',
  'chip_data_malformed',
] as const;
export type IntegrityReason = (typeof INTEGRITY_BREAKS)[number] | (typeof INTEGRITY_GAPS)[number];

/** C62.2: the DSC's revocation, from the store's CRLs only (PA never fetches). */
export const REVOCATION_STATES = ['revoked', 'unrevoked', 'undetermined'] as const;
export type Revocation = (typeof REVOCATION_STATES)[number];

/** Why revocation is `undetermined`: no current CRL, or a CSCA that names no distribution point. */
export const REVOCATION_GAPS = ['crl_unavailable', 'no_distribution_point'] as const;
export type RevocationGap = (typeof REVOCATION_GAPS)[number];

/** C62.2: each data group against the signed SOD. */
export const DATA_GROUP_STATES = [
  'identical',
  'not_identical',
  /** The signed SOD lists it; the client did not upload it. */
  'missing_from_upload',
  /** Uploaded, but the SOD does not list it. */
  'not_listed',
] as const;
export type DataGroupState = (typeof DATA_GROUP_STATES)[number];

/** The anchor PA chose for the DSC (C62.2: AKI to SKI, else issuer DN when its key verifies). */
export interface ChosenAnchor {
  readonly id: string;
  readonly country: string;
  readonly matchedBy: 'aki' | 'issuer_dn';
  readonly isLink: boolean;
  readonly sandboxOnly: boolean;
}

/** `verifyPassiveAuthentication`'s answer (C62.2). Non-PII: `chip_reads.pa_summary` keeps it. */
export interface PassiveAuthenticationReport {
  readonly integrity: Integrity;
  /** `null` exactly when integrity is established. */
  readonly integrityReason: IntegrityReason | null;
  readonly revocation: Revocation;
  /** `null` unless revocation is undetermined. */
  readonly revocationGap: RevocationGap | null;
  /** Every data group uploaded or listed, with its state. */
  readonly dataGroups: Readonly<Partial<Record<DataGroupNumber, DataGroupState>>>;
  readonly hashAlgorithm: HashAlgorithm | null;
  /** The SOD signature algorithm's name, such as `ecdsa-with-sha256`; `null` when unread. */
  readonly signatureAlgorithm: string | null;
  readonly anchor: ChosenAnchor | null;
  /** The DSC's country and validity, `null` without a DSC. */
  readonly dsc: {
    readonly country: string | null;
    readonly notBefore: Date;
    readonly notAfter: Date;
    readonly embedded: boolean;
  } | null;
  /** DG1's issuing state (ICAO alpha-3, `UTO` for the specimen issuer); `null` when unread. */
  readonly issuingState: string | null;
  /** Kebab-case facts for metadata: `sha1`, `issuer-dn-match`, `link-anchor`, `sod-v0`, … */
  readonly flags: readonly string[];
}

/** Options of {@link PassiveAuthenticationReport}'s verification. */
export interface PassiveAuthenticationOptions {
  /** The verification time: certificates and CRLs are judged at it. */
  readonly now: Date;
  /** C51.3 `accept-sha1` (true by default, flagged). */
  readonly acceptSha1: boolean;
  /**
   * The ISO 3166-1 alpha-2 country of an ICAO issuer code (`UTO` for the specimen state is `UT`;
   * `D` is `DE`), or `null` for one without a country. PA compares DG1's issuer with the DSC's
   * and the CSCA's country through it (C62.2); `@openverify/checks` exports `nfcIssuerCountry`.
   */
  readonly issuerCountry: (icaoCode: string) => string | null;
  /** Defaults to `EMRTD_LIMITS.verificationTimeBudgetMs`. */
  readonly timeBudgetMs?: number | undefined;
  /**
   * C62.9: the self-test the caller already ran (at worker start); PA runs it once per process
   * when omitted. A failed self-test answers `algorithm_unsupported`.
   */
  readonly selfTest?: SelfTestResult | undefined;
}

/** C62.6: Active Authentication over this challenge's nonce. */
export interface ActiveAuthenticationInput {
  /** DG15 as uploaded, or `null`. Its key is trusted only with integrity established. */
  readonly dg15: Uint8Array | null;
  /** Whether the verified SOD lists DG15. */
  readonly dg15Listed: boolean;
  readonly integrity: Integrity;
  /** The challenge's 8 nonce bytes (C62.5). */
  readonly nonce: Uint8Array;
  /** The client's response, `null` when it sent none. */
  readonly response: Uint8Array | null;
  /**
   * DG14 as uploaded, when PA found it identical: its `ActiveAuthenticationInfo` names the digest
   * of a plain-ECDSA response. Without it every SHA-2 digest and SHA-1 is tried (a hint only: the
   * trusted DG15 key still has to verify the response over this nonce).
   */
  readonly dg14?: Uint8Array | null | undefined;
}

/**
 * C62.6: what the response proved.
 * - `verified`: it verifies under the DG15 key over this nonce;
 * - `failed`: a well-formed response that does not verify;
 * - `malformed`: a response that cannot be read;
 * - `withheld`: the SOD lists DG15 but no response came;
 * - `not_listed`: the verified SOD lists no DG15 (the chip has no AA key);
 * - `untrusted_key`: integrity is not established, so the DG15 key cannot be trusted.
 */
export const ACTIVE_AUTHENTICATION_OUTCOMES = [
  'verified',
  'failed',
  'malformed',
  'withheld',
  'not_listed',
  'untrusted_key',
] as const;
export type ActiveAuthenticationOutcome = (typeof ACTIVE_AUTHENTICATION_OUTCOMES)[number];

export interface ActiveAuthenticationReport {
  readonly outcome: ActiveAuthenticationOutcome;
  /** RSA ISO/IEC 9796-2 scheme 1, or plain ECDSA (`r || s`); `null` when not reached. */
  readonly scheme: 'rsa-iso9796-2' | 'ecdsa-plain' | null;
  readonly hashAlgorithm: HashAlgorithm | null;
}

/** C62.9: the self-test of explicit-parameter brainpool keys (at worker start and before a sync). */
export interface SelfTestResult {
  readonly ok: boolean;
  /** What failed, by name (`brainpoolP256r1-explicit`, …); empty when `ok`. */
  readonly failures: readonly string[];
  /** `process.versions.node` and `process.versions.openssl`, for the operator. */
  readonly node: string;
  readonly openssl: string;
}

/** An AlgorithmIdentifier as received: the OID and the original DER of its parameters. */
export interface AlgorithmIdentifierValue {
  readonly oid: string;
  /** `null` when the parameters are absent. */
  readonly parameters: Uint8Array | null;
}

/** An X.509 certificate parsed with its original bytes (C62.2, C62.7). Not PII. */
export interface ParsedCertificate {
  readonly der: Uint8Array;
  /** Lower-case hex SHA-256 of `der`. */
  readonly sha256: string;
  readonly subjectDn: string;
  readonly issuerDn: string;
  /** The DNs normalised for comparison: lower case, white space collapsed. */
  readonly subjectDnKey: string;
  readonly issuerDnKey: string;
  /** ISO 3166-1 alpha-2 from the subject, `null` when absent. */
  readonly country: string | null;
  /** Lower-case hex, without leading zero bytes. */
  readonly serialNumber: string;
  readonly ski: string | null;
  readonly aki: string | null;
  readonly notBefore: Date;
  readonly notAfter: Date;
  /** `basicConstraints` `cA`. */
  readonly isCa: boolean;
  /** RFC 5280 names, such as `digitalSignature`, `keyCertSign`, `cRLSign`; empty without the extension. */
  readonly keyUsage: readonly string[];
  /** EKU OIDs. */
  readonly extendedKeyUsage: readonly string[];
  /** CRL distribution point URLs, as written. */
  readonly crlDistributionPoints: readonly string[];
  /** Critical extensions the verifier does not understand (D.1.1.3: a profile defect). */
  readonly unknownCriticalExtensions: readonly string[];
  /** The original TBS bytes, signature algorithm, signature value and SPKI. */
  readonly tbs: Uint8Array;
  readonly signatureAlgorithm: AlgorithmIdentifierValue;
  readonly signatureValue: Uint8Array;
  readonly spki: Uint8Array;
}

/** A CRL parsed with its original bytes (C62.7). */
export interface ParsedCrl {
  readonly der: Uint8Array;
  readonly issuerDn: string;
  readonly issuerDnKey: string;
  /** ISO 3166-1 alpha-2 from the issuer, `null` when absent. */
  readonly issuerCountry: string | null;
  readonly issuerKeyId: string | null;
  readonly thisUpdate: Date;
  readonly nextUpdate: Date | null;
  /** The `cRLNumber` extension, decimal; `null` when absent. */
  readonly crlNumber: string | null;
  /** Revoked serial numbers, lower-case hex without leading zero bytes. */
  readonly revokedSerials: readonly string[];
  /** The original TBS bytes, signature algorithm and signature value. */
  readonly tbs: Uint8Array;
  readonly signatureAlgorithm: AlgorithmIdentifierValue;
  readonly signatureValue: Uint8Array;
}

/** A CSCA master list (CMS `SignedData`, eContentType 2.23.136.1.1.2), parsed (C62.7). */
export interface ParsedMasterList {
  readonly der: Uint8Array;
  readonly eContentType: string;
  readonly signingTime: Date | null;
  /** The master list signer, when the list embeds it. */
  readonly signer: ParsedCertificate | null;
  /** The listed CSCA and link certificates. */
  readonly certificates: readonly ParsedCertificate[];
  /** Listed certificates that could not be read (skipped; real lists hold a few, research §1.4). */
  readonly unreadableCertificates: number;
}

/** Why a master list did not verify against its pinned root (C62.7). */
export const MASTER_LIST_FAILURES = [
  'content_type_invalid',
  'signer_missing',
  'signer_profile_invalid',
  'signer_not_issued_by_root',
  'message_digest_mismatch',
  'signature_invalid',
  'signer_expired',
] as const;
export type MasterListFailure = (typeof MASTER_LIST_FAILURES)[number];

export type MasterListVerification =
  { readonly verified: true } | { readonly verified: false; readonly failure: MasterListFailure };
