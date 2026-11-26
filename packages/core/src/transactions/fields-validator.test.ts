import { describe, expect, it, vi } from 'vitest';
import {
  fieldsValidatorOf,
  jsonFieldSchemasOf,
  type TransactionTypeVersionContent,
} from './engine.js';
import type { FieldSchema } from './field-schemas.js';
import { TRANSACTION_LIMITS } from './field-types.js';

const VERIFICATION = 'ver_01M5CK3190XEVBM5ZXA76E1JSN';
// The platform's file ids (`ID_PREFIXES.file`) are `file_` plus a ULID.
const PLATFORM_FILE = 'file_01M5CK3190XEVBM5ZXA76E1JSN';
/** A public processor test number, for the guard's own refusal tests. */
const CARD = '4242424242424242';

function field(
  type: string,
  key: string,
  config?: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): FieldSchema {
  return {
    type,
    key,
    label: 'Synthetic field',
    ...(config === undefined ? {} : { config }),
    ...extra,
  };
}

let nextVersion = 0;

function contentOf(
  fieldSchemas: readonly FieldSchema[],
  allowCardLikeStrings = false,
): TransactionTypeVersionContent {
  nextVersion += 1;
  return {
    id: `txntpv_test_${String(nextVersion)}`,
    fieldSchemas,
    statuses: ['created'],
    relationSchemas: [],
    allowCardLikeStrings,
  };
}

const walkOne = (schema: FieldSchema, value: unknown) =>
  fieldsValidatorOf(contentOf([schema]))({ [schema.key]: value });

const invalid = (pointer: string) => ({ code: 'field_schema_invalid', pointer });
const card = (pointer: string) => ({ code: 'card_number_refused', pointer });

function accepts(schema: FieldSchema, value: unknown, stored: unknown = value): void {
  const result = walkOne(schema, value);
  expect(result.problems).toEqual([]);
  expect(result.values).toEqual({ [schema.key]: stored });
}

function refuses(schema: FieldSchema, value: unknown): void {
  const result = walkOne(schema, value);
  expect(result.problems).toEqual([invalid(`/${schema.key}`)]);
  expect(result.values).toEqual({});
}

