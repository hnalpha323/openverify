import { describe, expect, it } from 'vitest';
import { fieldSchemaSchema, relationSchemaSchema } from './field-schemas.js';
import {
  DEFAULT_TRANSACTION_STATUSES,
  FIELD_SCHEMA_TYPES,
  FIELD_TYPES_NEVER_REFUSED,
  JSON_SCHEMA_ALLOWED_KEYWORDS,
  RELATION_SCHEMA_TARGETS,
  RELATION_TARGETS_UNSUPPORTED,
  RELATION_TARGET_VERIFICATION_TYPES,
  TRANSACTION_LIMITS,
  TRANSACTION_RESERVED_STATUS,
  TRANSACTION_STATUS_PATTERN,
} from './field-types.js';
import { TRANSACTIONS_AREA } from './engine.js';

const field = (type: string, config?: unknown, extra: Record<string, unknown> = {}) => ({
  type,
  key: 'amount_due',
  label: 'Synthetic field',
  ...(config === undefined ? {} : { config }),
  ...extra,
});

const accepted = (value: unknown) => fieldSchemaSchema.safeParse(value).success;

describe('the field types (C104.2)', () => {
  it('are the fifteen public wire types', () => {
    expect(FIELD_SCHEMA_TYPES).toEqual([
      'string',
      'integer',
      'number',
      'boolean',
      'datetime',
      'email-address',
      'date',
      'choices',
      'multi-choices',
      'array',
      'hash',
      'file',
      'platform-file',
      'json',
      'relation-schema',
    ]);
  });

  it('holds the caps of C104', () => {
    expect(TRANSACTION_LIMITS).toMatchObject({
      fieldsPerVersion: 100,
      nestingLevels: 3,
      searchableFields: 20,
      stringDefaultLength: 255,
      stringMaxLength: 1024,
      options: 200,
      arrayItems: 1000,
      fileDefaultMaxBytes: 10_000_000,
      jsonSchemaBytes: 16_384,
      jsonSchemaDepth: 10,
      jsonValueBytes: 65_536,
      statuses: 50,
      relationSchemas: 20,
      relatedObjects: 100,
    });
  });

  it('refuses never on the types that can hold personal data (P21)', () => {
    expect(FIELD_TYPES_NEVER_REFUSED).toEqual([
      'email-address',
      'file',
      'platform-file',
      'relation-schema',
      'hash',
      'json',
      'array',
    ]);
  });

  it('allows exactly the keywords of C104.3, and no pattern, $ref or format', () => {
    expect(JSON_SCHEMA_ALLOWED_KEYWORDS).toHaveLength(17);
    for (const refused of ['pattern', 'patternProperties', 'format', '$ref', '$data', 'default']) {
      expect(JSON_SCHEMA_ALLOWED_KEYWORDS).not.toContain(refused);
    }
  });

  it('maps a target to a verification type, and leaves the producers we lack unsupported (H22)', () => {
    expect(RELATION_SCHEMA_TARGETS).toHaveLength(6);
    expect(RELATION_TARGETS_UNSUPPORTED).toEqual(['document-mdoc', 'document-qr-code']);
    expect(RELATION_TARGET_VERIFICATION_TYPES).toEqual({
      'document-generic': 'document',
      'document-government-id': 'government_id',
      'document-government-id-nfc': 'government_id_nfc',
      selfie: 'selfie',
    });
  });

  it('starts a type with the four statuses, created first and reserved (C104.5)', () => {
    expect(DEFAULT_TRANSACTION_STATUSES).toEqual([
      'created',
      'approved',
      'declined',
      'needs review',
    ]);
    expect(TRANSACTION_RESERVED_STATUS).toBe('created');
    expect(TRANSACTION_STATUS_PATTERN.test('needs review')).toBe(true);
    expect(TRANSACTION_STATUS_PATTERN.test('Needs Review')).toBe(false);
  });
});

