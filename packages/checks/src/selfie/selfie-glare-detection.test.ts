import { describe, expect, it } from 'vitest';
import {
  selfieContextFor,
  selfieTemplate,
  threePoseAnalysis,
  withPose,
} from '../testing/selfie.js';
import { selfieGlareDetection } from './selfie-glare-detection.js';

const faceQualityOf = (patch: Record<string, number>) => {
  const current = threePoseAnalysis().poses.center.face_quality;
  if (current == null) {
    throw new Error('fixture without face quality');
  }
  return { ...current, ...patch };
};

describe('selfieGlareDetection (C43)', () => {
  it('passes a centre face region without glare, recording the ratio and its threshold', () => {
    expect(selfieGlareDetection(selfieContextFor())).toMatchObject({
      status: 'passed',
      type: 'user_behavior',
      reasons: [],
      metadata: { 'face-glare-ratio': 0.001 },
      provenance: {
        thresholds: { 'max-face-glare-ratio': 0.05 },
        'threshold-basis': { 'max-face-glare-ratio': 'provisional' },
      },
    });
  });

  it('fails glare above max-face-glare-ratio on the centre face (face_glare)', () => {
    const glare = withPose(threePoseAnalysis(), 'center', {
      face_quality: faceQualityOf({ glare_ratio: 0.051 }),
    });
    expect(selfieGlareDetection(selfieContextFor({ analysis: glare }))).toMatchObject({
      status: 'failed',
      reasons: ['face_glare'],
    });
    expect(
      selfieGlareDetection(
        selfieContextFor(
          {},
          selfieTemplate(['selfie_glare_detection'], {
            selfie_glare_detection: { 'max-face-glare-ratio': 0.001 },
          }),
        ),
      ).status,
    ).toBe('passed');
  });

  it('ignores the side poses (the face region is judged on the centre)', () => {
    const sideGlare = withPose(threePoseAnalysis(), 'left', {
      face_quality: faceQualityOf({ glare_ratio: 0.4 }),
    });
    expect(selfieGlareDetection(selfieContextFor({ analysis: sideGlare })).status).toBe('passed');
  });

  it('is input_missing without a centre face or its region', () => {
    for (const patch of [{ face: null, faces: [], face_quality: null }, { face_quality: null }]) {
      expect(
        selfieGlareDetection(
          selfieContextFor({ analysis: withPose(threePoseAnalysis(), 'center', patch) }),
        ),
      ).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'] });
    }
  });
});
