import { FACE_MATCH_DEFAULTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  selfieContextFor,
  selfieTemplate,
  threePoseAnalysis,
  withPose,
} from '../testing/selfie.js';
import { FACE_SCAN_FLOOR, selfieRepeatDetection } from './selfie-repeat-detection.js';

const CHECK = 'selfie_repeat_detection';
const scan = (matchCosines: number[], bestCosine: number | null, extra = {}) => ({
  history: {
    repeat: {
      kind: 'searched' as const,
      searched: 5000,
      truncated: false,
      bestCosine,
      matchCosines,
      ...extra,
    },
  },
});

describe('selfieRepeatDetection (C43)', () => {
  it('passes when no template of another account reaches the 1:N threshold', () => {
    expect(selfieRepeatDetection(selfieContextFor())).toMatchObject({
      status: 'passed',
      type: 'fraud',
      metadata: { searched: 120, truncated: false, 'match-count': 0, 'best-cosine': 0.21 },
      provenance: {
        thresholds: { threshold: 0.5 },
        'threshold-basis': { threshold: 'provisional' },
      },
    });
  });

  it('fails a face seen on another account at or above the threshold, counting the matches', () => {
    expect(selfieRepeatDetection(selfieContextFor(scan([0.41, 0.5, 0.83], 0.83)))).toMatchObject({
      status: 'failed',
      reasons: ['face_seen_on_other_account'],
      metadata: { 'match-count': 2, 'best-cosine': 0.83 },
    });
    expect(
      selfieRepeatDetection(
        selfieContextFor(
          scan([0.41, 0.5], 0.5),
          selfieTemplate([CHECK], { [CHECK]: { threshold: 0.4 } }),
        ),
      ).metadata['match-count'],
    ).toBe(2);
  });

  it('reports a scan the template cap truncated, and keeps the scan floor at the 1:1 threshold', () => {
    expect(
      selfieRepeatDetection(selfieContextFor(scan([], 0.3, { truncated: true }))).metadata,
    ).toMatchObject({ truncated: true });
    expect(FACE_SCAN_FLOOR).toBe(FACE_MATCH_DEFAULTS.threshold);
  });

  it('passes an empty gallery: the search ran over every stored template', () => {
    expect(
      selfieRepeatDetection(
        selfieContextFor({
          history: {
            repeat: {
              kind: 'searched',
              searched: 0,
              truncated: false,
              bestCosine: null,
              matchCosines: [],
            },
          },
        }),
      ),
    ).toMatchObject({
      status: 'passed',
      confidence: null,
      metadata: { searched: 0, 'best-cosine': null },
    });
  });

  it('needs the matching consent, a centre face and the scan', () => {
    expect(selfieRepeatDetection(selfieContextFor({ matchingConsent: false })).reasons).toEqual([
      'not_consented',
    ]);
    const noFace = withPose(threePoseAnalysis(), 'center', { face: null, faces: [] });
    expect(selfieRepeatDetection(selfieContextFor({ analysis: noFace })).reasons).toEqual([
      'input_missing',
    ]);
    expect(selfieRepeatDetection(selfieContextFor({ history: {} })).reasons).toEqual([
      'input_missing',
    ]);
    expect(
      selfieRepeatDetection(selfieContextFor({ history: { repeat: { kind: 'error' } } })).reasons,
    ).toEqual(['execution_error']);
  });
});
