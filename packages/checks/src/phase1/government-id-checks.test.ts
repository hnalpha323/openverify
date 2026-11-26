import { readFileSync } from 'node:fs';
import { checkResultSchema, decideVerification, type CheckResult } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  idBlurDetection,
  idDoubleSideDetection,
  idGlareDetection,
  idPortraitDetection,
} from './government-id-checks.js';
import type {
  DocumentQualityInput,
  GovernmentIdAnalysisInput,
  IdSideAnalysisInput,
} from './inputs.js';

/** The synthetic C6 golden response of `POST /v1/analyze/government-id`. */
function analysis(): GovernmentIdAnalysisInput {
  const url = new URL(
    '../../../../contracts/fixtures/vision/analyze-government-id.json',
    import.meta.url,
  );
  return JSON.parse(readFileSync(url, 'utf8')) as GovernmentIdAnalysisInput;
}

type QualityPatch = Partial<IdSideAnalysisInput['quality']>;

function withQuality(front: QualityPatch, back: QualityPatch | null = {}) {
  const value = analysis();
  value.sides.front.quality = { ...value.sides.front.quality, ...front };
  const backSide = value.sides.back;
  value.sides.back =
    back === null || backSide === null
      ? null
      : { ...backSide, quality: { ...backSide.quality, ...back } };
  return value;
}

function expectValid(result: unknown) {
  expect(checkResultSchema.safeParse(result).success).toBe(true);
}

describe('idBlurDetection', () => {
  it('passes when every side is sharp', () => {
    const result = idBlurDetection(analysis());
    expect(result).toEqual({
      name: 'id_blur_detection',
      status: 'passed',
      type: 'user_behavior',
      reasons: [],
      metadata: { front_blur_score: 2214.73, back_blur_score: 1876.05, blurry_sides: [] },
      stage: 'ga',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: {} },
    });
    expectValid(result);
  });

  it('fails on a blurry front', () => {
    expect(idBlurDetection(withQuality({ is_blurry: true, blur_score: 41.7 }))).toMatchObject({
      status: 'failed',
      reasons: ['image_blurry'],
      metadata: { front_blur_score: 41.7, blurry_sides: ['front'] },
    });
  });

  it('fails on a blurry back', () => {
    expect(idBlurDetection(withQuality({}, { is_blurry: true }))).toMatchObject({
      status: 'failed',
      reasons: ['image_blurry'],
      metadata: { blurry_sides: ['back'] },
    });
  });

  it('reports the reason once when both sides are blurry', () => {
    expect(idBlurDetection(withQuality({ is_blurry: true }, { is_blurry: true }))).toMatchObject({
      status: 'failed',
      reasons: ['image_blurry'],
      metadata: { blurry_sides: ['front', 'back'] },
    });
  });

  it('judges the front alone when no back was analysed', () => {
    expect(idBlurDetection(withQuality({}, null))).toMatchObject({
      status: 'passed',
      metadata: { back_blur_score: null, blurry_sides: [] },
    });
  });
});

describe('idGlareDetection', () => {
  it('passes without glare', () => {
    const result = idGlareDetection(analysis());
    expect(result).toEqual({
      name: 'id_glare_detection',
      status: 'passed',
      type: 'user_behavior',
      reasons: [],
      metadata: { front_glare_ratio: 0.0013, back_glare_ratio: 0, glare_sides: [] },
      stage: 'ga',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: {} },
    });
    expectValid(result);
  });

  it.each([
    ['front', withQuality({ has_glare: true, glare_ratio: 0.2 }), ['front']],
    ['back', withQuality({}, { has_glare: true }), ['back']],
    ['both sides', withQuality({ has_glare: true }, { has_glare: true }), ['front', 'back']],
  ])('fails on glare on the %s', (_label, input, sides) => {
    expect(idGlareDetection(input)).toMatchObject({
      status: 'failed',
      reasons: ['glare_present'],
      metadata: { glare_sides: sides },
    });
  });

  it('judges the front alone when no back was analysed', () => {
    expect(idGlareDetection(withQuality({}, null))).toMatchObject({
      status: 'passed',
      metadata: { back_glare_ratio: null },
    });
  });
});

