import { describe, expect, it } from 'vitest';
import { jsonSchemaKeywordProblems } from './engine.js';
import { JSON_SCHEMA_ALLOWED_KEYWORDS, TRANSACTION_LIMITS } from './field-types.js';

const refused = (pointer: string) => ({ code: 'field_schema_invalid', pointer });

/** `depth` arrays, one inside the other. */
function nestedArrays(depth: number): unknown {
  let value: unknown = [];
  for (let level = 1; level < depth; level += 1) {
    value = [value];
  }
  return value;
}

describe('jsonSchemaKeywordProblems: the allowlist (C104.3, P22)', () => {
  it('accepts a schema that uses every allowed keyword', () => {
    const schema = {
      title: 'Order',
      description: 'A synthetic order',
      type: 'object',
      additionalProperties: false,
      required: ['sku'],
      properties: {
        sku: { type: 'string', minLength: 1, maxLength: 32, enum: ['a', 'b'] },
        amount: {
          type: 'number',
          minimum: 0,
          maximum: 10,
          exclusiveMinimum: -1,
          exclusiveMaximum: 11,
        },
        kind: { const: 'order' },
        lines: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 1000 },
        note: { type: 'null' },
      },
    };
    expect(jsonSchemaKeywordProblems(schema)).toEqual([]);
    const used = new Set<string>();
    JSON.stringify(schema, (key: string, value: unknown) => {
      used.add(key);
      return value;
    });
    expect([...used]).toEqual(expect.arrayContaining([...JSON_SCHEMA_ALLOWED_KEYWORDS]));
  });

  it('accepts the empty schema', () => {
    expect(jsonSchemaKeywordProblems({})).toEqual([]);
  });

  it.each([
    'pattern',
    'patternProperties',
    'format',
    '$ref',
    '$data',
    '$id',
    '$schema',
    '$defs',
    'definitions',
    'dependencies',
    'dependentRequired',
    'uniqueItems',
    'default',
    'examples',
    'allOf',
    'anyOf',
    'oneOf',
    'not',
    'if',
    'then',
    'else',
    'contains',
    'propertyNames',
    'unevaluatedProperties',
    'multipleOf',
    'minProperties',
    'maxProperties',
  ])('refuses %s at the root and below', (keyword) => {
    expect(jsonSchemaKeywordProblems({ [keyword]: 'x' })).toEqual([refused(`/${keyword}`)]);
    expect(
      jsonSchemaKeywordProblems({
        type: 'object',
        properties: {
          lines: { type: 'array', maxItems: 1, items: { type: 'object', [keyword]: 'x' } },
        },
      }),
    ).toEqual([refused(`/properties/lines/items/${keyword}`)]);
  });

  it('reads a property name as a name, not as a keyword', () => {
    expect(
      jsonSchemaKeywordProblems({
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          $ref: { type: 'string' },
          format: { type: 'string' },
          default: { type: 'string' },
        },
        required: ['$ref', 'pattern'],
      }),
    ).toEqual([]);
  });

  it('reads enum and const as data, not as schemas', () => {
    expect(
      jsonSchemaKeywordProblems({
        enum: [{ $ref: '#/x' }, { pattern: 'a' }],
        const: { $data: '1/x', format: 'email' },
      }),
    ).toEqual([]);
  });

  it('escapes a pointer as RFC 6901 says', () => {
    expect(
      jsonSchemaKeywordProblems({ properties: { 'a/b~c': { type: 'object', pattern: 'x' } } }),
    ).toEqual([refused('/properties/a~1b~0c/pattern')]);
  });

  it('never repeats a value in a problem', () => {
    const problems = jsonSchemaKeywordProblems({
      const: 'synthetic-secret',
      pattern: 'synthetic-secret',
      title: 7,
    });
    expect(problems).toEqual([refused('/pattern'), refused('/title')]);
  });

  it('refuses __proto__ as a property name', () => {
    const schema: unknown = JSON.parse('{"properties":{"__proto__":{"type":"string"}}}');
    expect(jsonSchemaKeywordProblems(schema)).toEqual([refused('/properties/__proto__')]);
  });
});

