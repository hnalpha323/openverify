import { describe, expect, it } from 'vitest';
import type { SyntheticScoresInput } from '../phase1/inputs.js';
import {
  cameraCapture,
  selfieContextFor,
  selfieTemplate,
  threePoseAnalysis,
  withPose,
} from '../testing/selfie.js';
import {
  HEURISTIC_CONFIDENCE_CAP,
  selfieSuspiciousEntityDetection,
} from './selfie-suspicious-entity-detection.js';

const CHECK = 'selfie_suspicious_entity_detection';
const PROVIDER = { id: 'sandbox', sandbox: true };
const synthetic = (patch: Partial<SyntheticScoresInput>) => {
  const current = threePoseAnalysis().poses.center.synthetic;
  if (current == null) {
    throw new Error('fixture without synthetic scores');
  }
  return withPose(threePoseAnalysis(), 'center', { synthetic: { ...current, ...patch } });
};
const flagged = (isFlagged: boolean, score: number) => ({
  providers: {
    suspiciousEntity: {
      kind: 'result' as const,
      provider: PROVIDER,
      result: { flagged: isFlagged, score },
    },
  },
});

describe('selfieSuspiciousEntityDetection (H/A, C43)', () => {
  describe('the heuristic fusion (no provider bound)', () => {
    it('passes an unflagged face, beta, its confidence capped at 0.5', () => {
      expect(HEURISTIC_CONFIDENCE_CAP).toBe(0.5);
      expect(selfieSuspiciousEntityDetection(selfieContextFor())).toMatchObject({
        status: 'passed',
        type: 'fraud',
        stage: 'beta',
        confidence: 0.5,
        metadata: { method: 'heuristic', score: 0, coverage: 1 },
        provenance: {
          thresholds: { 'max-synthetic-face-score': 0.5 },
          'threshold-basis': { 'max-synthetic-face-score': 'provisional' },
        },
      });
    });

    it('fails a fused score above max-synthetic-face-score, its failure confidence capped at 0.5', () => {
      expect(
        selfieSuspiciousEntityDetection(
          selfieContextFor({ analysis: synthetic({ residual_peak_ratio: 6 }) }),
        ),
      ).toMatchObject({
        status: 'failed',
        reasons: ['synthetic_face_suspected'],
        confidence: 0.5,
        metadata: { method: 'heuristic', score: 0.8 },
      });
      expect(
        selfieSuspiciousEntityDetection(
          selfieContextFor(
            { analysis: synthetic({ residual_peak_ratio: 4 }) },
            selfieTemplate([CHECK], { [CHECK]: { 'max-synthetic-face-score': 0.3 } }),
          ),
        ).status,
      ).toBe('failed');
    });

    it('fails outright on a synthetic IPTC source type, and only records the others', () => {
      for (const type of ['trainedAlgorithmicMedia', 'compositeSynthetic']) {
        expect(
          selfieSuspiciousEntityDetection(
            selfieContextFor({ analysis: synthetic({ digital_source_type: type }) }),
          ),
        ).toMatchObject({
          status: 'failed',
          reasons: ['provenance_marks_synthetic'],
          confidence: 1,
          metadata: { 'digital-source-type': type },
        });
      }
      expect(
        selfieSuspiciousEntityDetection(
          selfieContextFor({
            analysis: synthetic({ digital_source_type: 'compositeWithTrainedAlgorithmicMedia' }),
          }),
        ),
      ).toMatchObject({
        status: 'passed',
        metadata: { 'digital-source-type': 'compositeWithTrainedAlgorithmicMedia' },
      });
    });

    it('reads the canonical landmark cue of an upload only', () => {
      const analysis = synthetic({ canonical_landmark_distance: 0.005 });
      expect(selfieSuspiciousEntityDetection(selfieContextFor({ analysis })).status).toBe('passed');
      expect(
        selfieSuspiciousEntityDetection(
          selfieContextFor({ analysis, capture: cameraCapture({ method: 'upload' }) }),
        ).status,
      ).toBe('failed');
    });

    it('is input_missing without a centre face or any cue: no input never passes', () => {
      expect(
        selfieSuspiciousEntityDetection(
          selfieContextFor({
            analysis: withPose(threePoseAnalysis(), 'center', { synthetic: null }),
          }),
        ),
      ).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'], confidence: null });
      expect(
        selfieSuspiciousEntityDetection(
          selfieContextFor({
            analysis: synthetic({
              spectral_tail_deviation: null,
              residual_peak_ratio: null,
              noise_inconsistency: null,
              jpeg_grid_misalignment: null,
            }),
          }),
        ).reasons,
      ).toEqual(['input_missing']);
      expect(
        selfieSuspiciousEntityDetection(
          selfieContextFor({
            analysis: withPose(threePoseAnalysis(), 'center', { face: null, faces: [] }),
          }),
        ).reasons,
      ).toEqual(['input_missing']);
    });
  });

  describe('a bound provider', () => {
    it('answers for the check, labelled with the provider', () => {
      expect(selfieSuspiciousEntityDetection(selfieContextFor(flagged(true, 0.9)))).toMatchObject({
        status: 'failed',
        reasons: ['provider_flagged'],
        confidence: 0.9,
        metadata: { method: 'provider', 'provider-score': 0.9 },
        provenance: { provider: PROVIDER },
      });
      expect(selfieSuspiciousEntityDetection(selfieContextFor(flagged(false, 0.2)))).toMatchObject({
        status: 'passed',
        confidence: 0.8,
      });
    });

    it('is execution_error when the provider failed, and the heuristic when none is bound', () => {
      expect(
        selfieSuspiciousEntityDetection(
          selfieContextFor({ providers: { suspiciousEntity: { kind: 'error' } } }),
        ),
      ).toMatchObject({ status: 'not_applicable', reasons: ['execution_error'] });
      expect(
        selfieSuspiciousEntityDetection(
          selfieContextFor({ providers: { suspiciousEntity: { kind: 'not_configured' } } }),
        ).metadata.method,
      ).toBe('heuristic');
    });

    it('still fails a synthetic IPTC source type outright', () => {
      expect(
        selfieSuspiciousEntityDetection(
          selfieContextFor({
            ...flagged(false, 0.1),
            analysis: synthetic({ digital_source_type: 'trainedAlgorithmicMedia' }),
          }),
        ),
      ).toMatchObject({
        status: 'failed',
        reasons: ['provenance_marks_synthetic'],
        confidence: 1,
      });
    });
  });
});
