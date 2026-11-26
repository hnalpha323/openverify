import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { transactionTypeVersionProblems, type FieldProblem } from './engine.js';
import type { FieldSchema, RelationSchema } from './field-schemas.js';
import { DEFAULT_TRANSACTION_STATUSES, FIELD_TYPES_NEVER_REFUSED } from './field-types.js';

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

const invalid = (pointer: string) => ({ code: 'field_schema_invalid', pointer });
const card = (pointer: string) => ({ code: 'card_number_refused', pointer });

interface Overrides {
  readonly statuses?: readonly string[];
  readonly relationSchemas?: readonly RelationSchema[];
  readonly allowCardLikeStrings?: boolean;
}

const problemsOf = (
  fieldSchemas: readonly FieldSchema[],
  overrides: Overrides = {},
): FieldProblem[] =>
  transactionTypeVersionProblems({
    fieldSchemas,
    statuses: DEFAULT_TRANSACTION_STATUSES,
    relationSchemas: [],
    allowCardLikeStrings: false,
    ...overrides,
  });

/** A `hash` inside `containers - 1` more, the innermost holding one string. */
function nested(containers: number): FieldSchema {
  let inner = field('string', 'leaf');
  for (let level = 0; level < containers; level += 1) {
    inner =
      level % 2 === 0
        ? field('hash', 'level', { 'item-schemas': [inner] })
        : field('array', 'level', { 'item-schema': inner, 'max-items': 1 });
  }
  return inner;
}

describe('transactionTypeVersionProblems: a lawful version', () => {
  it('passes one field of each type', () => {
    expect(
      problemsOf([
        field('string', 'a', { 'max-char-length': 64, sanitize: ['html'], searchable: true }),
        field('integer', 'b', { min: 0, max: 10 }, { 'default-value': 1 }),
        field('number', 'c', { min: 0.5, max: 0.5 }),
        field('boolean', 'd'),
        field('datetime', 'e', { required: true }),
        field('email-address', 'f', { searchable: true }),
        field('date', 'g', { 'min-date': '2026-01-01', 'max-date': '2026-12-31' }),
        field('choices', 'h', { options: ['x', 'y'], 'option-labels': { x: 'X' } }),
        field('multi-choices', 'i', { options: ['x'], 'allow-empty': true }),
        field('array', 'j', { 'item-schema': field('string', 'x'), 'max-items': 10 }),
        field('hash', 'k', { 'item-schemas': [field('string', 'x', { required: true })] }),
        field('file', 'l', {
          'min-file-size-bytes': 1,
          'max-file-size-bytes': 100,
          'supported-mime-types': ['application/pdf', 'image/svg+xml'],
          'page-count-limit-enabled': true,
          'page-count-min': 1,
          'page-count-max': 2,
        }),
        field('platform-file', 'm'),
        field('json', 'n', { 'json-schema': { type: 'object' } }),
        field('relation-schema', 'o', { target: 'selfie' }),
      ]),
    ).toEqual([]);
  });

  it('passes a lower bound with no upper one, and the reverse', () => {
    expect(
      problemsOf([
        field('integer', 'a', { min: 2 }),
        field('number', 'b', { max: 2 }),
        field('date', 'c', { 'min-date': '2026-01-01' }),
        field('date', 'd', { 'max-date': '2026-01-01' }),
        field('file', 'e', { 'page-count-min': 2 }),
        field('file', 'f', { 'page-count-max': 2 }),
      ]),
    ).toEqual([]);
  });

  it('passes the frozen version fixture, and an empty version', () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          '../../../../contracts/fixtures/api/transaction-type-version.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as {
      data: {
        attributes: {
          'field-schemas': FieldSchema[];
          statuses: string[];
          'relation-schemas': RelationSchema[];
          'allow-card-like-strings': boolean;
        };
      };
    };
    const { attributes } = fixture.data;
    expect(
      transactionTypeVersionProblems({
        fieldSchemas: attributes['field-schemas'],
        statuses: attributes.statuses,
        relationSchemas: attributes['relation-schemas'],
        allowCardLikeStrings: attributes['allow-card-like-strings'],
      }),
    ).toEqual([]);
    expect(problemsOf([])).toEqual([]);
  });
});

