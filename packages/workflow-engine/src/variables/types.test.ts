/** C115.3: the type DSL, zod contracts read as types, nullable and PII marks, and value checks. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { JsonValue } from '../expressions/json.js';
import {
  ANY_TYPE,
  checkValue,
  commonType,
  parseTypeDsl,
  resolvePath,
  typeFromZod,
  typeToJsonSchema,
  unionTypes,
  withMarks,
  type ScopeType,
} from './types.js';

function dsl(text: string): ScopeType {
  const parsed = parseTypeDsl(text);
  if (!parsed.ok) {
    throw new Error(`refused: ${parsed.detail}`);
  }
  return parsed.type;
}

const plain = { nullable: false, pii: false };

describe('the type DSL (C115.3)', () => {
  it.each<[string, object]>([
    ['string', { kind: 'string', ...plain }],
    ['number', { kind: 'number', ...plain }],
    ['integer', { kind: 'integer', ...plain }],
    ['boolean', { kind: 'boolean', ...plain }],
    ['datetime', { kind: 'datetime', ...plain }],
    ['file', { kind: 'id', prefix: 'wfrf', ...plain }],
    ['id<inq>', { kind: 'id', prefix: 'inq', ...plain }],
    ['enum<approve,review>', { kind: 'enum', values: ['approve', 'review'], ...plain }],
    ['enum<a, b-c>', { kind: 'enum', values: ['a', 'b-c'], ...plain }],
    ['list<string>', { kind: 'list', of: { kind: 'string', ...plain }, ...plain }],
    [
      'list<list<id<acc>>>',
      {
        kind: 'list',
        of: { kind: 'list', of: { kind: 'id', prefix: 'acc', ...plain }, ...plain },
        ...plain,
      },
    ],
    ['string pii', { kind: 'string', nullable: false, pii: true }],
  ])('reads %s', (text, type) => {
    expect(dsl(text)).toEqual(type);
  });

  it('reads an object with optional and PII members', () => {
    expect(dsl('object{score: number, name?: string pii, tags: list<string>}')).toEqual({
      kind: 'object',
      members: {
        score: { kind: 'number', ...plain },
        name: { kind: 'string', nullable: true, pii: true },
        tags: { kind: 'list', of: { kind: 'string', ...plain }, ...plain },
      },
      rest: null,
      inflect: false,
      ...plain,
    });
  });

  it('reads nested objects', () => {
    const type = dsl('object{a: object{b: integer}}');
    expect(resolvePath(type, ['a', 'b'])).toMatchObject({ ok: true, type: { kind: 'integer' } });
  });

  it.each([
    '',
    'text',
    'String',
    'list<>',
    'list<string',
    'enum<>',
    'enum<a,>',
    'enum<a b>',
    'id<>',
    'id<INQ>',
    'object{}',
    'object{a}',
    'object{a: }',
    'object{a: string',
    'object{a: string, a: number}',
    'object{__proto__: string}',
    'object{constructor: string}',
    'object{A: string}',
    'string extra',
    'string pii pii',
    'list<list<list<list<list<list<list<list<list<string>>>>>>>>>',
  ])('refuses %j', (text) => {
    expect(parseTypeDsl(text).ok).toBe(false);
  });

  it('quotes nothing it was given', () => {
    const canary = 'change-me-canary-type';
    const parsed = parseTypeDsl(canary);
    expect(JSON.stringify(parsed)).not.toContain(canary);
  });
});

describe('a zod contract as a type (C115.3, C114.6, C115.6)', () => {
  const schema = z.strictObject({
    status: z.enum(['ready', 'pending']),
    count: z.int(),
    score: z.number().nullable(),
    label: z.string().optional(),
    flag: z.boolean(),
    at: z.iso.datetime(),
    kind: z.literal('x'),
    id: z.string().regex(/^inq_[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
    name: z.string().nullable().meta({ pii: true }),
    nested: z.strictObject({ deep: z.string() }).meta({ pii: true }),
    list: z.array(z.strictObject({ value: z.string().meta({ pii: true }) })),
    fields: z.record(z.string(), z.string().nullable()).meta({ pii: true }),
    open: z.json(),
    either: z.union([z.string(), z.number()]),
    choice: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('a'), one: z.string() }),
      z.strictObject({ kind: z.literal('b'), two: z.string() }),
    ]),
  });
  const type = typeFromZod(schema);
  const read = (...segments: readonly (string | number)[]) => resolvePath(type, segments);

  it.each<[string, object]>([
    ['status', { type: { kind: 'enum', values: ['ready', 'pending'] }, nullable: false }],
    ['count', { type: { kind: 'integer' } }],
    ['flag', { type: { kind: 'boolean' } }],
    ['at', { type: { kind: 'datetime' } }],
    ['kind', { type: { kind: 'enum', values: ['x'] } }],
    ['id', { type: { kind: 'id', prefix: 'inq' } }],
    ['open', { type: { kind: 'any' } }],
    ['either', { type: { kind: 'any' } }],
  ])('%s', (name, expected) => {
    expect(read(name)).toMatchObject({ ok: true, ...expected });
  });

  it('marks a nullable member', () => {
    expect(read('score')).toMatchObject({ ok: true, nullable: true, pii: false });
  });

  it('marks an optional member as nullable', () => {
    expect(read('label')).toMatchObject({ ok: true, nullable: true });
  });

  it('reads the PII mark of a member', () => {
    expect(read('name')).toMatchObject({ ok: true, nullable: true, pii: true });
  });

  it('inherits a PII mark into what a member holds', () => {
    expect(read('nested', 'deep')).toMatchObject({ ok: true, pii: true });
  });

  it('reads a mark inside a list', () => {
    expect(read('list', 0, 'value')).toMatchObject({ ok: true, pii: true, nullable: true });
  });

  it('reads any key of a record, as nullable and with its mark', () => {
    expect(read('fields', 'first_name')).toMatchObject({ ok: true, pii: true, nullable: true });
  });

  it('merges the variants of a union: a member of one may be absent', () => {
    expect(read('choice', 'kind')).toMatchObject({
      ok: true,
      nullable: false,
      type: { kind: 'enum', values: ['a', 'b'] },
    });
    expect(read('choice', 'one')).toMatchObject({ ok: true, nullable: true });
  });

  it('marks PII by name as well, because contracts mask by name (C15)', () => {
    const named = typeFromZod(z.strictObject({ note: z.string(), tags: z.array(z.string()) }), {
      piiNames: new Set(['note']),
    });
    expect(resolvePath(named, ['note'])).toMatchObject({ ok: true, pii: true });
    expect(resolvePath(named, ['tags'])).toMatchObject({ ok: true, pii: false });
  });
});

describe('resolvePath (C114.5)', () => {
  const type = dsl('object{a: object{b: string}, list: list<number>}');

  it('resolves a member and an index, an index being nullable', () => {
    expect(resolvePath(type, ['a', 'b'])).toMatchObject({ ok: true, nullable: false });
    expect(resolvePath(type, ['list', 3])).toMatchObject({ ok: true, nullable: true });
  });

  it('says where an unknown path stops', () => {
    expect(resolvePath(type, ['a', 'z'])).toEqual({ ok: false, at: 1, reason: 'unknown' });
    expect(resolvePath(type, ['list', 'x'])).toEqual({ ok: false, at: 1, reason: 'unknown' });
    expect(resolvePath(type, ['a', 0])).toEqual({ ok: false, at: 1, reason: 'unknown' });
    expect(resolvePath(type, ['a', 'b', 'c'])).toEqual({ ok: false, at: 2, reason: 'unknown' });
  });

  it('reads no name off the prototype', () => {
    expect(resolvePath(type, ['toString'])).toEqual({ ok: false, at: 0, reason: 'unknown' });
  });

  it('carries a nullable parent into its member', () => {
    const nullable = dsl('object{a?: object{b: string}}');
    expect(resolvePath(nullable, ['a', 'b'])).toMatchObject({ ok: true, nullable: true });
  });

  it('descends an any as nullable, keeping its PII mark', () => {
    const open = withMarks(ANY_TYPE, { pii: true });
    expect(resolvePath(open, ['a', 0])).toMatchObject({ ok: true, nullable: true, pii: true });
  });

  it('refuses to descend an opaque value: an HTTPS body with no schema (C124.5)', () => {
    const opaque: ScopeType = { kind: 'any', opaque: true, nullable: false, pii: true };
    expect(resolvePath(opaque, [])).toMatchObject({ ok: true });
    expect(resolvePath(opaque, ['score'])).toEqual({ ok: false, at: 0, reason: 'untyped' });
  });

  it('reads a public member by its inflected name where the object says so', () => {
    const view: ScopeType = {
      kind: 'object',
      members: { 'country-code': { kind: 'string', ...plain } },
      rest: null,
      inflect: true,
      ...plain,
    };
    expect(resolvePath(view, ['country_code'])).toMatchObject({ ok: true });
    expect(resolvePath(view, ['country-code'])).toMatchObject({ ok: true });
  });
});

describe('merging types', () => {
  const left = dsl('object{a: string, b: number}');
  const right = dsl('object{b: number, c: string}');

  it('a union keeps every member, each one may be absent', () => {
    const union = unionTypes(left, right);
    expect(resolvePath(union, ['a'])).toMatchObject({ ok: true, nullable: true });
    expect(resolvePath(union, ['b'])).toMatchObject({ ok: true, nullable: false });
    expect(resolvePath(union, ['c'])).toMatchObject({ ok: true, nullable: true });
  });

  it('a common type keeps what every event holds (C114.5)', () => {
    const common = commonType(left, right);
    expect(resolvePath(common, ['a'])).toMatchObject({ ok: false });
    expect(resolvePath(common, ['b'])).toMatchObject({ ok: true });
  });

  it('merges enums, lists and numbers', () => {
    expect(unionTypes(dsl('enum<a>'), dsl('enum<b>'))).toMatchObject({ values: ['a', 'b'] });
    expect(unionTypes(dsl('list<integer>'), dsl('list<number>'))).toMatchObject({
      of: { kind: 'number' },
    });
    expect(unionTypes(dsl('integer'), dsl('number'))).toMatchObject({ kind: 'number' });
    expect(commonType(dsl('enum<a,b>'), dsl('enum<b,c>'))).toMatchObject({
      values: ['a', 'b', 'c'],
    });
  });

  it('reads different kinds as any, keeping the marks', () => {
    expect(unionTypes(dsl('string pii'), dsl('number'))).toMatchObject({ kind: 'any', pii: true });
    expect(commonType(dsl('string'), dsl('object{a: string}'))).toMatchObject({ kind: 'any' });
  });

  it('keeps ids of one prefix and forgets a prefix they do not share', () => {
    expect(unionTypes(dsl('id<inq>'), dsl('id<inq>'))).toMatchObject({ kind: 'id', prefix: 'inq' });
    expect(unionTypes(dsl('id<inq>'), dsl('id<acc>'))).toMatchObject({ kind: 'id', prefix: null });
  });
});

describe('typeToJsonSchema: what the editor picker reads (C115.3)', () => {
  it('renders every kind, with its marks', () => {
    expect(
      typeToJsonSchema(
        dsl(
          'object{a: string, b: integer, c: number, d: boolean, e: datetime, f: id<inq>, g: enum<x,y>, h: list<string>, i?: string pii}',
        ),
      ),
    ).toEqual({
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'integer' },
        c: { type: 'number' },
        d: { type: 'boolean' },
        e: { type: 'string', format: 'date-time' },
        f: { type: 'string', pattern: '^inq_' },
        g: { type: 'string', enum: ['x', 'y'] },
        h: { type: 'array', items: { type: 'string' } },
        i: { type: ['string', 'null'], pii: true, nullable: true },
      },
      required: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      additionalProperties: false,
    });
  });

  it('renders an any as an empty schema and a record by its rest', () => {
    expect(typeToJsonSchema(ANY_TYPE)).toEqual({});
    const record: ScopeType = {
      kind: 'object',
      members: {},
      rest: { kind: 'string', ...plain },
      inflect: false,
      ...plain,
    };
    expect(typeToJsonSchema(record)).toEqual({
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: { type: 'string' },
    });
  });
});

describe('checkValue: inputs and variables at run time (C118.2, C115.4)', () => {
  const type = dsl(
    'object{name: string, age?: integer, tags: list<enum<a,b>>, at: datetime, id: id<inq>}',
  );
  const good = {
    name: 'x',
    tags: ['a'],
    at: '2026-01-01T00:00:00Z',
    id: 'inq_01M5CJXHG07XPHF3HRM6NREDH7',
  };

  it('accepts a value of the type', () => {
    expect(checkValue(type, good)).toEqual([]);
    expect(checkValue(type, { ...good, age: null })).toEqual([]);
  });

  it.each<[string, JsonValue, string, string]>([
    ['a wrong scalar', { ...good, name: 1 }, '/name', 'value_type'],
    ['a fraction for an integer', { ...good, age: 1.5 }, '/age', 'value_type'],
    ['a value off the enum', { ...good, tags: ['z'] }, '/tags/0', 'value_type'],
    ['a list that is no list', { ...good, tags: 'a' }, '/tags', 'value_type'],
    ['a datetime that is none', { ...good, at: 'soon' }, '/at', 'value_type'],
    [
      'an id of another prefix',
      { ...good, id: 'acc_01M5CJXHG07XPHF3HRM6NREDH7' },
      '/id',
      'value_type',
    ],
    ['an unknown member', { ...good, extra: 1 }, '/extra', 'value_member'],
    [
      'a required member left out',
      { tags: [], at: good.at, id: good.id },
      '/name',
      'value_missing',
    ],
  ])('refuses %s', (_label, value, pointer, code) => {
    expect(checkValue(type, value)).toEqual([{ pointer, code }]);
  });

  it('refuses a null where the type says it may not be', () => {
    expect(checkValue(dsl('string'), null)).toEqual([{ pointer: '', code: 'value_missing' }]);
    expect(checkValue(dsl('string'), undefined)).toEqual([{ pointer: '', code: 'value_missing' }]);
  });

  it('takes any value for an any', () => {
    expect(checkValue(ANY_TYPE, { a: [1] })).toEqual([]);
  });

  it('checks a record by its rest', () => {
    const record: ScopeType = {
      kind: 'object',
      members: {},
      rest: { kind: 'number', ...plain },
      inflect: false,
      ...plain,
    };
    expect(checkValue(record, { a: 1 })).toEqual([]);
    expect(checkValue(record, { a: 'x' })).toEqual([{ pointer: '/a', code: 'value_type' }]);
  });

  it('takes a number for a number, finite only', () => {
    expect(checkValue(dsl('number'), 1.5)).toEqual([]);
    expect(checkValue(dsl('boolean'), 'true')).toEqual([{ pointer: '', code: 'value_type' }]);
    expect(checkValue(dsl('object{a: string}'), 'x')).toEqual([
      { pointer: '', code: 'value_type' },
    ]);
  });
});
