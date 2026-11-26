import { describe, expect, it } from 'vitest';
import type { SyntheticScoresInput } from '../phase1/inputs.js';
import {
  SYNTHETIC_DIGITAL_SOURCE_TYPES,
  SYNTHETIC_SIGNALS,
  digitalSourceTermOf,
  syntheticFaceScore,
} from './synthetic-score.js';

const GENUINE: SyntheticScoresInput = {
  spectral_tail_deviation: 0.1,
  residual_peak_ratio: 1.5,
  noise_inconsistency: 0.08,
  jpeg_grid_misalignment: 0,
  canonical_landmark_distance: 0.3,
  digital_source_type: null,
};
const NONE: SyntheticScoresInput = {
  spectral_tail_deviation: null,
  residual_peak_ratio: null,
  noise_inconsistency: null,
  jpeg_grid_misalignment: null,
  canonical_landmark_distance: null,
  digital_source_type: null,
};

describe('the synthetic-face signals (research §5.3)', () => {
  it('fail outright only on the two IPTC synthetic source types', () => {
    expect(SYNTHETIC_DIGITAL_SOURCE_TYPES).toEqual([
      'trainedAlgorithmicMedia',
      'compositeSynthetic',
    ]);
  });

  it('name every cue once, each with a weight in (0, 1] and a provisional basis', () => {
    expect(SYNTHETIC_SIGNALS.map((signal) => signal.key)).toEqual([
      'spectral_tail_deviation',
      'residual_peak_ratio',
      'noise_inconsistency',
      'jpeg_grid_misalignment',
      'canonical_landmark_distance',
    ]);
    for (const signal of SYNTHETIC_SIGNALS) {
      expect(signal.weight, signal.key).toBeGreaterThan(0);
      expect(signal.weight, signal.key).toBeLessThanOrEqual(1);
      expect(signal.clear, signal.key).not.toBe(signal.suspicious);
      expect(signal.basis, signal.key).toMatch(/provisional/);
    }
    expect(
      SYNTHETIC_SIGNALS.filter((signal) => signal.uploadsOnly).map((signal) => signal.key),
    ).toEqual(['canonical_landmark_distance']);
  });
});

describe('digitalSourceTermOf', () => {
  it.each([
    ['trainedAlgorithmicMedia', 'trainedAlgorithmicMedia'],
    ['http://cv.iptc.org/newscodes/digitalsourcetype/compositeSynthetic', 'compositeSynthetic'],
    ['https://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture/', 'digitalCapture'],
    ['', null],
    [null, null],
  ])('reads %j as %j', (value, term) => {
    expect(digitalSourceTermOf(value)).toBe(term);
  });
});

describe('syntheticFaceScore', () => {
  it('scores a genuine camera frame at 0 with every camera cue measured', () => {
    expect(syntheticFaceScore(GENUINE, { upload: false })).toEqual({
      score: 0,
      components: {
        'spectral-tail-deviation': 0,
        'residual-peak-ratio': 0,
        'noise-inconsistency': 0,
        'jpeg-grid-misalignment': 0,
      },
      coverage: 1,
    });
  });

  it('takes the strongest weighted cue', () => {
    const peaks = syntheticFaceScore({ ...GENUINE, residual_peak_ratio: 6 }, { upload: false });
    expect(peaks?.score).toBe(0.8);
    const both = syntheticFaceScore(
      { ...GENUINE, residual_peak_ratio: 4, noise_inconsistency: 1 },
      { upload: false },
    );
    expect(both).toMatchObject({ score: 0.434, components: { 'residual-peak-ratio': 0.5 } });
  });

  it('reads the canonical landmark distance on uploads only, small being suspicious', () => {
    expect(
      syntheticFaceScore({ ...GENUINE, canonical_landmark_distance: 0.01 }, { upload: false })
        ?.score,
    ).toBe(0);
    expect(
      syntheticFaceScore({ ...GENUINE, canonical_landmark_distance: 0.01 }, { upload: true }),
    ).toMatchObject({ score: 0.8, coverage: 1, components: { 'canonical-landmark-distance': 1 } });
  });

  it('scales the coverage by the cues measured, and is null without any', () => {
    expect(syntheticFaceScore({ ...NONE, noise_inconsistency: 0.94 }, { upload: false })).toEqual({
      score: 0.35,
      components: { 'noise-inconsistency': 0.5 },
      coverage: 0.25,
    });
    expect(syntheticFaceScore(NONE, { upload: true })).toBeNull();
  });
});

/**
 * Each cue's genuine tail in the C49 report (`docs/calibration/selfie-phase4.md`, "The
 * synthetic-face scales against genuine photos"): the 99th percentile of the studio portraits
 * scaled to a 2,000-px long side and the 45 re-encodings of the public-domain faces together, the
 * 1st for `canonical_landmark_distance` (suspicious when small). Numbers, never images.
 */
const GENUINE_TAIL = {
  spectral_tail_deviation: 3.7036,
  residual_peak_ratio: 1.9774,
  noise_inconsistency: 0.6889,
  jpeg_grid_misalignment: 0.2638,
  canonical_landmark_distance: 0.22,
} as const;

describe('the scales against genuine photos (C49; 4A vision-integrity open item 5)', () => {
  it('leave the genuine tail of every cue without suspicion', () => {
    for (const signal of SYNTHETIC_SIGNALS) {
      const tail = GENUINE_TAIL[signal.key];
      if (signal.clear < signal.suspicious) {
        expect(signal.clear, signal.key).toBeGreaterThanOrEqual(tail);
      } else {
        expect(signal.clear, signal.key).toBeLessThanOrEqual(tail);
      }
    }
    expect(
      syntheticFaceScore({ ...GENUINE_TAIL, digital_source_type: null }, { upload: true })?.score,
    ).toBe(0);
  });

  it('move a flagging clear level to the tail, keep the ramp width and the weight, and say the basis', () => {
    expect(
      SYNTHETIC_SIGNALS.map((signal) => [
        signal.key,
        signal.clear,
        signal.suspicious,
        signal.weight,
      ]),
    ).toEqual([
      ['spectral_tail_deviation', 3.71, 4.46, 0.8],
      ['residual_peak_ratio', 2, 6, 0.8],
      ['noise_inconsistency', 0.69, 1.19, 0.7],
      ['jpeg_grid_misalignment', 0.27, 1.02, 0.5],
      ['canonical_landmark_distance', 0.05, 0.01, 0.8],
    ]);
    for (const signal of SYNTHETIC_SIGNALS) {
      expect(signal.basis, signal.key).toMatch(/provisional/);
      expect(signal.basis, signal.key).toMatch(
        /genuine-only distribution; detection rate unmeasured/,
      );
    }
  });
});
