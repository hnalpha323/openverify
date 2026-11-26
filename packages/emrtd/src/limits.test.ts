/**
 * C62.1 (P19): the bounds of the pre-scan, the keys and the curves, as the plan fixes them, and
 * the explicit-parameter allowlist (brainpool P-192 to P-512, NIST P-192 to P-521).
 */
import { describe, expect, it } from 'vitest';
import { ALLOWED_CURVES, EMRTD_LIMITS } from './limits.js';

describe('EMRTD_LIMITS (C62.1)', () => {
  it('bounds the TLV pre-scan at depth 32 and 20,000 nodes', () => {
    expect(EMRTD_LIMITS.tlvMaxDepth).toBe(32);
    expect(EMRTD_LIMITS.tlvMaxNodes).toBe(20_000);
  });

  it('takes RSA moduli of 1,024 to 8,192 bits with a public exponent below 2^32', () => {
    expect(EMRTD_LIMITS.rsaMinModulusBits).toBe(1024);
    expect(EMRTD_LIMITS.rsaMaxModulusBits).toBe(8192);
    expect(EMRTD_LIMITS.rsaMaxPublicExponent).toBe(2n ** 32n - 1n);
  });

  it('takes EC fields of at most 521 bits', () => {
    expect(EMRTD_LIMITS.ecMaxFieldBits).toBe(521);
  });

  it('gives each verification a positive time budget', () => {
    expect(EMRTD_LIMITS.verificationTimeBudgetMs).toBeGreaterThan(0);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(EMRTD_LIMITS)).toBe(true);
    expect(Object.isFrozen(ALLOWED_CURVES)).toBe(true);
  });
});

describe('ALLOWED_CURVES (C62.1)', () => {
  it('lists the brainpool r1 curves from P-192 to P-512 and the NIST curves from P-192 to P-521', () => {
    expect(ALLOWED_CURVES.map((curve) => [curve.name, curve.oid, curve.fieldBits])).toEqual([
      ['brainpoolP192r1', '1.3.36.3.3.2.8.1.1.3', 192],
      ['brainpoolP224r1', '1.3.36.3.3.2.8.1.1.5', 224],
      ['brainpoolP256r1', '1.3.36.3.3.2.8.1.1.7', 256],
      ['brainpoolP320r1', '1.3.36.3.3.2.8.1.1.9', 320],
      ['brainpoolP384r1', '1.3.36.3.3.2.8.1.1.11', 384],
      ['brainpoolP512r1', '1.3.36.3.3.2.8.1.1.13', 512],
      ['P-192', '1.2.840.10045.3.1.1', 192],
      ['P-224', '1.3.132.0.33', 224],
      ['P-256', '1.2.840.10045.3.1.7', 256],
      ['P-384', '1.3.132.0.34', 384],
      ['P-521', '1.3.132.0.35', 521],
    ]);
  });

  it('keeps every allowed field within the EC bound', () => {
    for (const curve of ALLOWED_CURVES) {
      expect(curve.fieldBits).toBeLessThanOrEqual(EMRTD_LIMITS.ecMaxFieldBits);
    }
  });
});
