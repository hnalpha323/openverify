import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { aamvaPayload, goldenAnalysis, withBarcode, type FullSide } from '../testing/fixtures.js';
import { runCalibrationReport } from './cli.js';
import { calibrationReport, renderCalibrationMarkdown } from './report.js';

const NOW = new Date('2026-10-21T12:00:00Z');

function sides(patch: (front: FullSide, back: FullSide) => void = () => undefined) {
  const analysis = goldenAnalysis();
  const back = analysis.sides.back;
  if (back === null) {
    throw new Error('the golden fixture has a back');
  }
  patch(analysis.sides.front, back);
  return { front: analysis.sides.front, back };
}

const variant = (
  name: string,
  group: 'happy' | 'variant' | 'distinct-holder' | 're-encoding',
  expect: string[],
  patch?: (front: FullSide, back: FullSide) => void,
) => ({ name, group, expect, description: `${name} (test)`, sides: sides(patch), truth: {} });

/** A small hand-written measurements file in the format of tools/calibrate_government_id.py. */
function measurements() {
  const barcodeSide = (payload: string) => {
    const side = withBarcode(payload).sides.back;
    if (side === null) {
      throw new Error('withBarcode keeps the back');
    }
    return side;
  };
  return {
    generator_version: 4,
    model_versions: goldenAnalysis().model_versions,
    variants: [
      variant('happy', 'happy', []),
      variant('blurred', 'variant', ['id_blur_detection'], (front) => {
        front.quality = { ...front.quality, blur_score: 15, is_blurry: true };
        if (front.document_quality !== null) {
          front.document_quality = { ...front.document_quality, blur_score: 20, tenengrad: 300 };
        }
      }),
      variant('photocopy', 'variant', ['id_color_inconsistency_detection'], (front, back) => {
        for (const side of [front, back]) {
          if (side.forensics !== null) {
            side.forensics = { ...side.forensics, chroma: { colorfulness: 0, mean_saturation: 0 } };
          }
        }
      }),
      variant('front-as-back', 'variant', ['id_double_side_detection'], (front, back) => {
        back.phash = front.phash;
      }),
      variant('happy-jpeg-q60', 're-encoding', [], (front) => {
        front.phash = 'c3a59e1f0b6d7249';
      }),
      variant('holder-2', 'distinct-holder', [], (front) => {
        front.phash = '3c5a61e0f49283b7';
      }),
    ],
    aamva: [
      {
        id: 'dl-636014-real-id',
        valid: true,
        side: barcodeSide(aamvaPayload('dl-636014-real-id')),
      },
      {
        id: 'file-type-not-ansi',
        valid: false,
        side: barcodeSide(aamvaPayload('file-type-not-ansi')),
      },
    ],
  };
}

const thresholdOf = (report: ReturnType<typeof calibrationReport>, key: string) =>
  report.thresholds.find((entry) => entry.key === key);

