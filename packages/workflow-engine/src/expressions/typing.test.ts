/** C114.5, C114.6: conditions typed against the scope of their node, with the null and PII rules. */
import { describe, expect, it } from 'vitest';
import {
  enumType,
  listType,
  objectType,
  parseTypeDsl,
  type ScopeType,
} from '../variables/types.js';
import { parsed } from './testing.js';
import { typeCheckCondition } from './typing.js';

function dsl(text: string): ScopeType {
  const result = parseTypeDsl(text);
  if (!result.ok) {
    throw new Error(result.detail);
  }
  return result.type;
}

/** A scope that holds every case the rules name. */
const scope = objectType({
  trigger: dsl(
    'object{status: enum<completed,failed>, count: integer, name: string, nick?: string, name_pii: string pii, age: integer pii, kind_pii: enum<a,b> pii, at: datetime pii, ok: boolean pii, id: id<inq>, tags: list<string>, people: list<object{name: string pii, score?: number}>, done: boolean, maybe?: boolean, at_plain: datetime}',
  ),
  vars: dsl('object{risk: number}'),
  steps: objectType({
    list: objectType({ output: dsl('object{matched?: boolean, count: integer}') }),
  }),
  loop: dsl('object{item: string, index: integer}'),
  current_run: dsl('object{id: id<wfr>}'),
  event: objectType({}),
});

const check = (rule: unknown) => typeCheckCondition(parsed(rule), scope);
const codes = (rule: unknown) => check(rule).issues.map(({ code }) => code);
const pointers = (rule: unknown) => check(rule).issues.map(({ pointer }) => pointer);

const status = { var: 'trigger.status' };
const count = { var: 'trigger.count' };
const name = { var: 'trigger.name' };
const nick = { var: 'trigger.nick' };
const namePii = { var: 'trigger.name_pii' };
const matched = { var: 'steps.list.output.matched' };
const done = { var: 'trigger.done' };
const tags = { var: 'trigger.tags' };
const people = { var: 'trigger.people' };

describe('paths (C114.5)', () => {
  it.each<[string, unknown]>([
    ['a member', status],
    ['a list index', { var: 'trigger.tags[0]' }],
    ['a step output', { var: 'steps.list.output.count' }],
    ['the loop item', { var: 'loop.item' }],
  ])('%s resolves', (_label, rule) => {
    expect(codes(rule)).toEqual([]);
  });

  it('refuses an unknown path', () => {
    expect(codes({ var: 'trigger.nope' })).toEqual(['path_unknown']);
    expect(codes({ var: 'steps.other.output' })).toEqual(['path_unknown']);
  });

  it('points at the var', () => {
    expect(pointers({ and: [done, { var: 'vars.nope' }] })).toEqual(['/and/1/var']);
  });

  it('refuses a path into an opaque value (C124.5)', () => {
    const opaque: ScopeType = { kind: 'any', opaque: true, nullable: false, pii: true };
    const open = objectType({
      steps: objectType({ h: objectType({ output: objectType({ body: opaque }) }) }),
    });
    const rule = parsed({ '===': [{ var: 'steps.h.output.body.score' }, 1] });
    expect(typeCheckCondition(rule, open).issues.map(({ code }) => code)).toEqual(['path_untyped']);
  });

  it('holds current_case inert until Workflow 8B gives it a type (C140.2)', () => {
    const rule = parsed({ '===': [{ var: 'current_case.status' }, 'x'] });
    expect(typeCheckCondition(rule, scope).issues.map(({ code }) => code)).toEqual([
      'current_case_unavailable',
    ]);
  });

  it('reads current_case once a provider gives it a type', () => {
    const provided = objectType({ current_case: dsl('object{status: string}') });
    const rule = parsed({ '===': [{ var: 'current_case.status' }, 'x'] });
    expect(typeCheckCondition(rule, provided).issues).toEqual([]);
  });

  it('lists what it read, with the marks', () => {
    const { reads } = check({ and: [{ '===': [matched, true] }, { '===': [namePii, null] }] });
    expect(reads.map(({ path, nullable, pii }) => [path.text, nullable, pii])).toEqual([
      ['steps.list.output.matched', true, false],
      ['trigger.name_pii', false, true],
    ]);
  });
});