describe('idPortraitDetection', () => {
  it('passes when the front carries a portrait, without exposing the embedding', () => {
    const input = analysis();
    const result = idPortraitDetection(input);
    expect(result).toEqual({
      name: 'id_portrait_detection',
      status: 'passed',
      type: 'fraud',
      reasons: [],
      metadata: { score: 0.9312, face_count: 1 },
      stage: 'beta',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: {} },
    });
    expectValid(result);
    const firstValue = String(input.sides.front.portrait?.embedding[0]);
    expect(JSON.stringify(result)).not.toContain('embedding');
    expect(JSON.stringify(result)).not.toContain(firstValue);
  });

  it('fails when no portrait was found on the front', () => {
    const input = analysis();
    input.sides.front.portrait = null;
    input.sides.front.faces = [];
    expect(idPortraitDetection(input)).toMatchObject({
      status: 'failed',
      reasons: ['portrait_not_present'],
      metadata: { face_count: 0 },
    });
  });

  it('ignores faces on the back', () => {
    const input = analysis();
    input.sides.front.portrait = null;
    if (input.sides.back) {
      input.sides.back.faces = [{ bbox: [1, 2, 30, 40], score: 0.95 }];
    }
    expect(idPortraitDetection(input).status).toBe('failed');
  });
});

describe('idDoubleSideDetection', () => {
  const front = { sha256: 'a'.repeat(64) };
  const back = { sha256: 'b'.repeat(64) };

  it('passes a two-sided capture of two different images', () => {
    const result = idDoubleSideDetection({ requiredSides: 'both', uploads: { front, back } });
    expect(result).toEqual({
      name: 'id_double_side_detection',
      status: 'passed',
      type: 'user_behavior',
      reasons: [],
      metadata: { required_sides: 'both' },
      stage: 'beta',
      confidence: null,
      provenance: { 'implementation-version': 1, thresholds: {} },
    });
    expectValid(result);
  });

  it.each([
    ['the back', { front, back: null }, ['back_not_present']],
    ['the front', { front: null, back }, ['front_not_present']],
    ['both sides', { front: null, back: null }, ['front_not_present', 'back_not_present']],
  ])('fails when %s is missing', (_label, uploads, reasons) => {
    expect(idDoubleSideDetection({ requiredSides: 'both', uploads })).toMatchObject({
      status: 'failed',
      reasons,
    });
  });

  it('treats the same image uploaded as both sides as a missing back', () => {
    expect(
      idDoubleSideDetection({ requiredSides: 'both', uploads: { front, back: { ...front } } }),
    ).toMatchObject({
      status: 'failed',
      reasons: ['back_not_present'],
      metadata: { required_sides: 'both', back_identical_to_front: true },
    });
  });

  it.each([
    ['front', { front, back: null }],
    ['back', { front: null, back }],
  ] as const)('is not requested when the step needs only the %s (C29.6)', (side, uploads) => {
    const result = idDoubleSideDetection({ requiredSides: side, uploads });
    expect(result).toMatchObject({
      status: 'not_applicable',
      reasons: ['not_requested'],
      metadata: { required_sides: side },
    });
    // A non-blocking reason: a required double-side check does not send the step to review,
    // once another required check passed (the C30.1 amendment of Phase 5, V17).
    const blur: CheckResult = {
      ...result,
      name: 'id_blur_detection',
      status: 'passed',
      reasons: [],
    };
    expect(
      decideVerification([result, blur], {
        checks: {
          id_double_side_detection: { enabled: true, required: true },
          id_blur_detection: { enabled: true, required: true },
        },
      }).status,
    ).toBe('passed');
  });

  it.each([
    ['front', { front: null, back }, ['front_not_present']],
    ['back', { front, back: null }, ['back_not_present']],
  ] as const)('fails when the only required side (%s) is missing', (side, uploads, reasons) => {
    expect(idDoubleSideDetection({ requiredSides: side, uploads })).toMatchObject({
      status: 'failed',
      reasons,
    });
  });
});

// Phase 3: the rectified-document measures, configured thresholds and back-side evidence -------

import { documentFeatures } from '../data/feature-table.js';
import { goldenAnalysis } from '../testing/fixtures.js';

const DOCUMENT_BLUR = { 'min-document-blur-score': 50, 'min-document-width-px': 500 } as const;

function withDocumentQuality(side: 'front' | 'back', patch: Partial<DocumentQualityInput> | null) {
  const value = goldenAnalysis();
  const target = side === 'front' ? value.sides.front : value.sides.back;
  const measured = target?.document_quality;
  if (target === null || measured == null) {
    throw new Error('the golden fixture measures both documents');
  }
  target.document_quality = patch === null ? null : { ...measured, ...patch };
  return value;
}

