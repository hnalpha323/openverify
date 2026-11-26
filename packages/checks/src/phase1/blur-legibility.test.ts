/**
 * Phase 12A C9: the `id_blur_detection` verdict on a phone capture. A side whose rectified
 * document was measured is judged on that measure, not on the whole image (a desk around a card
 * and a large frame lower the whole-image score of a sharp card: the live 38.5 and 39.4). A side
 * the document measure calls blurry, whose OCR read many lines with high confidence, is legible.
 * Synthetic values only.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goldenAnalysis, type FullAnalysis } from '../testing/fixtures.js';
import { idBlurDetection } from './government-id-checks.js';
import type { TextLineInput } from './inputs.js';

/** The shipped document thresholds (`GOVERNMENT_ID_CHECK_CONFIG_DEFAULTS.id_blur_detection`). */
const DEFAULTS = { 'min-document-blur-score': 96.56, 'min-document-width-px': 616 } as const;

const lines = (count: number, confidence: number): TextLineInput[] =>
  Array.from({ length: count }, (_, row) => ({
    text: `LINE ${String(row)}`,
    confidence,
    box: [40, 40 + row * 26, 300, 20] as const,
    stroke_width_mean: 3,
    stroke_width_cv: 0.12,
  }));

/** The golden card with the front shaped as a phone capture: whole image 38.5, blurry. */
function phoneFront(documentBlur: number | null, text: TextLineInput[] = lines(21, 0.95)) {
  const analysis: FullAnalysis = goldenAnalysis();
  const front = analysis.sides.front;
  front.quality = { ...front.quality, blur_score: 38.5, is_blurry: true };
  const measured = front.document_quality;
  if (measured === null) {
    throw new Error('the golden fixture measures the front document');
  }
  front.document_quality = documentBlur === null ? null : { ...measured, blur_score: documentBlur };
  front.text = text;
  return analysis;
}

describe('idBlurDetection on a phone capture (C9)', () => {
  it('passes a live-shaped side: whole image 38.5, the document measure passing', () => {
    const result = idBlurDetection(phoneFront(250), DEFAULTS);
    expect(result).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: {
        front_blur_score: 38.5,
        blurry_sides: [],
        'document-blurry-sides': [],
        'legible-by-ocr-sides': [],
      },
    });
  });

  it('passes a document-blurry side whose 21 lines read at a median of 0.95, naming it', () => {
    const result = idBlurDetection(phoneFront(85), DEFAULTS);
    expect(result).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: { 'document-blurry-sides': [], 'legible-by-ocr-sides': ['front'] },
      provenance: {
        thresholds: {
          ...DEFAULTS,
          'legible-text-min-confidence': 0.9,
          'legible-text-min-lines': 8,
        },
      },
    });
  });

  it.each([
    ['five lines', lines(5, 0.95)],
    ['a median of 0.6', lines(21, 0.6)],
    ['no lines', []],
  ])('fails a document-blurry side with %s', (_label, text) => {
    expect(idBlurDetection(phoneFront(85, text), DEFAULTS)).toMatchObject({
      status: 'failed',
      reasons: ['image_blurry'],
      metadata: { 'document-blurry-sides': ['front'], 'legible-by-ocr-sides': [] },
    });
  });

  it('never rescues a plainly blurred card: under four fifths of the document threshold', () => {
    expect(idBlurDetection(phoneFront(77), DEFAULTS)).toMatchObject({
      status: 'failed',
      reasons: ['image_blurry'],
      metadata: { 'document-blurry-sides': ['front'], 'legible-by-ocr-sides': [] },
    });
    const tenengrad = { ...DEFAULTS, 'min-document-tenengrad': 5471 };
    const soft = phoneFront(85);
    const quality = soft.sides.front.document_quality;
    soft.sides.front.document_quality = quality === null ? null : { ...quality, tenengrad: 4300 };
    expect(idBlurDetection(soft, tenengrad).status).toBe('failed');
  });

  it('takes configured legibility thresholds', () => {
    const config = {
      ...DEFAULTS,
      'legible-text-min-confidence': 0.97,
      'legible-text-min-lines': 4,
    };
    expect(idBlurDetection(phoneFront(85), config).status).toBe('failed');
    expect(idBlurDetection(phoneFront(85, lines(5, 0.98)), config).status).toBe('passed');
  });

  it('judges a side with no document on the whole image, as before', () => {
    expect(idBlurDetection(phoneFront(null), DEFAULTS)).toMatchObject({
      status: 'failed',
      reasons: ['image_blurry'],
      metadata: { blurry_sides: ['front'], 'document-blurry-sides': [] },
    });
  });

  it('judges the whole image when no document threshold is configured', () => {
    expect(idBlurDetection(phoneFront(250), {})).toMatchObject({
      status: 'failed',
      metadata: { blurry_sides: ['front'] },
    });
  });

  it("still applies a min-blur-score the template configures, on every side: the operator's choice", () => {
    expect(idBlurDetection(phoneFront(250), { ...DEFAULTS, 'min-blur-score': 50 })).toMatchObject({
      status: 'failed',
      metadata: { blurry_sides: ['front'] },
    });
  });
});

