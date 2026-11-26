/**
 * C62.6: the chip portrait (DG2, decoded only after its hash verified) against the inquiry's
 * latest selfie, at the provisional threshold (`FACE_MATCH_DEFAULTS`, not calibrated for chip
 * portraits). Without a selfie: `no_reference_data` (chip data alone does not identify the
 * presenter). Judged on DG2's integrity (C62.4). Model-based, so `beta` with a confidence.
 */
import { FACE_MATCH_DEFAULTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { nfcContext } from './context.js';
import { idNfcSelfieComparison } from './id-nfc-selfie-comparison.js';
import { embedding, nfcInput, nfcTemplate, paReport } from './testing.js';
import type { GovernmentIdNfcCheckInput } from './inputs.js';

const judge = (input: Partial<GovernmentIdNfcCheckInput> = {}, config?: Record<string, unknown>) =>
  idNfcSelfieComparison(
    nfcContext(
      nfcInput(input),
      nfcTemplate(config === undefined ? {} : { id_nfc_selfie_comparison: config }),
    ),
  );
const models = [{ id: 'sface@2021dec', sha256: 'f'.repeat(64) }];

describe('id_nfc_selfie_comparison (C62.6)', () => {
  it('passes the chip portrait of the selfie face, with a confidence and the model', () => {
    const result = judge({ faceModels: models });
    expect(result).toMatchObject({
      status: 'passed',
      reasons: [],
      stage: 'beta',
      metadata: {
        threshold: FACE_MATCH_DEFAULTS.threshold,
        'selfie-verification-id': 'ver_01JD0000000000000000000SF1',
        integrity: 'established',
      },
      provenance: {
        models,
        thresholds: { threshold: FACE_MATCH_DEFAULTS.threshold },
        'threshold-basis': { threshold: 'provisional' },
      },
    });
    expect(result.metadata.similarity).toBeCloseTo(Math.cos(0.1), 3);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('fails another face with face_mismatch, whatever the integrity short of broken', () => {
    expect(
      judge({ chipPortrait: { kind: 'face', embedding: embedding(Math.PI / 2) } }),
    ).toMatchObject({
      status: 'failed',
      reasons: ['face_mismatch'],
    });
    expect(
      judge({
        chipPortrait: { kind: 'face', embedding: embedding(Math.PI / 2) },
        passiveAuthentication: paReport({
          integrity: 'not_established',
          integrityReason: 'trust_anchor_unavailable',
        }),
      }).reasons,
    ).toEqual(['face_mismatch']);
  });

  it('takes the template threshold', () => {
    // cos(1) = 0.54: above the default threshold, below the template's 0.6 (the schema's top).
    const portrait = { kind: 'face', embedding: embedding(1) } as const;
    expect(judge({ chipPortrait: portrait }).status).toBe('passed');
    expect(judge({ chipPortrait: portrait }, { threshold: 0.6 })).toMatchObject({
      status: 'failed',
      provenance: { thresholds: { threshold: 0.6 } },
    });
  });

  it('answers no_reference_data without a selfie, execution_error when it cannot be embedded', () => {
    expect(judge({ selfie: { kind: 'missing' } })).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_reference_data'],
    });
    expect(judge({ selfie: { kind: 'error' } }).reasons).toEqual(['execution_error']);
  });

  it('answers input_missing without a face in the portrait, execution_error when vision failed', () => {
    expect(judge({ chipPortrait: { kind: 'no_face' } }).reasons).toEqual(['input_missing']);
    expect(judge({ chipPortrait: { kind: 'error' } }).reasons).toEqual(['execution_error']);
    expect(judge({ chipPortrait: { kind: 'not_decoded' } }).reasons).toEqual(['input_missing']);
  });

  it('judges on DG2 integrity (C62.4)', () => {
    const unverified = paReport({
      integrity: 'not_established',
      integrityReason: 'certificate_expired',
    });
    expect(judge({ passiveAuthentication: unverified })).toMatchObject({
      status: 'not_applicable',
      reasons: ['integrity_not_established'],
      metadata: { integrity: 'not_established' },
    });
    // DG2 not decoded because its hash did not verify: no evidence either way.
    expect(
      judge({
        passiveAuthentication: paReport({ dataGroups: { 1: 'identical', 2: 'not_identical' } }),
        chipPortrait: { kind: 'not_decoded' },
      }).reasons,
    ).toEqual(['integrity_not_established']);
    expect(
      judge({
        passiveAuthentication: paReport({
          integrity: 'broken',
          integrityReason: 'dg_hash_mismatch',
        }),
        chipPortrait: { kind: 'face', embedding: embedding(Math.PI / 2) },
      }),
    ).toMatchObject({ status: 'not_applicable', reasons: ['integrity_not_established'] });
  });
});
