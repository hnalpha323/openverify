/**
 * C62.2, C62.7: the signature algorithms of an eMRTD PKI (Doc 9303-12 §4.1.6), verified through
 * node:crypto: ECDSA in DER and plain form, RSASSA-PKCS1-v1_5 named by digest or as
 * `rsaEncryption`, RSASSA-PSS with RFC 4055 parameters, SHA-1 only when accepted.
 */
import * as asn1js from 'asn1js';
import { describe, expect, it } from 'vitest';
import { utf8 } from './bytes.js';
import { algorithmIdentifier, bitString, explicit, integer, nullValue, sequence } from './der.js';
import { importPublicKey } from './keys.js';
import {
  ALGORITHM_OIDS,
  ECDSA_PLAIN_SIGNATURE_OIDS,
  ECDSA_SIGNATURE_OIDS,
  HASH_ALGORITHM_OIDS,
  RSA_PKCS1_SIGNATURE_OIDS,
} from './oids.js';
import { checkSignature, describeSignatureAlgorithm, hashAlgorithmOf } from './signatures.js';
import {
  testKeyPair,
  testSign,
  type TestKeySpec,
  type TestSignatureScheme,
} from './testing/keys.js';
import type { AlgorithmIdentifierValue } from './types.js';

const data = utf8('signed attributes');
const ec: TestKeySpec = { kind: 'ec', curve: 'brainpoolP256r1', explicitParameters: true };
const rsa: TestKeySpec = { kind: 'rsa', bits: 2048 };

/** The AlgorithmIdentifier a DER AlgorithmIdentifier holds, read by asn1js. */
function algorithmOf(der: Uint8Array): AlgorithmIdentifierValue {
  const [oid, parameters] = (asn1js.fromBER(der).result as asn1js.Sequence).valueBlock.value;
  return {
    oid: (oid as asn1js.ObjectIdentifier).getValue(),
    parameters: parameters === undefined ? null : new Uint8Array(parameters.valueBeforeDecodeView),
  };
}

function signed(spec: TestKeySpec, scheme: TestSignatureScheme = {}) {
  const key = testKeyPair('signatures', spec);
  const signature = testSign(key, data, scheme);
  return {
    key: importPublicKey(key.spki, 'test'),
    algorithm: algorithmOf(signature.algorithm),
    signature: signature.value,
  };
}

describe('hashAlgorithmOf', () => {
  it('names the digests by OID', () => {
    for (const [name, oid] of Object.entries(HASH_ALGORITHM_OIDS)) {
      expect(hashAlgorithmOf(oid)).toBe(name);
    }
    expect(hashAlgorithmOf('1.2.3')).toBeNull();
  });
});

describe('describeSignatureAlgorithm', () => {
  it.each([
    [ECDSA_SIGNATURE_OIDS.sha384, null, 'ecdsa-with-sha384', 'ecdsa', 'sha384'],
    [ECDSA_PLAIN_SIGNATURE_OIDS.sha256, null, 'ecdsa-plain-sha256', 'ecdsa-plain', 'sha256'],
    [RSA_PKCS1_SIGNATURE_OIDS.sha1, null, 'sha1-with-rsa', 'pkcs1', 'sha1'],
    [ALGORITHM_OIDS.rsaEncryption, 'sha512', 'rsa-encryption-sha512', 'pkcs1', 'sha512'],
    [ALGORITHM_OIDS.ecPublicKey, 'sha224', 'ecdsa-sha224', 'ecdsa', 'sha224'],
  ] as const)('names %s', (oid, digest, name, scheme, hash) => {
    expect(describeSignatureAlgorithm({ oid, parameters: null }, digest)).toEqual({
      name,
      scheme,
      hash,
      saltLength: null,
    });
  });

  it('needs a digest for rsaEncryption and id-ecPublicKey', () => {
    expect(
      describeSignatureAlgorithm({ oid: ALGORITHM_OIDS.rsaEncryption, parameters: null }),
    ).toBeNull();
    expect(
      describeSignatureAlgorithm({ oid: ALGORITHM_OIDS.ecPublicKey, parameters: null }, null),
    ).toBeNull();
  });

  it('reads RSASSA-PSS parameters, with the RFC 4055 defaults when absent', () => {
    const sha256 = algorithmIdentifier(HASH_ALGORITHM_OIDS.sha256, nullValue());
    const parameters = sequence(
      explicit(0, sha256),
      explicit(1, algorithmIdentifier(ALGORITHM_OIDS.mgf1, sha256)),
      explicit(2, integer(32)),
      explicit(3, integer(1)),
    );
    expect(describeSignatureAlgorithm({ oid: ALGORITHM_OIDS.rsassaPss, parameters })).toEqual({
      name: 'rsassa-pss-sha256',
      scheme: 'pss',
      hash: 'sha256',
      saltLength: 32,
    });
    for (const empty of [null, sequence()]) {
      expect(
        describeSignatureAlgorithm({ oid: ALGORITHM_OIDS.rsassaPss, parameters: empty }),
      ).toEqual({
        name: 'rsassa-pss-sha1',
        scheme: 'pss',
        hash: 'sha1',
        saltLength: 20,
      });
    }
  });

  it.each([
    [
      'an MGF1 digest other than the message digest',
      sequence(
        explicit(0, algorithmIdentifier(HASH_ALGORITHM_OIDS.sha256)),
        explicit(
          1,
          algorithmIdentifier(ALGORITHM_OIDS.mgf1, algorithmIdentifier(HASH_ALGORITHM_OIDS.sha1)),
        ),
      ),
    ],
    ['a trailer field other than 1', sequence(explicit(3, integer(2)))],
    ['another mask generation function', sequence(explicit(1, algorithmIdentifier('1.2.3.4')))],
    ['an unknown digest', sequence(explicit(0, algorithmIdentifier('1.2.3.4')))],
    ['malformed parameters', integer(5)],
  ])('refuses RSASSA-PSS with %s', (_label, parameters) => {
    expect(describeSignatureAlgorithm({ oid: ALGORITHM_OIDS.rsassaPss, parameters })).toBeNull();
  });

  it('refuses unknown algorithms', () => {
    expect(
      describeSignatureAlgorithm({ oid: '1.2.840.10040.4.3', parameters: null }, 'sha1'),
    ).toBeNull();
  });
});

