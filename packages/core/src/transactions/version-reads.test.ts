import { describe, expect, it } from 'vitest';
import {
  jsonFieldSchemasOf,
  readSourceKeyPath,
  transactionRelationProblems,
  transactionStatusProblems,
  transactionTypeVersionDiff,
} from './engine.js';
import type { FieldSchema } from './field-schemas.js';

const ACCOUNT = 'acc_01M5CK3190XEVBM5ZXA76E1JSN';
const TRANSACTION = 'txn_01M5CK3190XEVBM5ZXA76E1JSN';

function field(type: string, key: string, config?: Record<string, unknown>): FieldSchema {
  return { type, key, label: 'Synthetic field', ...(config === undefined ? {} : { config }) };
}

describe('transactionTypeVersionDiff (C104.6)', () => {
  const previous = [field('string', 'a'), field('integer', 'b'), field('date', 'c')];

  it('answers nothing for the same fields', () => {
    expect(transactionTypeVersionDiff(previous, previous)).toEqual({
      deletedFields: [],
      convertedFields: [],
    });
    expect(transactionTypeVersionDiff([], [])).toEqual({ deletedFields: [], convertedFields: [] });
  });

  it('names a field the new version drops, in the previous order', () => {
    expect(transactionTypeVersionDiff(previous, [field('integer', 'b')]).deletedFields).toEqual([
      'a',
      'c',
    ]);
  });

  it('names a field whose type changes, with both types', () => {
    const next = [field('integer', 'c'), field('string', 'a'), field('number', 'b')];
    expect(transactionTypeVersionDiff(previous, next)).toEqual({
      deletedFields: [],
      convertedFields: [
        { key: 'b', from: 'integer', to: 'number' },
        { key: 'c', from: 'date', to: 'integer' },
      ],
    });
  });

  it('reads a new key as a drop of the old one, and a new field as neither', () => {
    expect(transactionTypeVersionDiff([field('string', 'a')], [field('string', 'z')])).toEqual({
      deletedFields: ['a'],
      convertedFields: [],
    });
    expect(transactionTypeVersionDiff([], previous)).toEqual({
      deletedFields: [],
      convertedFields: [],
    });
  });

  it('keeps an archived or deactivated field: it is still in the version', () => {
    const next = [
      field('string', 'a', { 'archived-at': '2026-10-31T12:00:00.000Z' }),
      field('integer', 'b', { 'deactivated-at': '2026-10-31T12:00:00.000Z' }),
      field('date', 'c'),
    ];
    expect(transactionTypeVersionDiff(previous, next)).toEqual({
      deletedFields: [],
      convertedFields: [],
    });
  });

  describe('a nested field (K7B-8, owner decision 2 after 7B)', () => {
    const hash = (key: string, ...items: FieldSchema[]) =>
      field('hash', key, { 'item-schemas': items });
    const array = (key: string, item: FieldSchema) =>
      field('array', key, { 'item-schema': item, 'max-items': 10 });

    it('names a dropped or converted member of a hash by its dotted path', () => {
      const before = [hash('h', field('string', 'x'), field('string', 'y'))];
      const after = [hash('h', field('integer', 'x'))];

      expect(transactionTypeVersionDiff(before, after)).toEqual({
        deletedFields: ['h.y'],
        convertedFields: [{ key: 'h.x', from: 'string', to: 'integer' }],
      });
    });

    it('walks every level, up to the deepest path a version can hold', () => {
      const before = [hash('a', hash('b', hash('c', field('string', 'd'))))];
      const after = [hash('a', hash('b', hash('c', field('integer', 'd'))))];

      expect(transactionTypeVersionDiff(before, after).convertedFields).toEqual([
        { key: 'a.b.c.d', from: 'string', to: 'integer' },
      ]);
    });

    it('adds no segment for an array’s item schema: its members follow the array’s own key', () => {
      const before = [array('list', hash('item', field('string', 'x'), field('string', 'y')))];
      const after = [array('list', hash('item', field('integer', 'x')))];

      expect(transactionTypeVersionDiff(before, after)).toEqual({
        deletedFields: ['list.y'],
        convertedFields: [{ key: 'list.x', from: 'string', to: 'integer' }],
      });
    });

    it('names a converted item schema by the array’s key', () => {
      const before = [array('list', field('string', 'item'))];
      const after = [array('list', field('integer', 'item'))];

      expect(transactionTypeVersionDiff(before, after).convertedFields).toEqual([
        { key: 'list', from: 'string', to: 'integer' },
      ]);
    });

    it('raises one event for a removed or converted container, not one per descendant', () => {
      const before = [hash('gone', field('string', 'x')), hash('kept', field('string', 'y'))];
      const after = [field('string', 'kept')];

      expect(transactionTypeVersionDiff(before, after)).toEqual({
        deletedFields: ['gone'],
        convertedFields: [{ key: 'kept', from: 'hash', to: 'string' }],
      });
    });

    it('keeps a top-level field’s one-segment key', () => {
      expect(
        transactionTypeVersionDiff([field('string', 'a')], [field('integer', 'a')]).convertedFields,
      ).toEqual([{ key: 'a', from: 'string', to: 'integer' }]);
    });
  });
});

