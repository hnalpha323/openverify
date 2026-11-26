import { FACE_MATCH_DEFAULTS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_SIGNALS } from '../selfie/synthetic-score.js';
import {
  distributionOf,
  identityOf,
  renderSelfieCalibrationMarkdown,
  selfieCalibrationReport,
} from './selfie-report.js';

/** Four pseudonymous identities with two portraits each: hand-written cosines, no real data. */
const IMAGES = [
  'p0001-1',
  'p0001-2',
  'p0002-1',
  'p0002-2',
  'p0003-1',
  'p0003-2',
  'p0004-1',
  'p0004-2',
];
const GENUINE = [
  { a: 'p0001-1', b: 'p0001-2', genuine: true, cosine: 0.71, age_gap_years: 6 },
  { a: 'p0002-1', b: 'p0002-2', genuine: true, cosine: 0.64, age_gap_years: null },
  { a: 'p0003-1', b: 'p0003-2', genuine: true, cosine: 0.3, age_gap_years: 12 },
  { a: 'p0004-1', b: 'p0004-2', genuine: true, cosine: 0.55, age_gap_years: 2 },
];
const IMPOSTOR_COSINES = [
  0.08, -0.05, 0.12, 0.02, 0.19, -0.11, 0.05, 0.21, 0.41, 0.03, -0.02, 0.14, 0.09, 0, 0.17, -0.07,
  0.11, 0.06, 0.25, -0.03, 0.01, 0.15, 0.04, 0.1,
];
const IMPOSTORS = IMAGES.flatMap((a, i) =>
  IMAGES.slice(i + 1)
    .filter((b) => identityOf(a) !== identityOf(b))
    .map((b) => ({ a, b })),
).map((pair, index) => ({ ...pair, genuine: false, cosine: IMPOSTOR_COSINES[index] ?? 0 }));

const MEASUREMENTS = {
  schema_version: 1,
  generated_at: '2026-10-21T12:00:00Z',
  domain: 'studio portrait pairs',
  models: { detector: 'yunet-2026may', recognizer: 'sface-2021dec' },
  set: {
    manifest_sha256: '0'.repeat(64),
    identities: 4,
    images: 9,
    excluded: [{ image: 'p0004-3', reason: 'near_duplicate' }],
  },
  pairs: [...GENUINE, ...IMPOSTORS],
  skew: {
    sex: { female: 2, male: 2 },
    ita_degrees: [41.2, 18.5, -12, 55.3],
    per_group_frr_measured: false,
  },
  provisional: { center_yaw_ratio: [0.004, -0.012, 0.01], passive_liveness_mean: [0.97, 0.99] },
};

const report = () => selfieCalibrationReport(MEASUREMENTS, { seed: 7, replicates: 200 });

describe('identityOf and distributionOf', () => {
  it('reads the pseudonymous identity of an image id', () => {
    expect(identityOf('p0001-2')).toBe('p0001');
    expect(identityOf('p0123-10')).toBe('p0123');
  });

  it('summarises a list with linear-interpolated percentiles, null when empty', () => {
    expect(distributionOf([0.004, -0.012, 0.01])).toEqual({
      n: 3,
      min: -0.012,
      p5: -0.0104,
      median: 0.004,
      p95: 0.0094,
      max: 0.01,
    });
    expect(distributionOf([5])).toEqual({ n: 1, min: 5, p5: 5, median: 5, p95: 5, max: 5 });
    expect(distributionOf([])).toBeNull();
  });
});

