/**
 * Explicit EC domain parameters (X9.62 `SpecifiedECDomain` over a prime field, with the cofactor
 * Doc 9303-12 §4.1.6.3 requires) and EC `SubjectPublicKeyInfo`, written for the self-test's keys
 * and the test builders. The verifier never writes keys; it imports what it receives.
 */
import { bitLength, concatBytes, unsignedBytes } from './bytes.js';
import { bitString, integer, objectIdentifier, octetString, sequence } from './der.js';
import { ALGORITHM_OIDS } from './oids.js';

/** A short Weierstrass curve over a prime field: `y² = x³ + ax + b`, base point, order, cofactor. */
export interface EcCurveParameters {
  readonly p: bigint;
  readonly a: bigint;
  readonly b: bigint;
  readonly Gx: bigint;
  readonly Gy: bigint;
  readonly n: bigint;
  readonly h: bigint;
}

/** `SpecifiedECDomain` (version 1), the field elements at the field's byte length. */
export function explicitEcParameters(curve: EcCurveParameters): Uint8Array {
  const length = Math.ceil(bitLength(curve.p) / 8);
  const element = (value: bigint) => unsignedBytes(value, length);
  return sequence(
    integer(1),
    sequence(objectIdentifier(ALGORITHM_OIDS.primeField), integer(curve.p)),
    sequence(octetString(element(curve.a)), octetString(element(curve.b))),
    octetString(concatBytes(new Uint8Array([4]), element(curve.Gx), element(curve.Gy))),
    integer(curve.n),
    integer(curve.h),
  );
}

/** An EC SPKI over `parameters` (a named curve's OID TLV, or explicit parameters). */
export function ecSpki(parameters: Uint8Array, point: Uint8Array): Uint8Array {
  return sequence(
    sequence(objectIdentifier(ALGORITHM_OIDS.ecPublicKey), parameters),
    bitString(point),
  );
}
