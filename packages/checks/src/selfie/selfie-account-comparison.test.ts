import { FACE_MATCH_DEFAULTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  selfieContextFor,
  selfieTemplate,
  threePoseAnalysis,
  withPose,
} from '../testing/selfie.js';
import { selfieAccountComparison } from './selfie-account-comparison.js';

const CHECK = 'selfie_account_comparison';
const account = (templates: number, bestCosine: number | null) => ({
  history: { account: { kind: 'compared' as const, templates, bestCosine } },
});

describe('selfieAccountComparison (C43)', () => {
  it('passes the face of the account earlier selfies at the shared 1:1 threshold', () => {
    expect(selfieAccountComparison(selfieContextFor())).toMatchObject({
      status: 'passed',
      type: 'fraud',
      metadata: { 'templates-compared': 2, 'best-cosine': 0.71 },
      provenance: {
        thresholds: { threshold: FACE_MATCH_DEFAULTS.threshold },
        'threshold-basis': { threshold: FACE_MATCH_DEFAULTS.basis },
      },
    });
  });

  it('fails when no earlier selfie of the account shows this face (face_mismatch)', () => {
    expect(selfieAccountComparison(selfieContextFor(account(3, 0.2)))).toMatchObject({
      status: 'failed',
      reasons: ['face_mismatch'],
    });
    expect(
      selfieAccountComparison(
        selfieContextFor(
          account(3, 0.5),
          selfieTemplate([CHECK], { [CHECK]: { threshold: 0.55 } }),
        ),
      ).status,
    ).toBe('failed');
  });

  it('needs the matching consent (not_consented), checked first', () => {
    for (const matchingConsent of [false, undefined]) {
      expect(
        selfieAccountComparison(selfieContextFor({ matchingConsent, ...account(3, 0.9) })),
      ).toMatchObject({ status: 'not_applicable', reasons: ['not_consented'], confidence: null });
    }
  });

  it('is no_reference_data when the account has no earlier template', () => {
    expect(selfieAccountComparison(selfieContextFor(account(0, null)))).toMatchObject({
      status: 'not_applicable',
      reasons: ['no_reference_data'],
    });
  });

  it('is input_missing without a centre face or the lookup, execution_error when it failed', () => {
    const noFace = withPose(threePoseAnalysis(), 'center', { face: null, faces: [] });
    expect(selfieAccountComparison(selfieContextFor({ analysis: noFace })).reasons).toEqual([
      'input_missing',
    ]);
    expect(selfieAccountComparison(selfieContextFor({ history: {} })).reasons).toEqual([
      'input_missing',
    ]);
    expect(
      selfieAccountComparison(selfieContextFor({ history: { account: { kind: 'error' } } }))
        .reasons,
    ).toEqual(['execution_error']);
  });
});
