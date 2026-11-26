/**
 * KP10-40 (Workflow 10D): the prehashed ECDSA signer of `@openverify/emrtd/testing`. A caller that
 * holds only a message's hash (the sandbox test chip: a chip challenge keeps its nonce's SHA-256
 * and nothing else) gets the signature the key gives over the message itself.
 *
 * Checked three ways: against RFC 6979's published signatures for P-256 and P-384 (appendix A.2.5
 * and A.2.6, the messages "sample" and "test"), against `node:crypto` as an independent verifier
 * over the message, and against {@link testSign}, which hashes the message itself. The keys are the
 * RFC's published test keys and seeded test keys; nothing here is a real secret.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { toHex, utf8 } from '../bytes.js';
import { testSignDigest as exported } from './index.js';
import {
  TEST_CURVES,
  ecdsaSignDigest,
  testKeyPair,
  testSign,
  testSignDigest,
  type TestCurve,
} from './keys.js';

const bytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'));
const base64url = (hex: string): string => Buffer.from(hex, 'hex').toString('base64url');

interface Rfc6979Key {
  readonly curve: 'P-256' | 'P-384';
  readonly hash: 'sha256' | 'sha384';
  /** The private key `x`, and the public point `Ux`, `Uy`. */
  readonly x: string;
  readonly ux: string;
  readonly uy: string;
  /** The order of the curve's base point. */
  readonly n: bigint;
}

const P256: Rfc6979Key = {
  curve: 'P-256',
  hash: 'sha256',
  x: 'c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721',
  ux: '60fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb6',
  uy: '7903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299',
  n: 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
};

const P384: Rfc6979Key = {
  curve: 'P-384',
  hash: 'sha384',
  x: '6b9d3dad2e1b8c1c05b19875b6659f4de23c3b667bf297ba9aa47740787137d896d5724e4c70a825f872c9ea60d2edf5',
  ux: 'ec3a4e415b4e19a4568618029f427fa5da9a8bc4ae92e02e06aae5286b300c64def8f0ea9055866064a254515480bc13',
  uy: '8015d9b72d7d57244ea8ef9ac0c621896708a59367f9dfb9f54ca84b3f1c9db1288b231c3ae0d4fe7344fd2533264720',
  n: 0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973n,
};

/** The published `r` and `s` of each vector. */
const VECTORS: readonly (readonly [Rfc6979Key, string, string, string])[] = [
  [
    P256,
    'sample',
    'efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716',
    'f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8',
  ],
  [
    P256,
    'test',
    'f1abb023518351cd71d881567b1ea663ed3efcf6c5132b354f28d3b0b7d38367',
    '019f4113742a2b14bd25926b49c649155f267e60d3814b4c0cc84250e46f0083',
  ],
  [
    P384,
    'sample',
    '94edbb92a5ecb8aad4736e56c691916b3f88140666ce9fa73d64c4ea95ad133c81a648152e44acf96e36dd1e80fabe46',
    '99ef4aeb15f178cea1fe40db2603138f130e740a19624526203b6351d0a3a94fa329c145786e679e7b82c71a38628ac8',
  ],
];

/**
 * `s` as this signer writes it: the lower of `s` and `n - s`. Both are the same signature (ECDSA
 * accepts either), and the library behind the test keys always answers the lower one.
 */
function lowS(s: string, n: bigint): string {
  const value = BigInt(`0x${s}`);
  const lower = value > n / 2n ? n - value : value;
  return lower.toString(16).padStart(s.length, '0');
}

const publicKeyOf = (key: Rfc6979Key) =>
  createPublicKey({
    key: { kty: 'EC', crv: key.curve, x: base64url(key.ux), y: base64url(key.uy) },
    format: 'jwk',
  });

describe('ecdsaSignDigest (KP10-40)', () => {
  it.each(VECTORS)(
    'gives RFC 6979’s signature of %o over the hash of "%s"',
    (key, message, r, s) => {
      const digest = createHash(key.hash).update(message).digest();

      const signature = ecdsaSignDigest(key.curve, bytes(key.x), digest, 'plain');

      expect(toHex(signature)).toBe(`${r}${lowS(s, key.n)}`);
      expect(
        verify(
          key.hash,
          utf8(message),
          { key: publicKeyOf(key), dsaEncoding: 'ieee-p1363' },
          signature,
        ),
      ).toBe(true);
    },
  );

  it('writes X9.62 DER unless plain is asked', () => {
    const digest = createHash('sha256').update('sample').digest();

    const der = ecdsaSignDigest('P-256', bytes(P256.x), digest);

    expect(der[0]).toBe(0x30);
    expect(
      verify('sha256', utf8('sample'), { key: publicKeyOf(P256), dsaEncoding: 'der' }, der),
    ).toBe(true);
  });
});

describe('testSignDigest (KP10-40)', () => {
  const message = utf8('openverify synthetic nonce');
  const hashOf: Readonly<Record<TestCurve, 'sha256' | 'sha384' | 'sha512'>> = {
    brainpoolP256r1: 'sha256',
    brainpoolP384r1: 'sha384',
    brainpoolP512r1: 'sha512',
    'P-256': 'sha256',
    'P-384': 'sha384',
    'P-521': 'sha512',
    secp256k1: 'sha256',
  };

  it.each(TEST_CURVES)(
    'signs a %s key’s digest as testSign signs the message, plain and DER',
    (curve) => {
      const key = testKeyPair(`sign-digest/${curve}`, { kind: 'ec', curve });
      const digest = createHash(hashOf[curve]).update(message).digest();

      const plain = testSignDigest(key, digest, { ec: 'plain' });

      expect(toHex(plain)).toBe(toHex(testSign(key, message, { ec: 'plain' }).value));
      expect(toHex(testSignDigest(key, digest))).toBe(toHex(testSign(key, message).value));
      expect(
        verify(hashOf[curve], message, { key: key.publicKey, dsaEncoding: 'ieee-p1363' }, plain),
      ).toBe(true);
    },
  );

  it('signs under the digest the scheme names', () => {
    const key = testKeyPair('sign-digest/p384-sha256', { kind: 'ec', curve: 'P-384' });
    const digest = createHash('sha256').update(message).digest();

    const signature = testSignDigest(key, digest, { ec: 'plain', hash: 'sha256' });

    expect(
      verify('sha256', message, { key: key.publicKey, dsaEncoding: 'ieee-p1363' }, signature),
    ).toBe(true);
  });

  it('refuses a digest that is not the scheme’s length, and a key that is not an EC key', () => {
    const key = testKeyPair('sign-digest/refused', { kind: 'ec', curve: 'P-256' });
    const rsa = testKeyPair('sign-digest/rsa', { kind: 'rsa', bits: 1024 });

    expect(() => testSignDigest(key, new Uint8Array(20))).toThrow(RangeError);
    expect(() => testSignDigest(key, new Uint8Array(32), { hash: 'sha384' })).toThrow(RangeError);
    expect(() => testSignDigest(rsa, new Uint8Array(32))).toThrow(RangeError);
  });

  it('is exported from @openverify/emrtd/testing', () => {
    expect(exported).toBe(testSignDigest);
  });
});
