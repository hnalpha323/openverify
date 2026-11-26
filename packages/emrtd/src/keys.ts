/**
 * C62.1 (P19): public keys under the key and curve bounds, imported into `node:crypto`. Every
 * key the verifier uses (a CSCA's, a DSC's, DG15's) comes through {@link importPublicKey}:
 * - RSA (`rsaEncryption` or RSASSA-PSS): a modulus of 1,024 to 8,192 bits and an odd public
 *   exponent from 3 to below 2^32, read from the SPKI before OpenSSL sees it;
 * - EC (`id-ecPublicKey`): a named curve on `ALLOWED_CURVES`, or explicit domain parameters over
 *   a prime field of at most 521 bits that OpenSSL recognises as an allowlisted curve's exact
 *   parameters (Doc 9303-12 §4.1.6.3 requires explicit parameters; RFC 5480 forbids them, so
 *   only an exact match with a known curve is accepted);
 * - anything else (DSA, a characteristic-two field, implicitly-CA parameters, another curve):
 *   `algorithm_unsupported`. A structurally broken key is `chip_data_malformed`.
 */
import { createPublicKey, type KeyObject } from 'node:crypto';
import {
  bigintOf,
  bitStringOf,
  childrenOf,
  decodeAsn1,
  isUniversal,
  oidOf,
  type Asn1,
} from './asn1.js';
import { bitLength } from './bytes.js';
import { EmrtdError } from './errors.js';
import { ALLOWED_CURVES, EMRTD_LIMITS, type AllowedCurve } from './limits.js';
import { ALGORITHM_OIDS } from './oids.js';

/** A public key that passed the bounds. */
export interface PublicKeyImport {
  readonly kind: 'rsa' | 'ec';
  readonly key: KeyObject;
  /** The allowlisted curve of an EC key; `null` for RSA. */
  readonly curve: AllowedCurve | null;
  /** Whether an EC key carried explicit domain parameters. */
  readonly explicitParameters: boolean;
  /** The RSA modulus bits, or the EC field bits. */
  readonly bits: number;
}

const SEQUENCE = 16;
const NULL = 5;

function unsupported(step: string): never {
  throw new EmrtdError('algorithm_unsupported', step);
}

function malformed(step: string): never {
  throw new EmrtdError('chip_data_malformed', step);
}

/** OpenSSL's reading of the SPKI, or `null` when it refuses it. */
function nodeKey(spki: Uint8Array): KeyObject | null {
  try {
    return createPublicKey({ key: Buffer.from(spki), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

function importRsa(spki: Uint8Array, keyBits: Uint8Array, step: string): PublicKeyImport {
  const rsaKey = decodeAsn1(keyBits, step);
  const members = isUniversal(rsaKey, SEQUENCE) ? childrenOf(rsaKey, step) : malformed(step);
  const [modulusBlock, exponentBlock] = members;
  if (members.length !== 2 || modulusBlock === undefined || exponentBlock === undefined) {
    malformed(step);
  }
  const modulus = bigintOf(modulusBlock, step);
  const exponent = bigintOf(exponentBlock, step);
  if (modulus <= 0n || exponent <= 0n) {
    malformed(step);
  }
  const bits = bitLength(modulus);
  if (
    bits < EMRTD_LIMITS.rsaMinModulusBits ||
    bits > EMRTD_LIMITS.rsaMaxModulusBits ||
    exponent < 3n ||
    exponent % 2n === 0n ||
    exponent > EMRTD_LIMITS.rsaMaxPublicExponent
  ) {
    unsupported(step);
  }
  const key = nodeKey(spki) ?? malformed(step);
  return { kind: 'rsa', key, curve: null, explicitParameters: false, bits };
}

function curveNamed(key: KeyObject): AllowedCurve | null {
  const name = key.asymmetricKeyDetails?.namedCurve;
  return ALLOWED_CURVES.find((curve) => curve.opensslName === name) ?? null;
}

function importEc(spki: Uint8Array, parameters: Asn1 | undefined, step: string): PublicKeyImport {
  if (parameters === undefined || isUniversal(parameters, NULL)) {
    unsupported(step);
  }
  if (!isUniversal(parameters, SEQUENCE)) {
    const oid = oidOf(parameters, step);
    const curve = ALLOWED_CURVES.find((entry) => entry.oid === oid) ?? unsupported(step);
    const key = nodeKey(spki) ?? malformed(step);
    if (curveNamed(key) !== curve) {
      unsupported(step);
    }
    return { kind: 'ec', key, curve, explicitParameters: false, bits: curve.fieldBits };
  }
  // SpecifiedECDomain: version, fieldID { fieldType, prime }, curve, base, order, cofactor.
  const fieldId = childrenOf(parameters, step)[1] ?? malformed(step);
  const [fieldType, prime] = isUniversal(fieldId, SEQUENCE)
    ? childrenOf(fieldId, step)
    : malformed(step);
  if (fieldType === undefined || oidOf(fieldType, step) !== ALGORITHM_OIDS.primeField) {
    unsupported(step);
  }
  if (prime === undefined || bitLength(bigintOf(prime, step)) > EMRTD_LIMITS.ecMaxFieldBits) {
    unsupported(step);
  }
  // OpenSSL refuses parameters it cannot use and names the curve whose parameters these equal.
  const key = nodeKey(spki) ?? unsupported(step);
  const curve = curveNamed(key) ?? unsupported(step);
  return { kind: 'ec', key, curve, explicitParameters: true, bits: curve.fieldBits };
}

/**
 * Imports a `SubjectPublicKeyInfo` within the C62.1 bounds.
 * @throws {EmrtdError} `algorithm_unsupported` outside the bounds, `chip_data_malformed` for a
 * key that cannot be read; the message names `step`.
 */
export function importPublicKey(spki: Uint8Array, step: string): PublicKeyImport {
  const info = decodeAsn1(spki, step);
  const members = isUniversal(info, SEQUENCE) ? childrenOf(info, step) : malformed(step);
  const [algorithm, subjectPublicKey] = members;
  if (members.length !== 2 || algorithm === undefined || subjectPublicKey === undefined) {
    malformed(step);
  }
  const [oidBlock, parameters] = isUniversal(algorithm, SEQUENCE)
    ? childrenOf(algorithm, step)
    : malformed(step);
  const oid = oidOf(oidBlock ?? malformed(step), step);
  const keyBits = bitStringOf(subjectPublicKey, step);
  switch (oid) {
    case ALGORITHM_OIDS.rsaEncryption:
    case ALGORITHM_OIDS.rsassaPss:
      return importRsa(spki, keyBits, step);
    case ALGORITHM_OIDS.ecPublicKey:
      return importEc(spki, parameters, step);
    default:
      return unsupported(step);
  }
}
