import { readFileSync } from 'node:fs';
import {
  decideVerification,
  defaultTemplateConfig,
  listChecks,
  type VerificationTemplateConfig,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from '../result.js';
import {
  IMAGE_UNREADABLE_CHECK_REASON,
  NOT_IMPLEMENTED_CHECK_REASON,
  PHASE1_EVALUATED_CHECKS,
  evaluateGovernmentIdChecks,
  evaluateSelfieChecks,
  unreadableImageChecks,
  type GovernmentIdCheckInput,
  type SelfieCheckInput,
} from './evaluate.js';
import type { GovernmentIdAnalysisInput, SelfieAnalysisInput } from './inputs.js';

function fixture(name: string): unknown {
  const url = new URL(`../../../../contracts/fixtures/vision/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

const enabledAndRequired = (...ids: string[]): VerificationTemplateConfig => ({
  checks: Object.fromEntries(ids.map((id) => [id, { enabled: true, required: true }])),
});

const GOV_CHECKS = [
  'id_blur_detection',
  'id_glare_detection',
  'id_portrait_detection',
  'id_double_side_detection',
];
const SELFIE_CHECKS = [
  'selfie_image_quality_detection',
  'selfie_multiple_faces_detection',
  'selfie_id_comparison',
];

function governmentIdInput(): GovernmentIdCheckInput {
  return {
    analysis: fixture('analyze-government-id') as GovernmentIdAnalysisInput,
    requiredSides: 'both',
    uploads: { front: { sha256: 'a'.repeat(64) }, back: { sha256: 'b'.repeat(64) } },
  };
}

function selfieInput(): SelfieCheckInput {
  const portrait = (fixture('analyze-government-id') as GovernmentIdAnalysisInput).sides.front
    .portrait;
  return {
    analysis: fixture('analyze-selfie') as SelfieAnalysisInput,
    idPortrait: portrait && { embedding: portrait.embedding, verificationId: 'ver_X' },
  };
}

describe('PHASE1_EVALUATED_CHECKS', () => {
  it('lists the checks with a Phase 1 evaluator, by verification type', () => {
    expect(PHASE1_EVALUATED_CHECKS).toEqual({ government_id: GOV_CHECKS, selfie: SELFIE_CHECKS });
  });
});

describe('evaluateGovernmentIdChecks', () => {
  it('runs every enabled Phase 1 check, in configuration order', () => {
    const config = enabledAndRequired(...[...GOV_CHECKS].reverse());
    const results = evaluateGovernmentIdChecks(governmentIdInput(), config);
    expect(results.map((result) => result.name)).toEqual([...GOV_CHECKS].reverse());
    expect(results.every((result) => result.status === 'passed')).toBe(true);
    expect(decideVerification(results, config).status).toBe('passed');
  });

  it('skips disabled checks', () => {
    const config = enabledAndRequired('id_blur_detection');
    config.checks.id_glare_detection = { enabled: false, required: true };
    expect(evaluateGovernmentIdChecks(governmentIdInput(), config).map((r) => r.name)).toEqual([
      'id_blur_detection',
    ]);
  });

  it('evaluates every enabled government ID check: none answers not_implemented any more', () => {
    const config = enabledAndRequired('id_blur_detection', 'id_expired_detection');
    const results = evaluateGovernmentIdChecks(governmentIdInput(), config);
    expect(results.map((result) => [result.name, result.status])).toEqual([
      ['id_blur_detection', 'passed'],
      ['id_expired_detection', 'passed'],
    ]);
    expect(NOT_IMPLEMENTED_CHECK_REASON).toBe('not_implemented');
  });

  it('sends the golden card to review when every registry check is enabled, as A-tier checks have no provider (C30.1)', () => {
    const config = defaultTemplateConfig('government_id');
    for (const check of listChecks('government_id')) {
      config.checks[check.id] = { enabled: true, required: true };
    }
    const results = evaluateGovernmentIdChecks(
      { ...governmentIdInput(), environment: 'sandbox' },
      config,
    );
    expect(results).toHaveLength(listChecks('government_id').length);
    expect(results.filter((result) => result.status === 'pending')).toEqual([]);
    expect(results.filter((result) => result.status === 'failed')).toEqual([]);
    expect(decideVerification(results, config).status).toBe('needs_review');
  });

  it('fails the decision on a failing required check', () => {
    const input = governmentIdInput();
    input.analysis.sides.front.quality.is_blurry = true;
    // Phase 12A C9: a side whose document was measured is judged on that measure, so the
    // whole-image verdict decides only without one.
    input.analysis.sides.front.document_quality = null;
    const config = enabledAndRequired(...GOV_CHECKS);
    const decision = decideVerification(evaluateGovernmentIdChecks(input, config), config);
    expect(decision).toMatchObject({
      status: 'failed',
      failingCheckIds: ['id_blur_detection'],
      retryable: true,
    });
  });

  it.each([
    ['a selfie check', 'selfie_id_comparison'],
    ['an unknown check', 'id_teleport_detection'],
  ])('refuses a configuration naming %s', (_label, checkId) => {
    expect(() =>
      evaluateGovernmentIdChecks(governmentIdInput(), enabledAndRequired(checkId)),
    ).toThrow(InvalidCheckConfigError);
  });
});

describe('evaluateSelfieChecks', () => {
  it('runs every enabled Phase 1 check and passes the matching fixtures', () => {
    const config = enabledAndRequired(...SELFIE_CHECKS);
    const results = evaluateSelfieChecks(selfieInput(), config);
    expect(results.map((result) => [result.name, result.status])).toEqual([
      ['selfie_image_quality_detection', 'passed'],
      ['selfie_multiple_faces_detection', 'passed'],
      ['selfie_id_comparison', 'passed'],
    ]);
    expect(decideVerification(results, config).status).toBe('passed');
  });

  it('applies the configured face match threshold', () => {
    const input = { ...selfieInput(), faceMatchThreshold: 0.95 };
    const [result] = evaluateSelfieChecks(input, enabledAndRequired('selfie_id_comparison'));
    expect(result).toMatchObject({ status: 'failed', reasons: ['face_mismatch'] });
  });

  it('sends the selfie to review when there is no ID portrait to compare with (C43, was failed)', () => {
    const config = enabledAndRequired(...SELFIE_CHECKS);
    const results = evaluateSelfieChecks({ ...selfieInput(), idPortrait: null }, config);
    const decision = decideVerification(results, config);
    expect(decision).toMatchObject({
      status: 'needs_review',
      failingCheckIds: [],
      reviewCheckIds: ['selfie_id_comparison'],
    });
  });

  it('evaluates liveness: a selfie without a live capture is capture_not_live (C43)', () => {
    const config = enabledAndRequired('selfie_liveness_detection');
    expect(evaluateSelfieChecks(selfieInput(), config)).toEqual([
      expect.objectContaining({
        name: 'selfie_liveness_detection',
        status: 'not_applicable',
        reasons: ['capture_not_live'],
      }),
    ]);
  });

  it('evaluates every enabled §4.2 check: none answers not_implemented any more', () => {
    const config = defaultTemplateConfig('selfie');
    for (const check of listChecks('selfie')) {
      config.checks[check.id] = { enabled: true, required: true };
    }
    const results = evaluateSelfieChecks(selfieInput(), config);
    expect(results).toHaveLength(listChecks('selfie').length);
    expect(results.filter((result) => result.status === 'pending')).toEqual([]);
    expect(results.flatMap((result) => result.reasons)).not.toContain(NOT_IMPLEMENTED_CHECK_REASON);
  });

  it('refuses a government ID check in a selfie configuration', () => {
    expect(() =>
      evaluateSelfieChecks(selfieInput(), enabledAndRequired('id_blur_detection')),
    ).toThrow(InvalidCheckConfigError);
  });
});

describe('unreadableImageChecks', () => {
  const summary = (results: ReturnType<typeof unreadableImageChecks>) =>
    results.map((result) => [result.name, result.status, result.type, result.reasons]);

  it('fails the ID image quality checks and leaves the others pending, never passed', () => {
    const results = unreadableImageChecks('government_id', enabledAndRequired(...GOV_CHECKS));

    expect(IMAGE_UNREADABLE_CHECK_REASON).toBe('image_unreadable');
    expect(summary(results)).toEqual([
      ['id_blur_detection', 'failed', 'user_behavior', ['image_unreadable']],
      ['id_glare_detection', 'failed', 'user_behavior', ['image_unreadable']],
      ['id_portrait_detection', 'pending', 'fraud', ['image_unreadable']],
      ['id_double_side_detection', 'pending', 'user_behavior', ['image_unreadable']],
    ]);
    expect(results.every((result) => Object.keys(result.metadata).length === 0)).toBe(true);
  });

  it('makes the decision a retryable failure, so the user is asked for a new photo', () => {
    const config = enabledAndRequired(...GOV_CHECKS);
    const decision = decideVerification(unreadableImageChecks('government_id', config), config);

    expect(decision).toMatchObject({
      status: 'failed',
      failingCheckIds: ['id_blur_detection', 'id_glare_detection'],
      retryable: true,
    });
  });

  it('fails the selfie image quality check and leaves the face checks pending', () => {
    const results = unreadableImageChecks('selfie', enabledAndRequired(...SELFIE_CHECKS));

    expect(summary(results)).toEqual([
      ['selfie_image_quality_detection', 'failed', 'user_behavior', ['image_unreadable']],
      ['selfie_multiple_faces_detection', 'pending', 'fraud', ['image_unreadable']],
      ['selfie_id_comparison', 'pending', 'fraud', ['image_unreadable']],
    ]);
  });

  it('skips disabled checks and keeps configuration order', () => {
    const config: VerificationTemplateConfig = {
      checks: {
        id_portrait_detection: { enabled: true, required: true },
        id_glare_detection: { enabled: false, required: true },
        id_blur_detection: { enabled: true, required: false },
      },
    };

    expect(unreadableImageChecks('government_id', config).map((result) => result.name)).toEqual([
      'id_portrait_detection',
      'id_blur_detection',
    ]);
  });

  it('refuses a check of another verification type', () => {
    expect(() => unreadableImageChecks('selfie', enabledAndRequired('id_blur_detection'))).toThrow(
      InvalidCheckConfigError,
    );
  });
});
