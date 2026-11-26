import { describe, expect, it } from 'vitest';
import type { OcclusionInput } from '../phase1/inputs.js';
import {
  selfieContextFor,
  selfieTemplate,
  threePoseAnalysis,
  withPose,
} from '../testing/selfie.js';
import { selfieFaceCoveringDetection } from './selfie-face-covering-detection.js';

const occlusion = (
  covering: Partial<OcclusionInput['covering']> = {},
  glasses: Partial<OcclusionInput['glasses']> = {},
) => {
  const current = threePoseAnalysis().poses.center.occlusion;
  if (current == null) {
    throw new Error('fixture without occlusion');
  }
  return {
    occlusion: {
      covering: { ...current.covering, ...covering },
      glasses: { ...current.glasses, ...glasses },
    },
  };
};
const withOcclusion = (patch: ReturnType<typeof occlusion>) =>
  selfieContextFor({ analysis: withPose(threePoseAnalysis(), 'center', patch) });

describe('selfieFaceCoveringDetection (H, user behaviour, v2, C43)', () => {
  it('passes an uncovered lower face with a margin confidence, as beta', () => {
    expect(selfieFaceCoveringDetection(selfieContextFor())).toMatchObject({
      status: 'passed',
      type: 'user_behavior',
      stage: 'beta',
      confidence: 0.84,
      metadata: {
        score: 0.08,
        components: { 'skin-fraction-ratio': 0.97, 'texture-ratio': 1.04, 'delta-e': 3.1 },
      },
      provenance: {
        'implementation-version': 2,
        thresholds: { 'max-face-covering-score': 0.5 },
        'threshold-basis': { 'max-face-covering-score': 'provisional' },
      },
    });
  });

  it('fails a score above max-face-covering-score (face_covered), with a retry hint type', () => {
    expect(selfieFaceCoveringDetection(withOcclusion(occlusion({ score: 0.8 })))).toMatchObject({
      status: 'failed',
      reasons: ['face_covered'],
      type: 'user_behavior',
      confidence: 0.6,
    });
    expect(
      selfieFaceCoveringDetection(
        selfieContextFor(
          {},
          selfieTemplate(['selfie_face_covering_detection'], {
            selfie_face_covering_detection: { 'max-face-covering-score': 0.05 },
          }),
        ),
      ).status,
    ).toBe('failed');
  });

  it('is input_missing when the forehead reference is not valid, or nothing was measured', () => {
    expect(
      selfieFaceCoveringDetection(withOcclusion(occlusion({ forehead_valid: false, score: 0 }))),
    ).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'], confidence: null });
    expect(
      selfieFaceCoveringDetection(
        selfieContextFor({
          analysis: withPose(threePoseAnalysis(), 'center', { occlusion: null }),
        }),
      ).reasons,
    ).toEqual(['input_missing']);
    expect(
      selfieFaceCoveringDetection(
        selfieContextFor({
          analysis: withPose(threePoseAnalysis(), 'center', { face: null, faces: [] }),
        }),
      ).reasons,
    ).toEqual(['input_missing']);
  });
});
