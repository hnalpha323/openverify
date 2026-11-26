/**
 * C65.3: seeded test keys. An EC key's scalar is `seed mod n` (from a SHA-256 counter stream of
 * the seed), an RSA key's primes come from a seeded search confirmed by OpenSSL's primality test
 * (memoised per seed), and ECDSA signatures are RFC 6979 through `@noble/curves`, so the same
 * seed always gives the same key and the same EC signatures. No key file exists anywhere.
 */
import {
  checkPrimeSync,
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  type KeyObject,
} from 'node:crypto';
import type { ECDSA } from '@noble/curves/abstract/weierstrass.js';
import { brainpoolP256r1, brainpoolP384r1, brainpoolP512r1 } from '@noble/curves/misc.js';
import { p256, p384, p521 } from '@noble/curves/nist.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bitLength, bytesToBigInt, concatBytes, unsignedBytes } from '../bytes.js';
import {
  algorithmIdentifier,
  bitString,
  explicit,
  integer,
  nullValue,
  objectIdentifier,
  octetString,
  sequence,
} from '../der.js';
import { ecSpki, explicitEcParameters } from '../ec.js';
import { ALLOWED_CURVES } from '../limits.js';
import {
  ALGORITHM_OIDS,
  ECDSA_PLAIN_SIGNATURE_OIDS,
  ECDSA_SIGNATURE_OIDS,
  HASH_ALGORITHM_OIDS,
  RSA_PKCS1_SIGNATURE_OIDS,
} from '../oids.js';
import type { HashAlgorithm } from '../types.js';

/** The curves the builders sign on: the allowlisted ones Phase 5 tests, and one outside it. */
export const TEST_CURVES = [
  'brainpoolP256r1',
  'brainpoolP384r1',
  'brainpoolP512r1',
  'P-256',
  'P-384',
  'P-521',
  'secp256k1',
] as const;
export type TestCurve = (typeof TEST_CURVES)[number];

/**
 * A synthetic key: an EC curve (named, or with explicit parameters), RSA of 1,024 to 4,096 bits,
 * or `oversized-rsa`, a 16,384-bit public modulus with no private key behind it (C65.3: "a
 * 16,384-bit modulus"); its `privateKey` is a stand-in RSA-2048 key, so what it signs never
 * verifies.
 */
export type TestKeySpec =
  | { readonly kind: 'ec'; readonly curve: TestCurve; readonly explicitParameters?: boolean }
  | { readonly kind: 'rsa'; readonly bits: number }
  | { readonly kind: 'oversized-rsa' };

export interface TestKeyPair {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  /** `SubjectPublicKeyInfo`, DER (explicit EC parameters when the spec asks for them). */
  readonly spki: Uint8Array;
  readonly seed: string;
  readonly spec: TestKeySpec;
}

/** How a builder signs: the digest, and the RSA or ECDSA encoding. */
export interface TestSignatureScheme {
  /** Defaults to SHA-256, or the curve's own digest for EC keys over 256 bits. */
  readonly hash?: HashAlgorithm | undefined;
  /** RSASSA-PKCS1-v1_5 named by digest (the default), RSASSA-PSS, or `rsaEncryption`. */
  readonly rsa?: 'pkcs1' | 'pss' | 'rsa-encryption' | undefined;
  /** X9.62 DER (the default) or BSI plain `r || s`. */
  readonly ec?: 'der' | 'plain' | undefined;
}

/** A signature and the AlgorithmIdentifier (DER) that names it. */
export interface TestSignature {
  readonly value: Uint8Array;
  readonly algorithm: Uint8Array;
}

interface CurveEntry {
  readonly noble: ECDSA;
  readonly oid: string;
  readonly hash: HashAlgorithm;
}

const allowedOid = (name: string): string =>
  ALLOWED_CURVES.find((curve) => curve.name === name)?.oid ?? '';

