/** The six H-tier checks (ADR 0002 §3c): beta, a confidence on every passed or failed result. */
import { checkResultSchema, type CheckResult } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { goldenAnalysis } from '../testing/fixtures.js';
import { withForensics } from '../testing/forensics.js';
import { contextFor, template } from '../testing/context.js';
import { idColorInconsistencyDetection } from './id-color-inconsistency-detection.js';
import { idElectronicReplicaDetection } from './id-electronic-replica-detection.js';
import { idEntityDetection } from './id-entity-detection.js';
import { idFabricationDetection } from './id-fabrication-detection.js';
import { idHandwritingDetection } from './id-handwriting-detection.js';
import { idTamperDetection } from './id-tamper-detection.js';
import {
  colorInconsistencyScore,
  electronicReplicaScore,
  entityScore,
  fabricationScore,
  handwritingScore,
  tamperScore,
} from './scores.js';

function expectHeuristic(result: CheckResult, status: 'passed' | 'failed') {
  expect(result.status).toBe(status);
  expect(result.stage).toBe('beta');
  expect(result.confidence).toBeGreaterThan(0);
  expect(result.confidence).toBeLessThanOrEqual(1);
  expect(checkResultSchema.safeParse(result).success).toBe(true);
}

describe('idColorInconsistencyDetection', () => {
  it('passes a full-colour card, with its score and threshold', () => {
    const result = idColorInconsistencyDetection(contextFor());
    expectHeuristic(result, 'passed');
    expect(result).toMatchObject({
      metadata: { score: 0.021, components: { grayscale: 0, 'color-cast': 0.021 } },
      provenance: { thresholds: { 'max-color-inconsistency-score': 0.622 } },
    });
  });

  it('fails a grayscale photocopy', () => {
    const result = idColorInconsistencyDetection(
      contextFor({
        analysis: withForensics({ chroma: { colorfulness: 1.2, mean_saturation: 0.01 } }),
      }),
    );
    expectHeuristic(result, 'failed');
    expect(result.reasons).toEqual(['grayscale_image']);
  });

  it('fails a regional colour cast on either side', () => {
    const result = idColorInconsistencyDetection(
      contextFor({ analysis: withForensics({}, { color_cast_score: 0.8 }) }),
    );
    expectHeuristic(result, 'failed');
    expect(result.reasons).toEqual(['color_cast_detected']);
  });

  it('takes a configured threshold', () => {
    const context = contextFor(
      {},
      template({ id_color_inconsistency_detection: { 'max-color-inconsistency-score': 0.01 } }),
    );
    expect(idColorInconsistencyDetection(context).status).toBe('failed');
  });

  it('answers input_missing without forensics on the front', () => {
    expect(
      idColorInconsistencyDetection(contextFor({ analysis: withForensics(null) })),
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
      confidence: null,
    });
    expect(colorInconsistencyScore(withForensics(null))).toBeNull();
  });
});

describe('idElectronicReplicaDetection', () => {
  it('passes a card photographed directly', () => {
    expectHeuristic(idElectronicReplicaDetection(contextFor()), 'passed');
  });

  it.each([[{ moire_score: 0.9 }], [{ screen_grid_score: 0.8 }]])(
    'fails a screen recapture (%j)',
    (patch) => {
      const result = idElectronicReplicaDetection(contextFor({ analysis: withForensics(patch) }));
      expectHeuristic(result, 'failed');
      expect(result.reasons).toEqual(['screen_recapture_suspected']);
    },
  );

  it('answers input_missing without forensics', () => {
    expect(
      idElectronicReplicaDetection(contextFor({ analysis: withForensics(null) })).reasons,
    ).toEqual(['input_missing']);
    expect(electronicReplicaScore(withForensics(null))).toBeNull();
  });
});

