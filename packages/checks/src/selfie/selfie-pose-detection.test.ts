import { describe, expect, it } from 'vitest';
import {
  YAW,
  cameraCapture,
  centerOnlyAnalysis,
  selfieContextFor,
  threePoseAnalysis,
  withPose,
} from '../testing/selfie.js';
import { selfiePoseDetection } from './selfie-pose-detection.js';

const SHA = 'c'.repeat(64);
const yawOf = (yaw: number) => ({
  head_pose: { yaw_ratio: yaw, roll_deg: 0, yaw_deg: null, pitch_deg: null, method: 'yunet-5pt' },
});

describe('selfiePoseDetection (C43)', () => {
  it('passes a frontal centre and two turns, recording the yaw ratios and the mesh source', () => {
    const mesh = { id: 'canonical-face-mesh', sha256: SHA };
    const detector = { id: 'yunet-2026may', sha256: SHA };
    const result = selfiePoseDetection(
      selfieContextFor({ models: { faceDetector: detector, canonicalFaceMesh: mesh } }),
    );
    expect(result).toMatchObject({
      status: 'passed',
      type: 'user_behavior',
      reasons: [],
      confidence: null,
      metadata: {
        poses: ['center', 'right', 'left'],
        'yaw-ratios': { center: 0.004, right: -0.118, left: 0.124 },
        'yaw-ratio-changes': { right: -0.122, left: 0.12 },
        'image-mirrored': false,
        'head-pose-method': 'yunet-5pt',
      },
      provenance: {
        models: [detector, mesh],
        thresholds: { 'max-center-yaw-ratio': 0.021, 'min-side-yaw-ratio-change': 0.077 },
        'threshold-basis': {
          'max-center-yaw-ratio': 'provisional',
          'min-side-yaw-ratio-change': 'provisional',
        },
      },
    });
  });

  it('fails an insufficient turn alone with the hint for that pose (UB, C43)', () => {
    const short = withPose(threePoseAnalysis(), 'left', yawOf(YAW.center + 0.05));
    expect(selfiePoseDetection(selfieContextFor({ analysis: short }))).toMatchObject({
      status: 'failed',
      reasons: ['pose_not_left'],
    });
    const wrongWay = withPose(threePoseAnalysis(), 'right', yawOf(0.1));
    expect(selfiePoseDetection(selfieContextFor({ analysis: wrongWay })).reasons).toEqual([
      'pose_not_right',
    ]);
  });

  it('fails a turned centre, and lists every failing pose once in pose order', () => {
    const turned = withPose(
      withPose(threePoseAnalysis(), 'center', yawOf(0.05)),
      'left',
      yawOf(0.06),
    );
    expect(selfiePoseDetection(selfieContextFor({ analysis: turned })).reasons).toEqual([
      'pose_not_center',
      'pose_not_left',
    ]);
  });

  it('judges only the centre of a centre-only step', () => {
    expect(
      selfiePoseDetection(
        selfieContextFor({
          analysis: centerOnlyAnalysis(),
          capture: cameraCapture({ prompts: ['center'], liveness: 'passive' }),
        }),
      ),
    ).toMatchObject({ status: 'passed', metadata: { poses: ['center'] } });
  });

  it('flips the yaw sign for a mirrored image (C41.1)', () => {
    const mirrored = cameraCapture({
      device: {
        labelIsFilePath: false,
        virtualCamera: false,
        webdriver: false,
        imageMirrored: true,
      },
    });
    expect(selfiePoseDetection(selfieContextFor({ capture: mirrored }))).toMatchObject({
      status: 'failed',
      reasons: ['pose_not_left', 'pose_not_right'],
      metadata: { 'image-mirrored': true },
    });
  });

  it('is input_missing for a missing file, never passed', () => {
    expect(
      selfiePoseDetection(
        selfieContextFor({ analysis: withPose(threePoseAnalysis(), 'left', null) }),
      ),
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
      metadata: { 'missing-poses': ['left'] },
    });
  });

  it('is input_missing when vision measured no head pose, and fails a pose without a face', () => {
    expect(
      selfiePoseDetection(
        selfieContextFor({ analysis: withPose(threePoseAnalysis(), 'right', { head_pose: null }) }),
      ),
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
      metadata: { 'unmeasured-poses': ['right'] },
    });
    expect(
      selfiePoseDetection(
        selfieContextFor({
          analysis: withPose(threePoseAnalysis(), 'right', {
            face: null,
            faces: [],
            head_pose: null,
          }),
        }),
      ),
    ).toMatchObject({ status: 'failed', reasons: ['pose_not_right'] });
  });
});
