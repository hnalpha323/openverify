/** C40.10: the selfie verification attributes, derived from check metadata and the capture. */
import { describe, expect, it } from 'vitest';
import { selfieVerificationAttributes } from './selfie-verification-attributes.js';

const CAPTURE = {
  method: 'camera',
  liveness: 'active',
  prompts: ['center', 'right', 'left'],
} as const;

const CHECKS = [
  { name: 'selfie_id_comparison', metadata: { similarity: 0.712345, threshold: 0.363 } },
  {
    name: 'selfie_liveness_detection',
    metadata: { 'liveness-score': 0.934567, 'face-cosines': { left: 0.85, right: 0.79949 } },
  },
  {
    name: 'selfie_image_quality_detection',
    metadata: { 'face-box': [0.25, 0.2, 0.5, 0.6] },
  },
];

describe('selfieVerificationAttributes (C40.10)', () => {
  it('reads the scores from their metadata keys, rounded to 4 decimals, and the capture', () => {
    expect(selfieVerificationAttributes(CHECKS, CAPTURE)).toEqual({
      'capture-method': 'camera',
      liveness: 'active',
      poses: ['center', 'right', 'left'],
      'document-similarity-score': 0.7123,
      'selfie-similarity-score-left': 0.85,
      'selfie-similarity-score-right': 0.7995,
      'liveness-score': 0.9346,
      'center-photo-face-coordinates': [
        [0.25, 0.2],
        [0.75, 0.2],
        [0.75, 0.8],
        [0.25, 0.8],
      ],
    });
  });

  it('answers null for every attribute without a capture or metadata, as after redaction', () => {
    const redacted = CHECKS.map((check) => ({ ...check, metadata: {} }));

    expect(selfieVerificationAttributes(redacted, null)).toEqual({
      'capture-method': null,
      liveness: null,
      poses: null,
      'document-similarity-score': null,
      'selfie-similarity-score-left': null,
      'selfie-similarity-score-right': null,
      'liveness-score': null,
      'center-photo-face-coordinates': null,
    });
  });

  it.each([
    [
      'a similarity out of range',
      'selfie_id_comparison',
      { similarity: 1.5 },
      'document-similarity-score',
    ],
    [
      'a similarity that is not a number',
      'selfie_id_comparison',
      { similarity: '0.7' },
      'document-similarity-score',
    ],
    [
      'a non-finite liveness score',
      'selfie_liveness_detection',
      { 'liveness-score': null },
      'liveness-score',
    ],
    [
      'a liveness score above 1',
      'selfie_liveness_detection',
      { 'liveness-score': 1.2 },
      'liveness-score',
    ],
    [
      'face cosines that are not an object',
      'selfie_liveness_detection',
      { 'face-cosines': [0.8, 0.9] },
      'selfie-similarity-score-left',
    ],
    [
      'a face box of three numbers',
      'selfie_image_quality_detection',
      { 'face-box': [0.1, 0.1, 0.5] },
      'center-photo-face-coordinates',
    ],
    [
      'a face box past the image',
      'selfie_image_quality_detection',
      { 'face-box': [0.6, 0.1, 0.5, 0.5] },
      'center-photo-face-coordinates',
    ],
    [
      'a negative face box',
      'selfie_image_quality_detection',
      { 'face-box': [-0.1, 0.1, 0.5, 0.5] },
      'center-photo-face-coordinates',
    ],
  ] as const)('answers null for %s', (_label, name, metadata, attribute) => {
    const checks = CHECKS.map((check) => (check.name === name ? { name, metadata } : check));

    expect(selfieVerificationAttributes(checks, CAPTURE)[attribute]).toBeNull();
  });

  it('answers null for a side the liveness check did not compare', () => {
    const checks = CHECKS.map((check) =>
      check.name === 'selfie_liveness_detection'
        ? { ...check, metadata: { 'face-cosines': { left: 0.81 } } }
        : check,
    );

    expect(selfieVerificationAttributes(checks, CAPTURE)).toMatchObject({
      'selfie-similarity-score-left': 0.81,
      'selfie-similarity-score-right': null,
    });
  });

  it('keeps a negative cosine', () => {
    const checks = [{ name: 'selfie_id_comparison', metadata: { similarity: -0.04321 } }];

    expect(selfieVerificationAttributes(checks, CAPTURE)['document-similarity-score']).toBe(
      -0.0432,
    );
  });
});
