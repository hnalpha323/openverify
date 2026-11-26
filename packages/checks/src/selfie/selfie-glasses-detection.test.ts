import { describe, expect, it } from 'vitest';
import type { OcclusionInput } from '../phase1/inputs.js';
import {
  selfieContextFor,
  selfieTemplate,
  threePoseAnalysis,
  withPose,
} from '../testing/selfie.js';
import { selfieGlassesDetection } from './selfie-glasses-detection.js';

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

describe('selfieGlassesDetection (H, user behaviour, C43)', () => {
  it('passes a face without glasses, with a margin confidence', () => {
    expect(selfieGlassesDetection(selfieContextFor())).toMatchObject({
      status: 'passed',
      type: 'user_behavior',
      stage: 'beta',
      confidence: 0.78,
      metadata: {
        score: 0.11,
        components: {
          'rim-edge-energy': 0.04,
          'lens-highlight-ratio': 0,
          'bridge-edge-density': 0.03,
        },
      },
      provenance: {
        thresholds: { 'max-glasses-score': 0.5 },
        'threshold-basis': { 'max-glasses-score': 'provisional' },
      },
    });
  });

  it('fails a score above max-glasses-score (glasses_detected)', () => {
    expect(selfieGlassesDetection(withOcclusion(occlusion({}, { score: 0.9 })))).toMatchObject({
      status: 'failed',
      reasons: ['glasses_detected'],
      confidence: 0.8,
    });
    expect(
      selfieGlassesDetection(
        selfieContextFor(
          {},
          selfieTemplate(['selfie_glasses_detection'], {
            selfie_glasses_detection: { 'max-glasses-score': 0.1 },
          }),
        ),
      ),
    ).toMatchObject({ status: 'failed', provenance: { thresholds: { 'max-glasses-score': 0.1 } } });
  });

  it('is input_missing without the measurement or a centre face', () => {
    expect(
      selfieGlassesDetection(
        selfieContextFor({
          analysis: withPose(threePoseAnalysis(), 'center', { occlusion: null }),
        }),
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'] });
    expect(
      selfieGlassesDetection(
        selfieContextFor({
          analysis: withPose(threePoseAnalysis(), 'center', { face: null, faces: [] }),
        }),
      ).reasons,
    ).toEqual(['input_missing']);
  });
});