const CURVES: Readonly<Record<TestCurve, CurveEntry>> = {
  brainpoolP256r1: { noble: brainpoolP256r1, oid: allowedOid('brainpoolP256r1'), hash: 'sha256' },
  brainpoolP384r1: { noble: brainpoolP384r1, oid: allowedOid('brainpoolP384r1'), hash: 'sha384' },
  brainpoolP512r1: { noble: brainpoolP512r1, oid: allowedOid('brainpoolP512r1'), hash: 'sha512' },
  'P-256': { noble: p256, oid: allowedOid('P-256'), hash: 'sha256' },
  'P-384': { noble: p384, oid: allowedOid('P-384'), hash: 'sha384' },
  'P-521': { noble: p521, oid: allowedOid('P-521'), hash: 'sha512' },
  secp256k1: { noble: secp256k1, oid: ALGORITHM_OIDS.secp256k1, hash: 'sha256' },
};

const HASH_BYTES: Readonly<Record<HashAlgorithm, number>> = {
  sha1: 20,
  sha224: 28,
  sha256: 32,
  sha384: 48,
  sha512: 64,
};

type Secret =
  | { readonly kind: 'ec'; readonly curve: TestCurve; readonly scalar: Uint8Array }
  | { readonly kind: 'rsa' };

const SECRETS = new WeakMap<TestKeyPair, Secret>();
const KEYS = new Map<string, TestKeyPair>();
const PRIMES = new Map<string, bigint>();

/** `length` bytes from a SHA-256 counter stream of `label`. */
export function seededBytes(label: string, length: number): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (let counter = 0; blocks.length * 32 < length; counter += 1) {
    blocks.push(
      new Uint8Array(
        createHash('sha256')
          .update(`${label}/${String(counter)}`)
          .digest(),
      ),
    );
  }
  return concatBytes(...blocks).slice(0, length);
}

function ecKey(seed: string, curve: TestCurve, explicitParameters: boolean): TestKeyPair {
  const entry = CURVES[curve];
  const parameters = entry.noble.Point.CURVE();
  const scalarBytes = Math.ceil(bitLength(parameters.n) / 8);
  const stream = bytesToBigInt(seededBytes(`${seed}/ec/${curve}`, scalarBytes + 8));
  const scalar = unsignedBytes((stream % (parameters.n - 1n)) + 1n, scalarBytes);
  const point = entry.noble.getPublicKey(scalar, false);
  const spki = ecSpki(
    explicitParameters ? explicitEcParameters(parameters) : objectIdentifier(entry.oid),
    point,
  );
  const pkcs8 = sequence(
    integer(0),
    algorithmIdentifier(ALGORITHM_OIDS.ecPublicKey, objectIdentifier(entry.oid)),
    octetString(sequence(integer(1), octetString(scalar), explicit(1, bitString(point)))),
  );
  const pair: TestKeyPair = {
    privateKey: createPrivateKey({ key: Buffer.from(pkcs8), format: 'der', type: 'pkcs8' }),
    publicKey: createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' }),
    spki,
    seed,
    spec: { kind: 'ec', curve, explicitParameters },
  };
  SECRETS.set(pair, { kind: 'ec', curve, scalar });
  return pair;
}

/** The odd primes below 4,096, for a sieve before OpenSSL's primality test. */
const SMALL_PRIMES: readonly number[] = (() => {
  const limit = 4096;
  const composite = new Uint8Array(limit);
  const primes: number[] = [];
  for (let value = 3; value < limit; value += 2) {
    if (composite[value] === 0) {
      primes.push(value);
      for (let multiple = value * value; multiple < limit; multiple += 2 * value) {
        composite[multiple] = 1;
      }
    }
  }
  return primes;
})();

const RSA_EXPONENT = 65537n;

/** The first prime of `bits` bits at or after a seeded start, with `e` coprime to `p - 1`. */
function seededPrime(label: string, bits: number): bigint {
  const memo = PRIMES.get(label);
  if (memo !== undefined) {
    return memo;
  }
  const start = bytesToBigInt(seededBytes(label, bits / 8)) | (3n << BigInt(bits - 2)) | 1n;
  const residues = SMALL_PRIMES.map((prime) => Number(start % BigInt(prime)));
  for (let step = 0; ; step += 2) {
    if (residues.some((residue, index) => (residue + step) % (SMALL_PRIMES[index] ?? 1) === 0)) {
      continue;
    }
    const candidate = start + BigInt(step);
    if ((candidate - 1n) % RSA_EXPONENT !== 0n && checkPrimeSync(candidate)) {
      PRIMES.set(label, candidate);
      return candidate;
    }
  }
}

