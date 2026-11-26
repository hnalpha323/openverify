import { describe, expect, it } from 'vitest';
import {
  YAW,
  cameraCapture,
  centerOnlyAnalysis,
  selfieContextFor,
  selfieTemplate,
  threePoseAnalysis,
  withConsistency,
  withPose,
} from '../testing/selfie.js';
import { selfiePoseRepeatDetection } from './selfie-pose-repeat-detection.js';

const CHECK = 'selfie_pose_repeat_detection';
const yawOf = (yaw: number) => ({
  head_pose: { yaw_ratio: yaw, roll_deg: 0, yaw_deg: null, pitch_deg: null, method: 'yunet-5pt' },
});
const planarity = (trackedPoints: number, residual: number) => ({
  planarity: {
    tracked_points: trackedPoints,
    median_residual_ratio: residual,
    p90_residual_ratio: residual * 3,
  },
});

describe('selfiePoseRepeatDetection (C43)', () => {
  it('passes judged side poses that moved in 3-D, are distinct frames and not duplicates', () => {
    expect(selfiePoseRepeatDetection(selfieContextFor())).toMatchObject({
      status: 'passed',
      type: 'fraud',
      reasons: [],
      confidence: 1,
      metadata: {
        'judged-poses': ['right', 'left'],
        'face-cosines': { right: 0.9, left: 0.88 },
        'planarity-residuals': { right: 0.0094, left: 0.0094 },
        'tracked-points': { right: 52, left: 52 },
      },
      provenance: {
        thresholds: {
          'min-planarity-residual': 0.0045,
          'min-tracked-points': 20,
          'max-pose-cosine': 0.99,
        },
        'threshold-basis': {
          'min-planarity-residual': 'provisional',
          'min-tracked-points': 'provisional',
          'max-pose-cosine': 'provisional',
        },
      },
    });
  });

  it('is not_requested on a centre-only step', () => {
    expect(
      selfiePoseRepeatDetection(
        selfieContextFor({
          analysis: centerOnlyAnalysis(),
          capture: cameraCapture({ prompts: ['center'], liveness: 'passive' }),
        }),
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['not_requested'], confidence: null });
  });

  it('fails planar motion: the tracked points fit one homography (planar_motion)', () => {
    const analysis = withConsistency(threePoseAnalysis(), 'left', planarity(40, 0.002));
    expect(selfiePoseRepeatDetection(selfieContextFor({ analysis }))).toMatchObject({
      status: 'failed',
      reasons: ['planar_motion'],
      confidence: 0.5556,
    });
  });

  it('fails a side frame too similar to the centre (pose_frames_identical)', () => {
    const analysis = withConsistency(threePoseAnalysis(), 'right', {
      face_cosine_to_center: 0.995,
    });
    expect(selfiePoseRepeatDetection(selfieContextFor({ analysis }))).toMatchObject({
      status: 'failed',
      reasons: ['pose_frames_identical'],
      confidence: 0.5,
    });
    expect(
      selfiePoseRepeatDetection(
        selfieContextFor({}, selfieTemplate([CHECK], { [CHECK]: { 'max-pose-cosine': 0.85 } })),
      ).reasons,
    ).toEqual(['pose_frames_identical']);
  });

  it('fails a duplicate of the centre frame (duplicate_frame), listing reasons in C39.2 order', () => {
    const analysis = withConsistency(
      withConsistency(threePoseAnalysis(), 'right', { duplicate_of_center: true }),
      'left',
      { ...planarity(30, 0.001), face_cosine_to_center: 0.999 },
    );
    expect(selfiePoseRepeatDetection(selfieContextFor({ analysis }))).toMatchObject({
      status: 'failed',
      reasons: ['planar_motion', 'pose_frames_identical', 'duplicate_frame'],
      confidence: 1,
      metadata: { 'duplicate-poses': ['right'] },
    });
  });

  it('counts planarity only with min-tracked-points, recording it unmeasured and lowering the confidence', () => {
    const analysis = withConsistency(threePoseAnalysis(), 'left', planarity(10, 0.0001));
    expect(selfiePoseRepeatDetection(selfieContextFor({ analysis }))).toMatchObject({
      status: 'passed',
      confidence: 0.9167,
      metadata: { 'planarity-unmeasured': ['left'] },
    });
  });

  it('judges only the side poses whose pose and quality passed', () => {
    const analysis = withConsistency(
      withPose(threePoseAnalysis(), 'left', yawOf(YAW.center + 0.01)),
      'left',
      { duplicate_of_center: true },
    );
    expect(selfiePoseRepeatDetection(selfieContextFor({ analysis }))).toMatchObject({
      status: 'passed',
      metadata: { 'judged-poses': ['right'] },
    });
  });

  it('is input_missing when no side pose was judged (pose already failed)', () => {
    const analysis = withPose(
      withPose(threePoseAnalysis(), 'left', yawOf(YAW.center)),
      'right',
      yawOf(YAW.center),
    );
    expect(selfiePoseRepeatDetection(selfieContextFor({ analysis }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('is input_missing when the centre failed image quality: its reference frame is unusable', () => {
    const centre = threePoseAnalysis().poses.center;
    const analysis = withConsistency(
      withPose(threePoseAnalysis(), 'center', {
        quality: { ...centre.quality, brightness: 0.03, is_too_dark: true },
      }),
      'left',
      planarity(40, 0.001),
    );
    expect(selfiePoseRepeatDetection(selfieContextFor({ analysis }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('is input_missing, never passed, when a judged side has no measurement at all', () => {
    expect(
      selfiePoseRepeatDetection(
        selfieContextFor({ analysis: withConsistency(threePoseAnalysis(), 'left', null) }),
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'] });
    const nothing = withConsistency(threePoseAnalysis(), 'right', {
      face_cosine_to_center: null,
      planarity: null,
      duplicate_of_center: null,
    });
    expect(selfiePoseRepeatDetection(selfieContextFor({ analysis: nothing }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});