describe('calibrationReport (C36)', () => {
  it('reads the generator version and evaluates every variant with the real evaluators', () => {
    const report = calibrationReport(measurements(), { now: NOW });
    expect(report.generatorVersion).toBe(4);
    expect(report.variants.map((row) => [row.name, row.tripped, row.missed])).toEqual([
      ['happy', [], []],
      ['blurred', ['id_blur_detection'], []],
      ['photocopy', ['id_color_inconsistency_detection'], []],
      ['front-as-back', ['id_double_side_detection'], []],
      ['happy-jpeg-q60', [], []],
      ['holder-2', [], []],
    ]);
    const happy = report.variants[0];
    expect(happy?.results.id_age_comparison).toBe('passed');
    expect(happy?.failedUnexpectedly).toEqual([]);
  });

  it('proposes a lower bound between the genuine cards and the variants below them', () => {
    const blur = thresholdOf(
      calibrationReport(measurements(), { now: NOW }),
      'min-document-blur-score',
    );
    // One value per card: its weakest side, the one the check fails on. The three genuine cards
    // (happy, re-encoding, distinct holder) share the golden back, 1398.64.
    expect(blur).toMatchObject({
      check: 'id_blur_detection',
      direction: 'min',
      current: 67.1,
      genuine: { count: 3, min: 1398.64, max: 1398.64 },
      positives: [{ variant: 'blurred', value: 20 }],
      separated: ['blurred'],
    });
    expect(blur?.proposed).toBeCloseTo(709, 0);
    expect(blur?.margin).toBeCloseTo(689, 0);
  });

  it('proposes an upper bound for a heuristic score between the genuine cards and the variants above', () => {
    const color = thresholdOf(
      calibrationReport(measurements(), { now: NOW }),
      'max-color-inconsistency-score',
    );
    expect(color).toMatchObject({
      check: 'id_color_inconsistency_detection',
      direction: 'max',
      current: 0.622,
      positives: [{ variant: 'photocopy', value: 1 }],
      separated: ['photocopy'],
    });
    expect(color?.genuine.max).toBeCloseTo(0.021, 3);
    expect(color?.proposed).toBeCloseTo(0.51, 2);
  });

  it('proposes the front-back pHash distance that catches a front reused as the back', () => {
    const frontBack = thresholdOf(
      calibrationReport(measurements(), { now: NOW }),
      'min-front-back-phash-distance',
    );
    // The happy card is 34 bits from its back, the re-encoded front 33 and holder-2's front 27.
    expect(frontBack).toMatchObject({
      genuine: { min: 27 },
      separated: ['front-as-back'],
      proposed: 14,
      margin: 13.5,
    });
  });

  it('judges the current default: what it catches, the genuine cards it fails and its margin', () => {
    const report = calibrationReport(measurements(), { now: NOW });
    // 67.1 (Phase 12A) sits 47.1 above the blurred card's 20 and far below the genuine 1398.64.
    expect(thresholdOf(report, 'min-document-blur-score')?.atCurrent).toEqual({
      caught: ['blurred'],
      genuineFailing: 0,
      margin: 47.1,
    });
    const color = thresholdOf(report, 'max-color-inconsistency-score')?.atCurrent;
    expect(color).toMatchObject({ caught: ['photocopy'], genuineFailing: 0 });
    expect(color?.margin).toBeCloseTo(0.378, 2);
    expect(thresholdOf(report, 'max-tamper-score')?.atCurrent).toEqual({
      caught: [],
      genuineFailing: 0,
      margin: null,
    });
    // A default that fails a genuine card has no margin.
    const strict = measurements();
    const holder = strict.variants.find((entry) => entry.name === 'holder-2');
    if (holder?.sides.front.document_quality) {
      holder.sides.front.document_quality.blur_score = 40;
    }
    expect(
      thresholdOf(calibrationReport(strict, { now: NOW }), 'min-document-blur-score')?.atCurrent,
    ).toEqual({ caught: ['blurred'], genuineFailing: 1, margin: null });
    // A key without a default has no verdict.
    expect(thresholdOf(report, 'min-blur-score')?.atCurrent).toBeNull();
  });

  it("judges vision's whole-image defaults by the thresholds the measurements carry", () => {
    const report = calibrationReport(
      {
        ...measurements(),
        quality_thresholds: {
          blur_min: 100,
          glare_max: 0.05,
          brightness_min: 0.15,
          brightness_max: 0.9,
        },
      },
      { now: NOW },
    );
    // The blurred card's 15 is 85 below 100; the genuine cards' weakest side is 1876.05.
    expect(thresholdOf(report, 'min-blur-score')).toMatchObject({
      current: 100,
      currentSource: 'vision',
      atCurrent: { caught: ['blurred'], genuineFailing: 0, margin: 85 },
    });
    expect(thresholdOf(report, 'max-glare-ratio')).toMatchObject({
      current: 0.05,
      currentSource: 'vision',
    });
    expect(thresholdOf(report, 'min-document-blur-score')).toMatchObject({
      currentSource: 'registry',
    });
    expect(renderCalibrationMarkdown(report)).toContain('| 100 (vision) |');
  });

  it('says when no variant is separated, and proposes nothing', () => {
    const tamper = thresholdOf(calibrationReport(measurements(), { now: NOW }), 'max-tamper-score');
    expect(tamper).toMatchObject({ positives: [], separated: [], proposed: null });
    expect(tamper?.note).toMatch(/no variant/i);
  });

  it('measures the pHash distances of re-encodings and distinct cards (C34)', () => {
    const report = calibrationReport(measurements(), { now: NOW });
    expect(report.phash).toMatchObject({ reencodings: [1], maxReencoding: 1, proposed: 7 });
    expect(report.phash.minDistinct).toBeGreaterThan(7);

    const close = measurements();
    const holder = close.variants.find((entry) => entry.name === 'holder-2');
    if (holder !== undefined) {
      holder.sides.front.phash = 'c3a59e1f0b6d7248';
    }
    const disabled = calibrationReport(close, { now: NOW }).phash;
    expect(disabled).toMatchObject({ minDistinct: 0, proposed: null });
    expect(disabled.note).toMatch(/disabled/);
  });

  it('decodes the AAMVA barcode images and checks each against its vector', () => {
    expect(calibrationReport(measurements(), { now: NOW }).aamva).toEqual([
      {
        id: 'dl-636014-real-id',
        expectedValid: true,
        decoded: true,
        valid: true,
        error: null,
        agrees: true,
      },
      {
        id: 'file-type-not-ansi',
        expectedValid: false,
        decoded: true,
        valid: false,
        error: 'aamva_header_invalid',
        agrees: true,
      },
    ]);
  });

  it('refuses measurements that are not in the calibration format', () => {
    expect(() => calibrationReport({ variants: 'none' }, { now: NOW })).toThrow();
  });
});

