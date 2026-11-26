import { EXTRACTION_FIELDS, extractedFieldsSchema } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { consolidateExtraction, fieldsReadByBoth } from './consolidate.js';

const MRZ = {
  'name-last': 'VALEMONT',
  'name-first': 'QUINN',
  birthdate: '1990-02-14',
  'identification-number': 'X12K45P78',
  'expiration-date': '2034-02-28',
  sex: 'F',
} as const;

describe('consolidateExtraction (C31.2)', () => {
  it('returns every C31.5 field, null when no source read it, and a schema-valid extraction', () => {
    const consolidated = consolidateExtraction([]);
    expect(Object.keys(consolidated.fields)).toEqual([...EXTRACTION_FIELDS]);
    expect(Object.values(consolidated.fields).every((value) => value === null)).toBe(true);
    expect(consolidated.fieldSources).toEqual({});
    expect(consolidated.disagreeingFields).toEqual([]);
    expect(extractedFieldsSchema.safeParse(consolidated.fields).success).toBe(true);
  });

  it('names, per field, the sources that agree', () => {
    const consolidated = consolidateExtraction([
      { source: 'mrz', fields: MRZ, checkDigitsValid: true },
      {
        source: 'viz',
        fields: { 'name-last': 'Valemont', birthdate: '1990-02-14', 'address-city': 'NORTH HAVEN' },
      },
    ]);
    expect(consolidated.fields).toMatchObject({ ...MRZ, 'address-city': 'NORTH HAVEN' });
    expect(consolidated.fieldSources).toEqual({
      'name-first': ['mrz'],
      'name-last': ['mrz', 'viz'],
      birthdate: ['mrz', 'viz'],
      sex: ['mrz'],
      'identification-number': ['mrz'],
      'expiration-date': ['mrz'],
      'address-city': ['viz'],
    });
    expect(consolidated.details.birthdate).toEqual({
      value: '1990-02-14',
      readBy: ['mrz', 'viz'],
      agreeing: ['mrz', 'viz'],
      disagreeing: [],
    });
    expect(consolidated.disagreeingFields).toEqual([]);
  });

  it('takes a check-digit-valid MRZ first, then the barcode, then the VIZ', () => {
    const readings = [
      { source: 'viz' as const, fields: { birthdate: '1990-02-15' } },
      { source: 'barcode' as const, fields: { birthdate: '1990-02-16' } },
      { source: 'mrz' as const, fields: { birthdate: '1990-02-14' }, checkDigitsValid: true },
    ];
    expect(consolidateExtraction(readings).fields.birthdate).toBe('1990-02-14');
    expect(consolidateExtraction(readings.slice(0, 2)).fields.birthdate).toBe('1990-02-16');
    expect(consolidateExtraction(readings.slice(0, 1)).fields.birthdate).toBe('1990-02-15');
  });

  it('puts an MRZ whose check digits fail after the VIZ', () => {
    const consolidated = consolidateExtraction([
      { source: 'mrz', fields: { birthdate: '1990-02-14' }, checkDigitsValid: false },
      { source: 'viz', fields: { birthdate: '1990-02-15' } },
    ]);
    expect(consolidated.fields.birthdate).toBe('1990-02-15');
  });

  it('records a disagreement only where two sources read a field and differ', () => {
    const consolidated = consolidateExtraction([
      { source: 'mrz', fields: MRZ, checkDigitsValid: true },
      { source: 'viz', fields: { 'name-last': 'VALENTINE', 'name-first': 'QUINN' } },
      { source: 'barcode', fields: { 'name-last': 'VALEMONT' } },
    ]);
    expect(consolidated.disagreeingFields).toEqual(['name-last']);
    expect(consolidated.details['name-last']).toEqual({
      value: 'VALEMONT',
      readBy: ['mrz', 'barcode', 'viz'],
      agreeing: ['mrz', 'barcode'],
      disagreeing: [
        ['mrz', 'viz'],
        ['barcode', 'viz'],
      ],
    });
    expect(consolidated.fieldSources['name-last']).toEqual(['mrz', 'barcode']);
  });

  it('never counts an absent field as a mismatch', () => {
    const consolidated = consolidateExtraction([
      { source: 'mrz', fields: MRZ, checkDigitsValid: true },
      { source: 'viz', fields: {} },
    ]);
    expect(consolidated.disagreeingFields).toEqual([]);
  });

  it('counts a corrected MRZ field only where the VIZ agrees with it (C31.3)', () => {
    const confirmed = consolidateExtraction([
      { source: 'mrz', fields: MRZ, checkDigitsValid: true, correctedFields: ['birthdate'] },
      { source: 'viz', fields: { birthdate: '1990-02-14' } },
    ]);
    expect(confirmed.fieldSources.birthdate).toEqual(['mrz', 'viz']);
    expect(confirmed.unconfirmedCorrections).toEqual([]);

    const unconfirmed = consolidateExtraction([
      { source: 'mrz', fields: MRZ, checkDigitsValid: true, correctedFields: ['birthdate', 'sex'] },
      { source: 'viz', fields: { birthdate: '1991-02-14' } },
    ]);
    expect(unconfirmed.fields.birthdate).toBe('1991-02-14');
    expect(unconfirmed.fields.sex).toBeNull();
    expect(unconfirmed.fieldSources.birthdate).toEqual(['viz']);
    expect(unconfirmed.details.birthdate?.readBy).toEqual(['viz']);
    expect(unconfirmed.unconfirmedCorrections).toEqual(['birthdate', 'sex']);
  });

  it('drops a value the C31.5 schema refuses', () => {
    const consolidated = consolidateExtraction([
      {
        source: 'viz',
        fields: { birthdate: '1990-02-30', nationality: 'UTOPIA', 'name-last': 'X'.repeat(101) },
      },
    ]);
    expect(consolidated.fields.birthdate).toBeNull();
    expect(consolidated.fields.nationality).toBeNull();
    expect(consolidated.fields['name-last']).toBeNull();
    expect(consolidated.fieldSources).toEqual({});
  });

  it('compares an issuer code only with one of the same scheme: an AAMVA IIN is not an ICAO code (G004)', () => {
    const consolidated = consolidateExtraction([
      {
        source: 'barcode',
        fields: { 'issuing-authority-code': '636014', birthdate: '1990-02-14' },
      },
      { source: 'viz', fields: { 'issuing-authority-code': 'USA', birthdate: '1990-02-14' } },
    ]);
    expect(consolidated.fields['issuing-authority-code']).toBe('636014');
    expect(consolidated.disagreeingFields).toEqual([]);
    expect(consolidated.details['issuing-authority-code']).toEqual({
      value: '636014',
      readBy: ['barcode'],
      agreeing: ['barcode'],
      disagreeing: [],
    });
    expect(fieldsReadByBoth(consolidated, 'barcode', 'viz')).toEqual(['birthdate']);
  });

  it('compares ICAO issuer codes as countries: D is DEU, UTO is not (G004)', () => {
    const german = consolidateExtraction([
      { source: 'mrz', fields: { 'issuing-authority-code': 'D' }, checkDigitsValid: true },
      { source: 'viz', fields: { 'issuing-authority-code': 'DEU' } },
    ]);
    expect(german.disagreeingFields).toEqual([]);
    expect(german.fieldSources['issuing-authority-code']).toEqual(['mrz', 'viz']);
    const other = consolidateExtraction([
      { source: 'mrz', fields: { 'issuing-authority-code': 'UTO' }, checkDigitsValid: true },
      { source: 'viz', fields: { 'issuing-authority-code': 'DEU' } },
    ]);
    expect(other.disagreeingFields).toEqual(['issuing-authority-code']);
  });

  it('compares a name the MRZ may have cut short as a truncation, and only that one (G007)', () => {
    const viz = {
      source: 'viz',
      fields: { 'name-first': 'ALEXANDRA BEATRIX', 'name-last': 'DOEBERT' },
    } as const;
    const cut = consolidateExtraction([
      {
        source: 'mrz',
        fields: { 'name-first': 'ALEXANDRA B', 'name-last': 'DOEBERT' },
        checkDigitsValid: true,
        truncatedFields: ['name-first', 'name-last'],
      },
      viz,
    ]);
    expect(cut.disagreeingFields).toEqual([]);
    expect(cut.fieldSources['name-first']).toEqual(['mrz', 'viz']);

    const whole = consolidateExtraction([
      {
        source: 'mrz',
        fields: { 'name-first': 'ALEXANDRA BEATRIX', 'name-last': 'DOE' },
        checkDigitsValid: true,
        truncatedFields: [],
      },
      viz,
    ]);
    expect(whole.disagreeingFields).toEqual(['name-last']);
  });

  it('lists the fields two sources both read (C31.4)', () => {
    const consolidated = consolidateExtraction([
      { source: 'mrz', fields: MRZ, checkDigitsValid: true },
      {
        source: 'viz',
        fields: { 'name-last': 'VALEMONT', birthdate: '1991-01-01', 'address-city': 'X' },
      },
    ]);
    expect(fieldsReadByBoth(consolidated, 'mrz', 'viz')).toEqual(['name-last', 'birthdate']);
    expect(fieldsReadByBoth(consolidated, 'mrz', 'barcode')).toEqual([]);
  });
});
