import {
  CHECK_IDS,
  checkResultSchema,
  decideVerification,
  getCheckDefinition,
  listChecks,
  type CheckResult,
  type VerificationTemplateConfig,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  GOVERNMENT_ID_EVALUATORS,
  GOVERNMENT_ID_EVALUATED_CHECKS,
  GOVERNMENT_ID_EVALUATOR_REASONS,
  evaluateGovernmentIdChecks,
  extractGovernmentId,
  unreadableImageChecks,
  type GovernmentIdCheckInput,
} from '../index.js';
import { aamvaPayload, barcodeAnalysis, goldenAnalysis, withBarcode } from '../testing/fixtures.js';
import { withForensics } from '../testing/forensics.js';
import { NOW } from '../testing/context.js';

const EVERY_CHECK: VerificationTemplateConfig = {
  checks: Object.fromEntries(
    listChecks('government_id').map((check) => [check.id, { enabled: true, required: true }]),
  ),
};

function input(overrides: Partial<GovernmentIdCheckInput> = {}): GovernmentIdCheckInput {
  return {
    analysis: goldenAnalysis(),
    requiredSides: 'both',
    uploads: { front: { sha256: 'a'.repeat(64) }, back: { sha256: 'b'.repeat(64) } },
    environment: 'sandbox',
    now: NOW,
    ...overrides,
  };
}

const statuses = (results: readonly CheckResult[]) =>
  Object.fromEntries(
    results.map((result) => [result.name, [result.status, ...result.reasons].join(' ')]),
  );

describe('GOVERNMENT_ID_EVALUATORS', () => {
  it('has an evaluator for every §4.1 government ID check (C29)', () => {
    const ids = listChecks('government_id').map((check) => check.id);
    expect([...GOVERNMENT_ID_EVALUATED_CHECKS].sort()).toEqual([...ids].sort());
    expect(Object.keys(GOVERNMENT_ID_EVALUATORS).sort()).toEqual([...ids].sort());
  });
});