function modInverse(value: bigint, modulus: bigint): bigint {
  let [oldR, r] = [value % modulus, modulus];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const quotient = oldR / r;
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
  }
  return ((oldS % modulus) + modulus) % modulus;
}

const base64url = (value: bigint) => Buffer.from(unsignedBytes(value)).toString('base64url');

function rsaKey(seed: string, bits: number): TestKeyPair {
  const p = seededPrime(`${seed}/rsa/${String(bits)}/p`, bits / 2);
  const q = seededPrime(`${seed}/rsa/${String(bits)}/q`, bits / 2);
  const d = modInverse(RSA_EXPONENT, (p - 1n) * (q - 1n));
  const privateKey = createPrivateKey({
    key: {
      kty: 'RSA',
      n: base64url(p * q),
      e: base64url(RSA_EXPONENT),
      d: base64url(d),
      p: base64url(p),
      q: base64url(q),
      dp: base64url(d % (p - 1n)),
      dq: base64url(d % (q - 1n)),
      qi: base64url(modInverse(q, p)),
    },
    format: 'jwk',
  });
  const publicKey = createPublicKey(privateKey);
  const pair: TestKeyPair = {
    privateKey,
    publicKey,
    spki: new Uint8Array(publicKey.export({ type: 'spki', format: 'der' })),
    seed,
    spec: { kind: 'rsa', bits },
  };
  SECRETS.set(pair, { kind: 'rsa' });
  return pair;
}

function oversizedKey(seed: string): TestKeyPair {
  const modulus = bytesToBigInt(seededBytes(`${seed}/oversized`, 2048)) | (1n << 16_383n) | 1n;
  const spki = sequence(
    algorithmIdentifier(ALGORITHM_OIDS.rsaEncryption, nullValue()),
    bitString(sequence(integer(modulus), integer(RSA_EXPONENT))),
  );
  const pair: TestKeyPair = {
    privateKey: testKeyPair(`${seed}/stand-in`, { kind: 'rsa', bits: 2048 }).privateKey,
    publicKey: createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' }),
    spki,
    seed,
    spec: { kind: 'oversized-rsa' },
  };
  SECRETS.set(pair, { kind: 'rsa' });
  return pair;
}

/** A key derived from `seed`: the same seed and spec always give the same key. */
export function testKeyPair(seed: string, spec: TestKeySpec): TestKeyPair {
  const memoKey = `${seed}\u0000${JSON.stringify(
    spec.kind === 'ec' ? { ...spec, explicitParameters: spec.explicitParameters === true } : spec,
  )}`;
  const memo = KEYS.get(memoKey);
  if (memo !== undefined) {
    return memo;
  }
  let pair: TestKeyPair;
  if (spec.kind === 'ec') {
    if (!Object.hasOwn(CURVES, spec.curve)) {
      throw new RangeError('no test key on that curve');
    }
    pair = ecKey(seed, spec.curve, spec.explicitParameters === true);
  } else if (spec.kind === 'rsa') {
    if (!Number.isInteger(spec.bits) || spec.bits < 1024 || spec.bits > 4096 || spec.bits % 16) {
      throw new RangeError('test RSA keys have 1,024 to 4,096 bits, a multiple of 16');
    }
    pair = rsaKey(seed, spec.bits);
  } else {
    pair = oversizedKey(seed);
  }
  KEYS.set(memoKey, pair);
  return pair;
}

function pssParameters(hash: HashAlgorithm): Uint8Array {
  const digest = algorithmIdentifier(HASH_ALGORITHM_OIDS[hash], nullValue());
  return sequence(
    explicit(0, digest),
    explicit(1, algorithmIdentifier(ALGORITHM_OIDS.mgf1, digest)),
    explicit(2, integer(HASH_BYTES[hash])),
  );
}

function secretOf(key: TestKeyPair): Secret {
  const secret = SECRETS.get(key);
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (secret === undefined) {
    throw new RangeError('not a test key');
  }
  return secret;
}

/** The digest a key signs with under `scheme`. */
function hashFor(secret: Secret, scheme: TestSignatureScheme): HashAlgorithm {
  return scheme.hash ?? (secret.kind === 'ec' ? CURVES[secret.curve].hash : 'sha256');
}

