import { FACE_MATCH_DEFAULTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  selfieContextFor,
  selfieTemplate,
  threePoseAnalysis,
  withPose,
} from '../testing/selfie.js';
import type { BackgroundCandidateInput } from './inputs.js';
import { selfieSimilarBackgroundDetection } from './selfie-similar-background-detection.js';

const CHECK = 'selfie_similar_background_detection';
const candidate = (faceGroup: number, patch: Partial<BackgroundCandidateInput> = {}) => ({
  faceCosine: 0.1,
  faceGroup,
  goodMatches: 400,
  inliers: 380,
  inlierRatio: 0.95,
  ...patch,
});
const search = (candidates: BackgroundCandidateInput[], skipped = 0) => ({
  history: { background: { kind: 'searched' as const, candidates, skipped } },
});

describe('selfieSimilarBackgroundDetection (C43)', () => {
  it('passes without verified candidates, recording the coverage and the thresholds', () => {
    expect(selfieSimilarBackgroundDetection(selfieContextFor())).toMatchObject({
      status: 'passed',
      type: 'fraud',
      metadata: { coverage: 0.75, compared: 0, skipped: 0, verified: 0, 'distinct-faces': 0 },
      provenance: {
        thresholds: {
          'min-orb-inliers': 100,
          'min-inlier-ratio': 0.5,
          'window-days': 30,
          'min-distinct-faces': 3,
          'min-coverage': 0.25,
          'face-threshold': FACE_MATCH_DEFAULTS.threshold,
        },
        'threshold-basis': { 'min-orb-inliers': 'provisional', 'face-threshold': 'calibrated' },
      },
    });
  });

  it('fails a background seen with at least min-distinct-faces other verified faces', () => {
    const result = selfieSimilarBackgroundDetection(
      selfieContextFor(search([candidate(1), candidate(2), candidate(3)], 1)),
    );
    expect(result).toMatchObject({
      status: 'failed',
      reasons: ['background_seen_with_other_faces'],
      metadata: { compared: 3, skipped: 1, verified: 3, 'distinct-faces': 3 },
    });
  });

  it('counts distinct faces, and only candidates meeting both ORB limits with another face', () => {
    const sameFace = [candidate(1), candidate(1), candidate(2)];
    expect(selfieSimilarBackgroundDetection(selfieContextFor(search(sameFace))).status).toBe(
      'passed',
    );
    const weak = [
      candidate(1),
      candidate(2),
      candidate(3, { inliers: 99 }),
      candidate(4, { inlierRatio: 0.49 }),
      candidate(5, { faceCosine: FACE_MATCH_DEFAULTS.threshold }),
    ];
    expect(selfieSimilarBackgroundDetection(selfieContextFor(search(weak)))).toMatchObject({
      status: 'passed',
      metadata: { verified: 2, 'distinct-faces': 2 },
    });
    expect(
      selfieSimilarBackgroundDetection(
        selfieContextFor(
          search(weak),
          selfieTemplate([CHECK], { [CHECK]: { 'min-distinct-faces': 2 } }),
        ),
      ).status,
    ).toBe('failed');
  });

  it('is input_missing when the background coverage is below min-coverage, or unmeasured', () => {
    const centre = threePoseAnalysis().poses.center;
    const covered = withPose(threePoseAnalysis(), 'center', {
      background: centre.background == null ? null : { ...centre.background, coverage: 0.2 },
    });
    expect(selfieSimilarBackgroundDetection(selfieContextFor({ analysis: covered }))).toMatchObject(
      {
        status: 'not_applicable',
        reasons: ['input_missing'],
        metadata: { coverage: 0.2 },
      },
    );
    const unmeasured = withPose(threePoseAnalysis(), 'center', { background: null });
    expect(
      selfieSimilarBackgroundDetection(selfieContextFor({ analysis: unmeasured })).reasons,
    ).toEqual(['input_missing']);
  });

  it('needs the matching consent, a centre face and the search', () => {
    expect(
      selfieSimilarBackgroundDetection(selfieContextFor({ matchingConsent: false })).reasons,
    ).toEqual(['not_consented']);
    const noFace = withPose(threePoseAnalysis(), 'center', { face: null, faces: [] });
    expect(
      selfieSimilarBackgroundDetection(selfieContextFor({ analysis: noFace })).reasons,
    ).toEqual(['input_missing']);
    expect(selfieSimilarBackgroundDetection(selfieContextFor({ history: {} })).reasons).toEqual([
      'input_missing',
    ]);
    expect(
      selfieSimilarBackgroundDetection(
        selfieContextFor({ history: { background: { kind: 'error' } } }),
      ).reasons,
    ).toEqual(['execution_error']);
  });
});