describe('evaluateGovernmentIdChecks', () => {
  it('evaluates the golden Utopia card in a sandbox, every check at its tier', () => {
    const results = evaluateGovernmentIdChecks(input(), EVERY_CHECK);
    expect(statuses(results)).toEqual({
      id_unprocessable_submission_detection: 'passed',
      id_blur_detection: 'passed',
      id_glare_detection: 'passed',
      id_double_side_detection: 'passed',
      id_portrait_detection: 'passed',
      id_portrait_clarity_detection: 'passed',
      id_mrz_detection: 'passed',
      id_mrz_inconsistency_detection: 'passed',
      id_barcode_detection: 'not_applicable feature_absent',
      id_barcode_inconsistency_detection: 'not_applicable feature_absent',
      id_extracted_properties_detection: 'passed',
      id_extraction_inconsistency_detection: 'passed',
      id_number_format_inconsistency_detection: 'passed',
      id_expired_detection: 'passed',
      id_valid_dates_detection: 'passed',
      id_age_comparison: 'not_applicable age_limits_not_configured',
      id_age_inconsistency_detection: 'not_applicable provider_not_configured',
      id_disallowed_country_detection: 'passed',
      id_disallowed_type_detection: 'passed',
      id_po_box_detection: 'passed',
      id_real_id_detection: 'not_applicable feature_absent',
      id_color_inconsistency_detection: 'passed',
      id_electronic_replica_detection: 'passed',
      id_tamper_detection: 'passed',
      id_fabrication_detection: 'passed',
      id_handwriting_detection: 'passed',
      id_compromised_detection: 'passed',
      id_entity_detection: 'passed',
      id_repeat_detection: 'not_applicable input_missing',
      id_inconsistent_repeat_detection: 'not_applicable input_missing',
      id_account_comparison: 'not_applicable input_missing',
      id_inquiry_comparison: 'not_applicable input_missing',
      id_selfie_comparison: 'not_applicable input_missing',
      id_public_figure_detection: 'not_applicable provider_not_configured',
      id_aamva_database_lookup: 'not_applicable feature_absent',
    });
    for (const result of results) {
      expect(checkResultSchema.safeParse(result).success, result.name).toBe(true);
      expect(result.stage, result.name).toBe(getCheckDefinition(result.name)?.stage);
      if (getCheckDefinition(result.name)?.tier === 'H' && result.status !== 'not_applicable') {
        expect(result.confidence, result.name).not.toBeNull();
      }
    }
  });

  it('fails the Utopia card in production as a specimen (C30.7)', () => {
    const results = evaluateGovernmentIdChecks(input({ environment: 'production' }), EVERY_CHECK);
    expect(statuses(results)).toMatchObject({
      id_compromised_detection: 'failed specimen_issuer',
      id_mrz_detection: 'passed',
      id_barcode_detection: 'not_applicable input_missing',
      id_entity_detection: 'failed entity_risk_high',
    });
    expect(decideVerification(results, EVERY_CHECK).status).toBe('failed');
  });

  it('enforces the template allowlists before the flow step, and only an established value (C29.5)', () => {
    const allowUs: VerificationTemplateConfig = {
      ...EVERY_CHECK,
      'allowed-countries': ['US'],
      'allowed-id-classes': ['passport'],
    };
    expect(statuses(evaluateGovernmentIdChecks(input(), allowUs))).toMatchObject({
      id_disallowed_country_detection: 'failed issuing_country_not_allowed',
      id_disallowed_type_detection: 'failed id_class_not_allowed',
    });
    const step = { allowedCountries: ['US'], allowedIdClasses: ['national_id' as const] };
    expect(statuses(evaluateGovernmentIdChecks(input({ step }), EVERY_CHECK))).toMatchObject({
      id_disallowed_country_detection: 'failed issuing_country_not_allowed',
      id_disallowed_type_detection: 'passed',
    });
    expect(
      statuses(
        evaluateGovernmentIdChecks(input({ step }), {
          ...EVERY_CHECK,
          'allowed-id-classes': ['visa'],
        }),
      ),
    ).toMatchObject({ id_disallowed_type_detection: 'failed id_class_not_allowed' });
    const analysis = goldenAnalysis();
    analysis.sides.back = null;
    expect(
      statuses(
        evaluateGovernmentIdChecks(input({ analysis, requiredSides: 'front' }), EVERY_CHECK),
      ),
    ).toMatchObject({
      id_disallowed_country_detection: 'not_applicable input_missing',
      id_disallowed_type_detection: 'passed',
    });
  });

  it('confirms an MRZ issuer correction by the issuer code the header prints (C31.3)', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = [
      ...analysis.sides.front.text,
      {
        text: 'UTO',
        confidence: 0.99,
        box: [880, 20, 70, 34] as const,
        stroke_width_mean: 3,
        stroke_width_cv: 0.14,
      },
    ];
    if (analysis.sides.back !== null) {
      const [first = '', second = '', third = ''] = analysis.sides.back.mrz.lines;
      analysis.sides.back.mrz = {
        ...analysis.sides.back.mrz,
        lines: [`I<UT0${first.slice(5)}`, second, third],
      };
    }
    const [result] = evaluateGovernmentIdChecks(input({ analysis }), {
      checks: { id_mrz_inconsistency_detection: { enabled: true, required: true } },
    });
    expect(result).toMatchObject({
      status: 'passed',
      metadata: { 'corrected-fields': ['issuing-authority-code'], 'unconfirmed-corrections': [] },
    });
  });

  it('takes the extraction the worker built instead of deriving it', () => {
    const extraction = extractGovernmentId(barcodeAnalysis(), { now: NOW });
    const results = evaluateGovernmentIdChecks(input({ extraction }), {
      checks: { id_barcode_detection: { enabled: true, required: true } },
    });
    expect(results[0]).toMatchObject({ status: 'passed', metadata: { side: 'front' } });
  });

  it('evaluates the configured thresholds of each check', () => {
    const config: VerificationTemplateConfig = {
      checks: {
        id_expired_detection: { enabled: true, required: true, config: { 'grace-days': 30 } },
        id_tamper_detection: {
          enabled: true,
          required: false,
          config: { 'max-tamper-score': 0.01 },
        },
      },
    };
    const [expired, tamper] = evaluateGovernmentIdChecks(input(), config);
    expect(expired?.provenance.thresholds).toEqual({ 'grace-days': 30 });
    expect(tamper).toMatchObject({
      status: 'failed',
      provenance: { thresholds: { 'max-tamper-score': 0.01 } },
    });
  });

  it('emits only reasons listed in GOVERNMENT_ID_EVALUATOR_REASONS', () => {
    const inputs: GovernmentIdCheckInput[] = [
      input(),
      input({ environment: 'production' }),
      input({
        analysis: barcodeAnalysis(),
        requiredSides: 'front',
        uploads: { front: { sha256: 'c'.repeat(64) }, back: null },
      }),
      input({ analysis: withBarcode(aamvaPayload('id-636020-not-real-id')) }),
      input({ analysis: withBarcode('NOT AAMVA') }),
      input({
        analysis: withForensics(
          {
            ela_score: 0.9,
            moire_score: 0.9,
            chroma: { colorfulness: 0, mean_saturation: 0 },
            copy_move_score: 0.9,
          },
          { color_cast_score: 0.9 },
        ),
        uploads: { front: { sha256: 'a'.repeat(64) }, back: { sha256: 'a'.repeat(64) } },
      }),
      input({ uploads: { front: null, back: null } }),
      input({
        analysis: withForensics(null, null),
        providers: { ageEstimate: { kind: 'error' }, publicFigure: { kind: 'error' } },
      }),
    ];
    const emitted = new Map<string, Set<string>>();
    for (const value of inputs) {
      for (const result of evaluateGovernmentIdChecks(value, EVERY_CHECK)) {
        const reasons = emitted.get(result.name) ?? new Set<string>();
        result.reasons.forEach((reason) => reasons.add(reason));
        emitted.set(result.name, reasons);
      }
    }
    for (const [name, reasons] of emitted) {
      expect(GOVERNMENT_ID_EVALUATOR_REASONS[name], name).toEqual(
        expect.arrayContaining([...reasons]),
      );
    }
  });
});