describe('transactionTypeVersionProblems: the meta-schema (C104.3)', () => {
  it.each([
    ['an unknown type', field('float', 'a'), '/field-schemas/0/type'],
    ['a key out of its pattern', field('string', 'Amount Due'), '/field-schemas/0/key'],
    ['an unknown config member', field('boolean', 'a', { min: 1 }), '/field-schemas/0/config'],
    [
      'a string past the cap',
      field('string', 'a', { 'max-char-length': 1025 }),
      '/field-schemas/0/config/max-char-length',
    ],
    [
      'an array with no max-items',
      field('array', 'a', { 'item-schema': field('string', 'x') }),
      '/field-schemas/0/config/max-items',
    ],
    [
      'a bad field inside a hash',
      field('hash', 'a', { 'item-schemas': [field('string', 'x'), field('float', 'y')] }),
      '/field-schemas/0/config/item-schemas/1/type',
    ],
  ])('refuses %s, with its pointer', (_name, schema, pointer) => {
    expect(problemsOf([schema])).toEqual([invalid(pointer)]);
  });

  it('walks the other fields past a bad one', () => {
    expect(
      problemsOf([
        field('float', 'a'),
        field('string', 'b'),
        field('integer', 'c', { min: 2, max: 1 }),
      ]),
    ).toEqual([invalid('/field-schemas/0/type'), invalid('/field-schemas/2/config/min')]);
  });
});

describe('transactionTypeVersionProblems: stored content it cannot read', () => {
  const unreadable = (value: unknown) => value as FieldSchema;

  it.each([
    ['a null field', [unreadable(null)], '/field-schemas/0'],
    ['a text for a field', [unreadable('x')], '/field-schemas/0'],
  ])('answers a problem for %s, and never throws', (_name, schemas, pointer) => {
    expect(problemsOf(schemas)).toEqual([invalid(pointer)]);
  });

  it('answers a problem for a null inside a hash', () => {
    expect(problemsOf([field('hash', 'h', { 'item-schemas': [null] })])).toEqual([
      invalid('/field-schemas/0/config/item-schemas/0'),
    ]);
  });

  it('reads an alias past a null beside it', () => {
    const alias = field('string', 'a', { 'source-key-path': 'b' });
    expect(problemsOf([unreadable(null), alias, field('string', 'b')])).toEqual([
      invalid('/field-schemas/0'),
    ]);
  });

  it('answers a problem for a status or a relation it cannot read', () => {
    expect(problemsOf([], { statuses: ['created', 1 as unknown as string] })).toEqual([
      invalid('/statuses/1'),
    ]);
    expect(problemsOf([], { relationSchemas: [null as unknown as RelationSchema] })).toEqual([
      invalid('/relation-schemas/0'),
    ]);
  });
});

describe('transactionTypeVersionProblems: the caps (C104.2)', () => {
  it('takes 100 fields and refuses 101, at any depth', () => {
    const items = (count: number) =>
      Array.from({ length: count }, (_value, index) => field('boolean', `f${String(index)}`));
    expect(problemsOf(items(100))).toEqual([]);
    expect(problemsOf(items(101))).toEqual([invalid('/field-schemas')]);
    expect(problemsOf([field('hash', 'h', { 'item-schemas': items(99) })])).toEqual([]);
    expect(problemsOf([field('hash', 'h', { 'item-schemas': items(100) })])).toEqual([
      invalid('/field-schemas'),
    ]);
  });

  it('takes 3 levels through hash and array, and refuses a fourth', () => {
    expect(problemsOf([nested(3)])).toEqual([]);
    expect(problemsOf([nested(4)])).toEqual([
      invalid('/field-schemas/0/config/item-schema/config/item-schemas/0/config/item-schema'),
    ]);
  });

  it('refuses a nesting far past the stack, without a throw', () => {
    expect(problemsOf([nested(5000)])).toHaveLength(1);
  });

  it('takes 20 searchable fields and refuses the next', () => {
    const searchable = Array.from({ length: 21 }, (_value, index) =>
      field('string', `f${String(index)}`, { searchable: true }),
    );
    expect(problemsOf(searchable.slice(0, 20))).toEqual([]);
    expect(problemsOf(searchable)).toEqual([invalid('/field-schemas/20/config/searchable')]);
  });

  it('refuses a key twice at one level, and allows it at another', () => {
    expect(problemsOf([field('string', 'a'), field('integer', 'a')])).toEqual([
      invalid('/field-schemas/1/key'),
    ]);
    expect(
      problemsOf([
        field('string', 'a'),
        field('hash', 'b', { 'item-schemas': [field('string', 'a')] }),
        field('hash', 'c', { 'item-schemas': [field('string', 'a'), field('string', 'a')] }),
      ]),
    ).toEqual([invalid('/field-schemas/2/config/item-schemas/1/key')]);
  });
});