describe('comparability (C114.5)', () => {
  it.each<[string, unknown]>([
    ['a number and a literal', { '<': [count, 3] }],
    ['an integer and a number', { '<': [count, { var: 'vars.risk' }] }],
    ['a string and a literal', { '===': [name, 'x'] }],
    ['an enum and one of its values', { '===': [status, 'completed'] }],
    ['an id and a literal', { '===': [{ var: 'trigger.id' }, 'inq_x'] }],
    ['a boolean and a literal', { '===': [done, true] }],
    ['two dates', { '<': [{ var: 'trigger.at_plain' }, { now: [] }] }],
    ['anything and null', { '===': [count, null] }],
    ['an enum in a list of its values', { in: [status, ['completed', 'failed']] }],
  ])('%s', (_label, rule) => {
    expect(codes(rule)).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['a number and a string', { '===': [count, 'x'] }],
    ['a string and a number', { '<': [name, 1] }],
    ['an enum and a value off it', { '===': [status, 'pending'] }],
    ['a boolean ordered', { '<': [done, 1] }],
    ['two typed paths', { '===': [count, name] }],
    ['an enum in a list off it', { in: [status, ['completed', 'nope']] }],
    ['a number in a list of strings', { in: [count, tags] }],
    ['arithmetic on a string', { '+': [name, 1] }],
    ['a list operator over a scalar', { count: [count] }],
    ['a date operator on a number', { before: [count, { now: [] }] }],
    ['a string operator on a list', { trim: [tags] }],
    ['in with a number haystack', { in: ['a', count] }],
  ])('refuses %s', (_label, rule) => {
    expect(codes(rule)).toEqual(['type_incomparable']);
  });
});

describe('PII literals (C114.5, P37)', () => {
  it.each<[string, unknown]>([
    ['a comparison with a string', { '===': [namePii, 'Ada'] }],
    ['the literal on the left', { '===': ['Ada', namePii] }],
    ['an inequality', { '!==': [namePii, 'Ada'] }],
    ['in a literal list', { in: [namePii, ['Ada', 'Grace']] }],
    ['includes a literal', { includes: [{ collect: [people, 'name'] }, 'Ada'] }],
    ['a where value', { where: [people, 'name', 'eq', 'Ada'] }],
    ['a where list', { where: [people, 'name', 'in', ['Ada']] }],
    ['a value derived from one', { '===': [{ trim: [namePii] }, 'Ada'] }],
  ])('refuses %s', (_label, rule) => {
    expect(codes(rule)).toContain('pii_literal_in_condition');
  });

  it.each<[string, unknown]>([
    ['a number', { '<': [{ var: 'trigger.age' }, 18] }],
    ['an enum', { '===': [{ var: 'trigger.kind_pii' }, 'a'] }],
    ['a date', { after: [{ var: 'trigger.at' }, '2026-01-01'] }],
    ['a boolean', { '===': [{ var: 'trigger.ok' }, true] }],
    ['null', { '===': [namePii, null] }],
    ['another path', { '===': [namePii, name] }],
  ])('allows PII compared with %s', (_label, rule) => {
    expect(codes(rule)).toEqual([]);
  });
});

describe('a nullable path in a boolean position (C114.6, H04)', () => {
  it.each<[string, unknown]>([
    ['not', { '!': [matched] }],
    ['double not', { '!!': [matched] }],
    ['if', { if: [matched, 1, 2] }],
    ['if, the second condition', { if: [false, 1, matched, 2, 3] }],
    ['and', { and: [done, matched] }],
    ['or', { or: [matched, done] }],
    ['inequality', { '!==': [matched, true] }],
    ['inequality with null', { '!==': [matched, null] }],
    ['a nullable result', { '!': [{ first: [tags] }] }],
  ])('refuses %s', (_label, rule) => {
    expect(codes(rule)).toEqual(['nullable_in_boolean_position']);
  });

  it.each<[string, unknown]>([
    ['=== null', { '===': [matched, null] }],
    ['null ===', { '===': [null, matched] }],
    ['missing', { missing: ['steps.list.output.matched'] }],
    ['missing_some', { missing_some: [1, ['steps.list.output.matched']] }],
    ['not of an explicit test', { '!': [{ '===': [matched, null] }] }],
    ['and of explicit tests', { and: [{ '===': [matched, null] }, done] }],
  ])('allows %s', (_label, rule) => {
    expect(codes(rule)).toEqual([]);
  });

  it('allows the value branches of an if, where no boolean is read', () => {
    expect(codes({ '===': [{ if: [done, nick, 'x'] }, 'y'] })).toEqual([]);
  });

  it('allows a path the scope does not mark', () => {
    expect(codes({ '!': [done] })).toEqual([]);
  });
});

describe('whether a position reads a nullable path (C114.6)', () => {
  const reads = (rule: unknown) => check(rule).readsNullable;

  it.each<[string, unknown]>([
    ['a comparison', { '===': [matched, true] }],
    ['an order', { '<': [{ var: 'trigger.people[0].score' }, 1] }],
    ['inside an and', { and: [done, { '===': [matched, true] }] }],
    ['a cat', { '===': [{ cat: [nick, 'x'] }, 'y'] }],
    ['the head of a list', { '===': [{ first: [tags] }, 'x'] }],
    ['a map body', { '===': [{ count: [{ map: [people, { var: 'score' }] }] }, 1] }],
  ])('%s does', (_label, rule) => {
    expect(reads(rule)).toBe(true);
  });

  it.each<[string, unknown]>([
    ['a plain comparison', { '===': [status, 'failed'] }],
    ['an explicit test', { '===': [matched, null] }],
    ['missing', { missing: ['steps.list.output.matched'] }],
    [
      'a predicate with its own on-null',
      { some: [people, { '>': [{ var: 'score' }, 1] }, 'exclude'] },
    ],
    ['a where with its own on-null', { where: [people, 'score', 'gt', 1, 'exclude'] }],
  ])('%s does not', (_label, rule) => {
    expect(reads(rule)).toBe(false);
  });
});

