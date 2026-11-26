import { describe, expect, it } from 'vitest';
import { goldenAnalysis } from '../testing/fixtures.js';
import { contextFor, template } from '../testing/context.js';
import { idPortraitClarityDetection } from './id-portrait-clarity-detection.js';

function withClarity(
  patch: Partial<{ face_width_px: number; sharpness: number; landmarks_score: number }> | null,
) {
  const analysis = goldenAnalysis();
  analysis.sides.front.portrait_clarity =
    patch === null
      ? null
      : { face_width_px: 205.42, sharpness: 187.36, landmarks_score: 0.9312, ...patch };
  return contextFor({ analysis });
}

describe('idPortraitClarityDetection', () => {
  it('passes a large, sharp, unobstructed portrait, with its thresholds and model', () => {
    const detector = { id: 'yunet-2026may', sha256: 'a'.repeat(64) };
    expect(
      idPortraitClarityDetection(contextFor({ models: { faceDetector: detector } })),
    ).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: { 'face-width-px': 205.42, sharpness: 187.36, 'landmarks-score': 0.9312 },
      confidence: null,
      provenance: {
        models: [detector],
        thresholds: { 'min-face-width-px': 64, 'min-sharpness': 15, 'min-landmarks-score': 0.5 },
      },
    });
  });

  it.each([
    [{ face_width_px: 40 }, ['portrait_too_small']],
    [{ sharpness: 3 }, ['portrait_blurry']],
    [{ landmarks_score: 0.2 }, ['portrait_obstructed']],
    [
      { face_width_px: 40, sharpness: 3, landmarks_score: 0.2 },
      ['portrait_too_small', 'portrait_blurry', 'portrait_obstructed'],
    ],
  ])('fails %j with %j', (patch, reasons) => {
    expect(idPortraitClarityDetection(withClarity(patch))).toMatchObject({
      status: 'failed',
      reasons,
    });
  });

  it('takes configured thresholds', () => {
    const context = contextFor(
      {},
      template({ id_portrait_clarity_detection: { 'min-face-width-px': 300 } }),
    );
    expect(idPortraitClarityDetection(context)).toMatchObject({
      status: 'failed',
      reasons: ['portrait_too_small'],
    });
  });

  it('answers input_missing when the portrait was not measured', () => {
    expect(idPortraitClarityDetection(withClarity(null))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});
