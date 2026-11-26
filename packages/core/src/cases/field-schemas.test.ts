import { describe, expect, it } from 'vitest';
import { TRANSACTION_LIMITS, type FieldSchema } from '../index.js';
import { caseFieldSchemaProblems, caseFieldTypeProblems } from './field-schemas.js';

const text = (key: string): FieldSchema => ({ type: 'string', key, label: key });
const file = (key: string): FieldSchema => ({ type: 'file', key, label: key });
const json = (key: string): FieldSchema => ({
  type: 'json',
  key,
  label: key,
  config: { 'json-schema': { type: 'object' } },
});
const hash = (key: string, items: readonly FieldSchema[]): FieldSchema => ({
  type: 'hash',
  key,
  label: key,
  config: { 'item-schemas': items },
});
const list = (key: string, item: FieldSchema): FieldSchema => ({
  type: 'array',
  key,
  label: key,
  config: { 'item-schema': item, 'max-items': 10 },
});

describe('the case subset of the field schemas (C130.2, F37)', () => {
  it('takes every type but a file and json', () => {
    const fields: FieldSchema[] = [
      text('note'),
      { type: 'platform-file', key: 'photo', label: 'Photo' },
      { type: 'integer', key: 'count', label: 'Count' },
    ];
    expect(caseFieldTypeProblems(fields)).toEqual([]);
    expect(caseFieldSchemaProblems(fields)).toEqual([]);
  });

  it('refuses a file and json at the top, each by its pointer', () => {
    expect(caseFieldTypeProblems([text('note'), file('scan'), json('blob')])).toEqual([
      { code: 'field_schema_invalid', pointer: '/field-schemas/1/type' },
      { code: 'field_schema_invalid', pointer: '/field-schemas/2/type' },
    ]);
  });

  it('refuses one inside a hash or an array, at any level the walker allows', () => {
    const nested = hash('outer', [text('note'), list('items', hash('inner', [file('scan')]))]);
    expect(caseFieldTypeProblems([nested])).toEqual([
      {
        code: 'field_schema_invalid',
        pointer:
          '/field-schemas/0/config/item-schemas/1/config/item-schema/config/item-schemas/0/type',
      },
    ]);
  });

  it('never walks past the nesting cap, so a hostile depth costs no stack', () => {
    let field = file('scan');
    for (let level = 0; level < 5_000; level += 1) {
      field = list(`level-${String(level)}`, field);
    }
    expect(caseFieldTypeProblems([field])).toEqual([]);
    const capped = caseFieldSchemaProblems([field]);
    expect(capped.map(({ code }) => code)).toContain('field_schema_invalid');
    expect(capped.some(({ pointer }) => pointer.includes('/config/item-schema'))).toBe(true);
  });

  it("runs the walker's rules across a version as well, without a status or relation rule", () => {
    const repeated = [text('note'), text('note')];
    expect(caseFieldSchemaProblems(repeated)).toEqual([
      { code: 'field_schema_invalid', pointer: '/field-schemas/1/key' },
    ]);
    const tooMany = Array.from({ length: TRANSACTION_LIMITS.fieldsPerVersion + 1 }, (_, index) =>
      text(`field-${String(index)}`),
    );
    expect(caseFieldSchemaProblems(tooMany)).toContainEqual({
      code: 'field_schema_invalid',
      pointer: '/field-schemas',
    });
  });

  it('keeps the card guard on: a case version has no way to lift it (C104.4)', () => {
    const card: FieldSchema = {
      type: 'string',
      key: 'note',
      label: 'Note',
      'default-value': '4111 1111 1111 1111',
    };
    expect(caseFieldSchemaProblems([card]).map(({ code }) => code)).toContain(
      'card_number_refused',
    );
  });
});