describe('list predicates declare on-null (C114.6, V15)', () => {
  const scored = { '>': [{ var: 'score' }, 1] };

  it.each<[string, unknown]>([
    ['filter', { filter: [people, scored] }],
    ['some', { some: [people, scored] }],
    ['all', { all: [people, scored] }],
    ['none', { none: [people, scored] }],
    ['where', { where: [people, 'score', 'gt', 1] }],
  ])('%s over a nullable member needs one', (_label, rule) => {
    expect(codes(rule)).toEqual(['on_null_missing']);
  });

  it.each<[string, unknown]>([
    ['filter', { filter: [people, scored, 'include'] }],
    ['some', { some: [people, scored, 'exclude'] }],
    ['all', { all: [people, scored, 'error'] }],
    ['none', { none: [people, scored, 'include'] }],
    ['where', { where: [people, 'score', 'gt', 1, 'exclude'] }],
  ])('%s with one passes', (_label, rule) => {
    expect(codes(rule)).toEqual([]);
  });

  it('needs none over a member that cannot be null', () => {
    expect(codes({ filter: [people, { '===': [{ var: 'name' }, { var: 'name' }] }] })).toEqual([]);
    expect(codes({ where: [people, 'name', 'ne', { var: 'trigger.name' }] })).toEqual([]);
  });

  it('types the element', () => {
    expect(codes({ filter: [people, { var: 'nope' }] })).toEqual(['path_unknown']);
    expect(codes({ map: [tags, { '+': [{ var: '' }, 1] }] })).toEqual(['type_incomparable']);
    expect(codes({ where: [people, 'nope', 'eq', 1] })).toEqual(['path_unknown']);
  });

  it('types reduce with its accumulator and element', () => {
    const rule = { reduce: [tags, { cat: [{ var: 'accumulator' }, { var: 'current' }] }, ''] };
    expect(codes({ '===': [rule, 'x'] })).toEqual([]);
    const wrong = { reduce: [tags, { var: 'other' }, ''] };
    expect(codes(wrong)).toEqual(['path_unknown']);
  });
});

describe('the results of the operators', () => {
  it.each<[string, unknown]>([
    ['arithmetic', { '<': [{ '+': [1, count] }, 3] }],
    ['min', { '<': [{ min: [1, count] }, 3] }],
    ['count', { '<': [{ count: [tags] }, 3] }],
    ['length', { '<': [{ length: [name] }, 3] }],
    ['days_between', { '<': [{ days_between: ['2026-01-01', { now: [] }] }, 3] }],
    ['cat', { '===': [{ cat: [name, 'x'] }, 'y'] }],
    ['substr', { '===': [{ substr: [name, 1] }, 'y'] }],
    ['trim', { '===': [{ trim: [name] }, 'y'] }],
    ['replace_all', { '===': [{ replace_all: [name, 'a', 'b'] }, 'y'] }],
    ['replace_chars', { '===': [{ replace_chars: [name, 'a', 'b'] }, 'y'] }],
    ['email_domain, checked for null', { '===': [{ email_domain: [name] }, null] }],
    ['split', { includes: [{ split: [name, ','] }, 'y'] }],
    ['merge', { includes: [{ merge: [tags, ['a']] }, 'y'] }],
    ['sort', { includes: [{ sort_asc: [tags] }, 'y'] }],
    ['filter', { includes: [{ filter: [tags, true] }, 'y'] }],
    ['where', { count: [{ where: [people, 'name', 'ne', name] }] }],
    ['collect', { count: [{ collect: [people, 'score'] }] }],
    ['convert_to', { '<': [{ convert_to: [name, 'number'] }, 3] }],
    ['convert_to a string', { '===': [{ convert_to: [count, 'string'] }, 'x'] }],
    ['convert_to a boolean', { '===': [{ convert_to: [name, 'boolean'] }, true] }],
    ['convert_to a date', { before: [{ convert_to: [name, 'date'] }, { now: [] }] }],
    ['a literal list', { includes: [['a', 'b'], name] }],
    ['an empty list', { count: [[]] }],
  ])('%s has its type', (_label, rule) => {
    expect(codes(rule)).toEqual([]);
  });

  it('a list element of an enum list keeps its enum', () => {
    const local = objectType({ trigger: objectType({ all: listType(enumType(['a', 'b'])) }) });
    const rule = parsed({ '===': [{ first: [{ var: 'trigger.all' }] }, 'z'] });
    expect(typeCheckCondition(rule, local).issues.map(({ code }) => code)).toEqual([
      'type_incomparable',
    ]);
  });
});