describe('the walk: scalars (C104.2, C104.3)', () => {
  it('string: a length in characters, 255 by default', () => {
    const schema = field('string', 'note');
    accepts(schema, '');
    accepts(schema, 'a'.repeat(255));
    refuses(schema, 'a'.repeat(256));
    accepts(schema, '🙂'.repeat(255));
    refuses(schema, '🙂'.repeat(256));
    accepts(field('string', 'note', { 'max-char-length': 2 }), 'ab');
    refuses(field('string', 'note', { 'max-char-length': 2 }), 'abc');
    refuses(schema, 1);
    refuses(schema, null);
    refuses(schema, ['a']);
  });

  it('string: sanitize trims and removes control characters, and is no HTML sanitiser', () => {
    const schema = field('string', 'note', { sanitize: ['html'], 'max-char-length': 5 });
    accepts(schema, ' \u0000 ab\u0007c\t\n', 'abc');
    accepts(schema, '<b>', '<b>');
    accepts(schema, ` ${'a'.repeat(5)} `, 'aaaaa');
    accepts(field('string', 'note'), ' a ', ' a ');
  });

  it('integer: a safe integer within min and max', () => {
    const schema = field('integer', 'count', { min: -1, max: 3 });
    accepts(schema, -1);
    accepts(schema, 3);
    refuses(schema, -2);
    refuses(schema, 4);
    refuses(schema, 1.5);
    refuses(schema, '1');
    refuses(field('integer', 'count'), Number.MAX_SAFE_INTEGER + 1);
    refuses(field('integer', 'count'), Number.POSITIVE_INFINITY);
    accepts(field('integer', 'count'), 0);
  });

  it('number: a finite number within min and max', () => {
    const schema = field('number', 'amount', { min: 0.5, max: 1.5 });
    accepts(schema, 0.5);
    accepts(schema, 1.5);
    refuses(schema, 0.4);
    refuses(schema, 1.6);
    refuses(field('number', 'amount'), Number.NaN);
    refuses(field('number', 'amount'), Number.POSITIVE_INFINITY);
    refuses(field('number', 'amount'), '1');
  });

  it('boolean: nothing but true or false', () => {
    const schema = field('boolean', 'flag');
    accepts(schema, true);
    accepts(schema, false);
    refuses(schema, 0);
    refuses(schema, 'true');
  });

  it('datetime: a real instant with an offset', () => {
    const schema = field('datetime', 'at');
    accepts(schema, '2026-10-31T12:00:00.000Z');
    accepts(schema, '2024-02-29T12:00:00Z');
    accepts(schema, '2026-10-31T12:00:00+02:00');
    refuses(schema, '2026-02-29T12:00:00Z');
    refuses(schema, '2026-13-01T00:00:00Z');
    refuses(schema, '2026-10-31T12:00:00');
    refuses(schema, '2026-10-31');
    refuses(schema, 1793000000000);
  });

  it('email-address: a mailbox of at most 254 characters', () => {
    const schema = field('email-address', 'mail');
    accepts(schema, 'person@example.com');
    refuses(schema, 'not an address');
    refuses(schema, `${'a'.repeat(250)}@example.com`);
    refuses(schema, 1);
  });

  it('date: a real date within min-date and max-date', () => {
    const schema = field('date', 'day', { 'min-date': '2026-01-01', 'max-date': '2026-12-31' });
    accepts(schema, '2026-01-01');
    accepts(schema, '2026-12-31');
    refuses(schema, '2025-12-31');
    refuses(schema, '2027-01-01');
    refuses(schema, '2026-02-30');
    refuses(schema, '2026-10-31T00:00:00Z');
    accepts(field('date', 'day'), '2024-02-29');
    refuses(field('date', 'day'), '2026-02-29');
  });

  it('choices: an option, or null only with allow-empty', () => {
    const schema = field('choices', 'tier', { options: ['low', 'high'] });
    accepts(schema, 'low');
    refuses(schema, 'mid');
    refuses(schema, null);
    refuses(schema, '');
    refuses(schema, 1);
    accepts(field('choices', 'tier', { options: ['low'], 'allow-empty': true }), null);
  });

  it('multi-choices: distinct options, and empty only with allow-empty', () => {
    const schema = field('multi-choices', 'tags', { options: ['a', 'b', 'c'] });
    accepts(schema, ['a', 'c']);
    refuses(schema, ['a', 'z']);
    refuses(schema, ['a', 'a']);
    refuses(schema, 'a');
    refuses(schema, []);
    accepts(field('multi-choices', 'tags', { options: ['a'], 'allow-empty': true }), []);
  });

  it('never reads a value out of the prototype', () => {
    const validator = fieldsValidatorOf(
      contentOf([field('string', 'constructor', { required: true })]),
    );
    expect(validator({}).problems).toEqual([invalid('/constructor')]);
  });
});

