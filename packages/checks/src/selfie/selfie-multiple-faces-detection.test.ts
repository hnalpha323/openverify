import { describe, expect, it } from 'vitest';
import type { VisionFaceInput } from '../phase1/inputs.js';
import {
  selfieContextFor,
  selfieTemplate,
  threePoseAnalysis,
  withPose,
} from '../testing/selfie.js';
import { mergeFaceBoxes, selfieMultipleFacesDetection } from './selfie-multiple-faces-detection.js';

const CHECK = 'selfie_multiple_faces_detection';
const PRIMARY: VisionFaceInput = { bbox: [244, 104, 152, 204], score: 0.95 };
const face = (x: number, y: number, width: number, height: number): VisionFaceInput => ({
  bbox: [x, y, width, height],
  score: 0.9,
});

describe('mergeFaceBoxes', () => {
  it('keeps the largest box first and merges a box overlapping a kept one at IoU above 0.3', () => {
    const overlapping = face(254, 114, 152, 204);
    const apart = face(10, 10, 60, 80);
    expect(mergeFaceBoxes([apart, PRIMARY, overlapping])).toEqual([PRIMARY, apart]);
  });

  it('keeps boxes that overlap at IoU 0.3 or less', () => {
    const touching = face(244 + 100, 104, 152, 204);
    expect(mergeFaceBoxes([PRIMARY, touching])).toHaveLength(2);
  });
});

describe('selfieMultipleFacesDetection (v2, C43)', () => {
  it('passes one face per pose, with the Phase 1 centre count', () => {
    expect(selfieMultipleFacesDetection(selfieContextFor())).toMatchObject({
      status: 'passed',
      type: 'fraud',
      reasons: [],
      metadata: { face_count: 1, 'face-counts': { center: 1, right: 1, left: 1 } },
      provenance: {
        'implementation-version': 2,
        thresholds: { 'min-secondary-face-area-ratio': 0.25 },
        'threshold-basis': { 'min-secondary-face-area-ratio': 'provisional' },
      },
    });
  });

  it('fails a second face on any pose whose area reaches a quarter of the primary', () => {
    const second = face(450, 120, 76, 102);
    const analysis = withPose(threePoseAnalysis(), 'left', { faces: [PRIMARY, second] });
    expect(selfieMultipleFacesDetection(selfieContextFor({ analysis }))).toMatchObject({
      status: 'failed',
      reasons: ['multiple_faces_present'],
      metadata: { 'secondary-face-poses': ['left'], 'face-counts': { left: 2 } },
    });
  });

  it('ignores a small background face and a duplicate detection of the same face', () => {
    const bystander = face(10, 10, 70, 100);
    const duplicate = face(250, 110, 150, 200);
    const analysis = withPose(threePoseAnalysis(), 'center', {
      faces: [PRIMARY, bystander, duplicate],
    });
    expect(selfieMultipleFacesDetection(selfieContextFor({ analysis })).status).toBe('passed');
    expect(
      selfieMultipleFacesDetection(
        selfieContextFor(
          { analysis },
          selfieTemplate([CHECK], { [CHECK]: { 'min-secondary-face-area-ratio': 0.2 } }),
        ),
      ).status,
    ).toBe('failed');
  });

  it('passes a pose without a face: selfie_image_quality_detection reports it', () => {
    const analysis = withPose(threePoseAnalysis(), 'center', { faces: [], face: null });
    expect(selfieMultipleFacesDetection(selfieContextFor({ analysis })).status).toBe('passed');
  });

  it('is input_missing when a prompted pose has no file and no other pose failed', () => {
    const analysis = withPose(threePoseAnalysis(), 'right', null);
    expect(selfieMultipleFacesDetection(selfieContextFor({ analysis }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
      metadata: { 'missing-poses': ['right'] },
    });
    const withSecond = withPose(analysis, 'left', { faces: [PRIMARY, face(450, 120, 100, 130)] });
    expect(selfieMultipleFacesDetection(selfieContextFor({ analysis: withSecond })).status).toBe(
      'failed',
    );
  });
});
