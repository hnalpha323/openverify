import { SELFIE_CHECK_CONFIG_DEFAULTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { InvalidCheckConfigError } from '../result.js';
import {
  NOW,
  centerOnlyAnalysis,
  selfieContextFor,
  selfieInput,
  selfieTemplate,
} from '../testing/selfie.js';
import {
  consistencyOf,
  poseAnalysisOf,
  selfieCheckConfig,
  selfieContext,
  selfieModelsOf,
  selfieResultOptions,
} from './context.js';

const SHA = 'a'.repeat(64);

describe('selfieCheckConfig (C39.3, C43)', () => {
  it('takes every default, each with its basis, when the template sets none', () => {
    const config = selfieCheckConfig({ checks: {} }, 'selfie_pose_repeat_detection');
    expect(config.values).toEqual({
      'min-planarity-residual': 0.0045,
      'min-tracked-points': 20,
      'max-pose-cosine': 0.99,
    });
    expect(config.basis).toEqual({
      'min-planarity-residual': 'provisional',
      'min-tracked-points': 'provisional',
      'max-pose-cosine': 'provisional',
    });
  });

  it('lets the template override a key, which then has no basis (the operator set it)', () => {
    const config = selfieCheckConfig(
      selfieTemplate(['selfie_liveness_detection'], {
        selfie_liveness_detection: { 'min-passive-score': 0.7 },
      }),
      'selfie_liveness_detection',
    );
    expect(config.values).toEqual({ 'min-passive-score': 0.7, 'min-side-identity-cosine': 0.4 });
    expect(config.basis).toEqual({ 'min-side-identity-cosine': 'provisional' });
  });

  it('keeps a key the template sets that has no default (the Phase 1 whole-image keys)', () => {
    const config = selfieCheckConfig(
      selfieTemplate(['selfie_image_quality_detection'], {
        selfie_image_quality_detection: { 'min-brightness': 0.2 },
      }),
      'selfie_image_quality_detection',
    );
    expect(config.values['min-brightness']).toBe(0.2);
    expect(config.basis).not.toHaveProperty('min-brightness');
    expect(Object.keys(config.basis)).toEqual(
      Object.keys(SELFIE_CHECK_CONFIG_DEFAULTS.selfie_image_quality_detection ?? {}),
    );
  });

  it('refuses a config its registry schema refuses', () => {
    expect(() =>
      selfieCheckConfig(
        selfieTemplate(['selfie_liveness_detection'], {
          selfie_liveness_detection: { 'min-passive-score': 2 },
        }),
        'selfie_liveness_detection',
      ),
    ).toThrow(InvalidCheckConfigError);
  });

  it('is empty for a check that takes no config', () => {
    expect(selfieCheckConfig({ checks: {} }, 'selfie_public_figure_detection')).toEqual({
      values: {},
      basis: {},
    });
  });
});

describe('selfieResultOptions', () => {
  it('records the keys judged, with the basis of the defaults among them', () => {
    const config = {
      values: { 'min-passive-score': 0.7, 'min-side-identity-cosine': 0.4, other: 1 },
      basis: { 'min-side-identity-cosine': 'provisional' as const, other: 'provisional' as const },
    };
    expect(
      selfieResultOptions(config, ['min-passive-score', 'min-side-identity-cosine', 'unset'], {
        confidence: 0.5,
      }),
    ).toEqual({
      confidence: 0.5,
      thresholds: { 'min-passive-score': 0.7, 'min-side-identity-cosine': 0.4 },
      thresholdBasis: { 'min-side-identity-cosine': 'provisional' },
    });
  });
});

describe('selfieContext', () => {
  it('defaults to production, now and no capture', () => {
    const before = Date.now();
    const context = selfieContext({ analysis: centerOnlyAnalysis() }, { checks: {} });
    expect(context.environment).toBe('production');
    expect(context.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(context.capture).toBeNull();
    expect(context.cascade.prompts).toEqual(['center']);
  });

  it('keeps the environment, instant and capture it is given, and builds the cascade once', () => {
    const context = selfieContextFor({ environment: 'sandbox' });
    expect(context.environment).toBe('sandbox');
    expect(context.now).toBe(NOW);
    expect(context.capture?.prompts).toEqual(['center', 'right', 'left']);
    expect(context.cascade.judgedSides).toEqual(['right', 'left']);
  });

  it('reads the template config of the pose and quality checks into the cascade', () => {
    const context = selfieContext(
      selfieInput(),
      selfieTemplate(['selfie_pose_detection'], {
        selfie_pose_detection: { 'min-side-yaw-ratio-change': 0.2 },
      }),
    );
    expect(context.cascade.judgedSides).toEqual([]);
  });
});

describe('the context readers', () => {
  it('pick the named models in order, or none', () => {
    const detector = { id: 'yunet-2026may', sha256: SHA };
    const mesh = { id: 'canonical-face-mesh', sha256: SHA };
    const context = selfieContextFor({
      models: { faceDetector: detector, canonicalFaceMesh: mesh },
    });
    expect(selfieModelsOf(context, ['canonicalFaceMesh', 'antiSpoofV2', 'faceDetector'])).toEqual([
      mesh,
      detector,
    ]);
    expect(selfieModelsOf(selfieContextFor(), ['faceDetector'])).toBeUndefined();
  });

  it('read a pose analysis and a side pose consistency, or null', () => {
    const context = selfieContextFor({ analysis: centerOnlyAnalysis() });
    expect(poseAnalysisOf(context, 'center')).not.toBeNull();
    expect(poseAnalysisOf(context, 'left')).toBeNull();
    expect(consistencyOf(context, 'left')).toBeNull();
    expect(consistencyOf(selfieContextFor(), 'right')?.face_cosine_to_center).toBe(0.9);
    const poses = { ...selfieInput().analysis.poses };
    delete poses.left;
    expect(poseAnalysisOf(selfieContextFor({ analysis: { poses } }), 'left')).toBeNull();
  });
});
