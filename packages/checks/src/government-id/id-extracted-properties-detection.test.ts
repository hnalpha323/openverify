import { describe, expect, it } from 'vitest';
import { barcodeAnalysis, goldenAnalysis } from '../testing/fixtures.js';
import { contextFor, template } from '../testing/context.js';
import { idExtractedPropertiesDetection } from './id-extracted-properties-detection.js';

const DEFAULT_FIELDS = [
  'name-first',
  'name-last',
  'birthdate',
  'identification-number',
  'expiration-date',
];

describe('idExtractedPropertiesDetection', () => {
  it('passes when every default required field was extracted', () => {
    const recognizer = { id: 'pp-ocrv6-small-rec', sha256: 'e'.repeat(64) };
    expect(
      idExtractedPropertiesDetection(contextFor({ models: { textRecognizer: recognizer } })),
    ).toMatchObject({
      status: 'passed',
      reasons: [],
      metadata: { 'required-fields': DEFAULT_FIELDS, 'missing-fields': [] },
      provenance: { models: [recognizer], thresholds: { 'required-fields': DEFAULT_FIELDS } },
    });
  });

  it('fails naming the required fields that were not extracted', () => {
    const context = contextFor(
      {},
      template({
        id_extracted_properties_detection: {
          'required-fields': ['birthdate', 'address-postal-code', 'sex'],
        },
      }),
    );
    expect(idExtractedPropertiesDetection(context)).toMatchObject({
      status: 'failed',
      reasons: ['required_fields_missing'],
      metadata: { 'missing-fields': ['address-postal-code'] },
    });
  });

  describe('a holder with a single name (ICAO 9303 Part 3; G008)', () => {
    /** The golden card with this TD1 name line and no visual zone. */
    function singleName(nameLine: string, checkDigitsValid = true) {
      const analysis = goldenAnalysis();
      analysis.sides.front.text = [];
      const back = analysis.sides.back;
      if (back === null) {
        throw new Error('the golden fixture has a back');
      }
      back.mrz = {
        ...back.mrz,
        lines: back.mrz.lines.map((line, index) => {
          if (index === 2) {
            return nameLine;
          }
          // A wrong birth date check digit (position 6 of line 2).
          return index === 1 && !checkDigitsValid ? `${line.slice(0, 6)}0${line.slice(7)}` : line;
        }),
      };
      return analysis;
    }

    it('does not miss a first name a valid MRZ says the holder does not have', () => {
      const context = contextFor({ analysis: singleName('SUHARTO<<<<<<<<<<<<<<<<<<<<<<<') });
      expect(context.extraction.sources.mrz?.parsed.givenNames).toBe('');
      expect(idExtractedPropertiesDetection(context)).toMatchObject({
        status: 'passed',
        reasons: [],
        metadata: { 'missing-fields': [], 'single-name': true },
      });
    });

    it('still misses it when the MRZ check digits fail or the name field was full', () => {
      for (const analysis of [
        singleName('SUHARTO<<<<<<<<<<<<<<<<<<<<<<<', false),
        singleName('SUHARTOKUSUMOWARDHANIPRAWIRANE'),
      ]) {
        expect(idExtractedPropertiesDetection(contextFor({ analysis }))).toMatchObject({
          status: 'failed',
          reasons: ['required_fields_missing'],
          metadata: { 'missing-fields': ['name-first'] },
        });
      }
    });
  });

  it('does not require an expiry of a class the feature table says has none', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = analysis.sides.front.text.slice(0, 10);
    if (analysis.sides.back !== null) {
      analysis.sides.back.mrz = {
        found: false,
        format_guess: null,
        lines: [],
        line_confidences: [],
        box: null,
      };
    }
    const context = contextFor({ analysis });
    expect(idExtractedPropertiesDetection(context)).toMatchObject({
      status: 'failed',
      metadata: { 'missing-fields': ['expiration-date'] },
    });
    const row = contextFor().features;
    if (row === null) {
      throw new Error('the Utopia row exists in a sandbox');
    }
    expect(
      idExtractedPropertiesDetection({ ...context, features: { ...row, expiry: false } }),
    ).toMatchObject({
      status: 'passed',
      metadata: {
        'required-fields': DEFAULT_FIELDS.filter((field) => field !== 'expiration-date'),
      },
    });
  });

  it('reads the fields from a barcode without OCR', () => {
    const analysis = barcodeAnalysis();
    analysis.model_versions = {
      ...analysis.model_versions,
      text_detector: null,
      text_recognizer: null,
    };
    expect(idExtractedPropertiesDetection(contextFor({ analysis })).status).toBe('passed');
  });

  it('answers input_missing when no OCR model ran and no barcode was read', () => {
    const analysis = goldenAnalysis();
    analysis.model_versions = {
      ...analysis.model_versions,
      text_detector: null,
      text_recognizer: null,
    };
    analysis.sides.front.text = [];
    analysis.sides.back = null;
    expect(idExtractedPropertiesDetection(contextFor({ analysis }))).toMatchObject({
      status: 'not_applicable',
      reasons: ['input_missing'],
    });
  });

  describe('missing-fields-outcome (Phase 12A C6)', () => {
    const config = (outcome?: 'fail' | 'review') =>
      template({
        id_extracted_properties_detection: {
          'required-fields': ['birthdate', 'address-postal-code'],
          ...(outcome === undefined ? {} : { 'missing-fields-outcome': outcome }),
        },
      });

    it('fails missing fields by default and with fail', () => {
      for (const outcome of [undefined, 'fail'] as const) {
        expect(idExtractedPropertiesDetection(contextFor({}, config(outcome)))).toMatchObject({
          status: 'failed',
          reasons: ['required_fields_missing'],
          metadata: { 'missing-fields': ['address-postal-code'] },
        });
      }
    });

    it('answers not_applicable with required_fields_missing under review, naming the fields', () => {
      expect(idExtractedPropertiesDetection(contextFor({}, config('review')))).toMatchObject({
        status: 'not_applicable',
        reasons: ['required_fields_missing'],
        metadata: {
          'required-fields': ['birthdate', 'address-postal-code'],
          'missing-fields': ['address-postal-code'],
        },
        provenance: { thresholds: { 'missing-fields-outcome': 'review' } },
      });
    });

    it('passes under review when nothing is missing', () => {
      const all = template({
        id_extracted_properties_detection: { 'missing-fields-outcome': 'review' },
      });
      expect(idExtractedPropertiesDetection(contextFor({}, all))).toMatchObject({
        status: 'passed',
        reasons: [],
      });
    });

    it('keeps input_missing when no OCR ran and no barcode was read, under review too', () => {
      const analysis = goldenAnalysis();
      analysis.model_versions = { ...analysis.model_versions, text_detector: null };
      expect(
        idExtractedPropertiesDetection(contextFor({ analysis }, config('review'))),
      ).toMatchObject({ status: 'not_applicable', reasons: ['input_missing'] });
    });
  });
});
