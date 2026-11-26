import { extractedFieldsSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { barcodeAnalysis, goldenAnalysis } from '../testing/fixtures.js';
import { extractGovernmentId } from './extract.js';

const NOW = new Date('2026-10-21T12:00:00Z');

describe('extractGovernmentId (C31)', () => {
  it('reads the golden Utopia card: MRZ on the back, VIZ and address, consolidated', () => {
    const extraction = extractGovernmentId(goldenAnalysis(), { now: NOW });
    expect(extraction.consolidated.fields).toEqual({
      'name-first': 'QUINN',
      'name-middle': null,
      'name-last': 'VALEMONT',
      birthdate: '1990-02-14',
      sex: 'F',
      nationality: 'UTO',
      'identification-number': 'X12K45P78',
      'personal-number': null,
      'issue-date': null,
      'expiration-date': '2034-02-28',
      'issuing-authority-code': 'UTO',
      'address-street-1': '12 LANTERN ROW',
      'address-street-2': null,
      'address-city': 'NORTH HAVEN',
      'address-subdivision': null,
      'address-postal-code': null,
      'address-country-code': null,
      endorsements: null,
      restrictions: null,
      'vehicle-class': null,
    });
    expect(extractedFieldsSchema.safeParse(extraction.consolidated.fields).success).toBe(true);
    expect(extraction.consolidated.fieldSources).toEqual({
      'name-first': ['mrz', 'viz'],
      'name-last': ['mrz', 'viz'],
      birthdate: ['mrz', 'viz'],
      sex: ['mrz'],
      nationality: ['mrz'],
      'identification-number': ['mrz', 'viz'],
      'expiration-date': ['mrz', 'viz'],
      'issuing-authority-code': ['mrz'],
      'address-street-1': ['viz'],
      'address-city': ['viz'],
    });
    expect(extraction.sources.mrz).toMatchObject({
      side: 'back',
      correctedFields: [],
      minLineConfidence: 0.9688,
    });
    expect(extraction.sources.mrz?.parsed.valid).toBe(true);
    expect(extraction.sources.barcode).toBeNull();
    expect(extraction.sources.viz?.readings.birthdate).toMatchObject({
      side: 'front',
      lineIndex: 7,
    });
    expect(extraction.sources.viz?.readings['address-city']).toMatchObject({ side: 'back' });
    expect(extraction.document).toEqual({
      idClass: 'national_id',
      classSource: 'mrz',
      issuer: { scheme: 'icao', code: 'UTO', country: null, jurisdiction: null },
      layout: 'TD1',
    });
  });

  it('reads the barcode-only fixture as a California licence', () => {
    const extraction = extractGovernmentId(barcodeAnalysis(), { now: NOW });
    expect(extraction.sources.barcode?.side).toBe('front');
    expect(extraction.consolidated.fields).toMatchObject({
      'name-first': 'JORDAN',
      'name-last': 'TESTWORTH',
      birthdate: '1990-02-14',
      'expiration-date': '2031-02-14',
      'identification-number': 'Y9876543',
      'issuing-authority-code': '636014',
      sex: 'F',
    });
    expect(extraction.document).toMatchObject({
      idClass: 'drivers_license',
      classSource: 'barcode',
    });
  });

  it('resolves MRZ centuries against now: a birth date in the past, an expiry within 50 years', () => {
    const analysis = goldenAnalysis();
    const back = analysis.sides.back;
    if (back === null) {
      throw new Error('the golden fixture has a back');
    }
    back.mrz = {
      ...back.mrz,
      lines: [
        'I<UTOD231458907<<<<<<<<<<<<<<<',
        '7408122F1204159UTO<<<<<<<<<<<6',
        'ERIKSSON<<ANNA<MARIA<<<<<<<<<<',
      ],
    };
    analysis.sides.front.text = [];
    const fields = extractGovernmentId(analysis, { now: NOW }).consolidated.fields;
    expect(fields.birthdate).toBe('1974-08-12');
    expect(fields['expiration-date']).toBe('2012-04-15');
  });

  it('applies the C31.3 corrections and names the corrected fields', () => {
    const analysis = goldenAnalysis();
    const back = analysis.sides.back;
    if (back === null) {
      throw new Error('the golden fixture has a back');
    }
    back.mrz = {
      ...back.mrz,
      lines: [
        back.mrz.lines[0] ?? '',
        '9OO2144F3402281UTO<<<<<<<<<<<2'.replace('9OO', '9O0'),
        back.mrz.lines[2] ?? '',
      ],
    };
    const extraction = extractGovernmentId(analysis, { now: NOW });
    expect(extraction.sources.mrz?.correctedFields).toEqual(['birthdate']);
    expect(extraction.consolidated.fieldSources.birthdate).toEqual(['mrz', 'viz']);
  });

  it('records an MRZ that was found but does not parse, and reads on', () => {
    const analysis = goldenAnalysis();
    const back = analysis.sides.back;
    if (back === null) {
      throw new Error('the golden fixture has a back');
    }
    back.mrz = { ...back.mrz, lines: ['I<UTOX12K45P787<<<<<<<<<<<<<<<'], line_confidences: [0.9] };
    const extraction = extractGovernmentId(analysis, { now: NOW });
    expect(extraction.sources.mrz).toBeNull();
    expect(extraction.sources.mrzError).toEqual({ side: 'back', code: 'mrz_unrecognized_format' });
    expect(extraction.consolidated.fields['name-last']).toBe('VALEMONT');
    expect(extraction.document).toMatchObject({ idClass: 'national_id', classSource: 'viz' });
  });

  it('records a PDF417 that is not an AAMVA payload', () => {
    const analysis = barcodeAnalysis();
    const [barcode] = analysis.sides.front.barcodes;
    if (barcode === undefined) {
      throw new Error('the barcode fixture has a barcode');
    }
    analysis.sides.front.barcodes = [
      {
        ...barcode,
        bytes_b64: Buffer.from('NOT AAMVA', 'latin1').toString('base64'),
        text: 'NOT AAMVA',
      },
    ];
    const extraction = extractGovernmentId(analysis, { now: NOW });
    expect(extraction.sources.barcode).toBeNull();
    expect(extraction.sources.barcodeError).toEqual({
      side: 'front',
      code: 'aamva_header_invalid',
    });
  });

  it('extracts nothing from an analysis without text, MRZ or barcode', () => {
    const analysis = goldenAnalysis();
    analysis.sides.front.text = [];
    analysis.sides.back = null;
    const extraction = extractGovernmentId(analysis, { now: NOW });
    expect(extraction.sources).toEqual({
      mrz: null,
      mrzError: null,
      barcode: null,
      barcodeError: null,
      viz: null,
    });
    expect(extraction.consolidated.fieldSources).toEqual({});
    expect(extraction.document.idClass).toBeNull();
  });

  it('reads a Phase 1 analysis without the C32.1 fields as nothing extracted', () => {
    const analysis = goldenAnalysis();
    const { quality, faces, portrait } = analysis.sides.front;
    const extraction = extractGovernmentId({
      sides: { front: { quality, faces, portrait }, back: null },
    });
    expect(extraction.consolidated.fieldSources).toEqual({});
  });
});