describe('transactionTypeVersionProblems: redaction-policy never (C104.2, P21)', () => {
  const configFor = (type: string): Record<string, unknown> | undefined => {
    switch (type) {
      case 'array':
        return { 'item-schema': field('string', 'x'), 'max-items': 1 };
      case 'hash':
        return { 'item-schemas': [field('string', 'x')] };
      case 'json':
        return { 'json-schema': {} };
      case 'relation-schema':
        return { target: 'selfie' };
      default:
        return undefined;
    }
  };

  it.each(FIELD_TYPES_NEVER_REFUSED)('refuses it on %s', (type) => {
    expect(
      problemsOf([field(type, 'a', { ...configFor(type), 'redaction-policy': 'never' })]),
    ).toEqual([invalid('/field-schemas/0/config/redaction-policy')]);
  });

  it('needs the acknowledgement on a string', () => {
    expect(problemsOf([field('string', 'a', { 'redaction-policy': 'never' })])).toEqual([
      invalid('/field-schemas/0/config/never-redact-acknowledged'),
    ]);
    expect(
      problemsOf([
        field('string', 'a', {
          'redaction-policy': 'never',
          'never-redact-acknowledged': false,
        }),
      ]),
    ).toEqual([invalid('/field-schemas/0/config/never-redact-acknowledged')]);
    expect(
      problemsOf([
        field('string', 'a', { 'redaction-policy': 'never', 'never-redact-acknowledged': true }),
      ]),
    ).toEqual([]);
  });

  it('cannot be searchable on a string', () => {
    expect(
      problemsOf([
        field('string', 'a', {
          'redaction-policy': 'never',
          'never-redact-acknowledged': true,
          searchable: true,
        }),
      ]),
    ).toEqual([invalid('/field-schemas/0/config/searchable')]);
  });

  it('needs no acknowledgement on the other types', () => {
    expect(
      problemsOf([
        field('integer', 'a', { 'redaction-policy': 'never' }),
        field('boolean', 'b', { 'redaction-policy': 'never' }),
        field('string', 'c', { 'redaction-policy': 'none' }),
      ]),
    ).toEqual([]);
  });
});

describe('transactionTypeVersionProblems: what a nested field cannot be', () => {
  const inHash = (schema: FieldSchema) => field('hash', 'h', { 'item-schemas': [schema] });
  const pointer = '/field-schemas/0/config/item-schemas/0';

  it.each([
    ['searchable: no key names it', { searchable: true }, 'searchable'],
    [
      'write_once: only top-level writes are compared',
      { 'write-policy': 'write_once' },
      'write-policy',
    ],
    [
      'never: a hash cannot be, so neither can part of one',
      { 'redaction-policy': 'never', 'never-redact-acknowledged': true },
      'redaction-policy',
    ],
    ['an alias', { 'source-key-path': 'other' }, 'source-key-path'],
  ])('refuses %s', (_name, config, member) => {
    expect(problemsOf([inHash(field('string', 'x', config)), field('string', 'other')])).toEqual([
      invalid(`${pointer}/config/${member}`),
    ]);
  });

  it('refuses a file, which only its top-level PUT route can fill (P22)', () => {
    expect(problemsOf([inHash(field('file', 'x'))])).toEqual([invalid(pointer)]);
    expect(
      problemsOf([field('array', 'a', { 'item-schema': field('file', 'x'), 'max-items': 1 })]),
    ).toEqual([invalid('/field-schemas/0/config/item-schema')]);
  });

  it('refuses required on a file: no JSON body can hold one, so no create could pass', () => {
    expect(problemsOf([field('file', 'a', { required: true })])).toEqual([
      invalid('/field-schemas/0/config/required'),
    ]);
  });
});