describe('idTamperDetection', () => {
  it('passes an unedited card, every component measured', () => {
    const result = idTamperDetection(contextFor());
    expectHeuristic(result, 'passed');
    expect(result.metadata).toMatchObject({ coverage: 1, 'editing-software': false });
    expect(tamperScore(goldenAnalysis())?.score).toBeLessThan(0.2);
  });

  it.each([
    [{ exif: { software: 'Adobe Photoshop 27.0' } }, 'editing_software_detected'],
    [{ ela_score: 0.95 }, 'error_level_anomaly'],
    [{ jpeg: { double_compression_score: 0.95 } }, 'double_compression_detected'],
    [{ copy_move_score: 0.9 }, 'copy_move_detected'],
    [{ portrait_boundary_score: 0.95 }, 'portrait_boundary_anomaly'],
  ])('fails %j with %s', (patch, reason) => {
    const result = idTamperDetection(contextFor({ analysis: withForensics(patch) }));
    expectHeuristic(result, 'failed');
    expect(result.reasons).toContain(reason);
  });

  it('lets the strongest weighted component decide: moderate signals do not add up (calibration)', () => {
    const result = idTamperDetection(
      contextFor({
        analysis: withForensics({
          ela_score: 0.5,
          copy_move_score: 0.4,
          portrait_boundary_score: 0.4,
        }),
      }),
    );
    expectHeuristic(result, 'passed');
    expect(result.metadata.score).toBe(0.36);
  });

  it('passes the genuine synthetic card, whose copy-move and boundary scores are moderate', () => {
    const genuine = withForensics({
      ela_score: 0.1431,
      copy_move_score: 0.4062,
      portrait_boundary_score: 0.5119,
    });
    expectHeuristic(idTamperDetection(contextFor({ analysis: genuine })), 'passed');
  });

  it('measures less of a PNG upload, and says so', () => {
    const result = idTamperDetection(
      contextFor({ analysis: withForensics({ jpeg: null, portrait_boundary_score: null }) }),
    );
    expectHeuristic(result, 'passed');
    expect(result.metadata.coverage).toBe(0.6);
  });

  it('does not count error-level as measured on a front without a portrait (G009)', () => {
    // Vision answers ela_score 0.0 when there is no portrait to compare: not a measurement.
    const analysis = withForensics({ ela_score: 0, portrait_boundary_score: null });
    analysis.sides.front.portrait = null;

    const score = tamperScore(analysis);
    expect(score?.components).not.toHaveProperty('error-level');
    expect(score?.coverage).toBe(0.6);
    const result = idTamperDetection(contextFor({ analysis }));
    expectHeuristic(result, 'passed');
    expect(result.metadata.coverage).toBe(0.6);
  });

  it('never puts the editing software name in the result', () => {
    const result = idTamperDetection(
      contextFor({ analysis: withForensics({ exif: { software: 'GIMP 3.0' } }) }),
    );
    expect(JSON.stringify(result)).not.toContain('GIMP');
  });

  it('answers input_missing without forensics', () => {
    expect(idTamperDetection(contextFor({ analysis: withForensics(null) })).reasons).toEqual([
      'input_missing',
    ]);
  });
});

