/**
 * C100.3, C100.4: the importer's column and error-code tables. A header problem names a column of
 * the table, never text from the file, because a file with no header holds a person in its first
 * row. Every value is synthetic.
 */
import {
  IMPORT_ERROR_CODES,
  IMPORTER_LIST_KINDS,
  LIST_KINDS,
  type ListKind,
} from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  ListKeyInputError,
  importColumnOf,
  importColumns,
  importErrorCodeOfParser,
  importErrorScope,
  importHeaderProblems,
  importRowItem,
  listKeyInputs,
} from './index.js';

const COLUMNS: readonly (readonly [ListKind, readonly string[]])[] = [
  ['browser-fingerprint', ['value']],
  ['device-fingerprint', ['value']],
  ['country', ['country_code']],
  ['email-address', ['value', 'match_type']],
  ['geolocation', ['latitude', 'longitude', 'radius_meters']],
  ['government-id-number', ['id_number', 'id_class']],
  ['field', ['field_value']],
  ['ip-address', ['value']],
  ['name', ['name_first', 'name_last']],
  ['phone-number', ['value']],
  ['string', ['value']],
];

describe('importColumns (C100.3)', () => {
  it('covers every kind with an importer', () => {
    expect(COLUMNS.map(([kind]) => kind).sort()).toEqual([...IMPORTER_LIST_KINDS].sort());
  });

  it.each(COLUMNS)('gives %s its public header', (kind, columns) => {
    expect(importColumns(kind)).toEqual(columns);
  });

  it.each(LIST_KINDS.filter((kind) => !IMPORTER_LIST_KINDS.includes(kind)).map((kind) => [kind]))(
    'has no table for %s (decision 27)',
    (kind) => {
      expect(() => importColumns(kind)).toThrow(TypeError);
    },
  );

  it('keeps every column a header the error schema takes', () => {
    for (const [, columns] of COLUMNS) {
      for (const column of columns) {
        expect(column).toMatch(/^[a-z][a-z_]*$/);
      }
    }
  });
});

describe('importColumnOf', () => {
  it.each([
    ['email-address', 'match-type', 'match_type'],
    ['geolocation', 'radius-meters', 'radius_meters'],
    ['government-id-number', 'id-class', 'id_class'],
    ['name', 'name-first', 'name_first'],
    ['string', 'value', 'value'],
  ] as const)('maps the %s member %s to %s', (kind, member, column) => {
    expect(importColumnOf(kind, member)).toBe(column);
  });

  it('answers null for a member the kind has no column for', () => {
    expect(importColumnOf('string', 'latitude')).toBeNull();
    expect(importColumnOf('face', 'value')).toBeNull();
  });
});

describe('importHeaderProblems (C100.3)', () => {
  it('accepts the columns in any order', () => {
    expect(importHeaderProblems('email-address', ['match_type', 'value'])).toEqual([]);
  });

  it('accepts a header with surrounding spaces', () => {
    expect(importHeaderProblems('string', [' value '])).toEqual([]);
  });

  it('names a missing column', () => {
    expect(importHeaderProblems('email-address', ['value'])).toEqual([
      { column: 'match_type', code: 'missing_column' },
    ]);
  });

  it('names a repeated column once', () => {
    expect(importHeaderProblems('string', ['value', 'value', 'value'])).toEqual([
      { column: 'value', code: 'duplicate_column' },
    ]);
  });

  it('refuses an unknown column without echoing it: it may be a person', () => {
    const problems = importHeaderProblems('string', ['value', 'Ana Example']);
    expect(problems).toEqual([{ column: null, code: 'unknown_column' }]);
    expect(JSON.stringify(problems)).not.toContain('Ana');
  });

  it('answers each problem of a file with no header', () => {
    expect(importHeaderProblems('name', ['Ana', 'Example'])).toEqual([
      { column: null, code: 'unknown_column' },
      { column: null, code: 'unknown_column' },
      { column: 'name_first', code: 'missing_column' },
      { column: 'name_last', code: 'missing_column' },
    ]);
  });
});