describe('transactionStatusProblems (C104.5)', () => {
  const statuses = ['created', 'approved', 'needs review'];

  it('passes a status of the version', () => {
    expect(transactionStatusProblems(statuses, 'needs review')).toEqual([]);
    expect(transactionStatusProblems(statuses, 'created')).toEqual([]);
  });

  it('refuses any other, and is exact about case and spaces', () => {
    for (const status of ['declined', 'Approved', 'needs  review', '']) {
      expect(transactionStatusProblems(statuses, status)).toEqual([
        { code: 'status_does_not_exist', pointer: '/status' },
      ]);
    }
  });
});

describe('transactionRelationProblems (C104.5)', () => {
  const relations = [
    { key: 'buyer', target: 'account', cardinality: 'one' },
    { key: 'parent', target: 'transaction', cardinality: 'many' },
  ] as const;

  it('passes a declared relation with a target of its object', () => {
    expect(transactionRelationProblems(relations, 'buyer', ACCOUNT)).toEqual([]);
    expect(transactionRelationProblems(relations, 'parent', TRANSACTION)).toEqual([]);
  });

  it('refuses a relation the version does not declare', () => {
    expect(transactionRelationProblems(relations, 'seller', ACCOUNT)).toEqual([
      { code: 'relation_schema_unknown', pointer: '/relation-schema-key' },
    ]);
    expect(transactionRelationProblems([], 'buyer', ACCOUNT)).toEqual([
      { code: 'relation_schema_unknown', pointer: '/relation-schema-key' },
    ]);
  });

  it('refuses a target of the other object', () => {
    expect(transactionRelationProblems(relations, 'buyer', TRANSACTION)).toEqual([
      { code: 'relation_schema_unknown', pointer: '/target-object-id' },
    ]);
    expect(transactionRelationProblems(relations, 'parent', ACCOUNT)).toEqual([
      { code: 'relation_schema_unknown', pointer: '/target-object-id' },
    ]);
  });
});

describe('readSourceKeyPath (C104.2, P22)', () => {
  const values = { token: 'tok', card: { token: 'tok-2', brand: { name: 'x' } }, list: ['a'] };

  it('reads a top-level member and a nested one, up to 3 segments', () => {
    expect(readSourceKeyPath(values, 'token')).toBe('tok');
    expect(readSourceKeyPath(values, 'card.token')).toBe('tok-2');
    expect(readSourceKeyPath(values, 'card.brand.name')).toBe('x');
  });

  it('answers nothing for a member that is not there', () => {
    expect(readSourceKeyPath(values, 'missing')).toBeUndefined();
    expect(readSourceKeyPath(values, 'card.missing')).toBeUndefined();
    expect(readSourceKeyPath(values, 'token.length')).toBeUndefined();
  });

  it.each(['constructor', 'toString', 'card.constructor', 'card.hasOwnProperty'])(
    'reads %s only as an own property',
    (path) => {
      expect(readSourceKeyPath(values, path)).toBeUndefined();
    },
  );

  it('never reads __proto__, even an own one', () => {
    const parsed = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(readSourceKeyPath(parsed, '__proto__.polluted')).toBeUndefined();
  });

  it('does not walk into an array', () => {
    expect(readSourceKeyPath(values, 'list.0')).toBeUndefined();
  });

  it('refuses a path of more than 3 segments, or one outside the key pattern', () => {
    const deep = { a: { b: { c: { d: 1 } } } };
    expect(readSourceKeyPath(deep, 'a.b.c.d')).toBeUndefined();
    expect(readSourceKeyPath(deep, 'a..b')).toBeUndefined();
    expect(readSourceKeyPath(deep, '')).toBeUndefined();
    expect(readSourceKeyPath({ '': 1 }, '')).toBeUndefined();
  });

  it('sets nothing', () => {
    const frozen = Object.freeze({ a: Object.freeze({ b: 1 }) });
    expect(readSourceKeyPath(frozen, 'a.b')).toBe(1);
  });
});

describe('jsonFieldSchemasOf (C104.3)', () => {
  it('finds every json schema, at any depth, with its pointer and default', () => {
    const top = { type: 'object' };
    const inHash = { type: 'string' };
    const inArray = { type: 'array', maxItems: 2 };
    const fieldSchemas = [
      field('string', 'a'),
      { ...field('json', 'b', { 'json-schema': top }), 'default-value': { x: 1 } },
      field('hash', 'c', {
        'item-schemas': [field('integer', 'x'), field('json', 'y', { 'json-schema': inHash })],
      }),
      field('array', 'd', {
        'max-items': 2,
        'item-schema': field('json', 'z', { 'json-schema': inArray }),
      }),
    ];
    expect(jsonFieldSchemasOf(fieldSchemas)).toEqual([
      { pointer: '/field-schemas/1/config/json-schema', schema: top, defaultValue: { x: 1 } },
      {
        pointer: '/field-schemas/2/config/item-schemas/1/config/json-schema',
        schema: inHash,
        defaultValue: undefined,
      },
      {
        pointer: '/field-schemas/3/config/item-schema/config/json-schema',
        schema: inArray,
        defaultValue: undefined,
      },
    ]);
  });

  it('answers nothing for a version with no json field', () => {
    expect(jsonFieldSchemasOf([field('string', 'a')])).toEqual([]);
  });
});
