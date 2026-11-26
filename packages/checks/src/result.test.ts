import { DomainError, checkResultSchema, type CheckId } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { InvalidCheckConfigError, checkResult, parseCheckConfig } from './result.js';

const SHA = 'b'.repeat(64);

describe('checkResult', () => {
  it('takes the check type, stage and implementation version from the core registry', () => {
    expect(checkResult('id_blur_detection', 'failed', ['image_too_blurry'])).toEqual({
      name: 'id_blur_detection',
      status: 'failed',
      type: 'user_behavior',
      reasons: ['image_too_blurry'],
      metadata: {},
      stage: 'ga',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: {} },
    });
    expect(checkResult('id_expired_detection', 'passed').type).toBe('fraud');
    expect(checkResult('id_portrait_detection', 'passed').stage).toBe('beta');
  });

  it('carries the confidence, thresholds, models and provider it is given (C29.2)', () => {
    const thresholds = { 'max-tamper-score': 0.7 };
    const result = checkResult(
      'id_tamper_detection',
      'failed',
      ['tamper_suspected'],
      {},
      {
        confidence: 0.82,
        thresholds,
        models: [{ id: 'yunet-2026may', sha256: SHA }],
        provider: { id: 'sandbox', sandbox: true },
      },
    );
    thresholds['max-tamper-score'] = 0.1;
    expect(result).toMatchObject({
      stage: 'beta',
      confidence: 0.82,
      provenance: {
        'implementation-version': 1,
        models: [{ id: 'yunet-2026may', sha256: SHA }],
        provider: { id: 'sandbox', sandbox: true },
        thresholds: { 'max-tamper-score': 0.7 },
      },
    });
    expect(checkResultSchema.safeParse(result).success).toBe(true);
  });

  it('leaves models and provider out when they were not used', () => {
    const { provenance } = checkResult(
      'id_expired_detection',
      'passed',
      [],
      {},
      {
        thresholds: { 'grace-days': 0 },
      },
    );
    expect(provenance).toEqual({ 'implementation-version': 1, thresholds: { 'grace-days': 0 } });
  });

  it('records the basis of each default threshold (C39.3), and leaves an empty one out', () => {
    const judged = checkResult(
      'selfie_liveness_detection',
      'not_applicable',
      ['input_missing'],
      {},
      {
        thresholds: { 'min-passive-score': 0.5, 'min-side-identity-cosine': 0.6 },
        thresholdBasis: { 'min-passive-score': 'provisional' },
      },
    );
    expect(judged.provenance['threshold-basis']).toEqual({ 'min-passive-score': 'provisional' });
    expect(checkResultSchema.safeParse(judged).success).toBe(true);
    const operator = checkResult(
      'selfie_glare_detection',
      'passed',
      [],
      {},
      { thresholdBasis: {} },
    );
    expect(operator.provenance).not.toHaveProperty('threshold-basis');
  });

  it('refuses a passed or failed H-tier result without a confidence (ADR 0002 §3c)', () => {
    expect(() => checkResult('id_tamper_detection', 'passed')).toThrow(/confidence/);
    expect(() =>
      checkResult('id_tamper_detection', 'failed', [], {}, { confidence: null }),
    ).toThrow(/confidence/);
    expect(checkResult('id_tamper_detection', 'not_applicable', ['input_missing']).confidence).toBe(
      null,
    );
    expect(checkResult('id_tamper_detection', 'pending').confidence).toBe(null);
  });

  it.each([-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a confidence of %s',
    (confidence) => {
      expect(() => checkResult('id_expired_detection', 'passed', [], {}, { confidence })).toThrow();
    },
  );

  it('refuses a threshold key that is not kebab-case', () => {
    expect(() =>
      checkResult('id_expired_detection', 'passed', [], {}, { thresholds: { graceDays: 0 } }),
    ).toThrow();
  });

  it('copies reasons and metadata', () => {
    const reasons = ['expired'];
    const result = checkResult('id_expired_detection', 'failed', reasons, { graceDays: 0 });
    reasons.push('mutated');
    expect(result.reasons).toEqual(['expired']);
    expect(result.metadata).toEqual({ graceDays: 0 });
  });

  it('refuses ids missing from the registry', () => {
    expect(() => checkResult('id_unknown_detection' as CheckId, 'passed')).toThrow(
      'Unknown check id_unknown_detection',
    );
  });
});

describe('parseCheckConfig', () => {
  const schema = z.strictObject({ graceDays: z.int().min(0).default(0) });

  it('returns the parsed configuration with defaults', () => {
    expect(parseCheckConfig('id_expired_detection', schema, {})).toEqual({ graceDays: 0 });
  });

  it('raises a typed error listing the issues', () => {
    let thrown: unknown;
    try {
      parseCheckConfig('id_expired_detection', schema, { graceDays: -1 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidCheckConfigError);
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({
      code: 'invalid_check_config',
      checkId: 'id_expired_detection',
      issues: [{ path: 'graceDays', message: expect.any(String) as unknown }],
    });
  });
});