describe('idBlurDetection on the rectified document (C29.5)', () => {
  it('passes a sharp, large enough document and lists every threshold judged', () => {
    const result = idBlurDetection(goldenAnalysis(), DOCUMENT_BLUR);
    expect(result).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: {
        front_blur_score: 2214.73,
        'front-document-blur-score': 1543.21,
        'back-document-blur-score': 1398.64,
        'front-document-width-px': 1012,
        'document-blurry-sides': [],
        'low-resolution-sides': [],
      },
      provenance: { thresholds: DOCUMENT_BLUR },
    });
    expectValid(result);
  });

  it('fails a blurry document even when the whole image passes', () => {
    expect(
      idBlurDetection(withDocumentQuality('back', { blur_score: 21.5 }), DOCUMENT_BLUR),
    ).toMatchObject({
      status: 'failed',
      reasons: ['image_blurry'],
      metadata: { blurry_sides: [], 'document-blurry-sides': ['back'] },
    });
  });

  it('judges the Tenengrad sharpness only when configured', () => {
    const blurred = withDocumentQuality('front', { tenengrad: 120 });
    expect(idBlurDetection(blurred, DOCUMENT_BLUR).status).toBe('passed');
    expect(
      idBlurDetection(blurred, { ...DOCUMENT_BLUR, 'min-document-tenengrad': 500 }),
    ).toMatchObject({
      status: 'failed',
      reasons: ['image_blurry'],
      metadata: { 'document-blurry-sides': ['front'] },
    });
  });

  it('fails a document photographed too small', () => {
    expect(
      idBlurDetection(
        withDocumentQuality('front', { width_px: 308, height_px: 194 }),
        DOCUMENT_BLUR,
      ),
    ).toMatchObject({
      status: 'failed',
      reasons: ['resolution_too_low'],
      metadata: { 'low-resolution-sides': ['front'] },
    });
  });

  it('skips a side whose document was not measured', () => {
    expect(idBlurDetection(withDocumentQuality('back', null), DOCUMENT_BLUR)).toMatchObject({
      status: 'passed',
      metadata: { 'back-document-blur-score': null, 'document-blurry-sides': [] },
    });
  });

  it('applies a configured min-blur-score to the raw whole-image score, both ways', () => {
    const value = goldenAnalysis();
    value.sides.front.quality = { ...value.sides.front.quality, blur_score: 150, is_blurry: false };
    expect(idBlurDetection(value, { 'min-blur-score': 200 })).toMatchObject({
      status: 'failed',
      reasons: ['image_blurry'],
      metadata: { blurry_sides: ['front'] },
      provenance: { thresholds: { 'min-blur-score': 200 } },
    });
    value.sides.front.quality = { ...value.sides.front.quality, blur_score: 80, is_blurry: true };
    expect(idBlurDetection(value, { 'min-blur-score': 50 }).status).toBe('passed');
  });
});

describe('idGlareDetection on the rectified document (C29.5)', () => {
  it('fails glare over the text or the portrait above max-document-glare-ratio', () => {
    expect(
      idGlareDetection(withDocumentQuality('front', { glare_ratio_portrait: 0.3 }), {
        'max-document-glare-ratio': 0.1,
      }),
    ).toMatchObject({
      status: 'failed',
      reasons: ['glare_present'],
      metadata: {
        glare_sides: [],
        'document-glare-sides': ['front'],
        'front-glare-ratio-portrait': 0.3,
      },
      provenance: { thresholds: { 'max-document-glare-ratio': 0.1 } },
    });
  });

  it('passes a document whose regions are clear or unmeasured', () => {
    const value = withDocumentQuality('back', {
      glare_ratio_text: null,
      glare_ratio_portrait: null,
    });
    expect(idGlareDetection(value, { 'max-document-glare-ratio': 0.1 })).toMatchObject({
      status: 'passed',
      metadata: { 'document-glare-sides': [] },
    });
  });

  it('applies a configured max-glare-ratio to the raw whole-image ratio', () => {
    expect(idGlareDetection(goldenAnalysis(), { 'max-glare-ratio': 0.001 })).toMatchObject({
      status: 'failed',
      metadata: { glare_sides: ['front'] },
      provenance: { thresholds: { 'max-glare-ratio': 0.001 } },
    });
  });
});

describe('idPortraitDetection provenance (C29.2)', () => {
  it('names the face detector it rests on', () => {
    const detector = { id: 'yunet-2026may', sha256: 'c'.repeat(64) };
    expect(idPortraitDetection(goldenAnalysis(), [detector]).provenance).toEqual({
      'implementation-version': 1,
      models: [detector],
      thresholds: {},
    });
  });
});