describe('transactionTypeVersionProblems: searchable (C104.2, C105.4)', () => {
  it.each([
    ['multi-choices', { options: ['x'] }],
    ['array', { 'item-schema': field('string', 'x'), 'max-items': 1 }],
    ['hash', { 'item-schemas': [field('string', 'x')] }],
    ['file', {}],
    ['platform-file', {}],
    ['json', { 'json-schema': {} }],
    ['relation-schema', { target: 'selfie' }],
  ])('refuses it on %s, which has no one value to key', (type, config) => {
    expect(problemsOf([field(type, 'a', { ...config, searchable: true })])).toEqual([
      invalid('/field-schemas/0/config/searchable'),
    ]);
  });

  it.each([
    ['string', {}],
    ['integer', {}],
    ['number', {}],
    ['boolean', {}],
    ['datetime', {}],
    ['email-address', {}],
    ['date', {}],
    ['choices', { options: ['x'] }],
  ])('allows it on %s', (type, config) => {
    expect(problemsOf([field(type, 'a', { ...config, searchable: true })])).toEqual([]);
  });
});

describe('transactionTypeVersionProblems: source-key-path (C104.2, P22)', () => {
  const cardHash = field('hash', 'card', {
    'item-schemas': [
      field('string', 'token'),
      field('hash', 'issuer', { 'item-schemas': [field('string', 'name')] }),
    ],
  });
  const alias = (path: string, type = 'string', config: Record<string, unknown> = {}) =>
    field(type, 'alias', { ...config, 'source-key-path': path });
  const pathPointer = '/field-schemas/1/config/source-key-path';

  it('takes a path to a declared field of its type, through hashes, up to 3 segments', () => {
    expect(problemsOf([cardHash, alias('card.token')])).toEqual([]);
    expect(problemsOf([cardHash, alias('card.issuer.name')])).toEqual([]);
    expect(
      problemsOf([cardHash, alias('card', 'hash', { 'item-schemas': [field('string', 'x')] })]),
    ).toEqual([]);
    expect(problemsOf([cardHash, field('string', 'alias', { 'source-key-path': null })])).toEqual(
      [],
    );
  });

  it.each([
    ['four segments', 'card.issuer.name.first'],
    ['an empty segment', 'card..token'],
    ['a segment out of the pattern', 'card.__proto__'],
    ['an upper-case segment', 'Card.token'],
    ['an undeclared field', 'card.missing'],
    ['an undeclared root', 'missing'],
    ['a path through a scalar', 'card.token.more'],
    ['itself', 'alias'],
  ])('refuses %s', (_name, path) => {
    expect(problemsOf([cardHash, alias(path)])).toEqual([invalid(pathPointer)]);
  });

  it('refuses a path through an array, which no key can address', () => {
    expect(
      problemsOf([
        field('array', 'list', { 'item-schema': field('string', 'x'), 'max-items': 1 }),
        alias('list.x'),
      ]),
    ).toEqual([invalid(pathPointer)]);
  });

  it('refuses a field of another type, and an alias of an alias', () => {
    expect(problemsOf([cardHash, alias('card.token', 'integer')])).toEqual([invalid(pathPointer)]);
    expect(
      problemsOf([
        field('string', 'a'),
        alias('b'),
        field('string', 'b', { 'source-key-path': 'a' }),
      ]),
    ).toEqual([invalid(pathPointer)]);
  });

  it.each([
    ['required', { required: true }, 'required'],
    ['searchable', { searchable: true }, 'searchable'],
    ['write_once', { 'write-policy': 'write_once' }, 'write-policy'],
  ])('refuses %s on an alias, which takes no write', (_name, config, member) => {
    expect(problemsOf([cardHash, alias('card.token', 'string', config)])).toEqual([
      invalid(`/field-schemas/1/config/${member}`),
    ]);
  });

  it('refuses a default on an alias: it is never used to set a value', () => {
    expect(problemsOf([cardHash, { ...alias('card.token'), 'default-value': 'x' }])).toEqual([
      invalid('/field-schemas/1/default-value'),
    ]);
  });
});