describe('the walk: nested values (C104.2)', () => {
  const lineItem = field('hash', 'line', {
    'item-schemas': [field('string', 'sku', { required: true }), field('integer', 'quantity')],
  });

  it('array: each item against item-schema, up to max-items', () => {
    const schema = field('array', 'lines', {
      'item-schema': field('integer', 'x'),
      'max-items': 2,
    });
    accepts(schema, []);
    accepts(schema, [1, 2]);
    refuses(schema, [1, 2, 3]);
    refuses(schema, 'x');
    refuses(schema, null);
    expect(walkOne(schema, [1, 'x']).problems).toEqual([invalid('/lines/1')]);
  });

  it('hash: declared members, strict by default, with the parent as the pointer', () => {
    accepts(lineItem, { sku: 'a', quantity: 1 });
    accepts(lineItem, { sku: 'a' });
    refuses(lineItem, 'x');
    refuses(lineItem, ['x']);
    refuses(lineItem, null);
    expect(walkOne(lineItem, { sku: 1 }).problems).toEqual([invalid('/line/sku')]);
    expect(walkOne(lineItem, {}).problems).toEqual([invalid('/line/sku')]);
    expect(walkOne(lineItem, { sku: 'a', extra: 1, 'a/b': 2 }).problems).toEqual([
      invalid('/line'),
    ]);
  });

  it('hash: ignore-unknown-keys strips the rest, and walks none of it', () => {
    const schema = field('hash', 'line', {
      'item-schemas': [field('string', 'sku')],
      'ignore-unknown-keys': true,
    });
    accepts(schema, { sku: 'a', extra: CARD, deeper: { pan: CARD } }, { sku: 'a' });
  });

  it('nests, with a pointer through each level', () => {
    const schema = field('array', 'lines', { 'item-schema': lineItem, 'max-items': 5 });
    expect(walkOne(schema, [{ sku: 'a' }, { quantity: 1 }]).problems).toEqual([
      invalid('/lines/1/sku'),
    ]);
  });

  it('survives __proto__ in a member, without touching a prototype', () => {
    const value: unknown = JSON.parse('{"__proto__":{"polluted":true},"sku":"a"}');
    expect(walkOne(lineItem, value).problems).toEqual([invalid('/line')]);
    const stripped = field('hash', 'line', {
      'item-schemas': [field('string', 'sku')],
      'ignore-unknown-keys': true,
    });
    const result = walkOne(stripped, value);
    expect(result.values).toEqual({ line: { sku: 'a' } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('the walk: required, defaults and a partial write (C104.2)', () => {
  it('refuses an absent required field, with its pointer', () => {
    const validator = fieldsValidatorOf(contentOf([field('string', 'a', { required: true })]));
    expect(validator({}).problems).toEqual([invalid('/a')]);
  });

  it('does not take an empty string or an empty array for a required value', () => {
    refuses(field('string', 'a', { required: true }), '');
    refuses(field('string', 'a', { required: true, sanitize: ['html'] }), ' \u0000 ');
    refuses(
      field('array', 'a', {
        required: true,
        'item-schema': field('integer', 'x'),
        'max-items': 1,
      }),
      [],
    );
    accepts(
      field('multi-choices', 'a', { required: true, options: ['x'], 'allow-empty': true }),
      [],
    );
  });

  it('fills an absent field with its default, and leaves a given one alone', () => {
    const validator = fieldsValidatorOf(
      contentOf([
        field('string', 'a', { required: true }, { 'default-value': 'fallback' }),
        field('integer', 'b', undefined, { 'default-value': 7 }),
        field('boolean', 'c'),
      ]),
    );
    expect(validator({}).values).toEqual({ a: 'fallback', b: 7 });
    expect(validator({ a: 'given', b: 1, c: true }).values).toEqual({ a: 'given', b: 1, c: true });
  });

  it('fills a default inside a hash', () => {
    const schema = field('hash', 'h', {
      'item-schemas': [field('string', 'x', undefined, { 'default-value': 'd' })],
    });
    accepts(schema, {}, { x: 'd' });
  });

  it('applies neither required nor a default to a partial write', () => {
    const validator = fieldsValidatorOf(
      contentOf([
        field('string', 'a', { required: true }),
        field('integer', 'b', undefined, { 'default-value': 7 }),
        field('boolean', 'c'),
      ]),
    );
    expect(validator({ c: true }, { partial: true })).toMatchObject({
      values: { c: true },
      problems: [],
    });
  });

  it('holds a hash whole in a partial write', () => {
    const validator = fieldsValidatorOf(
      contentOf([
        field('hash', 'h', {
          'item-schemas': [field('string', 'x', { required: true })],
        }),
      ]),
    );
    expect(validator({ h: {} }, { partial: true }).problems).toEqual([invalid('/h/x')]);
  });
});

describe('the walk: what a request cannot write', () => {
  const at = '2026-10-31T12:00:00.000Z';

  it('refuses an unknown field, with no key in the pointer: a key can hold a value', () => {
    const validator = fieldsValidatorOf(contentOf([field('string', 'a')]));
    expect(validator({ a: 'x', [CARD]: 1, other: 2 }).problems).toEqual([invalid('')]);
  });

  it.each([
    ['a file field: its content has its own route', field('file', 'a')],
    ['an alias (P22)', field('string', 'a', { 'source-key-path': 'b' })],
    ['an archived field', field('string', 'a', { 'archived-at': at })],
    ['a deactivated field', field('string', 'a', { 'deactivated-at': at })],
  ])('refuses %s', (_name, schema) => {
    refuses(schema, 'x');
  });

  it.each([
    ['a file field', field('file', 'a', { required: true })],
    ['an alias', field('string', 'a', { required: true, 'source-key-path': 'b' })],
    ['an archived field', field('string', 'a', { required: true, 'archived-at': at })],
    ['a deactivated field', field('string', 'a', { required: true, 'deactivated-at': at })],
  ])('does not ask for %s, or fill its default', (_name, schema) => {
    const validator = fieldsValidatorOf(contentOf([{ ...schema, 'default-value': 'x' }]));
    expect(validator({})).toMatchObject({ values: {}, problems: [] });
  });

  it('refuses an item a file schema would hold, should one ever be stored', () => {
    const schema = field('array', 'a', { 'item-schema': field('file', 'x'), 'max-items': 1 });
    expect(walkOne(schema, ['x']).problems).toEqual([invalid('/a/0')]);
  });

  it('reads a null archived-at as active', () => {
    accepts(field('string', 'a', { 'archived-at': null, 'deactivated-at': null }), 'x');
    accepts(field('string', 'a', { 'source-key-path': null }), 'x');
  });
});

describe('the walk: references (C104.2, P12, H22)', () => {
  const selfie = field('relation-schema', 'portrait', { target: 'selfie' });

  it('hands every id to the API, which alone can check it', () => {
    const validator = fieldsValidatorOf(
      contentOf([
        field('platform-file', 'scan'),
        field('array', 'photos', { 'item-schema': selfie, 'max-items': 2 }),
      ]),
    );
    const result = validator({ scan: PLATFORM_FILE, photos: [VERIFICATION] });
    expect(result.problems).toEqual([]);
    expect(result.values).toEqual({ scan: PLATFORM_FILE, photos: [VERIFICATION] });
    expect(result.references).toEqual([
      { kind: 'platform-file', pointer: '/scan', id: PLATFORM_FILE },
      { kind: 'relation-schema', pointer: '/photos/0', id: VERIFICATION, target: 'selfie' },
    ]);
  });

  it.each([
    ['a verification id', field('platform-file', 'a'), VERIFICATION],
    ['a short id', field('platform-file', 'a'), 'file_1'],
    ['a fil_ id', field('platform-file', 'a'), 'fil_01M5CK3190XEVBM5ZXA76E1JSN'],
    ['no id', field('platform-file', 'a'), 1],
    ['a file id', selfie, PLATFORM_FILE],
    ['a lower-case id', selfie, VERIFICATION.toLowerCase()],
    ['no id', selfie, null],
  ])('refuses %s', (_name, schema, value) => {
    const result = walkOne(schema, value);
    expect(result.problems).toHaveLength(1);
    expect(result.references).toEqual([]);
  });
});

describe('the walk: json values (C104.3, P22)', () => {
  const schema = field('json', 'meta', { 'json-schema': { type: 'object' } });

  /** `depth` arrays, one inside the other. */
  function nestedArrays(depth: number): unknown {
    let value: unknown = [];
    for (let level = 1; level < depth; level += 1) {
      value = [value];
    }
    return value;
  }

  it('hands the value to the API with the pointer of its schema', () => {
    const validator = fieldsValidatorOf(
      contentOf([
        schema,
        field('array', 'more', {
          'item-schema': field('json', 'x', { 'json-schema': { type: 'string' } }),
          'max-items': 2,
        }),
      ]),
    );
    const result = validator({ meta: { a: 1 }, more: ['b'] });
    expect(result.problems).toEqual([]);
    expect(result.values).toEqual({ meta: { a: 1 }, more: ['b'] });
    expect(result.jsonValues).toEqual([
      { pointer: '/meta', schemaPointer: '/field-schemas/0/config/json-schema', value: { a: 1 } },
      {
        pointer: '/more/0',
        schemaPointer: '/field-schemas/1/config/item-schema/config/json-schema',
        value: 'b',
      },
    ]);
  });

  it('takes any JSON but null', () => {
    accepts(schema, 1);
    accepts(schema, 'a');
    accepts(schema, [1, { a: [true] }]);
    refuses(schema, null);
    refuses(schema, undefined);
  });

  it('takes depth 10, and refuses depth 11, or anything far past the stack', () => {
    accepts(schema, nestedArrays(10));
    refuses(schema, nestedArrays(11));
    refuses(schema, nestedArrays(200_000));
  });

  it('takes 64 KiB, and refuses a byte more', () => {
    const fits = 'a'.repeat(TRANSACTION_LIMITS.jsonValueBytes - 2);
    accepts(schema, fits);
    refuses(schema, `${fits}a`);
  });

  it('names the schema by the pointer jsonFieldSchemasOf gives it, at any depth', () => {
    const fieldSchemas = [
      field('json', 'top', { 'json-schema': {} }),
      field('hash', 'h', {
        'item-schemas': [
          field('array', 'lines', {
            'item-schema': field('json', 'line', { 'json-schema': {} }),
            'max-items': 1,
          }),
        ],
      }),
    ];
    const { jsonValues } = fieldsValidatorOf(contentOf(fieldSchemas))({
      top: 1,
      h: { lines: [2] },
    });
    expect(jsonValues.map(({ schemaPointer }) => schemaPointer)).toEqual(
      jsonFieldSchemasOf(fieldSchemas).map(({ pointer }) => pointer),
    );
    expect(jsonValues).toHaveLength(2);
  });

  it('keeps nothing from a refused value', () => {
    const result = walkOne(schema, nestedArrays(11));
    expect(result.jsonValues).toEqual([]);
  });
});

describe('the card-number guard, per position (C104.4, P20)', () => {
  const string = field('string', 'note');
  const hash = field('hash', 'h', { 'item-schemas': [field('string', 'token')] });
  const array = field('array', 'a', { 'item-schema': string, 'max-items': 2 });
  const json = field('json', 'j', { 'json-schema': {} });
  const options = { options: ['clean', CARD] };

  it.each([
    ['a string', string, CARD, '/note'],
    ['a string with spaces', string, '4242 4242 4242 4242', '/note'],
    ['a string inside text', string, `card ${CARD} exp`, '/note'],
    ['an email address', field('email-address', 'mail'), `${CARD}@example.com`, '/mail'],
    ['a choice', field('choices', 'c', options), CARD, '/c'],
    ['a multi-choice', field('multi-choices', 'c', options), ['clean', CARD], '/c/1'],
    ['an integer', field('integer', 'n'), 4242424242424242, '/n'],
    ['a number', field('number', 'n'), 4242424242424242, '/n'],
    ['a rounded number', field('number', 'n'), 6200000000000000000, '/n'],
    ['a member of a hash', hash, { token: CARD }, '/h/token'],
    ['an item of an array', array, ['clean', CARD], '/a/1'],
    ['a number in a json value', json, { a: [4242424242424242] }, '/j'],
    ['a string in a json value', json, { a: { b: [CARD] } }, '/j'],
    ['a json scalar', json, CARD, '/j'],
    ['a key in a json value', json, { [CARD]: 1 }, '/j'],
  ])('refuses %s, and only says where', (_name, schema, value, pointer) => {
    const result = walkOne(schema, value);
    expect(result.problems).toEqual([card(pointer)]);
    expect(result.values).toEqual({});
    expect(JSON.stringify(result.problems)).not.toContain('4242');
  });

  it('refuses a default as it is applied', () => {
    const validator = fieldsValidatorOf(
      contentOf([field('string', 'a', undefined, { 'default-value': CARD })]),
    );
    expect(validator({}).problems).toEqual([card('/a')]);
  });

  it('walks a sanitised string, as it would be stored', () => {
    const schema = field('string', 'note', { sanitize: ['html'] });
    expect(walkOne(schema, '4242\u00004242\u00074242\u00084242').problems).toEqual([card('/note')]);
  });

  it('holds json keys to the guard when the rest of the value is clean', () => {
    const result = walkOne(json, { safe: 'text', [`note ${CARD}`]: true });
    expect(result.problems).toEqual([card('/j')]);
    expect(result.jsonValues).toEqual([]);
  });

  it('is lifted by allow-card-like-strings, for the fields of that version', () => {
    const fields = { note: CARD, n: 4242424242424242, j: { [CARD]: CARD } };
    const schemas = [string, field('integer', 'n'), json];
    const lifted = fieldsValidatorOf(contentOf(schemas, true))(fields);
    expect(lifted.problems).toEqual([]);
    expect(lifted.values).toEqual(fields);
    const guarded = fieldsValidatorOf(contentOf(schemas, false))(fields);
    expect(guarded.problems).toEqual([card('/note'), card('/n'), card('/j')]);
  });

  it('passes a run that fails Luhn', () => {
    accepts(string, '4242424242424241');
    accepts(field('integer', 'n'), 4242424242424241);
  });
});

describe('the problems of a walk', () => {
  it('come in field order, and never carry a value', () => {
    const validator = fieldsValidatorOf(
      contentOf([field('integer', 'b'), field('string', 'a', { required: true })]),
    );
    const result = validator({ b: 'synthetic-secret' });
    expect(result.problems).toEqual([invalid('/b'), invalid('/a')]);
    expect(JSON.stringify(result)).not.toContain('synthetic-secret');
  });

  it('stop at 100, so a large body cannot grow a larger answer', () => {
    const schema = field('array', 'a', { 'item-schema': field('integer', 'x'), 'max-items': 1000 });
    const result = walkOne(
      schema,
      Array.from({ length: 1000 }, () => 'x'),
    );
    expect(result.problems).toHaveLength(100);
    expect(result.problems[99]).toEqual(invalid('/a/99'));
  });

  it('answer no references or json values', () => {
    const validator = fieldsValidatorOf(
      contentOf([
        field('platform-file', 'p'),
        field('json', 'j', { 'json-schema': {} }),
        field('integer', 'n'),
      ]),
    );
    expect(validator({ p: PLATFORM_FILE, j: 1, n: 'x' })).toEqual({
      values: {},
      problems: [invalid('/n')],
      references: [],
      jsonValues: [],
    });
  });
});

describe('fieldsValidatorOf: the cache by version id (C104.3)', () => {
  it('builds once per version', () => {
    const content = contentOf([field('string', 'a')]);
    expect(fieldsValidatorOf(content)).toBe(fieldsValidatorOf(content));
    const reread = { ...content, fieldSchemas: structuredClone(content.fieldSchemas) };
    expect(fieldsValidatorOf(reread)).toBe(fieldsValidatorOf(content));
  });

  it('never walks a version with the schemas of another read under the same id', () => {
    const first = contentOf([field('string', 'a')]);
    const edited = { ...first, fieldSchemas: [field('integer', 'a')] };
    expect(fieldsValidatorOf(first)({ a: 'x' }).problems).toEqual([]);
    expect(fieldsValidatorOf(edited)({ a: 'x' }).problems).toEqual([invalid('/a')]);
    const lifted = { ...first, allowCardLikeStrings: true };
    expect(fieldsValidatorOf(first)({ a: CARD }).problems).toEqual([card('/a')]);
    expect(fieldsValidatorOf(lifted)({ a: CARD }).problems).toEqual([]);
  });

  it('forgets the oldest version past its bound', () => {
    const content = contentOf([field('string', 'a')]);
    const validator = fieldsValidatorOf(content);
    for (let index = 0; index < 256; index += 1) {
      fieldsValidatorOf(contentOf([field('string', 'a')]));
    }
    expect(fieldsValidatorOf(content)).not.toBe(validator);
  });

  it('keeps a version in use', () => {
    const content = contentOf([field('string', 'a')]);
    const validator = fieldsValidatorOf(content);
    for (let index = 0; index < 400; index += 1) {
      expect(fieldsValidatorOf(content)).toBe(validator);
      fieldsValidatorOf(contentOf([field('string', 'a')]));
    }
  });

  it('holds no state between walks', () => {
    const validator = fieldsValidatorOf(contentOf([field('integer', 'a')]));
    expect(validator({ a: 'x' }).problems).toHaveLength(1);
    expect(validator({ a: 1 }).problems).toEqual([]);
  });

  it('generates no code: a field key never reaches the Function constructor', () => {
    const spy = vi.spyOn(globalThis, 'Function');
    const validator = fieldsValidatorOf(
      contentOf([
        field('hash', 'h', { 'item-schemas': [field('string', 'x'), field('integer', 'y')] }),
      ]),
    );
    expect(validator({ h: { x: 'a', y: 1 } }).problems).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
