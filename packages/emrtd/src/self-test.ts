/**
 * C62.9: the self-test of explicit-parameter brainpool keys through `node:crypto`, run as emrtd's
 * first test (the package's Vitest global setup), at worker start and before a sync; on failure
 * PA answers `algorithm_unsupported`. A distribution's Node may be built against an OpenSSL
 * without brainpool or with explicit parameters refused (research §1.5): the self-test finds that
 * before a genuine passport is judged by it.
 *
 * Each case derives a key from a fixed label (no key is stored), signs a fixed message with
 * `@noble/curves` (pure JavaScript, RFC 6979), and checks through the verifier's own import and
 * signature path that OpenSSL reads the explicit parameters as the curve's, verifies the
 * signature, and refuses it over other bytes.
 */
import { createHash } from 'node:crypto';
import type { ECDSA } from '@noble/curves/abstract/weierstrass.js';
import { brainpoolP256r1, brainpoolP384r1, brainpoolP512r1 } from '@noble/curves/misc.js';
import { bitLength, bytesToBigInt, unsignedBytes, utf8 } from './bytes.js';
import { ecSpki, explicitEcParameters } from './ec.js';
import { importPublicKey } from './keys.js';
import { ECDSA_SIGNATURE_OIDS } from './oids.js';
import { checkSignature } from './signatures.js';
import type { HashAlgorithm, SelfTestResult } from './types.js';

/** The curves the self-test covers, each with explicit parameters. */
export const SELF_TEST_CURVES = ['brainpoolP256r1', 'brainpoolP384r1', 'brainpoolP512r1'] as const;
type SelfTestCurve = (typeof SELF_TEST_CURVES)[number];

/** One named check; it passes when `run` returns true without throwing. */
export interface SelfTestCase {
  readonly name: string;
  readonly run: () => boolean;
}

const NOBLE: Readonly<Record<SelfTestCurve, { curve: ECDSA; hash: HashAlgorithm }>> = {
  brainpoolP256r1: { curve: brainpoolP256r1, hash: 'sha256' },
  brainpoolP384r1: { curve: brainpoolP384r1, hash: 'sha384' },
  brainpoolP512r1: { curve: brainpoolP512r1, hash: 'sha512' },
};

const MESSAGE = utf8('openverify/emrtd/self-test');

/** Runs the cases: `ok` when every one passes, the failing names otherwise. */
export function runSelfTest(cases: readonly SelfTestCase[]): SelfTestResult {
  const failures = cases
    .filter((testCase) => {
      try {
        return !testCase.run();
      } catch {
        return true;
      }
    })
    .map((testCase) => testCase.name);
  return {
    ok: failures.length === 0,
    failures,
    node: process.versions.node,
    openssl: process.versions.openssl,
  };
}

function explicitCurveCase(name: SelfTestCurve): SelfTestCase {
  return {
    name: `${name}-explicit`,
    run: () => {
      const { curve, hash } = NOBLE[name];
      const parameters = curve.Point.CURVE();
      const length = Math.ceil(bitLength(parameters.n) / 8);
      const label = createHash('sha512').update(`openverify/emrtd/self-test/${name}`).digest();
      const scalar = unsignedBytes((bytesToBigInt(label) % (parameters.n - 1n)) + 1n, length);
      const spki = ecSpki(explicitEcParameters(parameters), curve.getPublicKey(scalar, false));
      const signature = curve.sign(createHash(hash).update(MESSAGE).digest(), scalar, {
        prehash: false,
        format: 'der',
      });
      const key = importPublicKey(spki, 'selfTest');
      const check = (data: Uint8Array) =>
        checkSignature({
          algorithm: { oid: ECDSA_SIGNATURE_OIDS[hash], parameters: null },
          key,
          data,
          signature,
          acceptSha1: false,
        }).check;
      return (
        key.explicitParameters &&
        key.curve?.name === name &&
        check(MESSAGE) === 'valid' &&
        check(utf8('openverify/emrtd/self-test/other')) === 'invalid'
      );
    },
  };
}

/** The self-test cases, one per {@link SELF_TEST_CURVES} entry (`brainpoolP256r1-explicit`, ...). */
export function selfTestCases(): SelfTestCase[] {
  return SELF_TEST_CURVES.map(explicitCurveCase);
}

export function selfTest(): SelfTestResult {
  return runSelfTest(selfTestCases());
}
