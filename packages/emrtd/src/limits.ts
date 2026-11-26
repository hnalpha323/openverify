/**
 * C62.1 (P19): the bounds every chip file and key is held to before and while it is parsed. They
 * are provisional and ours unless a source is named; `emrtd` enforces them.
 */

export interface EmrtdLimits {
  /** The bounded TLV pre-scan that runs before asn1js on every chip file. */
  readonly tlvMaxDepth: number;
  readonly tlvMaxNodes: number;
  /** RSA moduli and public exponents (an exponent must be below 2^32). */
  readonly rsaMinModulusBits: number;
  readonly rsaMaxModulusBits: number;
  readonly rsaMaxPublicExponent: bigint;
  /** EC field sizes; explicit domain parameters only when they equal an allowlisted curve. */
  readonly ecMaxFieldBits: number;
  /** Each verification's time budget (ours, provisional). */
  readonly verificationTimeBudgetMs: number;
}

export const EMRTD_LIMITS: EmrtdLimits = Object.freeze({
  // C62.1: a chip file nests a few levels deep; DG2 holds one or two images.
  tlvMaxDepth: 32,
  tlvMaxNodes: 20_000,
  // C62.1 (P19): ICAO keys in the four free master lists are RSA 2,048-4,096 and EC 192-521
  // (docs/research/phase5-nfc.md §3.2); the bounds leave room on both sides.
  rsaMinModulusBits: 1024,
  rsaMaxModulusBits: 8192,
  rsaMaxPublicExponent: 2n ** 32n - 1n,
  ecMaxFieldBits: 521,
  // Ours, provisional: a few signature checks through node:crypto take milliseconds; the budget
  // only stops a pathological input, so it is generous enough for a loaded CI runner.
  verificationTimeBudgetMs: 5000,
});

/** C62.1: the curves explicit EC domain parameters may equal (brainpool and NIST). */
export interface AllowedCurve {
  readonly name: string;
  /** The named curve's OID. */
  readonly oid: string;
  readonly fieldBits: number;
  /**
   * The name OpenSSL gives the curve (`KeyObject.asymmetricKeyDetails.namedCurve`), also for
   * explicit parameters it recognised as this curve's.
   */
  readonly opensslName: string;
}

export const ALLOWED_CURVES: readonly AllowedCurve[] = Object.freeze([
  // RFC 5639 brainpool r1 curves (the ones ICAO lists carry, often as explicit parameters).
  {
    name: 'brainpoolP192r1',
    oid: '1.3.36.3.3.2.8.1.1.3',
    fieldBits: 192,
    opensslName: 'brainpoolP192r1',
  },
  {
    name: 'brainpoolP224r1',
    oid: '1.3.36.3.3.2.8.1.1.5',
    fieldBits: 224,
    opensslName: 'brainpoolP224r1',
  },
  {
    name: 'brainpoolP256r1',
    oid: '1.3.36.3.3.2.8.1.1.7',
    fieldBits: 256,
    opensslName: 'brainpoolP256r1',
  },
  {
    name: 'brainpoolP320r1',
    oid: '1.3.36.3.3.2.8.1.1.9',
    fieldBits: 320,
    opensslName: 'brainpoolP320r1',
  },
  {
    name: 'brainpoolP384r1',
    oid: '1.3.36.3.3.2.8.1.1.11',
    fieldBits: 384,
    opensslName: 'brainpoolP384r1',
  },
  {
    name: 'brainpoolP512r1',
    oid: '1.3.36.3.3.2.8.1.1.13',
    fieldBits: 512,
    opensslName: 'brainpoolP512r1',
  },
  // NIST FIPS 186 prime curves.
  { name: 'P-192', oid: '1.2.840.10045.3.1.1', fieldBits: 192, opensslName: 'prime192v1' },
  { name: 'P-224', oid: '1.3.132.0.33', fieldBits: 224, opensslName: 'secp224r1' },
  { name: 'P-256', oid: '1.2.840.10045.3.1.7', fieldBits: 256, opensslName: 'prime256v1' },
  { name: 'P-384', oid: '1.3.132.0.34', fieldBits: 384, opensslName: 'secp384r1' },
  { name: 'P-521', oid: '1.3.132.0.35', fieldBits: 521, opensslName: 'secp521r1' },
] as const);

/**
 * C62.7: the caps of a CSCA master list, which the trust-store sync downloads (16 MiB, C54.6) and
 * which holds hundreds of certificates (the BSI list: 609, research §3.2), far past a chip
 * file's 20,000 nodes. Ours, provisional: about 150 TLVs per certificate leave room for 6,000.
 */
export const MASTER_LIST_LIMITS = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 1_000_000,
});
