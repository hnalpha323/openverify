import { describe, expect, it } from 'vitest';
import {
  aamvaPayload,
  barcodeAnalysis,
  goldenAnalysis,
  labelledLines,
  withBarcode,
} from '../testing/fixtures.js';
import { extractionWith } from '../testing/extraction.js';
import { contextFor } from '../testing/context.js';
import { idExtractionInconsistencyDetection } from './id-extraction-inconsistency-detection.js';

/** A country code a US licence prints alone in its header band (an ICAO-style code, not its IIN). */
const usaHeader = {
  text: 'USA',
  confidence: 0.97,
  box: [200, 10, 60, 20] as const,
  stroke_width_mean: 3,
  stroke_width_cv: 0.12,
};

describe('idExtractionInconsistencyDetection', () => {
  it('passes when the MRZ and the visual zone agree on what both read', () => {
    expect(idExtractionInconsistencyDetection(contextFor())).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: {
        sources: ['mrz', 'viz'],
        'compared-pairs': ['mrz-viz'],
        'common-fields': 5,
        'disagreeing-fields': [],
      },
    });
  });

  it('fails when two sources read a field differently, naming the field and never the values', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = analysis.sides.front.text.map((line) =>
      line.text === '14 02 1990' ? { ...line, text: '15 02 1990' } : line,
    );
    const result = idExtractionInconsistencyDetection(contextFor({ analysis }));
    expect(result).toMatchObject({
      status: 'failed',
      reasons: ['extraction_inconsistent'],
      metadata: { 'disagreeing-fields': ['birthdate'] },
    });
    expect(JSON.stringify(result)).not.toContain('1990');
  });

  it('passes a genuine licence that prints USA alone in its header beside its AAMVA barcode (G004)', () => {
    const analysis = withBarcode(aamvaPayload('dl-636014-real-id'));
    analysis.sides.front.text = [
      usaHeader,
      ...labelledLines([
        ['LN', 'TESTWORTH'],
        ['FN', 'JORDAN'],
        ['DOB', '02/14/1990'],
        ['EXP', '02/14/2031'],
        ['DLN', 'Y9876543'],
      ]),
    ];
    const context = contextFor({ analysis });
    expect(context.extraction.sources.viz?.fields['issuing-authority-code']).toBe('USA');
    expect(context.extraction.consolidated.fields['issuing-authority-code']).toBe('636014');

    expect(idExtractionInconsistencyDetection(context)).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: { sources: ['barcode', 'viz'], 'disagreeing-fields': [] },
    });
  });

  it('fails a printed surname that only starts like the MRZ one (G007)', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = analysis.sides.front.text.map((line) =>
      // Jaro-Winkler 0.914 with VALEMONT: below C31.2's 0.92; only a prefix.
      line.text === 'VALEMONT' ? { ...line, text: 'VALEMONTBERGER' } : line,
    );
    expect(idExtractionInconsistencyDetection(contextFor({ analysis }))).toMatchObject({
      status: 'failed',
      reasons: ['extraction_inconsistent'],
      metadata: { 'disagreeing-fields': ['name-last'] },
    });
  });

  it('passes a TD1 whose full name field cut the given names the card prints whole (G007)', () => {
    const analysis = goldenAnalysis();
    const back = analysis.sides.back;
    if (back === null) {
      throw new Error('the golden fixture has a back');
    }
    // 30 characters ending in a letter: ICAO 9303 may have cut the name.
    back.mrz = {
      ...back.mrz,
      lines: back.mrz.lines.map((line, index) =>
        index === 2 ? 'VALEMONT<<QUINN<ALEXANDRA<BEAT' : line,
      ),
    };
    analysis.sides.front.text = analysis.sides.front.text.map((line) =>
      line.text === 'QUINN' ? { ...line, text: 'QUINN ALEXANDRA BEATRIX' } : line,
    );
    const context = contextFor({ analysis });
    expect(context.extraction.sources.mrz?.parsed.nameTruncated).toBe(true);

    expect(idExtractionInconsistencyDetection(context)).toMatchObject({
      status: 'passed',
      metadata: { 'disagreeing-fields': [] },
    });
  });

  it('answers input_missing with a single source (C31.4)', () => {
    expect(
      idExtractionInconsistencyDetection(contextFor({ analysis: barcodeAnalysis() })),
    ).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
      metadata: { sources: ['barcode'] },
    });
  });

  it('answers input_missing when no two sources share two fields (C31.4)', () => {
    const extraction = extractionWith({}, {}, [
      { source: 'mrz', fields: { 'name-last': 'VALEMONT', sex: 'F' }, checkDigitsValid: true },
      { source: 'viz', fields: { 'name-last': 'VALEMONT', 'address-city': 'NORTH HAVEN' } },
    ]);
    expect(idExtractionInconsistencyDetection(contextFor({ extraction }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
      metadata: { 'common-fields': 1 },
    });
  });
});