describe('transactionTypeVersionProblems: each type’s own rules (C104.2)', () => {
  it.each([
    ['integer min above max', field('integer', 'a', { min: 2, max: 1 }), 'min'],
    ['number min above max', field('number', 'a', { min: 0.2, max: 0.1 }), 'min'],
    [
      'min-date after max-date',
      field('date', 'a', { 'min-date': '2026-02-01', 'max-date': '2026-01-01' }),
      'min-date',
    ],
    [
      'the file minimum above its maximum',
      field('file', 'a', { 'min-file-size-bytes': 2, 'max-file-size-bytes': 1 }),
      'min-file-size-bytes',
    ],
    [
      'the file minimum above the default maximum',
      field('file', 'a', { 'min-file-size-bytes': 10_000_001 }),
      'min-file-size-bytes',
    ],
    [
      'the page minimum above its maximum',
      field('file', 'a', { 'page-count-min': 3, 'page-count-max': 2 }),
      'page-count-min',
    ],
    ['repeated options', field('choices', 'a', { options: ['x', 'x'] }), 'options/1'],
    [
      'a label of no option',
      field('multi-choices', 'a', { options: ['x'], 'option-labels': { y: 'Y' } }),
      'option-labels/y',
    ],
    [
      'a mime type with no subtype',
      field('file', 'a', { 'supported-mime-types': ['application/pdf', 'pdf'] }),
      'supported-mime-types/1',
    ],
  ])('refuses %s', (_name, schema, member) => {
    expect(problemsOf([schema])).toEqual([invalid(`/field-schemas/0/config/${member}`)]);
  });

  it.each([
    ['document-mdoc', 'document-mdoc'],
    ['document-qr-code', 'document-qr-code'],
  ])('answers relation_target_unsupported for %s, at any depth', (_name, target) => {
    expect(problemsOf([field('relation-schema', 'a', { target })])).toEqual([
      { code: 'relation_target_unsupported', pointer: '/field-schemas/0/config/target' },
    ]);
    expect(
      problemsOf([
        field('array', 'a', {
          'item-schema': field('relation-schema', 'x', { target }),
          'max-items': 1,
        }),
      ]),
    ).toEqual([
      {
        code: 'relation_target_unsupported',
        pointer: '/field-schemas/0/config/item-schema/config/target',
      },
    ]);
  });

  it('reads a json schema through the allowlist, with the field’s pointer, at any depth', () => {
    expect(
      problemsOf([
        field('json', 'a', { 'json-schema': { pattern: 'x' } }),
        field('hash', 'b', {
          'item-schemas': [field('json', 'x', { 'json-schema': { type: 'array' } })],
        }),
      ]),
    ).toEqual([
      invalid('/field-schemas/0/config/json-schema/pattern'),
      invalid('/field-schemas/1/config/item-schemas/0/config/json-schema'),
    ]);
  });
});

describe('transactionTypeVersionProblems: defaults (C104.2)', () => {
  const defaulting = (type: string, value: unknown, config?: Record<string, unknown>) =>
    field(type, 'a', config, { 'default-value': value });
  const pointer = '/field-schemas/0/default-value';

  it.each([
    ['a string past its length', defaulting('string', 'abc', { 'max-char-length': 2 })],
    ['an empty required string', defaulting('string', '', { required: true })],
    ['an integer under min', defaulting('integer', 0, { min: 1 })],
    ['a number over max', defaulting('number', 2.5, { max: 2 })],
    ['a date out of range', defaulting('date', '2025-01-01', { 'min-date': '2026-01-01' })],
    ['an address that is none', defaulting('email-address', 'not an address')],
    ['a choice that is no option', defaulting('choices', 'y', { options: ['x'] })],
    ['a repeated multi-choice', defaulting('multi-choices', ['x', 'x'], { options: ['x'] })],
    ['a multi-choice that is no option', defaulting('multi-choices', ['y'], { options: ['x'] })],
    [
      'too many items',
      defaulting('array', ['x', 'y'], { 'item-schema': field('string', 'x'), 'max-items': 1 }),
    ],
    [
      'an unknown member of a hash',
      defaulting('hash', { y: 1 }, { 'item-schemas': [field('string', 'x')] }),
    ],
  ])('refuses %s', (_name, schema) => {
    expect(problemsOf([schema])).toEqual([invalid(pointer)]);
  });

  it('points into a nested default', () => {
    expect(
      problemsOf([
        defaulting('array', ['ok', 1], { 'item-schema': field('string', 'x'), 'max-items': 2 }),
      ]),
    ).toEqual([invalid(`${pointer}/1`)]);
  });

  it('takes a default that holds', () => {
    expect(
      problemsOf([
        defaulting('string', 'ok', { 'max-char-length': 2 }),
        field('choices', 'b', { options: ['x'] }, { 'default-value': 'x' }),
        field('multi-choices', 'c', { options: ['x', 'y'] }, { 'default-value': ['y'] }),
        field('json', 'd', { 'json-schema': {} }, { 'default-value': { a: 1 } }),
      ]),
    ).toEqual([]);
  });

  it('refuses a json default past its caps', () => {
    let deep: unknown = [];
    for (let level = 0; level < 11; level += 1) {
      deep = [deep];
    }
    expect(problemsOf([defaulting('json', deep, { 'json-schema': {} })])).toEqual([
      invalid(pointer),
    ]);
  });
});

