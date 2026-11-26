import { checkResultSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  cameraCapture,
  centerOnlyAnalysis,
  selfieContextFor,
  selfieTemplate,
  threePoseAnalysis,
  withPose,
} from '../testing/selfie.js';
import { selfieImageQualityDetection } from './selfie-image-quality-detection.js';

const SHA = 'b'.repeat(64);
const CHECK = 'selfie_image_quality_detection';
const faceQualityOf = (patch: Record<string, number>) => {
  const current = threePoseAnalysis().poses.center.face_quality;
  if (current == null) {
    throw new Error('fixture without face quality');
  }
  return { ...current, ...patch };
};

describe('selfieImageQualityDetection (v2, C43)', () => {
  it('passes when every prompted pose is usable, with the Phase 1 metadata and the face box', () => {
    const result = selfieImageQualityDetection(
      selfieContextFor({ models: { faceDetector: { id: 'yunet-2026may', sha256: SHA } } }),
    );
    expect(result).toMatchObject({
      name: CHECK,
      status: 'passed',
      type: 'user_behavior',
      stage: 'beta',
      reasons: [],
      confidence: null,
    });
    expect(result.metadata).toMatchObject({
      blur_score: 410,
      brightness: 0.42,
      face_present: true,
      'face-blur-scores': { center: 180, right: 180, left: 180 },
      'face-box': [0.3813, 0.2167, 0.2375, 0.425],
    });
    expect(result.provenance).toEqual({
      'implementation-version': 2,
      models: [{ id: 'yunet-2026may', sha256: SHA }],
      thresholds: {
        'min-face-blur-score': 15,
        'min-face-width-px': 64,
        'min-face-height-ratio': 0.2,
        'min-image-short-side-px': 480,
      },
      'threshold-basis': {
        'min-face-blur-score': 'provisional',
        'min-face-width-px': 'provisional',
        'min-face-height-ratio': 'provisional',
        'min-image-short-side-px': 'provisional',
      },
    });
    expect(checkResultSchema.safeParse(result).success).toBe(true);
  });

  it('fails a too-dark centre alone with image_too_dark (UB, C43)', () => {
    const centre = threePoseAnalysis().poses.center;
    const dark = withPose(threePoseAnalysis(), 'center', {
      quality: { ...centre.quality, brightness: 0.05, is_too_dark: true },
    });
    expect(selfieImageQualityDetection(selfieContextFor({ analysis: dark }))).toMatchObject({
      status: 'failed',
      reasons: ['image_too_dark'],
      metadata: { 'pose-reasons': { center: ['image_too_dark'] } },
    });
  });

  it('judges every prompted pose, naming the pose that failed', () => {
    const noLeftFace = withPose(threePoseAnalysis(), 'left', {
      face: null,
      faces: [],
      face_quality: null,
      head_pose: null,
    });
    const blurryRight = withPose(noLeftFace, 'right', {
      face_quality: faceQualityOf({ blur_score: 3 }),
    });
    expect(selfieImageQualityDetection(selfieContextFor({ analysis: blurryRight }))).toMatchObject({
      status: 'failed',
      reasons: ['face_not_present', 'image_blurry'],
      metadata: {
        'pose-reasons': { right: ['image_blurry'], left: ['face_not_present'] },
      },
    });
  });

  it('applies the configured limits and records them, without a basis for the operator keys', () => {
    const result = selfieImageQualityDetection(
      selfieContextFor(
        {},
        selfieTemplate([CHECK], { [CHECK]: { 'min-brightness': 0.5, 'min-face-blur-score': 200 } }),
      ),
    );
    expect(result).toMatchObject({ status: 'failed', reasons: ['image_blurry', 'image_too_dark'] });
    expect(result.provenance.thresholds).toMatchObject({
      'min-brightness': 0.5,
      'min-face-blur-score': 200,
    });
    expect(result.provenance['threshold-basis']).not.toHaveProperty('min-face-blur-score');
    expect(result.provenance['threshold-basis']).toHaveProperty('min-face-width-px', 'provisional');
  });

  it('is input_missing, never passed, when a prompted pose has no file or was not measured', () => {
    const missingRight = withPose(threePoseAnalysis(), 'right', null);
    expect(selfieImageQualityDetection(selfieContextFor({ analysis: missingRight }))).toMatchObject(
      {
        status: 'not_applicable',
        reasons: ['input_missing'],
        metadata: { 'missing-poses': ['right'] },
      },
    );
    const unmeasured = withPose(threePoseAnalysis(), 'left', { face_quality: null });
    expect(selfieImageQualityDetection(selfieContextFor({ analysis: unmeasured }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
      metadata: { 'unmeasured-poses': ['left'] },
    });
  });

  it('judges a centre-only capture on the centre alone', () => {
    const result = selfieImageQualityDetection(
      selfieContextFor({
        analysis: centerOnlyAnalysis(),
        capture: cameraCapture({ prompts: ['center'] }),
      }),
    );
    expect(result.status).toBe('passed');
    expect(result.metadata['face-blur-scores']).toEqual({ center: 180 });
  });

  it('keeps the face box out without a face or an image size', () => {
    const noFace = withPose(centerOnlyAnalysis(), 'center', {
      face: null,
      faces: [],
      face_quality: null,
    });
    const result = selfieImageQualityDetection(
      selfieContextFor({ analysis: noFace, capture: null }),
    );
    expect(result).toMatchObject({ status: 'failed', reasons: ['face_not_present'] });
    expect(result.metadata).not.toHaveProperty('face-box');
    expect(result.metadata.face_present).toBe(false);
  });
});
