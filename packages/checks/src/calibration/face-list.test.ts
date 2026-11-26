/**
 * Workflow 7B's face-list calibration (Workflow 11D; lists-phase11.md item (i)): FPIR and FNIR at
 * the method's gallery sizes with bootstrap intervals, and the rule (0.5 stays while its FPIR upper
 * end at 10,000 is at most 1%, else the lowest grid threshold that meets it). Synthetic
 * measurements: pseudonymous ids and made-up cosines, no face.
 */
import { describe, expect, it } from 'vitest';
import {
  FACE_LIST_DEFAULTS,
  FACE_LIST_GALLERY_SIZES,
  FACE_LIST_GRID,
  FACE_LIST_RULE,
  FACE_LIST_THRESHOLD,
  faceListReport,
  fpirOf,
  parseFaceListArgs,
} from './face-list.js';
import type { SelfieCalibrationMeasurements } from './selfie-report.js';

const id = (person: number, image: number) =>
  `p${String(person).padStart(4, '0')}-${String(image)}`;

/** `people` identities of two images each: genuine pairs at `genuine`, impostors from `impostor`. */
function measurements(
  people: number,
  genuine: (person: number) => number,
  impostor: (a: number, b: number) => number,
): SelfieCalibrationMeasurements {
  const pairs: SelfieCalibrationMeasurements['pairs'] = [];
  for (let a = 1; a <= people; a += 1) {
    pairs.push({ a: id(a, 1), b: id(a, 2), genuine: true, cosine: genuine(a) });
    for (let b = a + 1; b <= people; b += 1) {
      pairs.push({ a: id(a, 1), b: id(b, 1), genuine: false, cosine: impostor(a, b) });
    }
  }
  return {
    schema_version: 1,
    generated_at: '2026-11-16T00:00:00Z',
    domain: 'synthetic portraits',
    models: { detector: 'synthetic', recognizer: 'synthetic' },
    set: { manifest_sha256: 'a'.repeat(64), identities: people, images: people * 2, excluded: [] },
    pairs,
    skew: { sex: {}, ita_degrees: [], per_group_frr_measured: false },
    provisional: {},
  };
}

describe('the face-list constants (the method)', () => {
  it('holds the galleries, the threshold, the rule and the grid', () => {
    expect(FACE_LIST_GALLERY_SIZES).toEqual([1000, 10_000]);
    expect(FACE_LIST_THRESHOLD).toBe(0.5);
    expect(FACE_LIST_RULE).toEqual({ gallery: 10_000, maxFpirUpper: 0.01 });
    expect(FACE_LIST_GRID[0]).toBe(0.3);
    expect(FACE_LIST_GRID.at(-1)).toBe(0.95);
    expect(FACE_LIST_GRID).toContain(0.5);
  });

  it('turns a false match rate into a search rate over a gallery', () => {
    expect(fpirOf(0, 10_000)).toBe(0);
    expect(fpirOf(1e-4, 1)).toBeCloseTo(1e-4, 12);
    expect(fpirOf(1e-4, 10_000)).toBeCloseTo(1 - (1 - 1e-4) ** 10_000, 12);
  });
});

describe('faceListReport', () => {
  it('keeps 0.5 when no impostor reaches it, with every interval around its value', () => {
    const report = faceListReport(
      measurements(
        30,
        (person) => 0.6 + person / 1000,
        () => 0.1,
      ),
      { seed: 7, replicates: 50 },
    );
    expect(report).toMatchObject({
      identities: 30,
      genuinePairs: 30,
      impostorPairs: 435,
      stays: true,
      picked: null,
    });
    expect(report.rows).toHaveLength(1);
    const [row] = report.rows;
    expect(row?.far).toBe(0);
    expect(row?.fpir['10000']).toEqual({ value: 0, low: 0, high: 0 });
    expect(row?.fnir).toEqual({ value: 0, low: 0, high: 0 });
  });

  it('picks the lowest grid threshold that meets the rule when 0.5 does not, with its FNIR', () => {
    // Impostors spread from 0.30 to 0.70: at 0.5 about half of them match, far above 1% a search.
    const report = faceListReport(
      measurements(
        40,
        (person) => 0.6 + (person % 10) / 100,
        (a, b) => 0.3 + ((a * 31 + b * 17) % 41) / 100,
      ),
      { seed: 11, replicates: 40 },
    );
    expect(report.stays).toBe(false);
    expect(report.picked).toBeGreaterThan(0.7);
    const picked = report.rows[1];
    expect(picked?.threshold).toBe(report.picked);
    expect(picked?.fpir['10000']?.high).toBeLessThanOrEqual(0.01);
    expect(picked?.fnir.value).toBeGreaterThan(0);
    const lower = faceListReport(
      measurements(
        40,
        (person) => 0.6 + (person % 10) / 100,
        (a, b) => 0.3 + ((a * 31 + b * 17) % 41) / 100,
      ),
      { seed: 11, replicates: 40 },
    );
    expect(lower).toEqual(report);
  });

  it('answers no threshold when even the grid top fails the rule', () => {
    const report = faceListReport(
      measurements(
        10,
        () => 0.99,
        () => 0.97,
      ),
      { seed: 3, replicates: 20 },
    );
    expect(report).toMatchObject({ stays: false, picked: null });
    expect(report.rows).toHaveLength(1);
  });

  it('refuses measurements without both kinds of pair', () => {
    expect(() =>
      faceListReport(
        measurements(
          1,
          () => 0.9,
          () => 0.1,
        ),
        { seed: 1, replicates: 1 },
      ),
    ).toThrow('genuine and impostor pairs');
  });
});

describe('parseFaceListArgs', () => {
  it('requires a seed and resolves the paths under the repository', () => {
    expect(parseFaceListArgs(['--face-list', '--seed', '42'], '/repo')).toEqual({
      input: `/repo/${FACE_LIST_DEFAULTS.input}`,
      output: `/repo/${FACE_LIST_DEFAULTS.output}`,
      seed: 42,
      replicates: 1000,
    });
    expect(
      parseFaceListArgs(['--seed', '1', '--input', '/tmp/m.json', '--replicates', '10'], '/r'),
    ).toMatchObject({
      input: '/tmp/m.json',
      replicates: 10,
    });
    expect(() => parseFaceListArgs(['--face-list'], '/r')).toThrow('--seed is required');
    expect(() => parseFaceListArgs(['--seed', 'x'], '/r')).toThrow('whole number');
    expect(() => parseFaceListArgs(['--seed'], '/r')).toThrow('needs a value');
    expect(() => parseFaceListArgs(['--now', '1'], '/r')).toThrow('not --now');
  });
});