describe('importRowItem (C100.3, C100.5)', () => {
  it('maps the public columns to the wire names', () => {
    expect(importRowItem('name', { name_first: 'Ana', name_last: 'Example' })).toEqual({
      'name-first': 'Ana',
      'name-last': 'Example',
    });
    expect(importRowItem('country', { country_code: 'US' })).toEqual({ 'country-code': 'US' });
    expect(importRowItem('field', { field_value: 'gold' })).toEqual({ 'field-value': 'gold' });
  });

  it('leaves an empty optional cell out, so the default of the kind applies', () => {
    expect(importRowItem('email-address', { value: 'ana@example.org', match_type: '' })).toEqual({
      value: 'ana@example.org',
    });
    expect(importRowItem('government-id-number', { id_number: 'X1', id_class: ' ' })).toEqual({
      'id-number': 'X1',
    });
  });

  it('keeps an optional cell that has a value', () => {
    expect(importRowItem('government-id-number', { id_number: 'X1', id_class: 'visa' })).toEqual({
      'id-number': 'X1',
      'id-class': 'visa',
    });
  });

  it('strips the neutraliser once, so an export re-imports unchanged (C100.5)', () => {
    expect(importRowItem('phone-number', { value: `'+12025550100` })).toEqual({
      value: '+12025550100',
    });
    expect(importRowItem('string', { value: `''=x` })).toEqual({ value: `'=x` });
  });

  it('reads the coordinates as numbers, which the item resource serves', () => {
    expect(
      importRowItem('geolocation', {
        latitude: ' 48.8566 ',
        longitude: '-2.3522',
        radius_meters: '1000',
      }),
    ).toEqual({ latitude: 48.8566, longitude: -2.3522, 'radius-meters': 1000 });
  });

  it('refuses a cell that is no number, naming its member', () => {
    try {
      importRowItem('geolocation', { latitude: 'north', longitude: '0', radius_meters: '1' });
      throw new Error('the row was accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(ListKeyInputError);
      expect((error as ListKeyInputError).code).toBe('invalid_value');
      expect((error as ListKeyInputError).member).toBe('latitude');
    }
  });

  it('leaves a required empty cell to the normaliser, which refuses it', () => {
    const item = importRowItem('string', { value: '' });
    expect(() => listKeyInputs('string', item)).toThrow(ListKeyInputError);
  });

  it('gives an item the normaliser keys', () => {
    const item = importRowItem('email-address', { value: 'example.org', match_type: 'domain' });
    expect(listKeyInputs('email-address', item)).toEqual([
      { keyKind: 'identifier-email-domain', input: 'example.org' },
    ]);
  });

  it('has no table for a biometric kind', () => {
    expect(() => importRowItem('face', {})).toThrow(TypeError);
  });
});

describe('importErrorCodeOfParser (C100.4)', () => {
  it.each([
    ['CSV_RECORD_INCONSISTENT_FIELDS_LENGTH', 'field_count_mismatch'],
    ['CSV_RECORD_INCONSISTENT_COLUMNS', 'field_count_mismatch'],
    ['CSV_MAX_RECORD_SIZE', 'record_too_large'],
    ['CSV_QUOTE_NOT_CLOSED', 'invalid_value'],
    ['CSV_INVALID_CLOSING_QUOTE', 'invalid_value'],
    ['CSV_NON_TRIMABLE_CHAR_AFTER_CLOSING_QUOTE', 'invalid_value'],
    ['INVALID_OPENING_QUOTE', 'invalid_value'],
    ['SOMETHING_NEW', 'invalid_value'],
  ])('maps %s to %s', (parserCode, code) => {
    expect(importErrorCodeOfParser(parserCode)).toBe(code);
  });
});

describe('importErrorScope (C100.4)', () => {
  it.each([
    'invalid_encoding',
    'missing_column',
    'unknown_column',
    'duplicate_column',
    'row_limit_exceeded',
  ] as const)('%s refuses the file', (code) => {
    expect(importErrorScope(code)).toBe('file');
  });

  it('holds every other code to one row', () => {
    const rowCodes = IMPORT_ERROR_CODES.filter((code) => importErrorScope(code) === 'row');
    expect(rowCodes).toEqual([
      'record_too_large',
      'field_count_mismatch',
      'invalid_value',
      'unparseable_phone',
      'host_bits_set',
      'out_of_range',
      'unsupported_class',
    ]);
  });
});