describe('selfieCalibrationReport (C49)', () => {
  it('counts the identities and pairs, with the rule-of-three floors', () => {
    const { counts, ruleOfThree, set, domain } = report();
    expect(IMPOSTORS).toHaveLength(24);
    expect(counts).toEqual({ identities: 4, genuinePairs: 4, impostorPairs: 24 });
    expect(ruleOfThree).toEqual({ frr: 0.75, far: 0.125 });
    expect(set).toEqual({ identities: 4, images: 9, excluded: { near_duplicate: 1 } });
    expect(domain).toBe('studio portrait pairs');
  });

  it('reports FRR at the threshold for FAR 1e-3, and FAR 1e-4 as not resolvable at this size', () => {
    const [far3, far4] = report().operatingPoints;
    expect(far3).toMatchObject({
      targetFar: 1e-3,
      threshold: 0.4101,
      far: { value: 0 },
      frr: { value: 0.25 },
      resolvable: false,
    });
    expect(far3?.far.high).toBeGreaterThanOrEqual(0.125);
    expect(far4).toMatchObject({ targetFar: 1e-4, resolvable: false });
  });

  it('gives FAR and FRR at the shared 1:1 threshold, the repeat threshold and the FAR 1e-3 one', () => {
    const rows = report().thresholds;
    expect(rows.map((row) => [row.label, row.threshold])).toEqual([
      ['shared 1:1 face-match threshold', FACE_MATCH_DEFAULTS.threshold],
      ['selfie_repeat_detection threshold', 0.5],
      ['threshold for FAR 1e-3', 0.4101],
      ["SFace's published 1:1 threshold (OpenCV Zoo)", 0.363],
    ]);
    expect(rows[0]?.far.value).toBeCloseTo(1 / 24, 6);
    expect(rows[0]?.frr.value).toBe(0.25);
    expect(rows[1]).toMatchObject({ far: { value: 0 }, frr: { value: 0.25 } });
  });

  it("keeps SFace's published 0.363 as its own row (C48: its thin margin), outside the 1:N table", () => {
    const sface = report().thresholds.at(-1);
    expect(sface).toMatchObject({ threshold: 0.363 });
    expect(sface?.far.value).toBeCloseTo(1 / 24, 6);
    expect(report().gallery.some((row) => row.label === sface?.label)).toBe(false);
    expect(renderSelfieCalibrationMarkdown(report())).toMatch(
      /\| SFace's published 1:1 threshold \(OpenCV Zoo\) \| 0\.363 \| upstream \|/,
    );
  });

  it('tabulates the expected 1:N false matches at N = 1,000, 10,000 and 100,000', () => {
    const gallery = report().gallery;
    expect(gallery.map((row) => row.gallerySize)).toEqual([
      1000, 10_000, 100_000, 1000, 10_000, 100_000, 1000, 10_000, 100_000,
    ]);
    const shared = gallery[0];
    expect(shared?.expectedFalseMatches).toBeCloseTo(41.6667, 3);
    expect(shared?.upperFalseMatches).toBeGreaterThanOrEqual(125);
  });

  it('bootstraps over identities: intervals in [0, 1], low <= high, the same seed the same report', () => {
    const first = report();
    expect(report()).toEqual(first);
    for (const estimate of [
      ...first.operatingPoints.flatMap((point) => [point.far, point.frr]),
      ...first.thresholds.flatMap((row) => [row.far, row.frr]),
    ]) {
      expect(estimate.low).toBeGreaterThanOrEqual(0);
      expect(estimate.high).toBeLessThanOrEqual(1);
      expect(estimate.low).toBeLessThanOrEqual(estimate.high);
    }
    expect(selfieCalibrationReport(MEASUREMENTS, { seed: 8, replicates: 200 }).seed).toBe(8);
  });

  it('bootstraps over identities, not pairs: one identity holding every high impostor widens the FAR interval (Workflow 4B review H002)', () => {
    // Ten synthetic identities with two portraits each. Every impostor pair of p0001 scores 0.9
    // and every other 0: 36 of the 180 impostor pairs (FAR 0.2) belong to one identity. A
    // replicate that does not draw p0001 (0.9^10, about 35%) sees no false accept, and one that
    // draws it three times sees about half; a resample of the 180 pairs stays near 0.2.
    const ids = Array.from({ length: 10 }, (_, index) => `p${String(index + 1).padStart(4, '0')}`);
    const images = ids.flatMap((identity) => [`${identity}-1`, `${identity}-2`]);
    const pairs = [
      ...ids.map((identity) => ({
        a: `${identity}-1`,
        b: `${identity}-2`,
        genuine: true,
        cosine: 0.7,
        age_gap_years: null,
      })),
      ...images.flatMap((a, i) =>
        images
          .slice(i + 1)
          .filter((b) => identityOf(a) !== identityOf(b))
          .map((b) => ({
            a,
            b,
            genuine: false,
            cosine: identityOf(a) === 'p0001' || identityOf(b) === 'p0001' ? 0.9 : 0,
          })),
      ),
    ];
    const clustered = selfieCalibrationReport(
      { ...MEASUREMENTS, set: { ...MEASUREMENTS.set, identities: 10, images: 20 }, pairs },
      { seed: 7, replicates: 1000 },
    );

    expect(clustered.counts).toEqual({ identities: 10, genuinePairs: 10, impostorPairs: 180 });
    const fixed = clustered.thresholds.filter((row) => row.label !== 'threshold for FAR 1e-3');
    expect(fixed).toHaveLength(3);
    for (const row of fixed) {
      expect(row.far.value).toBeCloseTo(0.2, 9);
      // A pair resample gives about 0.15 to 0.26 here; the identity resample reaches 0 and 0.4+.
      expect(row.far.low).toBe(0);
      expect(row.far.high).toBeGreaterThanOrEqual(2 * row.far.value);
    }
  });

  it('summarises the skew and the provisional distributions', () => {
    const { skew, provisional } = report();
    expect(skew.sex).toEqual({ female: 2, male: 2 });
    expect(skew.ageGapYears).toMatchObject({ n: 3, min: 2, median: 6, max: 12 });
    expect(skew.itaDegrees).toMatchObject({ n: 4, min: -12, max: 55.3 });
    expect(provisional.center_yaw_ratio).toMatchObject({ n: 3, median: 0.004 });
    expect(Object.keys(provisional)).toEqual(['center_yaw_ratio', 'passive_liveness_mean']);
  });

  it('refuses same-identity impostors, cross-identity genuine pairs and documents off the schema', () => {
    const sameIdentityImpostor = {
      ...MEASUREMENTS,
      pairs: [...MEASUREMENTS.pairs, { a: 'p0001-1', b: 'p0001-2', genuine: false, cosine: 0.7 }],
    };
    expect(() => selfieCalibrationReport(sameIdentityImpostor)).toThrow(/same identity/);
    const crossGenuine = {
      ...MEASUREMENTS,
      pairs: [...MEASUREMENTS.pairs, { a: 'p0001-1', b: 'p0002-1', genuine: true, cosine: 0.7 }],
    };
    expect(() => selfieCalibrationReport(crossGenuine)).toThrow(/different identities/);
    expect(() => selfieCalibrationReport({ ...MEASUREMENTS, schema_version: 2 })).toThrow();
    expect(() => selfieCalibrationReport({ ...MEASUREMENTS, names: ['x'] })).toThrow();
    expect(() => selfieCalibrationReport({ ...MEASUREMENTS, pairs: [...GENUINE] })).toThrow(
      /impostor/,
    );
  });
});