describe('transactionTypeVersionProblems: the card-number guard at publish (C104.4)', () => {
  const schemas = [
    field('string', 'a', undefined, { 'default-value': CARD }),
    field('integer', 'b', undefined, { 'default-value': 4242424242424242 }),
    field('choices', 'c', { options: ['clean', CARD] }),
    field('multi-choices', 'd', { options: [CARD] }),
  ];

  it('refuses a default and an option: a version is stored in the clear', () => {
    const problems = problemsOf(schemas);
    expect(problems).toEqual([
      card('/field-schemas/0/default-value'),
      card('/field-schemas/1/default-value'),
      card('/field-schemas/2/config/options/1'),
      card('/field-schemas/3/config/options/0'),
    ]);
    expect(JSON.stringify(problems)).not.toContain('4242');
  });

  it('is lifted with the fields of an opted-out version', () => {
    expect(problemsOf(schemas, { allowCardLikeStrings: true })).toEqual([]);
  });
});

describe('transactionTypeVersionProblems: statuses (C104.5)', () => {
  it.each([
    ['none', [], '/statuses'],
    ['51', ['created', ...Array.from({ length: 50 }, (_v, i) => `s${String(i)}`)], '/statuses'],
    ['created not first', ['approved', 'created'], '/statuses/0'],
    ['a repeat', ['created', 'approved', 'approved'], '/statuses/2'],
    ['created twice', ['created', 'created'], '/statuses/1'],
    ['upper case', ['created', 'Approved'], '/statuses/1'],
    ['a leading space', ['created', ' approved'], '/statuses/1'],
    ['65 characters', ['created', 'a'.repeat(65)], '/statuses/1'],
  ])('refuses %s', (_name, statuses, pointer) => {
    expect(problemsOf([], { statuses })).toEqual([invalid(pointer)]);
  });

  it('takes 50 statuses of up to 64 characters, with spaces, hyphens and underscores', () => {
    const statuses = [
      'created',
      'a'.repeat(64),
      'needs review',
      'on-hold_2',
      ...Array.from({ length: 46 }, (_value, index) => `s${String(index)}`),
    ];
    expect(statuses).toHaveLength(50);
    expect(problemsOf([], { statuses })).toEqual([]);
  });
});

describe('transactionTypeVersionProblems: relation schemas (C104.5)', () => {
  const relation = (key: string): RelationSchema => ({
    key,
    target: 'account',
    cardinality: 'one',
  });

  it('takes 20 and refuses 21', () => {
    const relations = Array.from({ length: 21 }, (_value, index) => relation(`r${String(index)}`));
    expect(problemsOf([], { relationSchemas: relations.slice(0, 20) })).toEqual([]);
    expect(problemsOf([], { relationSchemas: relations })).toEqual([invalid('/relation-schemas')]);
  });

  it('refuses a repeated key and a relation out of its shape', () => {
    expect(problemsOf([], { relationSchemas: [relation('a'), relation('a')] })).toEqual([
      invalid('/relation-schemas/1/key'),
    ]);
    const stored = { ...relation('a'), target: 'inquiry' } as unknown as RelationSchema;
    expect(problemsOf([], { relationSchemas: [stored] })).toEqual([
      invalid('/relation-schemas/0/target'),
    ]);
  });
});

describe('transactionTypeVersionProblems: its problems', () => {
  it('never carry a value', () => {
    const problems = problemsOf([
      field('string', 'a', { 'max-char-length': 1 }, { 'default-value': 'synthetic-secret' }),
      field('choices', 'b', { options: ['x'] }, { 'default-value': 'synthetic-secret' }),
    ]);
    expect(problems).toHaveLength(2);
    expect(JSON.stringify(problems)).not.toContain('synthetic-secret');
  });
});
