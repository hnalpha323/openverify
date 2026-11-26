import { selfieConfigDefaults } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import type { SelfieAnalysisInput } from '../phase1/inputs.js';
import {
  YAW,
  cameraCapture,
  centerOnlyAnalysis,
  selfieTemplate,
  threePoseAnalysis,
  withPose,
} from '../testing/selfie.js';
import { judgePoseDirection, judgePoseQuality, promptedPoses, selfieCascade } from './cascade.js';
import type { SelfieCheckConfig } from './context.js';

const config = (checkId: string, overrides: Record<string, number> = {}): SelfieCheckConfig => ({
  values: { ...selfieConfigDefaults(checkId), ...overrides },
  basis: {},
});
const QUALITY = config('selfie_image_quality_detection');
const POSE = config('selfie_pose_detection');

const quality = (analysis: SelfieAnalysisInput, pose: 'center' | 'left' | 'right' = 'center') =>
  judgePoseQuality(analysis, pose, QUALITY);
const direction = (
  analysis: SelfieAnalysisInput,
  pose: 'center' | 'left' | 'right',
  mirrored = false,
) => judgePoseDirection(analysis, pose, POSE, mirrored);

const faceQuality = (patch: Record<string, number>) => {
  const current = threePoseAnalysis().poses.center.face_quality;
  if (current == null) {
    throw new Error('fixture without face quality');
  }
  return { ...current, ...patch };
};

describe('promptedPoses', () => {
  it('is the capture prompts when there is a capture', () => {
    expect(promptedPoses(centerOnlyAnalysis(), cameraCapture())).toEqual([
      'center',
      'right',
      'left',
    ]);
  });

  it('is the analysed poses, centre first, without a capture (before Phase 4)', () => {
    expect(promptedPoses(centerOnlyAnalysis(), null)).toEqual(['center']);
    expect(promptedPoses(threePoseAnalysis(), null)).toEqual(['center', 'left', 'right']);
    expect(promptedPoses(withPose(threePoseAnalysis(), 'left', null), null)).toEqual([
      'center',
      'right',
    ]);
  });
});

describe('judgePoseQuality (selfie_image_quality_detection per pose)', () => {
  it('passes a usable pose', () => {
    expect(quality(threePoseAnalysis())).toEqual({ pose: 'center', status: 'passed', reasons: [] });
    expect(quality(threePoseAnalysis(), 'left').status).toBe('passed');
  });

  it('reports a prompted pose without a file as missing', () => {
    expect(quality(withPose(threePoseAnalysis(), 'right', null), 'right')).toEqual({
      pose: 'right',
      status: 'missing',
      reasons: [],
    });
  });

  it('fails a pose without a face, on any pose', () => {
    const noFace = { face: null, faces: [], face_quality: null, head_pose: null };
    expect(quality(withPose(threePoseAnalysis(), 'center', noFace))).toMatchObject({
      status: 'failed',
      reasons: ['face_not_present'],
    });
    expect(quality(withPose(threePoseAnalysis(), 'left', noFace), 'left')).toMatchObject({
      status: 'failed',
      reasons: ['face_not_present'],
    });
  });

  it('fails a blurry face region on any pose, against min-face-blur-score', () => {
    const blurry = withPose(threePoseAnalysis(), 'left', {
      face_quality: faceQuality({ blur_score: 14.9 }),
    });
    expect(quality(blurry, 'left')).toMatchObject({ status: 'failed', reasons: ['image_blurry'] });
    expect(
      judgePoseQuality(
        threePoseAnalysis(),
        'left',
        config('selfie_image_quality_detection', { 'min-face-blur-score': 200 }),
      ),
    ).toMatchObject({ status: 'failed', reasons: ['image_blurry'] });
  });

  it('judges the centre whole image as Phase 1 did: vision verdicts, or the configured limits', () => {
    const centre = threePoseAnalysis().poses.center;
    const withQuality = (patch: Partial<typeof centre.quality>) =>
      withPose(threePoseAnalysis(), 'center', { quality: { ...centre.quality, ...patch } });
    expect(quality(withQuality({ is_blurry: true })).reasons).toEqual(['image_blurry']);
    expect(quality(withQuality({ is_too_dark: true })).reasons).toEqual(['image_too_dark']);
    expect(quality(withQuality({ is_too_bright: true })).reasons).toEqual(['image_too_bright']);
    const limits = config('selfie_image_quality_detection', {
      'min-blur-score': 500,
      'min-brightness': 0.5,
    });
    expect(judgePoseQuality(threePoseAnalysis(), 'center', limits).reasons).toEqual([
      'image_blurry',
      'image_too_dark',
    ]);
    expect(
      judgePoseQuality(
        threePoseAnalysis(),
        'center',
        config('selfie_image_quality_detection', { 'max-brightness': 0.3 }),
      ).reasons,
    ).toEqual(['image_too_bright']);
  });

  it('leaves the side poses whole-image verdicts to the face region', () => {
    const left = threePoseAnalysis().poses.left;
    const dark = withPose(threePoseAnalysis(), 'left', {
      quality: {
        ...(left?.quality ?? threePoseAnalysis().poses.center.quality),
        is_too_dark: true,
        is_blurry: true,
      },
    });
    expect(quality(dark, 'left').status).toBe('passed');
  });

  it('fails a small centre face and a low-resolution centre image', () => {
    expect(
      quality(
        withPose(threePoseAnalysis(), 'center', { face_quality: faceQuality({ width_px: 63 }) }),
      ).reasons,
    ).toEqual(['face_too_small']);
    expect(
      quality(
        withPose(threePoseAnalysis(), 'center', {
          face_quality: faceQuality({ height_ratio: 0.19, width_px: 40 }),
        }),
      ).reasons,
    ).toEqual(['face_too_small']);
    expect(
      quality(withPose(threePoseAnalysis(), 'center', { image: { width: 640, height: 479 } }))
        .reasons,
    ).toEqual(['resolution_too_low']);
    expect(
      quality(
        withPose(threePoseAnalysis(), 'left', { face_quality: faceQuality({ width_px: 10 }) }),
        'left',
      ).status,
    ).toBe('passed');
  });

  it('lists every reason once, in the reasons order', () => {
    const centre = threePoseAnalysis().poses.center;
    const worst = withPose(threePoseAnalysis(), 'center', {
      quality: { ...centre.quality, is_blurry: true, is_too_dark: true },
      face_quality: faceQuality({ blur_score: 1, width_px: 20 }),
      image: { width: 320, height: 240 },
    });
    expect(quality(worst)).toMatchObject({
      status: 'failed',
      reasons: ['image_blurry', 'image_too_dark', 'face_too_small', 'resolution_too_low'],
    });
  });

  it('never passes a face whose region or image size vision did not measure', () => {
    expect(
      quality(withPose(threePoseAnalysis(), 'left', { face_quality: null }), 'left').status,
    ).toBe('unmeasured');
    expect(quality(withPose(threePoseAnalysis(), 'center', { image: null })).status).toBe(
      'unmeasured',
    );
    const centre = threePoseAnalysis().poses.center;
    expect(
      quality(
        withPose(threePoseAnalysis(), 'center', {
          face_quality: null,
          quality: { ...centre.quality, is_too_bright: true },
        }),
      ),
    ).toMatchObject({ status: 'failed', reasons: ['image_too_bright'] });
  });
});

