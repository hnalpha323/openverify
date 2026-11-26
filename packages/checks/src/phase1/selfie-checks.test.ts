/**
 * The Phase 1 selfie evaluators became version 2 (C39.1, C43); their tests live beside the v2
 * evaluators in `../selfie/`. This module keeps re-exporting the shared face match confidence.
 */
import { describe, expect, it } from 'vitest';
import { faceMatchConfidence as fromFaceMatch } from '../face-match.js';
import { faceMatchConfidence } from './selfie-checks.js';

describe('faceMatchConfidence', () => {
  it('is the face-match module function, re-exported', () => {
    expect(faceMatchConfidence).toBe(fromFaceMatch);
  });

  it('is 0 at the threshold and grows with the margin on either side', () => {
    expect(faceMatchConfidence(0.363, 0.363)).toBe(0);
    expect(faceMatchConfidence(0.5, 0.363)).toBeLessThan(faceMatchConfidence(0.9, 0.363));
    expect(faceMatchConfidence(0.2, 0.363)).toBeLessThan(faceMatchConfidence(-0.5, 0.363));
  });

  it('is 1 at the extremes', () => {
    expect(faceMatchConfidence(1, 0.363)).toBe(1);
    expect(faceMatchConfidence(-1, 0.363)).toBe(1);
  });

  it('is rounded to four decimals', () => {
    const value = faceMatchConfidence(0.7, 0.363);
    expect(value).toBe(Math.round(value * 10_000) / 10_000);
  });
});
