/**
 * C62.1 (P19): the key and curve bounds. RSA 1,024-8,192 bits with an odd exponent below 2^32;
 * EC only on an allowlisted curve, named or as explicit parameters equal to its own; everything
 * else `algorithm_unsupported`, and an unreadable key `chip_data_malformed`. Keys are the seeded
 * test keys or written by hand with the DER writer.
 */
import { brainpoolP256r1 } from '@noble/curves/misc.js';
import { describe, expect, it } from 'vitest';
import { concatBytes, fromHex, unsignedBytes } from './bytes.js';
import {
  algorithmIdentifier,
  bitString,
  integer,
  nullValue,
  objectIdentifier,
  octetString,
  sequence,
} from './der.js';
import { EmrtdError } from './errors.js';
import { importPublicKey } from './keys.js';
import { ALLOWED_CURVES } from './limits.js';
import { ALGORITHM_OIDS } from './oids.js';
import { testKeyPair, type TestKeySpec } from './testing/keys.js';

function codeOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    if (error instanceof EmrtdError) {
      expect(error.message).toBe(`keyTest: ${error.code}`);
      return error.code;
    }
    throw error;
  }
  return 'none';
}

const rsaSpki = (modulus: bigint, exponent: bigint) =>
  sequence(
    algorithmIdentifier(ALGORITHM_OIDS.rsaEncryption, nullValue()),
    bitString(sequence(integer(modulus), integer(exponent))),
  );

const ecSpki = (parameters: Uint8Array, point: Uint8Array) =>
  sequence(sequence(objectIdentifier(ALGORITHM_OIDS.ecPublicKey), parameters), bitString(point));

describe('importPublicKey: accepted keys (C62.1)', () => {
  it.each([
    [{ kind: 'ec', curve: 'brainpoolP256r1', explicitParameters: true }, 'brainpoolP256r1', 256],
    [{ kind: 'ec', curve: 'brainpoolP384r1', explicitParameters: true }, 'brainpoolP384r1', 384],
    [{ kind: 'ec', curve: 'brainpoolP512r1', explicitParameters: true }, 'brainpoolP512r1', 512],
    [{ kind: 'ec', curve: 'brainpoolP256r1' }, 'brainpoolP256r1', 256],
    [{ kind: 'ec', curve: 'P-256' }, 'P-256', 256],
    [{ kind: 'ec', curve: 'P-256', explicitParameters: true }, 'P-256', 256],
    [{ kind: 'ec', curve: 'P-384' }, 'P-384', 384],
    [{ kind: 'ec', curve: 'P-521', explicitParameters: true }, 'P-521', 521],
  ] as const satisfies readonly (readonly [TestKeySpec, string, number])[])(
    'takes EC %j as %s',
    (spec: TestKeySpec, curve, bits) => {
      const imported = importPublicKey(testKeyPair('bounds', spec).spki, 'keyTest');
      expect(imported).toMatchObject({
        kind: 'ec',
        curve: ALLOWED_CURVES.find((entry) => entry.name === curve),
        explicitParameters: spec.kind === 'ec' && spec.explicitParameters === true,
        bits,
      });
      expect(imported.key.asymmetricKeyType).toBe('ec');
    },
  );

  it.each([1024, 2048])('takes RSA-%i', (bits) => {
    const imported = importPublicKey(testKeyPair('bounds', { kind: 'rsa', bits }).spki, 'keyTest');
    expect(imported).toMatchObject({ kind: 'rsa', curve: null, explicitParameters: false, bits });
  });

  it('takes the bounds themselves: 8,192 bits and an exponent of 2^32 - 1', () => {
    const modulus = (1n << 8191n) | 1n;
    expect(importPublicKey(rsaSpki(modulus, 2n ** 32n - 1n), 'keyTest').bits).toBe(8192);
  });

  it('takes an RSASSA-PSS key', () => {
    const spki = sequence(
      algorithmIdentifier(ALGORITHM_OIDS.rsassaPss),
      bitString(sequence(integer((1n << 2047n) | 1n), integer(65537))),
    );
    expect(importPublicKey(spki, 'keyTest')).toMatchObject({ kind: 'rsa', bits: 2048 });
  });
});

