/**
 * C62.9: the self-test. On this Node (the image's 22.22.1 with OpenSSL 3.5.5) every
 * explicit-parameter brainpool case passes; a failing or throwing case is named, never hidden.
 * The explicit parameters it writes are read back by node:crypto as their curve.
 */
import { createPublicKey } from 'node:crypto';
import { brainpoolP256r1 } from '@noble/curves/misc.js';
import * as asn1js from 'asn1js';
import { describe, expect, it } from 'vitest';
import { unsignedBytes } from './bytes.js';
import { objectIdentifier } from './der.js';
import { ecSpki, explicitEcParameters } from './ec.js';
import { SELF_TEST_CURVES, runSelfTest, selfTest, selfTestCases } from './self-test.js';

describe('selfTest (C62.9)', () => {
  it('passes on this Node and names its platform', () => {
    expect(selfTest()).toEqual({
      ok: true,
      failures: [],
      node: process.versions.node,
      openssl: process.versions.openssl,
    });
  });

  it('runs one case per brainpool curve, with explicit parameters', () => {
    expect(SELF_TEST_CURVES).toEqual(['brainpoolP256r1', 'brainpoolP384r1', 'brainpoolP512r1']);
    expect(selfTestCases().map((testCase) => testCase.name)).toEqual([
      'brainpoolP256r1-explicit',
      'brainpoolP384r1-explicit',
      'brainpoolP512r1-explicit',
    ]);
    expect(selfTestCases().every((testCase) => testCase.run())).toBe(true);
  });

  it('names every case that fails or throws', () => {
    const result = runSelfTest([
      { name: 'passes', run: () => true },
      { name: 'fails', run: () => false },
      {
        name: 'throws',
        run: () => {
          throw new Error('no brainpool');
        },
      },
    ]);
    expect(result).toMatchObject({ ok: false, failures: ['fails', 'throws'] });
  });
});

describe('the explicit EC encoding', () => {
  it('writes SpecifiedECDomain that OpenSSL reads as brainpoolP256r1', () => {
    const curve = brainpoolP256r1.Point.CURVE();
    const parameters = explicitEcParameters(curve);
    const point = brainpoolP256r1.getPublicKey(unsignedBytes(9n, 32), false);
    const key = createPublicKey({
      key: Buffer.from(ecSpki(parameters, point)),
      format: 'der',
      type: 'spki',
    });
    expect(key.asymmetricKeyDetails?.namedCurve).toBe('brainpoolP256r1');
    const fields = (asn1js.fromBER(parameters).result as asn1js.Sequence).valueBlock.value;
    expect(fields).toHaveLength(6);
    expect((fields[5] as asn1js.Integer).valueBlock.valueDec).toBe(1);
    const named = createPublicKey({
      key: Buffer.from(ecSpki(objectIdentifier('1.3.36.3.3.2.8.1.1.7'), point)),
      format: 'der',
      type: 'spki',
    });
    expect(named.asymmetricKeyDetails?.namedCurve).toBe('brainpoolP256r1');
  });
});