/**
 * integration-12a (Workflow 12A Stage 3): the thresholds the Phase 12A blur calibration proposes
 * when it measures the analysis itself (`docs/calibration/blur-phase12a.md`), which Stage 3
 * applies to the defaults, and the vision build's own measures of three synthetic captures.
 */
const CALIBRATED = {
  'min-document-blur-score': 67.1,
  'min-document-tenengrad': 8583.33,
  'min-document-width-px': 616,
} as const;

/** The front measured as given; the back as the analysis measures the sharp phone-1080 back. */
function measured(blur: number, tenengrad: number, text: TextLineInput[]): FullAnalysis {
  const analysis = phoneFront(blur, text);
  const { front, back } = analysis.sides;
  front.document_quality = front.document_quality && { ...front.document_quality, tenengrad };
  if (back !== null) {
    back.document_quality = back.document_quality && {
      ...back.document_quality,
      blur_score: 267.93,
      tenengrad: 21_354.2,
    };
  }
  return analysis;
}

describe('idBlurDetection at the calibrated Phase 12A thresholds (integration-12a)', () => {
  it('are the thresholds the calibration document proposes', () => {
    const document = readFileSync(
      new URL('../../../../docs/calibration/blur-phase12a.md', import.meta.url),
      'utf8',
    );
    expect(document).toContain(
      `| \`min-document-blur-score\` | ${String(CALIBRATED['min-document-blur-score'])} |`,
    );
    expect(document).toContain(
      `| \`min-document-tenengrad\` | ${String(CALIBRATED['min-document-tenengrad'])} |`,
    );
  });

  it('passes the mildly soft phone capture as the analysis measures it', () => {
    // phone-1080-soft back: 89.86 and 10887.1 on its OCR boxes, five lines.
    expect(idBlurDetection(measured(89.86, 10_887.1, lines(5, 1)), CALIBRATED).status).toBe(
      'passed',
    );
  });

  it.each([
    // The C36 `blurred` Utopia front as the Phase 12A vision measures it: 18 lines at 0.999.
    ['the C36 blurred front', 44.74, 7624.53, lines(18, 0.999)],
    // phone-1080-motion front, the highest capture the calibration calls blurred: 15 lines.
    ['the motion-blurred phone front', 50.49, 6727, lines(15, 0.976)],
  ])('never rescues %s by its confident OCR', (_label, blur, tenengrad, text) => {
    expect(idBlurDetection(measured(blur, tenengrad, text), CALIBRATED)).toMatchObject({
      status: 'failed',
      reasons: ['image_blurry'],
      metadata: { 'document-blurry-sides': ['front'], 'legible-by-ocr-sides': [] },
    });
  });
});