/** The AlgorithmIdentifier (DER) {@link testSign} names for this key and scheme. */
export function testSignatureAlgorithm(
  key: TestKeyPair,
  scheme: TestSignatureScheme = {},
): Uint8Array {
  const secret = secretOf(key);
  const hash = hashFor(secret, scheme);
  if (secret.kind === 'ec') {
    return algorithmIdentifier(
      scheme.ec === 'plain' ? ECDSA_PLAIN_SIGNATURE_OIDS[hash] : ECDSA_SIGNATURE_OIDS[hash],
    );
  }
  if (scheme.rsa === 'pss') {
    return algorithmIdentifier(ALGORITHM_OIDS.rsassaPss, pssParameters(hash));
  }
  return algorithmIdentifier(
    scheme.rsa === 'rsa-encryption' ? ALGORITHM_OIDS.rsaEncryption : RSA_PKCS1_SIGNATURE_OIDS[hash],
    nullValue(),
  );
}

function signatureValue(
  key: TestKeyPair,
  secret: Secret,
  data: Uint8Array,
  scheme: TestSignatureScheme,
): Uint8Array {
  const hash = hashFor(secret, scheme);
  if (secret.kind === 'ec') {
    const digest = createHash(hash).update(data).digest();
    return ecdsaSignDigest(
      secret.curve,
      secret.scalar,
      digest,
      scheme.ec === 'plain' ? 'plain' : 'der',
    );
  }
  return new Uint8Array(
    nodeSign(
      hash,
      data,
      scheme.rsa === 'pss'
        ? {
            key: key.privateKey,
            padding: constants.RSA_PKCS1_PSS_PADDING,
            saltLength: HASH_BYTES[hash],
          }
        : { key: key.privateKey, padding: constants.RSA_PKCS1_PADDING },
    ),
  );
}

/**
 * KP10-40 (Workflow 10D): an ECDSA signature by the private key `scalar` on `curve` over `digest`,
 * a message's hash computed elsewhere: the signature the key gives over the message itself. RFC
 * 6979 through `@noble/curves` (deterministic; `s` is written as the lower of `s` and `n - s`), as
 * X9.62 DER or BSI plain `r || s`. For synthetic test keys only.
 */
export function ecdsaSignDigest(
  curve: TestCurve,
  scalar: Uint8Array,
  digest: Uint8Array,
  encoding: 'der' | 'plain' = 'der',
): Uint8Array {
  return CURVES[curve].noble.sign(digest, scalar, {
    prehash: false,
    format: encoding === 'plain' ? 'compact' : 'der',
  });
}

/**
 * KP10-40 (Workflow 10D): the signature of an EC test key over `digest`, the hash of a message
 * under the scheme's digest (SHA-256, or the curve's own for a key over 256 bits, unless
 * `scheme.hash` names one). It equals {@link testSign} over the message, for a caller that holds
 * only the hash: the sandbox test chip signs a challenge whose row keeps the nonce's SHA-256.
 * @throws {RangeError} for a key that is not an EC test key, or a digest of another length.
 */
export function testSignDigest(
  key: TestKeyPair,
  digest: Uint8Array,
  scheme: Pick<TestSignatureScheme, 'hash' | 'ec'> = {},
): Uint8Array {
  const secret = secretOf(key);
  if (secret.kind !== 'ec') {
    throw new RangeError('a prehashed signature needs an EC test key');
  }
  if (digest.length !== HASH_BYTES[hashFor(secret, scheme)]) {
    throw new RangeError('the digest does not have the length of the hash the scheme names');
  }
  return ecdsaSignDigest(
    secret.curve,
    secret.scalar,
    digest,
    scheme.ec === 'plain' ? 'plain' : 'der',
  );
}

/** Signs `data` with a test key. */
export function testSign(
  key: TestKeyPair,
  data: Uint8Array,
  scheme: TestSignatureScheme = {},
): TestSignature {
  const secret = secretOf(key);
  return {
    value: signatureValue(key, secret, data, scheme),
    algorithm: testSignatureAlgorithm(key, scheme),
  };
}
