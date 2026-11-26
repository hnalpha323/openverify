/**
 * Phase 12A (`docs/plans/phase-12a.plan.md`): the template option that sends missing required
 * fields to review (C6) and the OCR legibility keys of `id_blur_detection` (C9), and how the
 * decision engine already routes the review outcome.
 */
import { describe, expect, it } from 'vitest';
import {
  GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS,
  idBlurDetectionConfigSchema,
  idExtractedPropertiesDetectionConfigSchema,
} from './check-config.js';
import type { CheckResult } from './check-result.js';
import { decideVerification, type VerificationTemplateConfig } from './decision-engine.js';
import type { CheckStatus, CheckType } from './enums.js';

const accepts = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

function result(
  name: string,
  status: CheckStatus,
  type: CheckType,
  reasons: string[] = [],
): CheckResult {
  return {
    name,
    status,
    type,
    reasons,
    metadata: {},
    stage: 'ga',
    confidence: null,
    provenance: { 'implementation-version': 1, thresholds: {} },
  };
}

const REQUIRED = { enabled: true, required: true } as const;

describe('id_extracted_properties_detection missing-fields-outcome (C6)', () => {
  it('takes fail or review, nothing else', () => {
    const schema = idExtractedPropertiesDetectionConfigSchema;
    expect(accepts(schema, { 'missing-fields-outcome': 'fail' })).toBe(true);
    expect(accepts(schema, { 'missing-fields-outcome': 'review' })).toBe(true);
    expect(accepts(schema, { 'missing-fields-outcome': 'retake' })).toBe(false);
    expect(accepts(schema, { 'missing-fields-outcome': true })).toBe(false);
  });

  it('defaults to fail, so a template that does not opt in behaves as before', () => {
    expect(GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_extracted_properties_detection).toMatchObject({
      'missing-fields-outcome': 'fail',
    });
  });
});

describe('decideVerification on the review outcome (C6)', () => {
  const checks: VerificationTemplateConfig = {
    checks: {
      id_blur_detection: REQUIRED,
      id_extracted_properties_detection: REQUIRED,
    },
  };

  it('sends missing required fields to review, not retryable, when that is the only problem', () => {
    const decision = decideVerification(
      [
        result('id_blur_detection', 'passed', 'user_behavior'),
        result('id_extracted_properties_detection', 'not_applicable', 'user_behavior', [
          'required_fields_missing',
        ]),
      ],
      checks,
    );
    expect(decision).toMatchObject({
      status: 'needs_review',
      retryable: false,
      reviewCheckIds: ['id_extracted_properties_detection'],
      failingCheckIds: [],
    });
  });

  it('still fails when another required check failed', () => {
    const decision = decideVerification(
      [
        result('id_blur_detection', 'failed', 'user_behavior', ['image_blurry']),
        result('id_extracted_properties_detection', 'not_applicable', 'user_behavior', [
          'required_fields_missing',
        ]),
      ],
      checks,
    );
    expect(decision).toMatchObject({ status: 'failed', failingCheckIds: ['id_blur_detection'] });
  });
});

describe('id_blur_detection OCR legibility keys (C9)', () => {
  it('bounds the median confidence to 0-1 and the line count to 1-100', () => {
    const schema = idBlurDetectionConfigSchema;
    expect(accepts(schema, { 'legible-text-min-confidence': 0.9 })).toBe(true);
    expect(accepts(schema, { 'legible-text-min-confidence': 1.1 })).toBe(false);
    expect(accepts(schema, { 'legible-text-min-lines': 8 })).toBe(true);
    expect(accepts(schema, { 'legible-text-min-lines': 0 })).toBe(false);
    expect(accepts(schema, { 'legible-text-min-lines': 8.5 })).toBe(false);
    expect(accepts(schema, { 'legible-text-min-lines': 101 })).toBe(false);
  });
});
