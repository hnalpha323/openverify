/** The ICAO object identifiers the verifier reads (Doc 9303-10, -11, -12). */
export const ICAO_OIDS = Object.freeze({
  /** `id-icao-mrtd-security-ldsSecurityObject`: the SOD's eContentType. */
  ldsSecurityObject: '2.23.136.1.1.1',
  /** `id-icao-cscaMasterList`: a master list's eContentType (C62.7). */
  cscaMasterList: '2.23.136.1.1.2',
  /** `id-icao-cscaMasterListSigningKey`: the master list signer's EKU (C62.7). */
  cscaMasterListSigningKey: '2.23.136.1.1.3',
  /** `id-icao-mrtd-security-extensions-documentTypeList` (Doc 9303-12 §7.1.1.2). */
  documentTypeList: '2.23.136.1.1.6.2',
});

/** The digest algorithms by OID (NIST CSOR, OIW for SHA-1). */
export const HASH_ALGORITHM_OIDS = Object.freeze({
  sha1: '1.3.14.3.2.26',
  sha224: '2.16.840.1.101.3.4.2.4',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',
} as const);

/** The key and signature algorithm OIDs the verifier and the test builders name. */
export const ALGORITHM_OIDS = Object.freeze({
  /** RFC 5480 `id-ecPublicKey` and the X9.62 prime field. */
  ecPublicKey: '1.2.840.10045.2.1',
  primeField: '1.2.840.10045.1.1',
  characteristicTwoField: '1.2.840.10045.1.2',
  /** SEC 2 secp256k1: a named curve outside the C62.1 allowlist. */
  secp256k1: '1.3.132.0.10',
  /** RFC 8017 `rsaEncryption`, RSASSA-PSS and MGF1. */
  rsaEncryption: '1.2.840.113549.1.1.1',
  rsassaPss: '1.2.840.113549.1.1.10',
  mgf1: '1.2.840.113549.1.1.8',
  /** FIPS 186 DSA: not supported by the verifier (Doc 9303-12 §4.1.6.2 allows it; none seen). */
  dsa: '1.2.840.10040.4.1',
} as const);

/** X9.62 ECDSA with a DER-encoded signature, by digest. */
export const ECDSA_SIGNATURE_OIDS = Object.freeze({
  sha1: '1.2.840.10045.4.1',
  sha224: '1.2.840.10045.4.3.1',
  sha256: '1.2.840.10045.4.3.2',
  sha384: '1.2.840.10045.4.3.3',
  sha512: '1.2.840.10045.4.3.4',
} as const);

/** BSI TR-03111 §5.2.1 plain ECDSA (`r || s`), by digest: Active Authentication's format. */
export const ECDSA_PLAIN_SIGNATURE_OIDS = Object.freeze({
  sha1: '0.4.0.127.0.7.1.1.4.1.1',
  sha224: '0.4.0.127.0.7.1.1.4.1.2',
  sha256: '0.4.0.127.0.7.1.1.4.1.3',
  sha384: '0.4.0.127.0.7.1.1.4.1.4',
  sha512: '0.4.0.127.0.7.1.1.4.1.5',
} as const);

/** RFC 8017 RSASSA-PKCS1-v1_5, by digest. */
export const RSA_PKCS1_SIGNATURE_OIDS = Object.freeze({
  sha1: '1.2.840.113549.1.1.5',
  sha224: '1.2.840.113549.1.1.14',
  sha256: '1.2.840.113549.1.1.11',
  sha384: '1.2.840.113549.1.1.12',
  sha512: '1.2.840.113549.1.1.13',
} as const);

/** Doc 9303-11 §6.1: `id-icao-mrtd-security-aaProtocolObject`, DG14's ActiveAuthenticationInfo. */
export const ACTIVE_AUTHENTICATION_PROTOCOL_OID = '2.23.136.1.1.5';

/** RFC 5652: the SignedData content type and the signed attributes PA reads. */
export const CMS_OIDS = Object.freeze({
  signedData: '1.2.840.113549.1.7.2',
  data: '1.2.840.113549.1.7.1',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
});