describe('checkSignature', () => {
  it.each([
    ['ECDSA DER over explicit brainpool', ec, {}],
    ['plain ECDSA', ec, { ec: 'plain' }],
    ['ECDSA on P-521', { kind: 'ec', curve: 'P-521' }, {}],
    ['RSASSA-PKCS1-v1_5', rsa, { hash: 'sha384' }],
    ['RSASSA-PSS', rsa, { rsa: 'pss' }],
  ] as const)(
    'verifies %s and refuses the same signature over other bytes',
    (_label, spec, scheme) => {
      const input = signed(spec, scheme);
      expect(checkSignature({ ...input, data, acceptSha1: false })).toMatchObject({
        check: 'valid',
      });
      expect(checkSignature({ ...input, data: utf8('other'), acceptSha1: false }).check).toBe(
        'invalid',
      );
    },
  );

  it('verifies rsaEncryption with the digest supplied, and is unsupported without it', () => {
    const input = signed(rsa, { rsa: 'rsa-encryption', hash: 'sha512' });
    expect(checkSignature({ ...input, digest: 'sha512', data, acceptSha1: false })).toMatchObject({
      check: 'valid',
      algorithm: { name: 'rsa-encryption-sha512' },
    });
    expect(checkSignature({ ...input, data, acceptSha1: false })).toEqual({
      check: 'unsupported',
      algorithm: null,
    });
  });

  it('accepts SHA-1 only when asked', () => {
    const input = signed(ec, { hash: 'sha1' });
    expect(checkSignature({ ...input, data, acceptSha1: true }).check).toBe('valid');
    expect(checkSignature({ ...input, data, acceptSha1: false })).toMatchObject({
      check: 'unsupported',
      algorithm: { hash: 'sha1' },
    });
  });

  it('refuses a signature the key cannot make, and malformed signatures, as invalid', () => {
    const ecInput = signed(ec);
    const rsaInput = signed(rsa);
    expect(checkSignature({ ...ecInput, key: rsaInput.key, data, acceptSha1: false }).check).toBe(
      'invalid',
    );
    expect(checkSignature({ ...rsaInput, key: ecInput.key, data, acceptSha1: false }).check).toBe(
      'invalid',
    );
    expect(
      checkSignature({
        ...ecInput,
        signature: new Uint8Array([0x30, 0x01]),
        data,
        acceptSha1: false,
      }).check,
    ).toBe('invalid');
    expect(
      checkSignature({
        ...signed(ec, { ec: 'plain' }),
        signature: new Uint8Array(3),
        data,
        acceptSha1: false,
      }).check,
    ).toBe('invalid');
  });

  it('answers unsupported, not invalid, when the key may not make the scheme (a PSS-only key, PKCS#1)', () => {
    const key = testKeyPair('signatures', rsa);
    const bits = (
      (asn1js.fromBER(key.spki).result as asn1js.Sequence).valueBlock.value[1] as asn1js.BitString
    ).valueBlock.valueHexView;
    const pssOnly = importPublicKey(
      sequence(algorithmIdentifier(ALGORITHM_OIDS.rsassaPss), bitString(bits)),
      'test',
    );
    const signature = testSign(key, data, { rsa: 'pkcs1' });
    expect(
      checkSignature({
        algorithm: algorithmOf(signature.algorithm),
        key: pssOnly,
        data,
        signature: signature.value,
        acceptSha1: false,
      }).check,
    ).toBe('unsupported');
    const pss = testSign(key, data, { rsa: 'pss' });
    expect(
      checkSignature({
        algorithm: algorithmOf(pss.algorithm),
        key: pssOnly,
        data,
        signature: pss.value,
        acceptSha1: false,
      }).check,
    ).toBe('valid');
  });

  it('answers unsupported for an unknown algorithm', () => {
    const input = signed(ec);
    expect(
      checkSignature({
        ...input,
        algorithm: { oid: '1.2.3.4', parameters: null },
        data,
        acceptSha1: true,
      }),
    ).toEqual({ check: 'unsupported', algorithm: null });
  });
});