describe('idFabricationDetection', () => {
  it('passes a card laid out as its ICAO class: aspect, text, portrait and MRZ in place', () => {
    const result = idFabricationDetection(contextFor());
    expectHeuristic(result, 'passed');
    expect(result.metadata).toMatchObject({ layout: 'TD1', coverage: 1 });
    expect(fabricationScore(contextFor())?.score).toBeLessThan(0.1);
  });

  it('fails text printed over the portrait', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = analysis.sides.front.text.map((line) =>
      line.text === 'QUINN' ? { ...line, box: [60, 200, 180, 40] as const } : line,
    );
    analysis.sides.front.text = [
      ...analysis.sides.front.text,
      {
        text: 'X',
        confidence: 0.9,
        box: [70, 300, 150, 40] as const,
        stroke_width_mean: 3,
        stroke_width_cv: 0.14,
      },
    ];
    const result = idFabricationDetection(contextFor({ analysis }));
    expectHeuristic(result, 'failed');
    expect(result.reasons).toEqual(['layout_nonconformant']);
    expect(result.metadata).toMatchObject({ 'nonconformant-components': ['text-over-portrait'] });
  });

  it('fails an MRZ that is not at the bottom of the card', () => {
    const analysis = goldenAnalysis();
    if (analysis.sides.back !== null) {
      analysis.sides.back.mrz = { ...analysis.sides.back.mrz, box: [24, 100, 964, 170] };
    }
    const result = idFabricationDetection(contextFor({ analysis }));
    expectHeuristic(result, 'failed');
    expect(result.metadata).toMatchObject({ 'nonconformant-components': ['mrz-geometry'] });
  });

  it('fails a portrait on the wrong side of a TD1 front', () => {
    const analysis = goldenAnalysis();
    if (analysis.sides.front.portrait !== null) {
      analysis.sides.front.portrait = {
        ...analysis.sides.front.portrait,
        bbox: [760, 158, 205, 275],
      };
    }
    analysis.sides.front.text = [];
    const result = idFabricationDetection(contextFor({ analysis }));
    expectHeuristic(result, 'failed');
    expect(result.metadata).toMatchObject({ 'nonconformant-components': ['portrait-position'] });
  });

  it('fails text outside the document', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = analysis.sides.front.text.map((line) => ({
      ...line,
      box: [900, 600, 300, 60] as const,
    }));
    const result = idFabricationDetection(contextFor({ analysis }));
    expectHeuristic(result, 'failed');
    expect(result.metadata).toMatchObject({
      'nonconformant-components': expect.arrayContaining(['text-outside']) as unknown,
    });
  });

  it('judges a class without an ICAO layout on the parts it can, with lower coverage', () => {
    const result = idFabricationDetection(contextFor({ environment: 'production' }));
    expectHeuristic(result, 'passed');
    expect(result.metadata).toMatchObject({ layout: 'TD1' });
  });

  it('answers input_missing without a document outline', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.document = {
      found: false,
      quad: null,
      method: 'none',
      rectified_size: null,
      aspect_ratio: null,
      area_ratio: null,
    };
    expect(idFabricationDetection(contextFor({ analysis }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});

describe('idHandwritingDetection', () => {
  it('passes printed fields', () => {
    const result = idHandwritingDetection(contextFor());
    expectHeuristic(result, 'passed');
    expect(result.metadata).toMatchObject({ 'suspected-fields': [] });
    expect(handwritingScore(contextFor())?.score).toBeLessThan(0.1);
  });

  it('fails a field written by hand: irregular strokes, read with less confidence, naming the field', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = analysis.sides.front.text.map((line) =>
      line.text === '14 02 1990' ? { ...line, stroke_width_cv: 0.6, confidence: 0.62 } : line,
    );
    const result = idHandwritingDetection(contextFor({ analysis }));
    expectHeuristic(result, 'failed');
    expect(result).toMatchObject({
      reasons: ['handwriting_suspected'],
      metadata: { 'suspected-fields': ['birthdate'] },
    });
    expect(JSON.stringify(result)).not.toContain('1990');
  });

  it('answers input_missing with fewer than three lines whose strokes were measured', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = analysis.sides.front.text.map((line) => ({
      ...line,
      stroke_width_cv: null,
    }));
    if (analysis.sides.back !== null) {
      analysis.sides.back.text = [];
    }
    expect(idHandwritingDetection(contextFor({ analysis }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});

describe('idEntityDetection', () => {
  it('passes a card whose fraud signals are all low, listing what it aggregated', () => {
    const result = idEntityDetection(contextFor());
    expectHeuristic(result, 'passed');
    expect(result.metadata).toMatchObject({ signals: [] });
    expect(Object.keys(result.metadata.components as object)).toEqual(
      expect.arrayContaining([
        'tamper',
        'electronic-replica',
        'color-inconsistency',
        'fabrication',
        'handwriting',
      ]),
    );
  });

  it('counts a heuristic only by how far it exceeds its own threshold', () => {
    const moderate = withForensics({
      copy_move_score: 0.45,
      color_cast_score: 0.45,
      moire_score: 0.35,
    });
    const result = idEntityDetection(contextFor({ analysis: moderate }));
    expectHeuristic(result, 'passed');
    expect(result.metadata).toMatchObject({ score: 0, signals: [] });
    const recapture = withForensics({ moire_score: 0.6, screen_grid_score: 0.95 });
    const failed = idEntityDetection(contextFor({ analysis: recapture }));
    expectHeuristic(failed, 'failed');
    expect(failed.metadata).toMatchObject({
      // (0.95 - 0.418) / (1 - 0.418): the replica score past its calibrated threshold.
      components: { 'electronic-replica': 0.9141 },
      signals: ['electronic-replica'],
    });
  });

  it('fails a specimen in production, naming the signal', () => {
    const result = idEntityDetection(contextFor({ environment: 'production' }));
    expectHeuristic(result, 'failed');
    expect(result).toMatchObject({
      reasons: ['entity_risk_high'],
      metadata: { signals: ['compromised'] },
    });
  });

  it('fails an MRZ whose check digits fail', () => {
    const analysis = goldenAnalysis();
    if (analysis.sides.back !== null) {
      const [first = '', second = '', third = ''] = analysis.sides.back.mrz.lines;
      analysis.sides.back.mrz = {
        ...analysis.sides.back.mrz,
        lines: [first, second.replace('9002144', '9002154'), third],
      };
    }
    const result = idEntityDetection(contextFor({ analysis }));
    expectHeuristic(result, 'failed');
    expect(result.metadata).toMatchObject({
      signals: expect.arrayContaining(['mrz-check-digits']) as unknown,
    });
  });

  it('answers input_missing without forensics and without any extraction', () => {
    const analysis = withForensics(null, null);
    analysis.sides.front.text = [];
    analysis.sides.back = null;
    expect(idEntityDetection(contextFor({ analysis }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
    expect(entityScore(contextFor({ analysis }))).toBeNull();
  });
});
