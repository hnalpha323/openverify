import { describe, expect, it } from 'vitest';
import {
  EXTRACTION_FIELDS,
  EXTRACTION_SOURCES,
  emptyExtractedFields,
  extractedFieldsSchema,
  extractionFieldSourcesSchema,
  type ExtractedFields,
} from './extraction.js';

/** A fictional holder of the sandbox test issuer Utopia (C30.7); no real person. */
const holder: ExtractedFields = {
  'name-first': 'QUINN',
  'name-middle': null,
  'name-last': 'VALEMONT',
  birthdate: '1990-02-14',
  sex: 'X',
  nationality: 'UTO',
  'identification-number': 'X12K45P78',
  'personal-number': null,
  'issue-date': '2024-03-01',
  'expiration-date': '2034-02-28',
  'issuing-authority-code': 'UTO',
  'address-street-1': '12 LANTERN ROW',
  'address-street-2': null,
  'address-city': 'NORTH HAVEN',
  'address-subdivision': null,
  'address-postal-code': 'UT 1024',
  'address-country-code': null,
  endorsements: null,
  restrictions: null,
  'vehicle-class': null,
};

describe('extraction fields (C31.5)', () => {
  it('are the C31.5 attribute names, in order', () => {
    expect(EXTRACTION_FIELDS).toEqual([
      'name-first',
      'name-middle',
      'name-last',
      'birthdate',
      'sex',
      'nationality',
      'identification-number',
      'personal-number',
      'issue-date',
      'expiration-date',
      'issuing-authority-code',
      'address-street-1',
      'address-street-2',
      'address-city',
      'address-subdivision',
      'address-postal-code',
      'address-country-code',
      'endorsements',
      'restrictions',
      'vehicle-class',
    ]);
    expect(EXTRACTION_SOURCES).toEqual(['mrz', 'barcode', 'viz', 'nfc']);
  });

  it('accept a full record and an empty one, with every field present', () => {
    expect(extractedFieldsSchema.parse(holder)).toEqual(holder);
    expect(extractedFieldsSchema.parse(emptyExtractedFields())).toEqual(
      Object.fromEntries(EXTRACTION_FIELDS.map((field) => [field, null])),
    );
    expect(extractedFieldsSchema.safeParse({ ...holder, sex: undefined }).success).toBe(false);
  });

  it.each([
    ['an impossible date', { birthdate: '1990-02-30' }],
    ['a compact date', { 'expiration-date': '20340228' }],
    ['a sex outside M, F and X', { sex: 'male' }],
    ['a two-letter nationality', { nationality: 'UT' }],
    ['a lower-case nationality', { nationality: 'uto' }],
    ['an issuer code with spaces', { 'issuing-authority-code': 'UTO AUTH' }],
    ['an alpha-3 address country', { 'address-country-code': 'UTO' }],
    ['an empty name', { 'name-first': '' }],
    ['a control character', { 'address-city': 'NORTH\u0000HAVEN' }],
    ['an over-long value', { 'address-street-1': 'A'.repeat(201) }],
    ['an unknown field', { 'eye-color': 'BRO' }],
    ['a number instead of text', { 'identification-number': 12_345 }],
  ])('reject %s', (_label, change) => {
    expect(extractedFieldsSchema.safeParse({ ...holder, ...change }).success).toBe(false);
  });
});

describe('extraction sources (C31.5)', () => {
  it('name, per field, the sources that agreed', () => {
    const sources = { birthdate: ['mrz', 'viz'], 'identification-number': ['barcode'] };
    expect(extractionFieldSourcesSchema.parse(sources)).toEqual(sources);
    expect(extractionFieldSourcesSchema.parse({})).toEqual({});
  });

  it.each([
    ['an empty source list', { birthdate: [] }],
    ['an unknown source', { birthdate: ['ocr'] }],
    ['a source named twice', { birthdate: ['mrz', 'mrz'] }],
    ['an unknown field', { 'eye-color': ['viz'] }],
    ['a value instead of sources', { birthdate: '1990-02-14' }],
  ])('reject %s', (_label, sources) => {
    expect(extractionFieldSourcesSchema.safeParse(sources).success).toBe(false);
  });
});