describe('jsonSchemaKeywordProblems: what each keyword holds', () => {
  it.each([
    ['true', true],
    ['false', false],
    ['null', null],
    ['an array', []],
    ['a string', 'object'],
    ['a number', 1],
    ['nothing', undefined],
  ])('refuses %s as a schema', (_name, schema) => {
    expect(jsonSchemaKeywordProblems(schema)).toEqual([refused('')]);
  });

  it.each([
    ['a boolean item', { type: 'array', maxItems: 1, items: true }, '/items'],
    ['a tuple of items', { type: 'array', maxItems: 1, items: [{}] }, '/items'],
    ['a boolean property', { properties: { a: true } }, '/properties/a'],
    ['properties as a list', { properties: [] }, '/properties'],
    ['additionalProperties true', { additionalProperties: true }, '/additionalProperties'],
    ['additionalProperties as a schema', { additionalProperties: {} }, '/additionalProperties'],
    ['a list of types', { type: ['string', 'null'] }, '/type'],
    ['an unknown type', { type: 'float' }, '/type'],
    ['required as text', { required: 'a' }, '/required'],
    ['required with a number', { required: [1] }, '/required'],
    ['required with a repeat', { required: ['a', 'a'] }, '/required'],
    ['enum as text', { enum: 'a' }, '/enum'],
    ['an empty enum', { enum: [] }, '/enum'],
    ['a text minimum', { minimum: '1' }, '/minimum'],
    ['a text maximum', { maximum: '1' }, '/maximum'],
    ['a draft 4 exclusive minimum', { exclusiveMinimum: true }, '/exclusiveMinimum'],
    ['a draft 4 exclusive maximum', { exclusiveMaximum: true }, '/exclusiveMaximum'],
    ['a negative minLength', { minLength: -1 }, '/minLength'],
    ['a fractional maxLength', { maxLength: 1.5 }, '/maxLength'],
    ['a text minItems', { type: 'array', maxItems: 1, minItems: '1' }, '/minItems'],
    ['a title that is no text', { title: 1 }, '/title'],
    ['a description that is no text', { description: 1 }, '/description'],
  ])('refuses %s', (_name, schema, pointer) => {
    expect(jsonSchemaKeywordProblems(schema)).toEqual([refused(pointer)]);
  });

  it('needs maxItems, at most 1,000, on every array', () => {
    expect(jsonSchemaKeywordProblems({ type: 'array' })).toEqual([refused('')]);
    expect(jsonSchemaKeywordProblems({ items: { type: 'string' } })).toEqual([refused('')]);
    expect(jsonSchemaKeywordProblems({ minItems: 1 })).toEqual([refused('')]);
    expect(
      jsonSchemaKeywordProblems({ type: 'object', properties: { a: { type: 'array' } } }),
    ).toEqual([refused('/properties/a')]);
    expect(jsonSchemaKeywordProblems({ type: 'array', maxItems: 1001 })).toEqual([
      refused('/maxItems'),
    ]);
    expect(jsonSchemaKeywordProblems({ type: 'array', maxItems: 1.5 })).toEqual([
      refused('/maxItems'),
    ]);
    expect(jsonSchemaKeywordProblems({ type: 'array', maxItems: 1000 })).toEqual([]);
  });
});

describe('jsonSchemaKeywordProblems: size and depth', () => {
  it('takes 16 KiB and refuses a byte more, counted in bytes', () => {
    const shell = JSON.stringify({ title: '' }).length;
    const fits = 'a'.repeat(TRANSACTION_LIMITS.jsonSchemaBytes - shell);
    expect(jsonSchemaKeywordProblems({ title: fits })).toEqual([]);
    expect(jsonSchemaKeywordProblems({ title: `${fits}a` })).toEqual([refused('')]);
    expect(jsonSchemaKeywordProblems({ title: `${fits.slice(1)}é` })).toEqual([refused('')]);
  });

  it('takes depth 10 and refuses depth 11, counting every object and array', () => {
    expect(jsonSchemaKeywordProblems({ const: nestedArrays(9) })).toEqual([]);
    expect(jsonSchemaKeywordProblems({ const: nestedArrays(10) })).toEqual([refused('')]);
  });

  it('refuses a schema far past the stack, without walking it', () => {
    expect(jsonSchemaKeywordProblems({ const: nestedArrays(200_000) })).toEqual([refused('')]);
  });
});
