import { FACE_MATCH_DEFAULTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  CENTER_EMBEDDING,
  ID_EMBEDDING,
  selfieContextFor,
  selfieTemplate,
  threePoseAnalysis,
  unitVector,
  vectorAtCosine,
  withPose,
} from '../testing/selfie.js';
import { selfieIdComparison } from './selfie-id-comparison.js';

const CHECK = 'selfie_id_comparison';
const SHA = 'e'.repeat(64);

describe('selfieIdComparison (v2, C43)', () => {
  it('passes the same face at the shared threshold, recording the similarity and its basis', () => {
    const recognizer = { id: 'sface-2021dec', sha256: SHA };
    const result = selfieIdComparison(selfieContextFor({ models: { faceRecognizer: recognizer } }));
    expect(result).toMatchObject({
      name: CHECK,
      status: 'passed',
      type: 'fraud',
      reasons: [],
      metadata: {
        similarity: 0.62,
        threshold: FACE_MATCH_DEFAULTS.threshold,
        confidence_stage: 'beta',
        id_verification_id: 'ver_ID',
      },
      provenance: {
        'implementation-version': 2,
        models: [recognizer],
        thresholds: { threshold: FACE_MATCH_DEFAULTS.threshold },
        'threshold-basis': { threshold: FACE_MATCH_DEFAULTS.basis },
      },
    });
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.metadata.confidence).toBe(result.confidence);
    expect(JSON.stringify(result)).not.toContain(String(CENTER_EMBEDDING[0]));
  });

  it('fails another face below the threshold (face_mismatch)', () => {
    const other = vectorAtCosine(CENTER_EMBEDDING, 99, 0.1);
    expect(
      selfieIdComparison(
        selfieContextFor({
          idReference: { kind: 'portrait', verificationId: 'ver_ID', embedding: other },
        }),
      ),
    ).toMatchObject({
      status: 'failed',
      reasons: ['face_mismatch'],
      metadata: { similarity: 0.1 },
    });
  });

  it('applies the template threshold, which then has no basis', () => {
    const result = selfieIdComparison(
      selfieContextFor({}, selfieTemplate([CHECK], { [CHECK]: { threshold: 0.6 } })),
    );
    expect(result).toMatchObject({
      status: 'passed',
      provenance: { thresholds: { threshold: 0.6 } },
    });
    expect(result.provenance).not.toHaveProperty('threshold-basis');
    expect(
      selfieIdComparison(
        selfieContextFor({}, selfieTemplate([CHECK], { [CHECK]: { threshold: 0.6 } })),
      ).status,
    ).toBe('passed');
    const strict = selfieIdComparison(
      selfieContextFor(
        {
          idReference: {
            kind: 'portrait',
            verificationId: 'ver_ID',
            embedding: vectorAtCosine(CENTER_EMBEDDING, 5, 0.5),
          },
        },
        selfieTemplate([CHECK], { [CHECK]: { threshold: 0.55 } }),
      ),
    );
    expect(strict.status).toBe('failed');
  });

  it('is no_reference_data, naming what is missing, without an eligible ID portrait (was failed)', () => {
    for (const missing of ['government_id', 'portrait'] as const) {
      expect(
        selfieIdComparison(selfieContextFor({ idReference: { kind: 'missing', missing } })),
      ).toMatchObject({
        status: 'not_applicable',
        reasons: ['no_reference_data'],
        metadata: { reference: missing },
        confidence: null,
      });
    }
  });

  it('is input_missing without a centre face, and execution_error when the ID could not be embedded', () => {
    const noFace = withPose(threePoseAnalysis(), 'center', { face: null, faces: [] });
    expect(selfieIdComparison(selfieContextFor({ analysis: noFace }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
    expect(selfieIdComparison(selfieContextFor({ idReference: { kind: 'error' } }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['execution_error'],
    });
  });

  describe('the Phase 1 input (until the worker sends idReference)', () => {
    it('compares idPortrait, at the worker threshold when the template sets none', () => {
      const legacy = {
        idReference: undefined,
        idPortrait: { embedding: ID_EMBEDDING, verificationId: 'ver_P1' },
      };
      expect(selfieIdComparison(selfieContextFor(legacy))).toMatchObject({
        status: 'passed',
        metadata: { id_verification_id: 'ver_P1' },
        provenance: { 'threshold-basis': { threshold: 'calibrated' } },
      });
      const stricter = selfieIdComparison(
        selfieContextFor({ ...legacy, faceMatchThreshold: 0.95 }),
      );
      expect(stricter).toMatchObject({
        status: 'failed',
        provenance: { thresholds: { threshold: 0.95 } },
      });
      expect(stricter.provenance).not.toHaveProperty('threshold-basis');
    });

    it('reads a null portrait as no reference data, never a pass', () => {
      expect(
        selfieIdComparison(selfieContextFor({ idReference: undefined, idPortrait: null })),
      ).toMatchObject({
        status: 'not_applicable',
        reasons: ['no_reference_data'],
        metadata: { reference: 'portrait' },
      });
      expect(selfieIdComparison(selfieContextFor({ idReference: undefined }))).toMatchObject({
        status: 'not_applicable',
        reasons: ['no_reference_data'],
      });
    });
  });

  it('throws on a malformed embedding (a programming error, never a pass)', () => {
    expect(() =>
      selfieIdComparison(
        selfieContextFor({
          idReference: {
            kind: 'portrait',
            verificationId: 'v',
            embedding: unitVector(1).slice(0, 5),
          },
        }),
      ),
    ).toThrow(/invalid/);
  });
});