describe('the field-schema union (C104.2)', () => {
  it.each([
    ['string', field('string', { 'max-char-length': 64, sanitize: ['html'] })],
    ['string with no config', field('string')],
    ['integer', field('integer', { min: 0, max: 10 }, { 'default-value': 1 })],
    ['number', field('number', { min: 0.5 })],
    ['boolean', field('boolean')],
    ['datetime', field('datetime', { required: true })],
    ['email-address', field('email-address')],
    ['date', field('date', { 'min-date': '2026-01-01' })],
    ['choices', field('choices', { options: ['a', 'b'], 'option-labels': { a: 'A' } })],
    ['multi-choices', field('multi-choices', { options: ['a'], 'allow-empty': true })],
    ['array', field('array', { 'item-schema': field('string'), 'max-items': 10 })],
    ['hash', field('hash', { 'item-schemas': [field('string')], 'ignore-unknown-keys': true })],
    ['file', field('file', { 'max-file-size-bytes': 100, 'supported-mime-types': ['image/png'] })],
    ['platform-file', field('platform-file')],
    ['json', field('json', { 'json-schema': { type: 'object' } })],
    ['relation-schema', field('relation-schema', { target: 'selfie' })],
  ])('takes %s', (_name, value) => {
    expect(accepted(value)).toBe(true);
  });

  it('bounds a file field’s sizes by the ceiling: the upload is held in memory (K7B-7)', () => {
    const ceiling = TRANSACTION_LIMITS.fileMaxBytes;

    expect(ceiling).toBe(20_000_000);
    expect(accepted(field('file', { 'max-file-size-bytes': ceiling }))).toBe(true);
    expect(accepted(field('file', { 'max-file-size-bytes': ceiling + 1 }))).toBe(false);
    expect(accepted(field('file', { 'min-file-size-bytes': ceiling }))).toBe(true);
    expect(accepted(field('file', { 'min-file-size-bytes': ceiling + 1 }))).toBe(false);
  });

  it('nests through hash and array', () => {
    expect(
      accepted(
        field('hash', {
          'item-schemas': [field('array', { 'item-schema': field('integer'), 'max-items': 1 })],
        }),
      ),
    ).toBe(true);
    expect(
      accepted(field('hash', { 'item-schemas': [field('array', { 'item-schema': field('x') })] })),
    ).toBe(false);
  });

  it.each([
    ['an unknown type', field('float')],
    ['a key out of its pattern', { ...field('string'), key: 'Amount Due' }],
    ['an unknown config member', field('boolean', { 'max-char-length': 1 })],
    ['a string longer than the cap', field('string', { 'max-char-length': 1025 })],
    ['an array with no max-items (P22)', field('array', { 'item-schema': field('string') })],
    ['an array above 1,000', field('array', { 'item-schema': field('string'), 'max-items': 1001 })],
    ['choices with no options', field('choices', { options: [] })],
    ['a target outside the six', field('relation-schema', { target: 'account' })],
    ['a default of another type', field('integer', undefined, { 'default-value': 'x' })],
    ['an infinite bound', field('number', { min: Number.POSITIVE_INFINITY })],
    ['a bound past MAX_SAFE_INTEGER', field('integer', { max: Number.MAX_SAFE_INTEGER + 2 })],
  ])('refuses %s', (_name, value) => {
    expect(accepted(value)).toBe(false);
  });

  it('declares relations to accounts and transactions only (C104.5)', () => {
    const relation = { key: 'buyer', target: 'account', cardinality: 'one' };
    expect(relationSchemaSchema.safeParse(relation).success).toBe(true);
    expect(relationSchemaSchema.safeParse({ ...relation, target: 'inquiry' }).success).toBe(false);
    expect(relationSchemaSchema.safeParse({ ...relation, cardinality: 'two' }).success).toBe(false);
  });
});

describe('the engine (C104.2-C104.5)', () => {
  it('names the area', () => {
    expect(TRANSACTIONS_AREA).toBe('transactions');
  });
});