describe('judgePoseDirection (selfie_pose_detection per pose)', () => {
  it('passes a frontal centre and fails a turned one', () => {
    expect(direction(threePoseAnalysis(), 'center')).toEqual({
      pose: 'center',
      status: 'passed',
      reason: null,
      yawRatio: YAW.center,
      yawRatioChange: null,
    });
    for (const yaw of [0.05, -0.05, 0.0211]) {
      const turned = withPose(threePoseAnalysis(), 'center', {
        head_pose: {
          yaw_ratio: yaw,
          roll_deg: 0,
          yaw_deg: null,
          pitch_deg: null,
          method: 'yunet-5pt',
        },
      });
      expect(direction(turned, 'center'), String(yaw)).toMatchObject({
        status: 'failed',
        reason: 'pose_not_center',
      });
    }
  });

  it('passes a side turned far enough in its own direction (the user left is positive)', () => {
    expect(direction(threePoseAnalysis(), 'left')).toMatchObject({
      status: 'passed',
      yawRatio: YAW.left,
      yawRatioChange: YAW.left - YAW.center,
    });
    expect(direction(threePoseAnalysis(), 'right')).toMatchObject({
      status: 'passed',
      yawRatioChange: YAW.right - YAW.center,
    });
  });

  it('fails an insufficient turn, and a turn the wrong way', () => {
    const yawOf = (yaw: number) => ({
      head_pose: {
        yaw_ratio: yaw,
        roll_deg: 0,
        yaw_deg: null,
        pitch_deg: null,
        method: 'yunet-5pt',
      },
    });
    expect(
      direction(withPose(threePoseAnalysis(), 'left', yawOf(YAW.center + 0.07)), 'left'),
    ).toMatchObject({
      status: 'failed',
      reason: 'pose_not_left',
    });
    expect(direction(withPose(threePoseAnalysis(), 'left', yawOf(-0.12)), 'left').reason).toBe(
      'pose_not_left',
    );
    expect(direction(withPose(threePoseAnalysis(), 'right', yawOf(0.12)), 'right').reason).toBe(
      'pose_not_right',
    );
    expect(
      judgePoseDirection(
        threePoseAnalysis(),
        'left',
        config('selfie_pose_detection', { 'min-side-yaw-ratio-change': 0.2 }),
        false,
      ).status,
    ).toBe('failed');
  });

  it('flips the sign for a mirrored image (C41.1)', () => {
    expect(direction(threePoseAnalysis(), 'left', true)).toMatchObject({
      status: 'failed',
      reason: 'pose_not_left',
      yawRatio: -YAW.left,
    });
    const swapped = withPose(
      withPose(threePoseAnalysis(), 'left', {
        head_pose: {
          yaw_ratio: YAW.right,
          roll_deg: 0,
          yaw_deg: null,
          pitch_deg: null,
          method: 'yunet-5pt',
        },
      }),
      'right',
      {
        head_pose: {
          yaw_ratio: YAW.left,
          roll_deg: 0,
          yaw_deg: null,
          pitch_deg: null,
          method: 'yunet-5pt',
        },
      },
    );
    expect(direction(swapped, 'left', true).status).toBe('passed');
    expect(direction(swapped, 'right', true).status).toBe('passed');
  });

  it('fails a pose without a face, and a missing file is missing', () => {
    const noFace = { face: null, faces: [], face_quality: null, head_pose: null };
    expect(direction(withPose(threePoseAnalysis(), 'left', noFace), 'left')).toMatchObject({
      status: 'failed',
      reason: 'pose_not_left',
    });
    expect(direction(withPose(threePoseAnalysis(), 'center', noFace), 'center')).toMatchObject({
      status: 'failed',
      reason: 'pose_not_center',
    });
    expect(direction(withPose(threePoseAnalysis(), 'right', null), 'right').status).toBe('missing');
  });

  it('cannot judge a head pose vision did not measure, nor a side without a centre reference', () => {
    expect(
      direction(withPose(threePoseAnalysis(), 'left', { head_pose: null }), 'left').status,
    ).toBe('unmeasured');
    const noCentreFace = withPose(threePoseAnalysis(), 'center', {
      face: null,
      faces: [],
      head_pose: null,
    });
    expect(direction(noCentreFace, 'left')).toMatchObject({
      status: 'unmeasured',
      yawRatio: YAW.left,
      yawRatioChange: null,
    });
  });
});

