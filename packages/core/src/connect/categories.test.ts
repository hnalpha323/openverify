/**
 * C230.4 (review F07): the category table, frozen. A change here changes what a consent covers, so
 * every row is written out.
 */
import { describe, expect, it } from 'vitest';
import { FIELD_SCHEMA_TYPES } from '../transactions/field-types.js';
import {
  DATA_CLASSES,
  FIELD_TYPE_CLASS,
  SHARE_CATEGORIES,
  SHARE_CATEGORY_DATA_CLASS,
  SHARE_FIELD_TYPES,
  WELL_KNOWN_FIELD_CATEGORY,
  fieldShareCategory,
} from './categories.js';

describe('the data classes and share categories (C230.4, C276.2)', () => {
  it('names the nine data classes', () => {
    expect(DATA_CLASSES).toEqual([
      'biometric',
      'identity-documents',
      'identity-fields',
      'contact',
      'device-and-network',
      'financial-and-crypto',
      'operator-and-audit',
      'secrets',
      'public-and-list-data',
    ]);
  });

  it('names the six share categories, with no category for a face template', () => {
    expect(SHARE_CATEGORIES).toEqual([
      'identity-fields',
      'contact-fields',
      'other-fields',
      'document-images',
      'biometric',
      'check-results',
    ]);
  });

  it('gives every share category a data class', () => {
    expect(SHARE_CATEGORY_DATA_CLASS).toEqual({
      'identity-fields': 'identity-fields',
      'contact-fields': 'contact',
      'other-fields': 'identity-fields',
      'document-images': 'identity-documents',
      biometric: 'biometric',
      'check-results': 'identity-documents',
    });
    expect(Object.keys(SHARE_CATEGORY_DATA_CLASS).sort()).toEqual([...SHARE_CATEGORIES].sort());
    for (const dataClass of Object.values(SHARE_CATEGORY_DATA_CLASS)) {
      expect(DATA_CLASSES).toContain(dataClass);
    }
  });

  it('is frozen', () => {
    for (const table of [
      DATA_CLASSES,
      SHARE_CATEGORIES,
      SHARE_CATEGORY_DATA_CLASS,
      FIELD_TYPE_CLASS,
      WELL_KNOWN_FIELD_CATEGORY,
    ]) {
      expect(Object.isFrozen(table)).toBe(true);
    }
  });
});

describe('FIELD_TYPE_CLASS (C230.4): every field type, one row each', () => {
  const TABLE: readonly (readonly [string, string])[] = [
    ['string', 'identity-fields'],
    ['integer', 'other-fields'],
    ['number', 'other-fields'],
    ['boolean', 'other-fields'],
    ['datetime', 'identity-fields'],
    ['email-address', 'contact-fields'],
    ['date', 'identity-fields'],
    ['choices', 'other-fields'],
    ['multi-choices', 'other-fields'],
    ['array', 'identity-fields'],
    ['hash', 'identity-fields'],
    ['file', 'document-images'],
    ['platform-file', 'document-images'],
    ['json', 'identity-fields'],
    ['relation-schema', 'other-fields'],
  ];

  it.each(TABLE)('classes %s as %s', (type, category) => {
    expect((FIELD_TYPE_CLASS as Readonly<Record<string, string>>)[type]).toBe(category);
  });

  it('has a row for every field type and no other', () => {
    expect(TABLE.map(([type]) => type)).toEqual([...FIELD_SCHEMA_TYPES]);
    expect(Object.keys(FIELD_TYPE_CLASS).sort()).toEqual([...FIELD_SCHEMA_TYPES].sort());
    expect(SHARE_FIELD_TYPES).toBe(FIELD_SCHEMA_TYPES);
  });

  it('classes every type as a category a field can fall in', () => {
    for (const category of Object.values(FIELD_TYPE_CLASS)) {
      expect(['identity-fields', 'contact-fields', 'other-fields', 'document-images']).toContain(
        category,
      );
    }
  });
});

describe('fieldShareCategory (C230.4)', () => {
  it('takes a well-known key over the type', () => {
    expect(fieldShareCategory('phone-number', 'string')).toBe('contact-fields');
    expect(fieldShareCategory('email-address', 'string')).toBe('contact-fields');
    expect(fieldShareCategory('birthdate', 'date')).toBe('identity-fields');
    expect(fieldShareCategory('name-first', 'choices')).toBe('identity-fields');
  });

  it('reads a snake_case key as its kebab-case twin, as an inquiry spells its fields', () => {
    expect(fieldShareCategory('phone_number', 'string')).toBe('contact-fields');
    expect(fieldShareCategory('email_address', 'string')).toBe('contact-fields');
    expect(fieldShareCategory('name_first', 'choices')).toBe('identity-fields');
    expect(fieldShareCategory('address_postal_code', 'integer')).toBe('identity-fields');
  });

  it('takes the type for any other key', () => {
    expect(fieldShareCategory('favourite-colour', 'choices')).toBe('other-fields');
    expect(fieldShareCategory('notes', 'string')).toBe('identity-fields');
    expect(fieldShareCategory('proof', 'file')).toBe('document-images');
  });

  it('reads the well-known table by own property only', () => {
    expect(fieldShareCategory('constructor', 'integer')).toBe('other-fields');
    expect(fieldShareCategory('toString', 'boolean')).toBe('other-fields');
  });
});