describe('idDoubleSideDetection on the back-side evidence (C32.2)', () => {
  const front = { sha256: 'a'.repeat(64) };
  const back = { sha256: 'b'.repeat(64) };
  const td1 = documentFeatures(
    { scheme: 'icao', code: 'UTO', country: null, jurisdiction: null },
    'national_id',
    'sandbox',
  );
  const aamva = documentFeatures(
    { scheme: 'aamva', code: '636014', country: 'US', jurisdiction: 'CA' },
    'drivers_license',
    'production',
  );
  const passport = documentFeatures(
    { scheme: 'icao', code: 'GBR', country: 'GB', jurisdiction: null },
    'passport',
    'production',
  );
  const config = { 'min-front-back-phash-distance': 12 };

  it('passes two different sides whose back carries the MRZ the class expects', () => {
    expect(
      idDoubleSideDetection({
        requiredSides: 'both',
        uploads: { front, back },
        analysis: goldenAnalysis(),
        features: td1,
        config,
      }),
    ).toMatchObject({
      status: 'passed',
      metadata: {
        'front-back-phash-distance': 34,
        'back-feature': 'mrz',
        'back-feature-found': true,
      },
      provenance: { thresholds: config },
    });
  });

  it('fails a back whose pHash is within the distance of the front: a re-encoded front', () => {
    const value = goldenAnalysis();
    if (value.sides.back !== null) {
      value.sides.back.phash = 'c3a59e1f0b6d7249';
    }
    expect(
      idDoubleSideDetection({
        requiredSides: 'both',
        uploads: { front, back },
        analysis: value,
        features: null,
        config,
      }),
    ).toMatchObject({
      status: 'failed',
      reasons: ['back_not_present'],
      metadata: { 'front-back-phash-distance': 1, 'back-matches-front': 'phash' },
    });
  });

  it('fails a back without the MRZ the class expects there', () => {
    const value = goldenAnalysis();
    if (value.sides.back !== null) {
      value.sides.back.mrz = {
        found: false,
        format_guess: null,
        lines: [],
        line_confidences: [],
        box: null,
      };
    }
    expect(
      idDoubleSideDetection({
        requiredSides: 'both',
        uploads: { front, back },
        analysis: value,
        features: td1,
        config,
      }),
    ).toMatchObject({
      status: 'failed',
      reasons: ['back_feature_not_found'],
      metadata: { 'back-feature': 'mrz', 'back-feature-found': false },
    });
  });

  it('expects a PDF417 on the back of an AAMVA card', () => {
    const value = goldenAnalysis();
    expect(
      idDoubleSideDetection({
        requiredSides: 'both',
        uploads: { front, back },
        analysis: value,
        features: aamva,
        config,
      }),
    ).toMatchObject({
      status: 'failed',
      reasons: ['back_feature_not_found'],
      metadata: { 'back-feature': 'pdf417' },
    });
    const [barcode] = barcodeAnalysisSide().barcodes;
    if (value.sides.back !== null && barcode !== undefined) {
      value.sides.back.barcodes = [barcode];
    }
    expect(
      idDoubleSideDetection({
        requiredSides: 'both',
        uploads: { front, back },
        analysis: value,
        features: aamva,
        config,
      }).status,
    ).toBe('passed');
  });

  it('is feature_absent for a one-sided class (a passport data page)', () => {
    expect(
      idDoubleSideDetection({
        requiredSides: 'both',
        uploads: { front, back: null },
        analysis: goldenAnalysis(),
        features: passport,
        config,
      }),
    ).toMatchObject({ status: 'not_applicable', reasons: ['feature_absent'] });
  });

  it('does not judge the back feature without a feature row, and says so', () => {
    expect(
      idDoubleSideDetection({
        requiredSides: 'both',
        uploads: { front, back },
        analysis: goldenAnalysis(),
        features: null,
        config,
      }),
    ).toMatchObject({
      status: 'passed',
      metadata: { 'back-feature': null, 'back-feature-found': null },
    });
  });

  it('compares no pHash when a side has none', () => {
    const value = goldenAnalysis();
    value.sides.front.phash = null;
    expect(
      idDoubleSideDetection({
        requiredSides: 'both',
        uploads: { front, back },
        analysis: value,
        features: null,
        config,
      }),
    ).toMatchObject({ status: 'passed', metadata: { 'front-back-phash-distance': null } });
  });
});

import { barcodeAnalysis } from '../testing/fixtures.js';

function barcodeAnalysisSide() {
  return barcodeAnalysis().sides.front;
}
