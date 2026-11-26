import { checkResultSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { barcodeAnalysis, goldenAnalysis } from '../testing/fixtures.js';
import { contextFor, template } from '../testing/context.js';
import { idUnprocessableSubmissionDetection } from './id-unprocessable-submission-detection.js';

const NOT_FOUND = {
  found: false,
  quad: null,
  method: 'none',
  rectified_size: null,
  aspect_ratio: null,
  area_ratio: null,
} as const;
const NO_MRZ = { found: false, format_guess: null, lines: [], line_confidences: [], box: null };

describe('idUnprocessableSubmissionDetection', () => {
  it('passes an identity document: outline, text and portrait on the front, the outline on the back', () => {
    const detector = { id: 'yunet-2026may', sha256: 'a'.repeat(64) };
    const result = idUnprocessableSubmissionDetection(
      contextFor({ models: { faceDetector: detector } }),
    );
    expect(result).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: {
        'front-document-found': true,
        'back-document-found': true,
        'front-text-lines': 13,
        'machine-readable-zone': true,
        'portrait-present': true,
      },
      provenance: { models: [detector], thresholds: { 'min-text-lines': 3 } },
    });
    expect(checkResultSchema.safeParse(result).success).toBe(true);
  });

  it('fails a front with no document outline, too little text and no identity feature', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front = {
      ...analysis.sides.front,
      document: NOT_FOUND,
      text: [],
      portrait: null,
    };
    analysis.sides.back = null;
    expect(idUnprocessableSubmissionDetection(contextFor({ analysis }))).toMatchObject({
      status: 'failed',
      reasons: ['document_not_found', 'insufficient_text', 'identity_features_not_found'],
    });
  });

  it('accepts a barcode in place of text and a portrait (a barcode-only back)', () => {
    expect(
      idUnprocessableSubmissionDetection(contextFor({ analysis: barcodeAnalysis() })).status,
    ).toBe('passed');
  });

  it('fails a back that shows no document', () => {
    const analysis = goldenAnalysis();
    if (analysis.sides.back !== null) {
      analysis.sides.back = {
        ...analysis.sides.back,
        document: NOT_FOUND,
        mrz: NO_MRZ,
        barcodes: [],
      };
    }
    expect(idUnprocessableSubmissionDetection(contextFor({ analysis }))).toMatchObject({
      status: 'failed',
      reasons: ['document_not_found'],
      metadata: { 'back-document-found': false },
    });
  });

  it('counts only OCR lines read with some confidence, against min-text-lines', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = analysis.sides.front.text.map((line) => ({
      ...line,
      confidence: 0.2,
    }));
    if (analysis.sides.back !== null) {
      analysis.sides.back.mrz = NO_MRZ;
    }
    expect(
      idUnprocessableSubmissionDetection(
        contextFor(
          { analysis },
          template({ id_unprocessable_submission_detection: { 'min-text-lines': 1 } }),
        ),
      ),
    ).toMatchObject({
      status: 'failed',
      reasons: ['insufficient_text'],
      metadata: { 'front-text-lines': 0 },
    });
  });

  it('answers input_missing without the C32.1 document detection or when no OCR model ran', () => {
    const { quality, faces, portrait } = goldenAnalysis().sides.front;
    expect(
      idUnprocessableSubmissionDetection(
        contextFor({
          analysis: { sides: { front: { quality, faces, portrait }, back: null } } as never,
        }),
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'] });
    const analysis = goldenAnalysis();
    analysis.model_versions = {
      ...analysis.model_versions,
      text_detector: null,
      text_recognizer: null,
    };
    expect(idUnprocessableSubmissionDetection(contextFor({ analysis }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
      metadata: { 'text-measured': false },
    });
  });
});
