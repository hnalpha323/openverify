import { describe, expect, it } from 'vitest';
import {
  aamvaPayload,
  barcodeAnalysis,
  labelledLines,
  quebecAamvaPayload,
  withBarcode,
} from '../testing/fixtures.js';
import { contextFor } from '../testing/context.js';
import { idBarcodeInconsistencyDetection } from './id-barcode-inconsistency-detection.js';
import { GOVERNMENT_ID_EVALUATOR_REASONS } from './reasons.js';

/** A California licence whose front reads the holder of the dl-636014-real-id vector. */
function californiaLicence(birth = '02/14/1990') {
  const analysis = withBarcode(aamvaPayload('dl-636014-real-id'));
  analysis.sides.front.text = labelledLines([
    ['SURNAME', 'TESTWORTH'],
    ['GIVEN NAMES', 'JORDAN'],
    ['DOB', birth],
    ['DL NO', 'Y9876543'],
    ['EXP', '02/14/2031'],
  ]);
  return analysis;
}

/** A country code a US licence prints alone in its header band (an ICAO-style code, not its IIN). */
const usaHeader = {
  text: 'USA',
  confidence: 0.97,
  box: [200, 10, 60, 20] as const,
  stroke_width_mean: 3,
  stroke_width_cv: 0.12,
};

describe('idBarcodeInconsistencyDetection', () => {
  it('passes a valid AAMVA payload that agrees with the front', () => {
    expect(
      idBarcodeInconsistencyDetection(contextFor({ analysis: californiaLicence() })),
    ).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: {
        'aamva-version': 10,
        'compared-fields': [
          'name-first',
          'name-last',
          'birthdate',
          'identification-number',
          'expiration-date',
        ],
        'disagreeing-fields': [],
        'agreement-fields': 4,
      },
    });
  });

  it('passes a front that prints USA alone in its header: the IIN is not compared with it (G004)', () => {
    const analysis = californiaLicence();
    analysis.sides.front.text = [usaHeader, ...analysis.sides.front.text];
    const context = contextFor({ analysis });
    expect(context.extraction.sources.viz?.fields['issuing-authority-code']).toBe('USA');

    expect(idBarcodeInconsistencyDetection(context)).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: {
        'compared-fields': [
          'name-first',
          'name-last',
          'birthdate',
          'identification-number',
          'expiration-date',
        ],
        'disagreeing-fields': [],
      },
    });
  });

  it('fails a front that disagrees with the barcode, naming the field', () => {
    expect(
      idBarcodeInconsistencyDetection(contextFor({ analysis: californiaLicence('02/15/1990') })),
    ).toMatchObject({
      status: 'failed',
      reasons: ['barcode_viz_mismatch'],
      metadata: { 'disagreeing-fields': ['birthdate'] },
    });
  });

  it('fails a payload without its mandatory elements', () => {
    expect(
      idBarcodeInconsistencyDetection(contextFor({ analysis: barcodeAnalysis() })),
    ).toMatchObject({
      status: 'failed',
      reasons: ['aamva_mandatory_element_missing'],
    });
  });

  it.each([
    ['aamva-version-11', 'aamva_version_unsupported'],
    ['iin-not-listed', 'aamva_iin_unknown'],
    ['birth-date-not-a-date', 'aamva_date_invalid'],
  ])('fails the %s vector with %s', (id, reason) => {
    expect(
      idBarcodeInconsistencyDetection(contextFor({ analysis: withBarcode(aamvaPayload(id)) }))
        .reasons,
    ).toContain(reason);
  });

  it.each([
    ['qc-file-type-aamva', 'aamva_header_nonstandard'],
    ['qc-offset-shift', 'aamva_designator_offset_mismatch'],
  ])('fails the tolerated Quebec deviation %s with %s, a listed reason (C4)', (id, reason) => {
    const result = idBarcodeInconsistencyDetection(
      contextFor({ analysis: withBarcode(quebecAamvaPayload(id)) }),
    );
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.reasons).toContain(reason);
    expect(GOVERNMENT_ID_EVALUATOR_REASONS.id_barcode_inconsistency_detection).toContain(reason);
  });

  it('fails a PDF417 that is not an AAMVA payload', () => {
    expect(
      idBarcodeInconsistencyDetection(contextFor({ analysis: withBarcode('HELLO WORLD') })),
    ).toMatchObject({
      status: 'failed',
      reasons: ['aamva_header_invalid'],
    });
  });

  it('answers input_missing when the front does not show what the barcode says (C31.4)', () => {
    const analysis = withBarcode(aamvaPayload('dl-636014-real-id'));
    analysis.sides.front.text = [];
    expect(idBarcodeInconsistencyDetection(contextFor({ analysis }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
      metadata: { 'agreement-fields': 0 },
    });
  });

  it('answers feature_absent for the Utopia TD1 in a sandbox, input_missing without a row', () => {
    expect(idBarcodeInconsistencyDetection(contextFor())).toMatchObject({
      status: 'not_applicable',
      reasons: ['feature_absent'],
    });
    expect(
      idBarcodeInconsistencyDetection(contextFor({ environment: 'production' })),
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  it('never puts a value in the result', () => {
    const serialized = JSON.stringify(
      idBarcodeInconsistencyDetection(contextFor({ analysis: californiaLicence('02/15/1990') })),
    );
    for (const value of ['TESTWORTH', 'JORDAN', 'Y9876543', '1990']) {
      expect(serialized).not.toContain(value);
    }
  });
});
