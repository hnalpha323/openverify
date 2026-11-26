/**
 * The C43 contract at the logic level: the cascade keeps one user mistake to one user-behaviour
 * failure, so the verification stays retryable with the right hint, and every result emits only
 * the reasons its evaluator declares, over a broad set of genuine and degraded inputs.
 */
import {
  checkResultSchema,
  decideVerification,
  type CheckId,
  type CheckResult,
  type VerificationTemplateConfig,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { evaluateSelfieChecks } from '../phase1/evaluate.js';
import {
  YAW,
  cameraCapture,
  centerOnlyAnalysis,
  selfieInput,
  threePoseAnalysis,
  withConsistency,
  withPose,
} from '../testing/selfie.js';
import type { SelfieCheckInput } from './inputs.js';
import { SELFIE_EVALUATOR_REASONS } from './reasons.js';

/** The C45.1 default template's selfie checks. */
const REQUIRED: CheckId[] = [
  'selfie_image_quality_detection',
  'selfie_pose_detection',
  'selfie_multiple_faces_detection',
  'selfie_liveness_detection',
  'selfie_id_comparison',
];
const ADVISORY: CheckId[] = [
  'selfie_glare_detection',
  'selfie_pose_repeat_detection',
  'selfie_account_comparison',
  'selfie_repeat_detection',
  'selfie_similar_background_detection',
  'selfie_face_covering_detection',
  'selfie_glasses_detection',
  'selfie_suspicious_entity_detection',
];
const DISABLED: CheckId[] = ['selfie_age_comparison', 'selfie_public_figure_detection'];

const DEFAULT_TEMPLATE: VerificationTemplateConfig = {
  checks: {
    ...Object.fromEntries(REQUIRED.map((id) => [id, { enabled: true, required: true }])),
    ...Object.fromEntries(ADVISORY.map((id) => [id, { enabled: true, required: false }])),
    ...Object.fromEntries(DISABLED.map((id) => [id, { enabled: false, required: false }])),
  },
};
const EVERY_CHECK: VerificationTemplateConfig = {
  checks: Object.fromEntries(
    [...REQUIRED, ...ADVISORY, ...DISABLED].map((id) => [id, { enabled: true, required: true }]),
  ),
};

const statusOf = (results: readonly CheckResult[], id: CheckId) =>
  results.find((result) => result.name === id)?.status;
const headPose = (yaw: number) => ({
  head_pose: { yaw_ratio: yaw, roll_deg: 0, yaw_deg: null, pitch_deg: null, method: 'yunet-5pt' },
});

describe('the C43 cascade contract', () => {
  it('passes a genuine three-pose capture on the C45.1 default template', () => {
    const results = evaluateSelfieChecks(selfieInput(), DEFAULT_TEMPLATE);
    expect(results.map((result) => [result.name, result.status])).toEqual(
      [...REQUIRED, ...ADVISORY].map((id) => [id, 'passed']),
    );
    expect(decideVerification(results, DEFAULT_TEMPLATE).status).toBe('passed');
  });

  it.each([
    ['left', YAW.center + 0.05, 'pose_not_left'],
    ['right', YAW.center - 0.05, 'pose_not_right'],
  ] as const)(
    'an insufficient %s turn (yaw ratio %d) alone fails only pose: retryable, hint %s',
    (pose, yaw, hint) => {
      const input = selfieInput({ analysis: withPose(threePoseAnalysis(), pose, headPose(yaw)) });
      const results = evaluateSelfieChecks(input, DEFAULT_TEMPLATE);
      const decision = decideVerification(results, DEFAULT_TEMPLATE);
      expect(decision).toMatchObject({
        status: 'failed',
        retryable: true,
        failingCheckIds: ['selfie_pose_detection'],
        hints: [{ checkId: 'selfie_pose_detection', reasons: [hint] }],
        advisoryFailedCheckIds: [],
      });
      expect(statusOf(results, 'selfie_liveness_detection')).not.toBe('failed');
      expect(statusOf(results, 'selfie_pose_repeat_detection')).not.toBe('failed');
    },
  );

  it('a too-dark centre alone fails only image quality: retryable, hint image_too_dark', () => {
    const centre = threePoseAnalysis().poses.center;
    const dark = withPose(threePoseAnalysis(), 'center', {
      quality: { ...centre.quality, brightness: 0.04, is_too_dark: true },
    });
    const results = evaluateSelfieChecks(selfieInput({ analysis: dark }), DEFAULT_TEMPLATE);
    expect(decideVerification(results, DEFAULT_TEMPLATE)).toMatchObject({
      status: 'failed',
      retryable: true,
      failingCheckIds: ['selfie_image_quality_detection'],
      hints: [{ checkId: 'selfie_image_quality_detection', reasons: ['image_too_dark'] }],
      advisoryFailedCheckIds: [],
    });
    expect(statusOf(results, 'selfie_liveness_detection')).not.toBe('failed');
    expect(statusOf(results, 'selfie_pose_repeat_detection')).not.toBe('failed');
  });

  it('never passes liveness when the pose check is not required and a side was not judged', () => {
    const template: VerificationTemplateConfig = {
      checks: {
        ...DEFAULT_TEMPLATE.checks,
        selfie_pose_detection: { enabled: false, required: false },
      },
    };
    const input = selfieInput({
      analysis: withPose(threePoseAnalysis(), 'left', headPose(YAW.center)),
    });
    const results = evaluateSelfieChecks(input, template);
    expect(statusOf(results, 'selfie_liveness_detection')).toBe('not_applicable');
    expect(decideVerification(results, template).status).toBe('needs_review');
  });
});

/** Genuine and degraded inputs that reach every evaluator path the contract tests can name. */
function inputs(): SelfieCheckInput[] {
  const genuine = selfieInput();
  const noCentreFace = withPose(threePoseAnalysis(), 'center', {
    face: null,
    faces: [],
    face_quality: null,
    head_pose: null,
    passive_liveness: null,
    occlusion: null,
    synthetic: null,
  });
  const provider = { id: 'sandbox', sandbox: true };
  return [
    genuine,
    selfieInput({ analysis: noCentreFace }),
    selfieInput({ analysis: withPose(threePoseAnalysis(), 'left', null) }),
    selfieInput({
      analysis: withConsistency(threePoseAnalysis(), 'right', { duplicate_of_center: true }),
    }),
    selfieInput({ capture: null, idReference: { kind: 'missing', missing: 'government_id' } }),
    selfieInput({ capture: cameraCapture({ device: null, replayedPoses: ['left'] }) }),
    selfieInput({
      capture: cameraCapture({
        device: {
          labelIsFilePath: true,
          virtualCamera: true,
          webdriver: true,
          imageMirrored: true,
        },
      }),
      environment: 'sandbox',
    }),
    selfieInput({
      analysis: centerOnlyAnalysis(),
      capture: cameraCapture({ prompts: ['center'], liveness: 'passive' }),
      matchingConsent: false,
      idReference: { kind: 'error' },
      history: {
        account: { kind: 'error' },
        repeat: { kind: 'error' },
        background: { kind: 'error' },
      },
    }),
    selfieInput({
      history: {
        account: { kind: 'compared', templates: 0, bestCosine: null },
        repeat: {
          kind: 'searched',
          searched: 9,
          truncated: true,
          bestCosine: 0.9,
          matchCosines: [0.9],
        },
        background: {
          kind: 'searched',
          candidates: [1, 2, 3].map((faceGroup) => ({
            faceCosine: 0,
            faceGroup,
            goodMatches: 500,
            inliers: 480,
            inlierRatio: 0.96,
          })),
          skipped: 0,
        },
      },
      idBirthdate: '2015-01-01',
      providers: {
        selfieAgeEstimate: { kind: 'result', provider, result: { age: 40 } },
        selfiePublicFigure: { kind: 'result', provider, result: { match: true, score: 0.9 } },
        suspiciousEntity: { kind: 'result', provider, result: { flagged: true, score: 0.8 } },
      },
    }),
    selfieInput({
      providers: {
        selfieAgeEstimate: { kind: 'error' },
        selfiePublicFigure: { kind: 'not_configured' },
        suspiciousEntity: { kind: 'error' },
      },
      idBirthdate: null,
    }),
  ];
}

describe('every selfie result (C39.2, C29.2)', () => {
  const results = inputs().flatMap((input) => evaluateSelfieChecks(input, EVERY_CHECK));

  it('evaluates every enabled check: none answers pending or not_implemented', () => {
    expect(results.length).toBe(inputs().length * 15);
    expect(results.filter((result) => result.status === 'pending')).toEqual([]);
  });

  it('emits only the reasons its evaluator declares', () => {
    for (const result of results) {
      const declared = SELFIE_EVALUATOR_REASONS[result.name] ?? [];
      for (const reason of result.reasons) {
        expect(declared, `${result.name}: ${reason}`).toContain(reason);
      }
    }
  });

  it('gives every not_applicable and failed result a reason, and a passed one none', () => {
    for (const result of results) {
      if (result.status === 'passed') {
        expect(result.reasons, result.name).toEqual([]);
      } else {
        expect(result.reasons.length, result.name).toBeGreaterThan(0);
      }
    }
  });

  it('satisfies the result contract, with a confidence on every H-tier verdict and on liveness', () => {
    for (const result of results) {
      expect(checkResultSchema.safeParse(result).success, result.name).toBe(true);
      if (
        (result.name === 'selfie_liveness_detection' ||
          result.name === 'selfie_face_covering_detection' ||
          result.name === 'selfie_glasses_detection' ||
          result.name === 'selfie_suspicious_entity_detection') &&
        (result.status === 'passed' || result.status === 'failed')
      ) {
        expect(result.confidence, result.name).not.toBeNull();
      }
    }
  });

  it('keeps biometric values out of every result', () => {
    const serialised = JSON.stringify(results);
    const genuine = selfieInput();
    const embedding = genuine.analysis.poses.center.face?.embedding ?? [];
    const layout = genuine.analysis.poses.center.background?.layout ?? [];
    expect(serialised).not.toContain(String(embedding[0]));
    expect(serialised).not.toContain(JSON.stringify(layout.slice(0, 4)).slice(1, -1));
    expect(serialised).not.toContain('landmarks');
  });
});
