import { checkResultSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  CREATED_AT,
  YAW,
  cameraCapture,
  centerOnlyAnalysis,
  selfieContextFor,
  selfieTemplate,
  threePoseAnalysis,
  withConsistency,
  withPose,
} from '../testing/selfie.js';
import type { SelfieDeviceFlags } from './inputs.js';
import {
  LIVENESS_PASS_CONFIDENCE_CAP,
  selfieLivenessDetection,
} from './selfie-liveness-detection.js';

const CHECK = 'selfie_liveness_detection';
const SHA = 'd'.repeat(64);
const CLEAN: SelfieDeviceFlags = {
  labelIsFilePath: false,
  virtualCamera: false,
  webdriver: false,
  imageMirrored: false,
};
const at = (seconds: number) => new Date(CREATED_AT.getTime() + seconds * 1000);
const passiveOf = (mean: number) => ({
  passive_liveness: { v2: mean, v1se: mean, mean, effective_scales: { v2: 2.4, v1se: 2.4 } },
});

describe('selfieLivenessDetection (C43)', () => {
  it('passes a live three-pose capture, its confidence capped at 0.6', () => {
    const v2 = { id: 'minifasnet-v2', sha256: SHA };
    const result = selfieLivenessDetection(selfieContextFor({ models: { antiSpoofV2: v2 } }));
    expect(result).toMatchObject({
      name: CHECK,
      status: 'passed',
      type: 'fraud',
      stage: 'beta',
      reasons: [],
      confidence: LIVENESS_PASS_CONFIDENCE_CAP,
      metadata: {
        components: { passive: 'passed', active: 'passed', integrity: 'passed' },
        'liveness-score': 0.97,
        'passive-scores': { center: 0.97, right: 0.97, left: 0.97 },
        'passive-effective-scales': { v2: 2.4, v1se: 2.4 },
        'face-cosines': { right: 0.9, left: 0.88 },
        'judged-poses': ['right', 'left'],
        'capture-method': 'camera',
        'order-followed': true,
        'timing-flags': [],
      },
      provenance: {
        models: [v2],
        thresholds: { 'min-passive-score': 0.5, 'min-side-identity-cosine': 0.4 },
        'threshold-basis': {
          'min-passive-score': 'provisional',
          'min-side-identity-cosine': 'provisional',
        },
      },
    });
    expect(LIVENESS_PASS_CONFIDENCE_CAP).toBe(0.6);
    expect(checkResultSchema.safeParse(result).success).toBe(true);
  });

  it('is capture_not_live without a capture, or for an upload', () => {
    for (const capture of [null, cameraCapture({ method: 'upload' })]) {
      expect(selfieLivenessDetection(selfieContextFor({ capture }))).toMatchObject({
        status: 'not_applicable',
        reasons: ['capture_not_live'],
        confidence: null,
        metadata: {
          components: {
            passive: 'not_executed',
            active: 'not_executed',
            integrity: 'not_executed',
          },
        },
      });
    }
  });

  describe('passive', () => {
    it('fails a centre below min-passive-score, with a margin confidence', () => {
      const analysis = withPose(threePoseAnalysis(), 'center', passiveOf(0.3));
      expect(selfieLivenessDetection(selfieContextFor({ analysis }))).toMatchObject({
        status: 'failed',
        reasons: ['passive_liveness_low'],
        confidence: 0.4,
        metadata: { components: { passive: 'failed', active: 'passed', integrity: 'passed' } },
      });
    });

    it('never passes without the passive measurement', () => {
      const analysis = withPose(threePoseAnalysis(), 'center', { passive_liveness: null });
      expect(selfieLivenessDetection(selfieContextFor({ analysis }))).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
        confidence: null,
        metadata: { components: { passive: 'not_executed', active: 'passed' } },
      });
    });

    it('is not executed when the centre fails image quality: liveness never fails on quality', () => {
      const centre = threePoseAnalysis().poses.center;
      const dark = withPose(threePoseAnalysis(), 'center', {
        quality: { ...centre.quality, brightness: 0.04, is_too_dark: true },
        ...passiveOf(0.1),
      });
      expect(selfieLivenessDetection(selfieContextFor({ analysis: dark }))).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
        metadata: { components: { passive: 'not_executed' }, 'liveness-score': 0.1 },
      });
    });

    it('records the side poses passive scores without judging them (decision 19)', () => {
      const analysis = withPose(threePoseAnalysis(), 'left', passiveOf(0.05));
      expect(selfieLivenessDetection(selfieContextFor({ analysis }))).toMatchObject({
        status: 'passed',
        metadata: { 'passive-scores': { left: 0.05 } },
      });
    });
  });

  describe('active', () => {
    it('fails a side face of another person (pose_identity_mismatch)', () => {
      const analysis = withConsistency(threePoseAnalysis(), 'right', {
        face_cosine_to_center: 0.3,
      });
      expect(selfieLivenessDetection(selfieContextFor({ analysis }))).toMatchObject({
        status: 'failed',
        reasons: ['pose_identity_mismatch'],
        confidence: 0.25,
        metadata: { components: { active: 'failed' }, 'face-cosines': { right: 0.3 } },
      });
      expect(
        selfieLivenessDetection(
          selfieContextFor(
            {},
            selfieTemplate([CHECK], { [CHECK]: { 'min-side-identity-cosine': 0.95 } }),
          ),
        ).reasons,
      ).toEqual(['pose_identity_mismatch']);
    });

    it('answers input_missing, never passed or failed, when a side pose was not judged', () => {
      const short = withConsistency(
        withPose(threePoseAnalysis(), 'left', {
          head_pose: {
            yaw_ratio: 0.03,
            roll_deg: 0,
            yaw_deg: null,
            pitch_deg: null,
            method: 'yunet-5pt',
          },
        }),
        'left',
        { face_cosine_to_center: 0.1 },
      );
      expect(selfieLivenessDetection(selfieContextFor({ analysis: short }))).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
        metadata: { components: { active: 'not_executed' }, 'judged-poses': ['right'] },
      });
      const unmeasured = withConsistency(threePoseAnalysis(), 'left', null);
      expect(selfieLivenessDetection(selfieContextFor({ analysis: unmeasured }))).toMatchObject({
        status: 'not_applicable',
        reasons: ['input_missing'],
      });
    });

    it('is not requested on a centre-only step, which then rests on the passive frame alone', () => {
      const analysis = withPose(centerOnlyAnalysis(), 'center', passiveOf(0.6));
      const result = selfieLivenessDetection(
        selfieContextFor({
          analysis,
          capture: cameraCapture({
            prompts: ['center'],
            liveness: 'passive',
            promptTimings: [{ pose: 'center', clientElapsedMs: 2100, receivedAt: at(2.4) }],
          }),
        }),
      );
      expect(result).toMatchObject({
        status: 'passed',
        confidence: 0.1667,
        metadata: {
          components: { passive: 'passed', active: 'not_requested', integrity: 'passed' },
        },
      });
    });
  });

  describe('integrity', () => {
    it.each([
      [{ ...CLEAN, labelIsFilePath: true }, ['automated_capture']],
      [{ ...CLEAN, webdriver: true }, ['automated_capture']],
    ])('fails %j in production with confidence 1', (device, reasons) => {
      expect(
        selfieLivenessDetection(selfieContextFor({ capture: cameraCapture({ device }) })),
      ).toMatchObject({
        status: 'failed',
        reasons,
        confidence: 1,
        metadata: { components: { integrity: 'failed' } },
      });
    });

    it('fails bytes replayed from another capture or inquiry in production', () => {
      expect(
        selfieLivenessDetection(
          selfieContextFor({ capture: cameraCapture({ replayedPoses: ['left'] }) }),
        ),
      ).toMatchObject({
        status: 'failed',
        reasons: ['capture_replayed'],
        metadata: { 'replayed-poses': ['left'] },
      });
    });

    it('records a test capture device in a sandbox and does not fail it (C43 sandbox rule)', () => {
      const capture = cameraCapture({
        device: { ...CLEAN, labelIsFilePath: true, webdriver: true },
        replayedPoses: ['center'],
      });
      const result = selfieLivenessDetection(selfieContextFor({ capture, environment: 'sandbox' }));
      expect(result).toMatchObject({
        status: 'passed',
        metadata: {
          components: { passive: 'passed', active: 'passed', integrity: 'not_executed' },
          'test-capture-device': true,
          'integrity-flags': ['file-path-label', 'webdriver', 'replayed-bytes'],
        },
      });
      const production = selfieLivenessDetection(selfieContextFor({ capture }));
      expect(production).toMatchObject({
        status: 'failed',
        reasons: ['automated_capture', 'capture_replayed'],
      });
    });

    it('counts a sandbox-waived integrity as not executed, which lowers the confidence', () => {
      const analysis = withPose(threePoseAnalysis(), 'center', passiveOf(0.7));
      const waived = selfieLivenessDetection(
        selfieContextFor({
          analysis,
          environment: 'sandbox',
          capture: cameraCapture({ device: { ...CLEAN, webdriver: true } }),
        }),
      );
      const clean = selfieLivenessDetection(selfieContextFor({ analysis, environment: 'sandbox' }));
      expect(clean).toMatchObject({ status: 'passed', confidence: 0.4 });
      expect(waived).toMatchObject({ status: 'passed', confidence: 0.3333 });
      expect(clean.metadata).not.toHaveProperty('test-capture-device');
    });

    it('sends a virtual camera to review when nothing failed (capture_device_suspicious)', () => {
      const capture = cameraCapture({ device: { ...CLEAN, virtualCamera: true } });
      expect(selfieLivenessDetection(selfieContextFor({ capture }))).toMatchObject({
        status: 'not_applicable',
        reasons: ['capture_device_suspicious'],
        confidence: null,
        metadata: { 'integrity-flags': ['virtual-camera'] },
      });
      const failing = withPose(threePoseAnalysis(), 'center', passiveOf(0.2));
      expect(
        selfieLivenessDetection(selfieContextFor({ analysis: failing, capture })),
      ).toMatchObject({
        status: 'failed',
        reasons: ['passive_liveness_low'],
      });
    });

    it('is not executed without a device snapshot or the replay lookup', () => {
      for (const capture of [
        cameraCapture({ device: null }),
        cameraCapture({ replayedPoses: null }),
      ]) {
        expect(selfieLivenessDetection(selfieContextFor({ capture }))).toMatchObject({
          status: 'passed',
          metadata: { components: { integrity: 'not_executed' } },
        });
      }
    });
  });

  describe('order and timing', () => {
    const analysis = withPose(threePoseAnalysis(), 'center', passiveOf(0.75));

    it('only lowers the confidence of a pass: batched uploads, and a broken order', () => {
      expect(selfieLivenessDetection(selfieContextFor({ analysis })).confidence).toBe(0.5);
      const batched = cameraCapture({
        promptTimings: [
          { pose: 'center', clientElapsedMs: 2100, receivedAt: at(2.4) },
          { pose: 'right', clientElapsedMs: 5300, receivedAt: at(5.7) },
          { pose: 'left', clientElapsedMs: 5400, receivedAt: at(5.8) },
        ],
      });
      expect(
        selfieLivenessDetection(selfieContextFor({ analysis, capture: batched })),
      ).toMatchObject({
        status: 'passed',
        confidence: 0.45,
        metadata: { 'order-followed': true, 'timing-flags': ['uploads-batched'] },
      });
      const reordered = cameraCapture({
        promptTimings: [
          { pose: 'center', clientElapsedMs: 2100, receivedAt: at(2.4) },
          { pose: 'right', clientElapsedMs: 8800, receivedAt: at(9.1) },
          { pose: 'left', clientElapsedMs: 5300, receivedAt: at(5.7) },
        ],
      });
      expect(
        selfieLivenessDetection(selfieContextFor({ analysis, capture: reordered })),
      ).toMatchObject({
        status: 'passed',
        confidence: 0.4,
        metadata: { 'order-followed': false, 'timing-flags': ['client-elapsed-not-increasing'] },
      });
    });

    it('never fails on the turn size: an insufficient turn leaves the side unjudged', () => {
      const short = withPose(threePoseAnalysis(), 'right', {
        head_pose: {
          yaw_ratio: YAW.center - 0.01,
          roll_deg: 0,
          yaw_deg: null,
          pitch_deg: null,
          method: 'yunet-5pt',
        },
      });
      expect(selfieLivenessDetection(selfieContextFor({ analysis: short })).status).toBe(
        'not_applicable',
      );
    });
  });
});