describe('GOVERNMENT_ID_EVALUATOR_REASONS (C29.4)', () => {
  it('lists the reasons of every §4.1 check, the NFC expiry included, each once and snake_case', () => {
    const ids = [
      ...listChecks('government_id').map((check) => check.id),
      'id_nfc_expired_detection',
    ];
    expect(Object.keys(GOVERNMENT_ID_EVALUATOR_REASONS).sort()).toEqual(ids.sort());
    for (const [id, reasons] of Object.entries(GOVERNMENT_ID_EVALUATOR_REASONS)) {
      expect(CHECK_IDS, id).toContain(id);
      expect(new Set(reasons).size, id).toBe(reasons.length);
      for (const reason of reasons) {
        // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
        expect(reason, id).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
      }
    }
    expect(Object.isFrozen(GOVERNMENT_ID_EVALUATOR_REASONS)).toBe(true);
  });

  it('never lists not_implemented: every check has an evaluator', () => {
    for (const reasons of Object.values(GOVERNMENT_ID_EVALUATOR_REASONS)) {
      expect(reasons).not.toContain('not_implemented');
    }
  });
});

describe('unreadableImageChecks (C29.4)', () => {
  it('fails the image quality checks, keeps vision checks pending and answers input_missing for the extraction checks', () => {
    const results = unreadableImageChecks('government_id', {
      checks: {
        id_blur_detection: { enabled: true, required: true },
        id_tamper_detection: { enabled: true, required: false },
        id_expired_detection: { enabled: true, required: true },
        id_repeat_detection: { enabled: true, required: false },
      },
    });
    expect(results.map((result) => [result.name, result.status, ...result.reasons])).toEqual([
      ['id_blur_detection', 'failed', 'image_unreadable'],
      ['id_tamper_detection', 'pending', 'image_unreadable'],
      ['id_expired_detection', 'not_applicable', 'input_missing'],
      ['id_repeat_detection', 'not_applicable', 'input_missing'],
    ]);
  });
});