describe('importPublicKey: refused keys (C62.1, P19)', () => {
  it('refuses a 16,384-bit modulus and moduli under 1,024 bits', () => {
    expect(
      codeOf(() =>
        importPublicKey(testKeyPair('bounds', { kind: 'oversized-rsa' }).spki, 'keyTest'),
      ),
    ).toBe('algorithm_unsupported');
    expect(codeOf(() => importPublicKey(rsaSpki((1n << 1022n) | 1n, 65537n), 'keyTest'))).toBe(
      'algorithm_unsupported',
    );
    expect(codeOf(() => importPublicKey(rsaSpki((1n << 8192n) | 1n, 65537n), 'keyTest'))).toBe(
      'algorithm_unsupported',
    );
  });

  it.each([
    ['2^32', 2n ** 32n],
    ['an even exponent', 65536n],
    ['1', 1n],
  ])('refuses the exponent %s', (_label, exponent) => {
    expect(codeOf(() => importPublicKey(rsaSpki((1n << 2047n) | 1n, exponent), 'keyTest'))).toBe(
      'algorithm_unsupported',
    );
  });

  it('refuses secp256k1, named or with explicit parameters (not on the allowlist)', () => {
    for (const explicitParameters of [false, true]) {
      const spki = testKeyPair('bounds', {
        kind: 'ec',
        curve: 'secp256k1',
        explicitParameters,
      }).spki;
      expect(codeOf(() => importPublicKey(spki, 'keyTest'))).toBe('algorithm_unsupported');
    }
  });

  it('refuses explicit parameters that differ from the curve they resemble', () => {
    const curve = brainpoolP256r1.Point.CURVE();
    const field = (value: bigint) => octetString(unsignedBytes(value, 32));
    const point = brainpoolP256r1.getPublicKey(unsignedBytes(7n, 32), false);
    const parameters = (b: bigint) =>
      sequence(
        integer(1),
        sequence(objectIdentifier(ALGORITHM_OIDS.primeField), integer(curve.p)),
        sequence(field(curve.a), field(b)),
        octetString(
          concatBytes(fromHex('04'), unsignedBytes(curve.Gx, 32), unsignedBytes(curve.Gy, 32)),
        ),
        integer(curve.n),
        integer(curve.h),
      );
    expect(importPublicKey(ecSpki(parameters(curve.b), point), 'keyTest').curve?.name).toBe(
      'brainpoolP256r1',
    );
    expect(codeOf(() => importPublicKey(ecSpki(parameters(curve.b + 1n), point), 'keyTest'))).toBe(
      'algorithm_unsupported',
    );
  });

  it('refuses an explicit prime field over 521 bits before OpenSSL reads it', () => {
    const prime = (1n << 600n) - 1n;
    const parameters = sequence(
      integer(1),
      sequence(objectIdentifier(ALGORITHM_OIDS.primeField), integer(prime)),
      sequence(octetString(new Uint8Array(75)), octetString(new Uint8Array(75))),
      octetString(new Uint8Array(151)),
      integer(prime),
      integer(1),
    );
    expect(codeOf(() => importPublicKey(ecSpki(parameters, new Uint8Array(151)), 'keyTest'))).toBe(
      'algorithm_unsupported',
    );
  });

  it.each([
    [
      'a characteristic-two field',
      sequence(
        integer(1),
        sequence(objectIdentifier(ALGORITHM_OIDS.characteristicTwoField), nullValue()),
      ),
    ],
    ['implicitly-CA parameters', nullValue()],
    ['an unknown named curve', objectIdentifier('1.3.132.0.10')],
  ])('refuses %s', (_label, parameters) => {
    expect(codeOf(() => importPublicKey(ecSpki(parameters, new Uint8Array(65)), 'keyTest'))).toBe(
      'algorithm_unsupported',
    );
  });

  it('refuses DSA and unknown key algorithms', () => {
    const spki = sequence(algorithmIdentifier(ALGORITHM_OIDS.dsa), bitString(integer(5)));
    expect(codeOf(() => importPublicKey(spki, 'keyTest'))).toBe('algorithm_unsupported');
  });

  it.each([
    ['garbage', fromHex('0102')],
    ['trailing bytes', concatBytes(sequence(nullValue()), fromHex('00'))],
    [
      'an RSA key that is not a SEQUENCE of two INTEGERs',
      sequence(
        algorithmIdentifier(ALGORITHM_OIDS.rsaEncryption, nullValue()),
        bitString(integer(5)),
      ),
    ],
    [
      'a negative modulus',
      sequence(
        algorithmIdentifier(ALGORITHM_OIDS.rsaEncryption, nullValue()),
        bitString(sequence(fromHex('02028001'), integer(65537))),
      ),
    ],
    [
      'a point that is not on the curve',
      ecSpki(
        objectIdentifier('1.2.840.10045.3.1.7'),
        concatBytes(fromHex('04'), unsignedBytes(1n, 32), unsignedBytes(1n, 32)),
      ),
    ],
  ])('refuses %s as malformed', (_label, spki) => {
    expect(codeOf(() => importPublicKey(spki, 'keyTest'))).toBe('chip_data_malformed');
  });

  it('refuses a test key followed by trailing bytes as malformed', () => {
    const spki = testKeyPair('bounds', { kind: 'ec', curve: 'P-256' }).spki;
    expect(codeOf(() => importPublicKey(concatBytes(spki, fromHex('00')), 'keyTest'))).toBe(
      'chip_data_malformed',
    );
  });
});