describe('renderSelfieCalibrationMarkdown', () => {
  const markdown = renderSelfieCalibrationMarkdown(report());

  it('names the domain beside every table of numbers', () => {
    const tables = markdown.split('\n').filter((line) => /^\| ?-/.test(line)).length;
    expect(tables).toBeGreaterThanOrEqual(4);
    const captions = markdown.match(/^Domain: /gm) ?? [];
    expect(captions.length).toBeGreaterThanOrEqual(tables);
    expect(
      (markdown.match(/^Domain: studio portrait pairs/gm) ?? []).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('states the counts, the rule-of-three floor beside the FRR, and the unresolvable FAR', () => {
    expect(markdown).toContain('4 identities');
    expect(markdown).toContain('4 genuine pairs');
    expect(markdown).toContain('24 impostor pairs');
    expect(markdown).toMatch(/rule-of-three FRR floor 3 \/ 4 = 0\.75/);
    expect(markdown).toContain('not resolvable at this size');
    for (const size of ['1,000', '10,000', '100,000']) {
      expect(markdown).toContain(size);
    }
  });

  it('labels the synthetic distributions provisional, states the skew, purpose and takedown, and never names a vendor', () => {
    expect(markdown).toMatch(/provisional/);
    expect(markdown).toMatch(/do not measure APCER/);
    expect(markdown).toMatch(/per-group FRR is unmeasured/);
    expect(markdown).toMatch(/ITA.*proxy/);
    expect(markdown).toMatch(/## Purpose and lawful basis/);
    expect(markdown).toMatch(/## Takedown/);
    expect(markdown).not.toMatch(/persona/i);
  });
});

/** The same set with a pinned review (p0003-3 excluded) and the genuine-cue sections. */
const BEFORE_REVIEW = [
  ...GENUINE,
  { a: 'p0003-1', b: 'p0003-3', genuine: true, cosine: 0.12, age_gap_years: null },
];
const ramp = (count: number, step: number) => Array.from({ length: count }, (_, i) => i * step);
const WITH_REVIEW = {
  ...MEASUREMENTS,
  review: { excluded_images: 1, genuine_pairs_before: BEFORE_REVIEW },
  genuine_cues: {
    portraits: {
      passive_liveness_mean: [0.91, 0.42, 0.88],
      spectral_tail_deviation: ramp(150, 0.02),
      canonical_landmark_distance: [0.3, 0.12, 0.45],
      residual_peak_ratio: [1.1, 1.4],
    },
    re_encodings: {
      spectral_tail_deviation: [2.19, 0.03],
      canonical_landmark_distance: [0.31, 0.59],
      residual_peak_ratio: [1.76],
      noise_inconsistency: [1e6],
    },
  },
};
const reviewed = () => selfieCalibrationReport(WITH_REVIEW, { seed: 7, replicates: 200 });

describe('the review (C49.1)', () => {
  it('reports FRR before and after it at fixed thresholds, with the pairs it removed', () => {
    const { review } = reviewed();
    expect(review).toMatchObject({
      excludedImages: 1,
      genuinePairsBefore: 5,
      genuinePairsAfter: 4,
      removedPairs: 1,
    });
    expect(review?.rows.map((row) => [row.label, row.threshold])).toEqual([
      ['threshold for FAR 1e-3', 0.4101],
      ['shared 1:1 face-match threshold', FACE_MATCH_DEFAULTS.threshold],
    ]);
    expect(review?.rows[0]?.before.value).toBeCloseTo(0.4, 10);
    expect(review?.rows[0]?.after.value).toBe(0.25);
    for (const row of review?.rows ?? []) {
      for (const estimate of [row.before, row.after]) {
        expect(estimate.low).toBeLessThanOrEqual(estimate.value);
        expect(estimate.high).toBeGreaterThanOrEqual(estimate.value);
      }
    }
  });

  it('says plainly when the measurements carry no review section', () => {
    expect(report().review).toBeNull();
    expect(renderSelfieCalibrationMarkdown(report())).toMatch(
      /FRR before the review cannot be computed/,
    );
    const markdown = renderSelfieCalibrationMarkdown(reviewed());
    expect(markdown).toMatch(/## The review/);
    expect(markdown).toMatch(/5 genuine pairs before the review, 4 after: 1 removed/);
  });
});

describe('the operating point threshold', () => {
  it('carries its own 95% bootstrap interval', () => {
    const [far3] = report().operatingPoints;
    expect(far3?.thresholdInterval.low).toBeLessThanOrEqual(far3?.thresholdInterval.high ?? 0);
    expect(far3?.thresholdInterval.low).toBeGreaterThanOrEqual(-1);
    expect(far3?.thresholdInterval.high).toBeLessThanOrEqual(1.0001);
    expect(renderSelfieCalibrationMarkdown(report())).toMatch(
      /\| 1e-3 \| 0\.4101 \([-0-9.]+ to [-0-9.]+\) \|/,
    );
  });

  it('states where the shared 1:1 threshold lies against that interval (C49.3)', () => {
    const markdown = renderSelfieCalibrationMarkdown(report());
    expect(markdown).toMatch(/## The shared 1:1 threshold \(C49\.3\)/);
    expect(markdown).toContain(
      `${String(FACE_MATCH_DEFAULTS.threshold)} (${FACE_MATCH_DEFAULTS.basis})`,
    );
    expect(markdown).toMatch(/(inside|below|above) the 95% interval of the threshold for FAR 1e-3/);
  });
});

describe('the genuine cues (a false-positive proxy)', () => {
  it('summarise each cue of the portraits and of the re-encodings with p1 and p99', () => {
    const cues = reviewed().genuineCues;
    expect(cues?.portraits.spectral_tail_deviation).toMatchObject({ n: 150, min: 0, max: 2.98 });
    expect(cues?.portraits.spectral_tail_deviation?.p99).toBeCloseTo(2.9502, 4);
    expect(cues?.portraits.spectral_tail_deviation?.p1).toBeCloseTo(0.0298, 4);
    expect(cues?.reEncodings.residual_peak_ratio).toMatchObject({ n: 1, p99: 1.76 });
    expect(report().genuineCues).toBeNull();
  });

  it('set every synthetic scale against the genuine tail of the portraits and re-encodings together', () => {
    const rows = reviewed().genuineCues?.synthetic ?? [];
    expect(rows.map((row) => row.key)).toEqual(SYNTHETIC_SIGNALS.map((signal) => signal.key));
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
    expect(byKey.spectral_tail_deviation).toMatchObject({ n: 152, tailRule: 'p99' });
    expect(byKey.spectral_tail_deviation?.genuineTail).toBeCloseTo(2.9498, 4);
    expect(byKey.canonical_landmark_distance).toMatchObject({
      n: 5,
      direction: 'lower',
      tailRule: 'min',
      genuineTail: 0.12,
    });
    expect(byKey.residual_peak_ratio).toMatchObject({ n: 3, tailRule: 'max', genuineTail: 1.76 });
    expect(byKey.jpeg_grid_misalignment).toMatchObject({
      n: 0,
      genuineTail: null,
      flagsGenuine: false,
    });
    expect(byKey.noise_inconsistency?.flagsGenuine).toBe(true);
    for (const row of rows) {
      const signal = SYNTHETIC_SIGNALS.find((entry) => entry.key === row.key);
      expect(row).toMatchObject({
        clear: signal?.clear,
        suspicious: signal?.suspicious,
        weight: signal?.weight,
      });
      if (row.genuineTail !== null) {
        const flags =
          row.direction === 'higher' ? row.clear < row.genuineTail : row.clear > row.genuineTail;
        expect(row.flagsGenuine, row.key).toBe(flags);
      }
    }
  });

  it('state what the default min-passive-score rejects of the genuine portraits (Workflow 4B review H003)', () => {
    const withPassive = (values: number[]) =>
      renderSelfieCalibrationMarkdown(
        selfieCalibrationReport(
          {
            ...WITH_REVIEW,
            genuine_cues: {
              ...WITH_REVIEW.genuine_cues,
              portraits: { ...WITH_REVIEW.genuine_cues.portraits, passive_liveness_mean: values },
            },
          },
          { seed: 7, replicates: 20 },
        ),
      );
    const opening =
      '`selfie_liveness_detection` fails a centre whose passive-liveness mean is below `min-passive-score` (default 0.5, provisional) with `passive_liveness_low`, a fraud reason that gives no retry.';
    const closing =
      'Studio portraits are still and often retouched, so this is a false-positive proxy: the false-reject rate on genuine webcam selfies is unmeasured.';

    // Synthetic means. A listed percentile below the default puts at least floor(q (n - 1) / 100)
    // + 1 values below it; a p1 at or above it leaves at most ceil((n - 1) / 100) below.
    // [0.91, 0.42, 0.88]: p1 0.4292 and p5 0.466 are below 0.5, the median is not.
    expect(renderSelfieCalibrationMarkdown(reviewed())).toContain(
      `${opening} On these genuine portraits (n = 3) the p1 is 0.4292 and the p5 0.466: at least 1 of them (33.33%) scores below the default. ${closing}`,
    );
    const low = [
      0.1,
      0.2,
      ...Array.from({ length: 58 }, () => 0.3),
      ...Array.from({ length: 42 }, () => 0.9),
    ];
    expect(withPassive(low)).toContain(
      'On these genuine portraits (n = 102) the p1 is 0.201 and the p5 0.3: at least 51 of them (50%) score below the default.',
    );
    const rare = [0.1, ...Array.from({ length: 199 }, () => 0.9)];
    expect(withPassive(rare)).toContain(
      'On these genuine portraits (n = 200) the p1 is 0.9 and the p5 0.9: at most 2 of them (1%) score below the default.',
    );
    expect(withPassive([0.9, 0.95, 0.97])).toContain(
      'On these genuine portraits (n = 3) the p1 is 0.901 and the p5 0.905: none of them scores below the default.',
    );
    expect(withPassive([0.1, 0.2, 0.3])).toContain(
      'On these genuine portraits (n = 3) the p1 is 0.102 and the p5 0.11: all 3 of them score below the default.',
    );
    expect(renderSelfieCalibrationMarkdown(report())).not.toContain(opening);
  });

  it('label the portraits a false-positive proxy and the scales genuine-only', () => {
    const markdown = renderSelfieCalibrationMarkdown(reviewed());
    expect(markdown).toContain(
      'Domain: studio portraits, scaled to a 2,000-px long side: a false-positive proxy, not a selfie measurement.',
    );
    expect(markdown).toMatch(/genuine-only distribution; detection rate unmeasured/);
    expect(markdown).toMatch(/## Genuine portraits: the heuristic cues/);
    expect(markdown).toMatch(/## The synthetic-face scales against genuine photos/);
    const tables = markdown.split('\n').filter((line) => /^\| ?-/.test(line)).length;
    expect((markdown.match(/^Domain: /gm) ?? []).length).toBeGreaterThanOrEqual(tables);
  });
});
