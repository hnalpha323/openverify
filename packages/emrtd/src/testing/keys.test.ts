/**
 * C65.3: the seeded test keys and their signatures, checked against `node:crypto` as an
 * independent verifier: the same seed gives the same key, EC signatures are RFC 6979
 * (deterministic), RSA keys have the bits asked for and are memoised, and the oversized key's
 * stand-in private key never verifies under its 16,384-bit modulus.
 */
import { createHash, verify } from 'node:crypto';
import * as asn1js from 'asn1js';
import { describe, expect, it } from 'vitest';
import { toHex, utf8 } from '../bytes.js';
import {
  ECDSA_PLAIN_SIGNATURE_OIDS,
  ECDSA_SIGNATURE_OIDS,
  ALGORITHM_OIDS,
  RSA_PKCS1_SIGNATURE_OIDS,
} from '../oids.js';
import { TEST_CURVES, seededBytes, testKeyPair, testSign, type TestKeySpec } from './keys.js';

const message = utf8('openverify synthetic message');

function algorithmOid(algorithm: Uint8Array): string {
  const parsed = asn1js.fromBER(algorithm).result as asn1js.Sequence;
  return (parsed.valueBlock.value[0] as asn1js.ObjectIdentifier).getValue();
}

describe('seededBytes', () => {
  it('is a deterministic stream of the asked length', () => {
    expect(toHex(seededBytes('a', 40))).toBe(toHex(seededBytes('a', 40)));
    expect(seededBytes('a', 40)).toHaveLength(40);
    expect(toHex(seededBytes('a', 8))).not.toBe(toHex(seededBytes('b', 8)));
    expect(toHex(seededBytes('a', 32))).toBe(createHash('sha256').update('a/0').digest('hex'));
  });
});

describe('testKeyPair (C65.3)', () => {
  it.each(
    TEST_CURVES.flatMap((curve) => [false, true].map((explicit) => [curve, explicit] as const)),
  )(
    'derives the same %s key from the same seed (explicit parameters: %s)',
    (curve, explicitParameters) => {
      const spec: TestKeySpec = { kind: 'ec', curve, explicitParameters };
      const key = testKeyPair('seed-a', spec);
      expect(toHex(key.spki)).toBe(toHex(testKeyPair('seed-a', spec).spki));
      expect(toHex(key.spki)).not.toBe(toHex(testKeyPair('seed-b', spec).spki));
      expect(key.publicKey.asymmetricKeyType).toBe('ec');
      expect(key.privateKey.type).toBe('private');
      expect(key).toMatchObject({ seed: 'seed-a', spec });
      // The SPKI names its curve, or carries a SEQUENCE of explicit parameters.
      const spki = asn1js.fromBER(key.spki).result as asn1js.Sequence;
      const algorithm = spki.valueBlock.value[0] as asn1js.Sequence;
      const parameters = algorithm.valueBlock.value[1];
      expect(parameters instanceof asn1js.Sequence).toBe(explicitParameters);
    },
  );

  it('signs EC deterministically (RFC 6979), verifiable by node:crypto in DER and plain form', () => {
    for (const curve of TEST_CURVES) {
      const key = testKeyPair('sign', { kind: 'ec', curve, explicitParameters: true });
      const der = testSign(key, message);
      expect(toHex(der.value)).toBe(toHex(testSign(key, message).value));
      const hash =
        curve.endsWith('384r1') || curve === 'P-384'
          ? 'sha384'
          : curve.endsWith('512r1') || curve === 'P-521'
            ? 'sha512'
            : 'sha256';
      expect(algorithmOid(der.algorithm)).toBe(ECDSA_SIGNATURE_OIDS[hash]);
      expect(verify(hash, message, key.publicKey, der.value), curve).toBe(true);
      const plain = testSign(key, message, { ec: 'plain', hash: 'sha256' });
      expect(algorithmOid(plain.algorithm)).toBe(ECDSA_PLAIN_SIGNATURE_OIDS.sha256);
      expect(
        verify('sha256', message, { key: key.publicKey, dsaEncoding: 'ieee-p1363' }, plain.value),
        curve,
      ).toBe(true);
    }
  });

  it('derives RSA keys of the bits asked for, memoised, with exponent 65537', () => {
    const started = performance.now();
    const key = testKeyPair('rsa', { kind: 'rsa', bits: 2048 });
    expect(testKeyPair('rsa', { kind: 'rsa', bits: 2048 })).toBe(key);
    expect(key.publicKey.asymmetricKeyDetails).toMatchObject({
      modulusLength: 2048,
      publicExponent: 65537n,
    });
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it('signs RSA as PKCS#1 v1.5, rsaEncryption and PSS, verifiable by node:crypto', () => {
    const key = testKeyPair('rsa', { kind: 'rsa', bits: 2048 });
    const pkcs1 = testSign(key, message, { hash: 'sha384' });
    expect(algorithmOid(pkcs1.algorithm)).toBe(RSA_PKCS1_SIGNATURE_OIDS.sha384);
    expect(verify('sha384', message, key.publicKey, pkcs1.value)).toBe(true);
    const plain = testSign(key, message, { rsa: 'rsa-encryption' });
    expect(algorithmOid(plain.algorithm)).toBe(ALGORITHM_OIDS.rsaEncryption);
    expect(verify('sha256', message, key.publicKey, plain.value)).toBe(true);
    const pss = testSign(key, message, { rsa: 'pss' });
    expect(algorithmOid(pss.algorithm)).toBe(ALGORITHM_OIDS.rsassaPss);
    expect(
      verify(
        'sha256',
        message,
        { key: key.publicKey, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: 32 },
        pss.value,
      ),
    ).toBe(true);
  });

  it('gives the oversized key a 16,384-bit modulus and a stand-in that never verifies', () => {
    const key = testKeyPair('big', { kind: 'oversized-rsa' });
    expect(key.publicKey.asymmetricKeyDetails?.modulusLength).toBe(16_384);
    const signature = testSign(key, message);
    expect(signature.value).toHaveLength(256);
    expect(verify('sha256', message, key.publicKey, signature.value)).toBe(false);
  });

  it.each([
    [{ kind: 'rsa', bits: 1000 }],
    [{ kind: 'rsa', bits: 8192 }],
    [{ kind: 'ec', curve: 'P-192' }],
  ] as const)('refuses %j', (spec) => {
    expect(() => testKeyPair('bad', spec as unknown as TestKeySpec)).toThrow(RangeError);
  });
});