describe('selfieCascade', () => {
  it('judges every prompted pose, and liveness may judge both sides of a correct capture', () => {
    const cascade = selfieCascade(threePoseAnalysis(), cameraCapture(), { checks: {} });
    expect(cascade.prompts).toEqual(['center', 'right', 'left']);
    expect(cascade.sidePrompts).toEqual(['right', 'left']);
    expect(cascade.quality.map((entry) => [entry.pose, entry.status])).toEqual([
      ['center', 'passed'],
      ['right', 'passed'],
      ['left', 'passed'],
    ]);
    expect(cascade.pose.map((entry) => entry.status)).toEqual(['passed', 'passed', 'passed']);
    expect(cascade.centerQualityPassed).toBe(true);
    expect(cascade.judgedSides).toEqual(['right', 'left']);
    expect(cascade.imageMirrored).toBe(false);
  });

  it('keeps a side out of judgement when its pose or its quality failed', () => {
    const turnedTooLittle = withPose(threePoseAnalysis(), 'left', {
      head_pose: {
        yaw_ratio: 0.03,
        roll_deg: 0,
        yaw_deg: null,
        pitch_deg: null,
        method: 'yunet-5pt',
      },
    });
    expect(selfieCascade(turnedTooLittle, cameraCapture(), { checks: {} }).judgedSides).toEqual([
      'right',
    ]);
    const blurryRight = withPose(threePoseAnalysis(), 'right', {
      face_quality: faceQuality({ blur_score: 2 }),
    });
    expect(selfieCascade(blurryRight, cameraCapture(), { checks: {} }).judgedSides).toEqual([
      'left',
    ]);
  });

  it('knows when the centre quality failed', () => {
    const centre = threePoseAnalysis().poses.center;
    const dark = withPose(threePoseAnalysis(), 'center', {
      quality: { ...centre.quality, is_too_dark: true, brightness: 0.05 },
    });
    const cascade = selfieCascade(dark, cameraCapture(), { checks: {} });
    expect(cascade.centerQualityPassed).toBe(false);
    expect(cascade.judgedSides).toEqual(['right', 'left']);
  });

  it('reads the image-mirrored flag of the device snapshot', () => {
    const capture = cameraCapture({
      device: {
        labelIsFilePath: false,
        virtualCamera: false,
        webdriver: false,
        imageMirrored: true,
      },
    });
    const cascade = selfieCascade(threePoseAnalysis(), capture, { checks: {} });
    expect(cascade.imageMirrored).toBe(true);
    expect(cascade.judgedSides).toEqual([]);
  });

  it('applies the pose and quality config even when those checks are disabled', () => {
    const template = selfieTemplate([], {});
    template.checks.selfie_image_quality_detection = {
      enabled: false,
      required: false,
      config: { 'min-face-blur-score': 1000 },
    };
    expect(selfieCascade(threePoseAnalysis(), cameraCapture(), template).judgedSides).toEqual([]);
  });

  it('prompts a centre-only capture without side poses', () => {
    const cascade = selfieCascade(centerOnlyAnalysis(), cameraCapture({ prompts: ['center'] }), {
      checks: {},
    });
    expect(cascade.sidePrompts).toEqual([]);
    expect(cascade.judgedSides).toEqual([]);
  });
});