describe('renderCalibrationMarkdown', () => {
  const markdown = renderCalibrationMarkdown(
    calibrationReport(measurements(), { now: NOW, source: 'test.json' }),
  );

  it('states plainly that it covers synthetic fixtures only and keeps the heuristics beta', () => {
    expect(markdown).toMatch(/^# Government ID calibration, Phase 3/);
    expect(markdown).toContain('synthetic fixtures only');
    expect(markdown).toContain('beta');
    expect(markdown).toContain('test.json');
    expect(markdown).toContain('2026-10-21');
  });

  it('has the thresholds, the pHash distances, the variants and the AAMVA images', () => {
    for (const heading of [
      '## Thresholds',
      '## pHash distances (C34)',
      '## Variants',
      '## Measurements',
      '## AAMVA barcode images',
    ]) {
      expect(markdown).toContain(heading);
    }
    for (const text of [
      'min-document-blur-score',
      'max-tamper-score',
      'front-as-back',
      'dl-636014-real-id',
      'At the default',
      'catches blurred, margin 47.1',
    ]) {
      expect(markdown).toContain(text);
    }
  });

  it('holds no field value of the cards', () => {
    for (const value of ['VALEMONT', 'QUINN', 'X12K45P78', 'TESTWORTH', '14 02 1990']) {
      expect(markdown).not.toContain(value);
    }
  });
});

describe('runCalibrationReport', () => {
  it('reads the measurements file and writes the report, creating its folder', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'openverify-calibration-'));
    const input = path.join(directory, 'measurements.json');
    const output = path.join(directory, 'docs', 'calibration', 'report.md');
    writeFileSync(input, JSON.stringify(measurements()));
    expect(runCalibrationReport({ input, output, now: NOW })).toEqual({ variants: 6, aamva: 2 });
    expect(readFileSync(output, 'utf8')).toContain('# Government ID calibration, Phase 3');
  });
});
