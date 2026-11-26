import { describe, expect, it } from 'vitest';
import { extractGovernmentId } from '../extraction/extract.js';
import { barcodeAnalysis, goldenAnalysis } from '../testing/fixtures.js';
import { NOW, contextFor } from '../testing/context.js';
import { idMrzDetection } from './id-mrz-detection.js';

const NO_MRZ = { found: false, format_guess: null, lines: [], line_confidences: [], box: null };

/** The golden card's extraction (a Utopia TD1) with no MRZ read: the class stays established. */
function withoutMrz(backPresent = true) {
  const analysis = goldenAnalysis();
  const extraction = extractGovernmentId(analysis, { now: NOW });
  if (analysis.sides.back !== null) {
    analysis.sides.back.mrz = NO_MRZ;
  }
  if (!backPresent) {
    analysis.sides.back = null;
  }
  return {
    analysis,
    extraction: { ...extraction, sources: { ...extraction.sources, mrz: null } },
  };
}

describe('idMrzDetection', () => {
  it('passes a located and parsed MRZ, with its format and OCR models', () => {
    const recognizer = { id: 'pp-ocrv6-small-rec', sha256: 'd'.repeat(64) };
    expect(idMrzDetection(contextFor({ models: { textRecognizer: recognizer } }))).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: {
        format: 'TD1',
        side: 'back',
        'min-line-confidence': 0.9688,
        'corrected-fields': [],
      },
      provenance: { models: [recognizer] },
    });
  });

  it('names every character it corrected by MRZ field (C31.3)', () => {
    const analysis = goldenAnalysis();
    if (analysis.sides.back !== null) {
      const [first = '', second = '', third = ''] = analysis.sides.back.mrz.lines;
      analysis.sides.back.mrz = {
        ...analysis.sides.back.mrz,
        lines: [`1<UT0${first.slice(5)}`, second, third],
      };
    }
    expect(idMrzDetection(contextFor({ analysis }))).toMatchObject({
      status: 'passed',
      metadata: {
        'mrz-corrections': ['document_code', 'issuing_state'],
        'corrected-fields': ['issuing-authority-code'],
      },
    });
  });

  it('fails an MRZ that was found but cannot be read', () => {
    const analysis = goldenAnalysis();
    if (analysis.sides.back !== null) {
      analysis.sides.back.mrz = {
        ...analysis.sides.back.mrz,
        lines: ['I<UTOX12K45P787'],
        line_confidences: [0.4],
      };
    }
    expect(idMrzDetection(contextFor({ analysis }))).toMatchObject({
      status: 'failed',
      reasons: ['mrz_unreadable'],
      metadata: { 'mrz-error': 'mrz_unrecognized_format', side: 'back' },
    });
  });

  it('fails when the established class has an MRZ and none was found', () => {
    expect(idMrzDetection(contextFor(withoutMrz()))).toMatchObject({
      status: 'failed',
      reasons: ['mrz_not_found'],
    });
  });

  it('answers not_requested when the class keeps its MRZ on a back the flow did not ask for', () => {
    expect(
      idMrzDetection(
        contextFor({
          ...withoutMrz(false),
          requiredSides: 'front',
          uploads: { front: { sha256: 'a'.repeat(64) }, back: null },
        }),
      ),
    ).toMatchObject({ status: 'not_applicable', reasons: ['not_requested'] });
  });

  it('answers input_missing without a feature row: Utopia in production (C30.7)', () => {
    expect(
      idMrzDetection(contextFor({ ...withoutMrz(), environment: 'production' })),
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('answers feature_absent for an established AAMVA licence (C36)', () => {
    expect(idMrzDetection(contextFor({ analysis: barcodeAnalysis() }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['feature_absent'],
    });
  });

  it('answers input_missing when no OCR model ran, since no MRZ could be read', () => {
    const { analysis, extraction } = withoutMrz();
    analysis.model_versions = {
      ...analysis.model_versions,
      text_detector: null,
      text_recognizer: null,
    };
    expect(idMrzDetection(contextFor({ analysis, extraction }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });
});
