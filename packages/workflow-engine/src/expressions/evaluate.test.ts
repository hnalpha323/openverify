/** C114: golden vectors per operator, the limits, and no host error from anything an operator wrote. */
import { describe, expect, it } from 'vitest';
import { EXPRESSION_LIMITS } from '../limits/index.js';
import { evaluateExpression } from './evaluate.js';
import type { JsonValue } from './json.js';
import { decide, NOW, parsed, run, scopeOf, seeded } from './testing.js';

const value = (result: JsonValue) => ({ outcome: 'value', value: result });
const unknown = { outcome: 'null' };
const failed = (code: string) => ({ outcome: 'error', code });

const roots = {
  trigger: {
    status: 'completed',
    count: 3,
    empty: '',
    tags: ['vip', 'beta'],
    nothing: null,
    fields: { amount: 12.5, name: 'Ada' },
    items: [
      { id: 'a', score: 3, kind: 'x' },
      { id: 'b', score: 1, kind: 'y' },
      { id: 'c', score: 2, kind: 'x' },
    ],
    gaps: [{ score: 1 }, { score: null }, {}],
  },
  vars: { risk: 2, flag: true },
  steps: { check: { output: { matched: null, done: true } } },
  loop: { item: 'vip', index: 0 },
  current_run: { id: 'wfr_1' },
} satisfies Readonly<Record<string, JsonValue>>;

describe('logic (C114.2)', () => {
  it.each<[string, unknown, JsonValue]>([
    ['and, all true, the last', { and: [1, 'a', true] }, true],
    ['and stops at the first falsy', { and: [1, 0, 'a'] }, 0],
    ['or, the first truthy', { or: [0, '', 2, 3] }, 2],
    ['or, all falsy, the last', { or: [0, ''] }, ''],
    ['not', { '!': [false] }, true],
    ['not of an empty list', { '!': [[]] }, true],
    ['not of a list', { '!': [[0]] }, false],
    ['double not of an empty string', { '!!': [''] }, false],
    ['double not of zero', { '!!': [0] }, false],
    ['if, the first branch', { if: [true, 'a', 'b'] }, 'a'],
    ['if, the else', { if: [false, 'a', 'b'] }, 'b'],
    ['if, the middle branch', { if: [false, 'a', true, 'b', 'c'] }, 'b'],
    ['if, no else', { if: [false, 'a'] }, null],
  ])('%s', (_label, rule, expected) => {
    expect(run(rule, roots)).toEqual(value(expected));
  });

  it('never evaluates the branch not taken', () => {
    expect(run({ and: [false, { '/': [1, 0] }] })).toEqual(value(false));
    expect(run({ or: [true, { '/': [1, 0] }] })).toEqual(value(true));
    expect(run({ if: [true, 1, { '/': [1, 0] }] })).toEqual(value(1));
  });
});

describe('comparison (C114.2, decision 6)', () => {
  it.each<[string, unknown, JsonValue]>([
    ['equal numbers', { '===': [1, 1] }, true],
    ['equal strings', { '===': ['a', 'a'] }, true],
    ['equal booleans', { '===': [true, true] }, true],
    ['no coercion of a number and a string', { '===': [1, '1'] }, false],
    ['no coercion of zero and an empty string', { '===': [0, ''] }, false],
    ['the loose alias does not coerce', { '==': [1, '1'] }, false],
    ['the loose not does not coerce', { '!=': [1, '1'] }, true],
    ['strict inequality', { '!==': [1, 2] }, true],
    ['less', { '<': [1, 2] }, true],
    ['not less', { '<': [2, 2] }, false],
    ['less or equal', { '<=': [2, 2] }, true],
    ['greater', { '>': [3, 2] }, true],
    ['greater or equal', { '>=': [2, 2] }, true],
    ['between', { '<': [1, 2, 3] }, true],
    ['not between', { '<': [1, 3, 3] }, false],
    ['between or equal', { '<=': [1, 3, 3] }, true],
    ['descending', { '>': [3, 2, 1] }, true],
    ['descending or equal', { '>=': [3, 3, 1] }, true],
    ['strings compare', { '<': ['a', 'b'] }, true],
  ])('%s', (_label, rule, expected) => {
    expect(run(rule, roots)).toEqual(value(expected));
  });

  it.each<[string, unknown]>([
    ['a number and a string', { '<': [1, '2'] }],
    ['two booleans', { '>': [true, false] }],
    ['a list', { '<': [[1], 2] }],
    ['an object read by a path', { '===': [{ var: 'trigger.fields' }, 1] }],
    ['a list with equality', { '===': [[1], [1]] }],
    ['a list with inequality', { '!==': [[1], [1]] }],
  ])('refuses to compare %s', (_label, rule) => {
    expect(run(rule, roots)).toEqual(failed('expression_type_mismatch'));
  });
});

describe('data (C114.2, C114.4)', () => {
  it.each<[string, unknown, JsonValue]>([
    ['a member', { var: 'trigger.status' }, 'completed'],
    ['a nested member', { var: 'trigger.fields.amount' }, 12.5],
    ['an index', { var: 'trigger.tags[1]' }, 'beta'],
    ['a member of an index', { var: 'trigger.items[2].id' }, 'c'],
    ['an absent member reads as null', { var: 'trigger.absent' }, null],
    ['an index past the end reads as null', { var: 'trigger.tags[9]' }, null],
    [
      'missing lists what is absent',
      { missing: ['trigger.status', 'trigger.absent'] },
      ['trigger.absent'],
    ],
    ['missing counts null as absent', { missing: ['trigger.nothing'] }, ['trigger.nothing']],
    ['missing counts an empty string as absent', { missing: ['trigger.empty'] }, ['trigger.empty']],
    ['missing of nothing absent', { missing: ['trigger.status'] }, []],
    ['missing of an unset variable, with no error', { missing: ['vars.unset'] }, ['vars.unset']],
    ['missing_some, met', { missing_some: [1, ['trigger.status', 'trigger.absent']] }, []],
    [
      'missing_some, unmet',
      { missing_some: [2, ['trigger.status', 'trigger.absent']] },
      ['trigger.absent'],
    ],
  ])('%s', (_label, rule, expected) => {
    expect(run(rule, roots)).toEqual(value(expected));
  });

  it('reading a variable before it holds a value is its own error (C115.4)', () => {
    expect(run({ var: 'vars.unset' }, roots)).toEqual(failed('variable_unset'));
  });

  it('reads a variable that holds null as null', () => {
    expect(run({ var: 'vars.held' }, { vars: { held: null } })).toEqual(value(null));
  });

  it.each(['toString', 'hasOwnProperty', 'length'])(
    'reads no %s off the prototype of a value',
    (name) => {
      expect(run({ var: `trigger.tags.${name}` }, roots)).toEqual(value(null));
      expect(run({ var: `trigger.fields.${name}` }, roots)).toEqual(value(null));
    },
  );
});

describe('arithmetic on finite numbers (C114.2)', () => {
  it.each<[string, unknown, JsonValue]>([
    ['plus', { '+': [1, 2, 3.5] }, 6.5],
    ['minus', { '-': [5, 2] }, 3],
    ['negate', { '-': [5] }, -5],
    ['times', { '*': [2, 3, 4] }, 24],
    ['divide', { '/': [7, 2] }, 3.5],
    ['modulo', { '%': [7, 2] }, 1],
    ['min', { min: [3, 1, 2] }, 1],
    ['max', { max: [3, 1, 2] }, 3],
  ])('%s', (_label, rule, expected) => {
    expect(run(rule)).toEqual(value(expected));
  });

  it.each<[string, unknown]>([
    ['a string in a sum', { '+': [1, '2'] }],
    ['a boolean in a product', { '*': [true, 2] }],
    ['a list in a min', { min: [[1], 2] }],
  ])('never coerces %s', (_label, rule) => {
    expect(run(rule)).toEqual(failed('expression_type_mismatch'));
  });

  it.each<[string, unknown]>([
    ['a division by zero', { '/': [1, 0] }],
    ['a modulo by zero', { '%': [1, 0] }],
    ['an overflow', { '*': [1e308, 10] }],
  ])('%s is an error, never Infinity or NaN', (_label, rule) => {
    expect(run(rule)).toEqual(failed('expression_arithmetic_error'));
  });
});

describe('strings and lists (C114.2)', () => {
  it.each<[string, unknown, JsonValue]>([
    ['in a list', { in: ['vip', { var: 'trigger.tags' }] }, true],
    ['not in a list', { in: ['no', { var: 'trigger.tags' }] }, false],
    ['in a string', { in: ['am', 'example'] }, true],
    ['cat', { cat: ['a', 1, true] }, 'a1true'],
    ['substr from', { substr: ['jsonlogic', 4] }, 'logic'],
    ['substr from the end', { substr: ['jsonlogic', -5] }, 'logic'],
    ['substr with a length', { substr: ['jsonlogic', 1, 3] }, 'son'],
    ['substr with a negative length', { substr: ['jsonlogic', 4, -2] }, 'log'],
    ['merge lists and scalars', { merge: [[1, 2], 3, [4]] }, [1, 2, 3, 4]],
    ['all, true', { all: [[1, 2], { '>': [{ var: '' }, 0] }] }, true],
    ['all, false', { all: [[1, 0], { '>': [{ var: '' }, 0] }] }, false],
    ['all of nothing is false, as in JSONLogic', { all: [[], true] }, false],
    ['some', { some: [[0, 1], { '>': [{ var: '' }, 0] }] }, true],
    ['some of nothing', { some: [[], true] }, false],
    ['none', { none: [[0], { '>': [{ var: '' }, 0] }] }, true],
    ['none of nothing', { none: [[], true] }, true],
    ['filter', { filter: [[1, 2, 3], { '>': [{ var: '' }, 1] }] }, [2, 3]],
    ['map', { map: [[1, 2], { '*': [{ var: '' }, 2] }] }, [2, 4]],
    ['map over members', { map: [{ var: 'trigger.items' }, { var: 'id' }] }, ['a', 'b', 'c']],
    [
      'reduce',
      { reduce: [[1, 2, 3], { '+': [{ var: 'accumulator' }, { var: 'current' }] }, 10] },
      16,
    ],
    ['count', { count: [{ var: 'trigger.tags' }] }, 2],
    ['first', { first: [{ var: 'trigger.tags' }] }, 'vip'],
    ['last', { last: [{ var: 'trigger.tags' }] }, 'beta'],
    ['first of nothing', { first: [[]] }, null],
    ['last of nothing', { last: [[]] }, null],
    ['includes', { includes: [{ var: 'trigger.tags' }, 'beta'] }, true],
    ['does not include', { includes: [{ var: 'trigger.tags' }, 'x'] }, false],
    ['length of a string', { length: 'abc' }, 3],
    ['length of a list', { length: [{ var: 'trigger.tags' }] }, 2],
    ['trim', { trim: '  a b ' }, 'a b'],
    ['split', { split: ['a,b,c', ','] }, ['a', 'b', 'c']],
    ['replace_all', { replace_all: ['a-b-c', '-', '+'] }, 'a+b+c'],
    ['replace_all with no match', { replace_all: ['abc', 'x', 'y'] }, 'abc'],
    ['replace_chars', { replace_chars: ['(555) 01', '() ', ''] }, '55501'],
    ['email_domain', { email_domain: 'ada@example.com' }, 'example.com'],
    ['email_username', { email_username: 'ada@example.com' }, 'ada'],
    ['email_domain keeps the last at sign', { email_domain: '"a@b"@example.org' }, 'example.org'],
    ['no at sign has no domain', { email_domain: 'ada' }, null],
    ['no at sign has no username', { email_username: 'ada' }, null],
  ])('%s', (_label, rule, expected) => {
    expect(run(rule, roots)).toEqual(value(expected));
  });

  it.each<[string, unknown]>([
    ['cat of a list', { cat: [[1]] }],
    ['in a number', { in: [1, 2] }],
    ['in of a list needle', { in: [[1], [[1]]] }],
    ['substr of a number', { substr: [123, 1] }],
    ['substr from a string', { substr: ['abc', 'a'] }],
    ['merge of an object', { merge: [{ var: 'trigger.fields' }] }],
    ['all over a string', { all: ['abc', true] }],
    ['filter over a number', { filter: [1, true] }],
    ['map over an object', { map: [{ var: 'trigger.fields' }, true] }],
    ['reduce over a string', { reduce: ['abc', true, 0] }],
    ['count of a string', { count: ['abc'] }],
    ['first of a string', { first: ['abc'] }],
    ['last of a string', { last: ['abc'] }],
    ['includes in a string', { includes: ['abc', 'a'] }],
    ['length of a number', { length: [1] }],
    ['trim of a number', { trim: [1] }],
    ['split of a number', { split: [1, ','] }],
    ['split on a number', { split: ['a', 1] }],
    ['replace_all of a number', { replace_all: [1, 'a', 'b'] }],
    ['replace_all on nothing', { replace_all: ['abc', '', 'b'] }],
    ['replace_chars of a number', { replace_chars: [1, 'a', 'b'] }],
    ['email_domain of a number', { email_domain: [1] }],
  ])('refuses %s', (_label, rule) => {
    expect(run(rule, roots)).toEqual(failed('expression_type_mismatch'));
  });
});

describe('the public method chains (C114.2)', () => {
  const items = { var: 'trigger.items' };

  it.each<[string, unknown, JsonValue]>([
    ['where eq', { collect: [{ where: [items, 'kind', 'eq', 'x'] }, 'id'] }, ['a', 'c']],
    ['where ne', { collect: [{ where: [items, 'kind', 'ne', 'x'] }, 'id'] }, ['b']],
    ['where gt', { collect: [{ where: [items, 'score', 'gt', 2] }, 'id'] }, ['a']],
    ['where gte', { collect: [{ where: [items, 'score', 'gte', 2] }, 'id'] }, ['a', 'c']],
    ['where lt', { collect: [{ where: [items, 'score', 'lt', 2] }, 'id'] }, ['b']],
    ['where lte', { collect: [{ where: [items, 'score', 'lte', 2] }, 'id'] }, ['b', 'c']],
    ['where in', { collect: [{ where: [items, 'id', 'in', ['a', 'b']] }, 'id'] }, ['a', 'b']],
    ['sort_asc by key', { collect: [{ sort_asc: [items, 'score'] }, 'id'] }, ['b', 'c', 'a']],
    ['sort_desc by key', { collect: [{ sort_desc: [items, 'score'] }, 'id'] }, ['a', 'c', 'b']],
    ['sort_asc of scalars', { sort_asc: [[3, 1, 2]] }, [1, 2, 3]],
    ['sort_desc of strings', { sort_desc: [['a', 'c', 'b']] }, ['c', 'b', 'a']],
    [
      'sort keeps ties in order',
      { collect: [{ sort_asc: [items, 'kind'] }, 'id'] },
      ['a', 'c', 'b'],
    ],
    ['collect keeps a null', { collect: [{ var: 'trigger.gaps' }, 'score'] }, [1, null, null]],
    ['count of a where', { count: [{ where: [items, 'kind', 'eq', 'x'] }] }, 2],
  ])('%s', (_label, rule, expected) => {
    expect(run(rule, roots)).toEqual(value(expected));
  });

  it.each<[string, unknown]>([
    ['where over a string', { where: ['abc', 'a', 'eq', 1] }],
    ['where in a value that is no list', { where: [items, 'id', 'in', 'a'] }],
    ['sort of mixed values', { sort_asc: [[1, 'a']] }],
    ['sort of objects with no key', { sort_asc: [items] }],
    ['sort over a string', { sort_asc: ['abc'] }],
    ['collect over a string', { collect: ['abc', 'a'] }],
  ])('refuses %s', (_label, rule) => {
    expect(run(rule, roots)).toEqual(failed('expression_type_mismatch'));
  });
});

describe('convert_to (C114.2)', () => {
  it.each<[string, unknown, JsonValue]>([
    ['a number to a string', { convert_to: [1.5, 'string'] }, '1.5'],
    ['a boolean to a string', { convert_to: [true, 'string'] }, 'true'],
    ['a string to a number', { convert_to: ['12.5', 'number'] }, 12.5],
    ['a negative to a number', { convert_to: ['-3e2', 'number'] }, -300],
    ['a number stays', { convert_to: [2, 'number'] }, 2],
    ['true to a boolean', { convert_to: ['true', 'boolean'] }, true],
    ['false to a boolean', { convert_to: ['false', 'boolean'] }, false],
    ['a boolean stays', { convert_to: [false, 'boolean'] }, false],
    ['one to a boolean', { convert_to: [1, 'boolean'] }, true],
    ['zero to a boolean', { convert_to: [0, 'boolean'] }, false],
    ['a date', { convert_to: ['2026-02-28', 'date'] }, '2026-02-28'],
    ['an instant to its date', { convert_to: ['2026-02-28T23:30:00-01:00', 'date'] }, '2026-03-01'],
    [
      'a date to an instant',
      { convert_to: ['2026-02-28', 'datetime'] },
      '2026-02-28T00:00:00.000Z',
    ],
    [
      'an offset to UTC',
      { convert_to: ['2026-02-28T12:00:00+02:00', 'datetime'] },
      '2026-02-28T10:00:00.000Z',
    ],
  ])('%s', (_label, rule, expected) => {
    expect(run(rule)).toEqual(value(expected));
  });

  it.each<[string, unknown]>([
    ['text to a number', { convert_to: ['twelve', 'number'] }],
    ['an empty string to a number', { convert_to: ['', 'number'] }],
    ['a hex string to a number', { convert_to: ['0x10', 'number'] }],
    ['text to a boolean', { convert_to: ['yes', 'boolean'] }],
    ['two to a boolean', { convert_to: [2, 'boolean'] }],
    ['the thirtieth of February', { convert_to: ['2026-02-30', 'date'] }],
    ['a date with no zone', { convert_to: ['2026-02-28T12:00:00', 'datetime'] }],
    ['text to a date', { convert_to: ['soon', 'datetime'] }],
    ['a number to a date', { convert_to: [20260228, 'date'] }],
  ])('refuses %s', (_label, rule) => {
    expect(run(rule)).toEqual(failed('expression_conversion_failed'));
  });

  it('refuses a list', () => {
    expect(run({ convert_to: [[1], 'string'] })).toEqual(failed('expression_type_mismatch'));
  });
});

describe('dates (C114.2)', () => {
  it.each<[string, unknown, JsonValue]>([
    ['before', { before: ['2026-01-01', '2026-01-02'] }, true],
    ['not before', { before: ['2026-01-02', '2026-01-01'] }, false],
    ['after', { after: ['2026-01-02T00:00:00Z', '2026-01-01T23:59:59Z'] }, true],
    [
      'after, across offsets',
      { after: ['2026-01-01T12:00:00+01:00', '2026-01-01T11:30:00Z'] },
      false,
    ],
    ['days_between', { days_between: ['2026-01-01', '2026-01-11'] }, 10],
    ['days_between, backwards', { days_between: ['2026-01-11', '2026-01-01'] }, -10],
    [
      'days_between counts whole days',
      { days_between: ['2026-01-01T00:00:00Z', '2026-01-02T23:00:00Z'] },
      1,
    ],
    ['now', { now: [] }, NOW],
  ])('%s', (_label, rule, expected) => {
    expect(run(rule)).toEqual(value(expected));
  });

  it('reads the run clock, so a resume reads the same value', () => {
    expect(
      evaluateExpression(parsed({ now: [] }), scopeOf({}, '2030-01-01T00:00:00.000Z')),
    ).toEqual(value('2030-01-01T00:00:00.000Z'));
  });

  it('has no clock of its own', () => {
    expect(evaluateExpression(parsed({ now: [] }), scopeOf({}, null))).toEqual(
      failed('expression_clock_missing'),
    );
  });

  it.each<[string, unknown]>([
    ['a date that is no date', { before: ['soon', '2026-01-01'] }],
    ['a number', { after: [1, '2026-01-01'] }],
    ['a list', { days_between: [[], '2026-01-01'] }],
  ])('refuses %s', (_label, rule) => {
    expect(run(rule)).toEqual(failed('expression_conversion_failed'));
  });
});

describe('unknown is not false (C114.6)', () => {
  const matched = { var: 'steps.check.output.matched' };

  it('tests for null explicitly with === null', () => {
    expect(run({ '===': [matched, null] }, roots)).toEqual(value(true));
    expect(run({ '===': [null, matched] }, roots)).toEqual(value(true));
    expect(run({ '===': [{ var: 'steps.check.output.done' }, null] }, roots)).toEqual(value(false));
  });

  it('tests for an absent member the same way', () => {
    expect(run({ '===': [{ var: 'trigger.absent' }, null] }, roots)).toEqual(value(true));
  });

  it('defines !== with null as the negation of strict equality', () => {
    expect(run({ '!==': [matched, true] }, roots)).toEqual(value(true));
    expect(run({ '!==': [matched, null] }, roots)).toEqual(value(false));
  });

  it.each<[string, unknown]>([
    ['=== with a value', { '===': [matched, true] }],
    ['=== with a value on the right', { '===': [false, matched] }],
    ['<', { '<': [matched, 1] }],
    ['>= on the right', { '>=': [1, matched] }],
    ['between', { '<': [1, matched, 3] }],
    ['arithmetic', { '+': [1, matched] }],
    ['min', { min: [1, matched] }],
    ['in, as the needle', { in: [matched, ['a']] }],
    ['in, as the list', { in: ['a', matched] }],
    ['cat', { cat: ['a', matched] }],
    ['substr', { substr: [matched, 1] }],
    ['merge', { merge: [[1], matched] }],
    ['not', { '!': [matched] }],
    ['double not', { '!!': [matched] }],
    ['if', { if: [matched, 1, 2] }],
    ['and', { and: [true, matched] }],
    ['or', { or: [false, matched] }],
    ['count', { count: [matched] }],
    ['first', { first: [matched] }],
    ['includes, as the value', { includes: [['a'], matched] }],
    ['where, as the list', { where: [matched, 'a', 'eq', 1] }],
    ['sort', { sort_asc: [matched] }],
    ['collect', { collect: [matched, 'a'] }],
    ['length', { length: [matched] }],
    ['trim', { trim: [matched] }],
    ['split', { split: [matched, ','] }],
    ['replace_all', { replace_all: [matched, 'a', 'b'] }],
    ['replace_chars', { replace_chars: ['a', matched, 'b'] }],
    ['email_domain', { email_domain: [matched] }],
    ['convert_to', { convert_to: [matched, 'string'] }],
    ['before', { before: [matched, '2026-01-01'] }],
    ['days_between', { days_between: ['2026-01-01', matched] }],
    ['all, over a null list', { all: [matched, true] }],
    ['map, over a null list', { map: [matched, { var: '' }] }],
    ['reduce, over a null list', { reduce: [matched, true, 0] }],
    ['a null element in a map', { map: [[matched], { '+': [{ var: '' }, 1] }] }],
  ])('%s reaches the on-null of its position', (_label, rule) => {
    expect(run(rule, roots)).toEqual(unknown);
  });

  it('a condition whose answer is null is unknown, not false', () => {
    expect(decide(matched, roots)).toEqual(unknown);
  });

  it('a boolean answer is a boolean, by JSONLogic truthiness', () => {
    expect(decide({ var: 'trigger.count' }, roots)).toEqual(value(true));
    expect(decide({ var: 'trigger.empty' }, roots)).toEqual(value(false));
    expect(decide([], roots)).toEqual(value(false));
    expect(decide({ missing: ['trigger.status'] }, roots)).toEqual(value(false));
    expect(decide({ missing: ['trigger.absent'] }, roots)).toEqual(value(true));
  });

  it('passes an error through a condition', () => {
    expect(decide({ '/': [1, 0] }, roots)).toEqual(failed('expression_arithmetic_error'));
  });
});

describe('list predicates declare on-null (C114.6, V15)', () => {
  const gaps = { var: 'trigger.gaps' };
  const scored = { '>': [{ var: 'score' }, 0] };

  it.each<[string, unknown, JsonValue]>([
    ['filter exclude drops the unknown', { count: [{ filter: [gaps, scored, 'exclude'] }] }, 1],
    ['filter include keeps the unknown', { count: [{ filter: [gaps, scored, 'include'] }] }, 3],
    [
      'some include counts the unknown',
      { some: [gaps, { '>': [{ var: 'score' }, 5] }, 'include'] },
      true,
    ],
    ['some exclude does not', { some: [gaps, { '>': [{ var: 'score' }, 5] }, 'exclude'] }, false],
    ['all include passes the unknown', { all: [gaps, scored, 'include'] }, true],
    ['all exclude fails on it', { all: [gaps, scored, 'exclude'] }, false],
    [
      'none include finds the unknown',
      { none: [gaps, { '>': [{ var: 'score' }, 5] }, 'include'] },
      false,
    ],
    ['none exclude does not', { none: [gaps, { '>': [{ var: 'score' }, 5] }, 'exclude'] }, true],
    [
      'where exclude drops the unknown',
      { count: [{ where: [gaps, 'score', 'gte', 0, 'exclude'] }] },
      1,
    ],
    [
      'where include keeps the unknown',
      { count: [{ where: [gaps, 'score', 'gte', 0, 'include'] }] },
      3,
    ],
  ])('%s', (_label, rule, expected) => {
    expect(run(rule, roots)).toEqual(value(expected));
  });

  it.each<[string, unknown]>([
    ['filter', { filter: [gaps, scored, 'error'] }],
    ['some', { some: [gaps, { '>': [{ var: 'score' }, 5] }, 'error'] }],
    ['all', { all: [gaps, scored, 'error'] }],
    ['none', { none: [gaps, scored, 'error'] }],
    ['where', { where: [gaps, 'score', 'eq', 1, 'error'] }],
  ])('%s with error stops the step', (_label, rule) => {
    expect(run(rule, roots)).toEqual(failed('condition_input_null'));
  });

  it.each<[string, unknown]>([
    ['filter', { filter: [gaps, scored] }],
    ['where', { where: [gaps, 'score', 'eq', 1] }],
  ])('%s with no on-null reaches the position: an element never silently drops', (_label, rule) => {
    expect(run(rule, roots)).toEqual(unknown);
  });

  it('never turns a host error in a predicate into an answer', () => {
    expect(run({ filter: [[1], { '/': [1, 0] }, 'exclude'] })).toEqual(
      failed('expression_arithmetic_error'),
    );
  });
});

describe('the limits at run time (C114.3)', () => {
  const STRING = EXPRESSION_LIMITS['string-characters'].value;
  const ARRAY = EXPRESSION_LIMITS['array-elements'].value;
  const big = Array.from({ length: ARRAY }, (_unused, index) => index);
  const limited = failed('expression_limit_exceeded');

  it('reads a list at the limit', () => {
    expect(run({ count: [{ var: 'vars.list' }] }, { vars: { list: big } })).toEqual(value(ARRAY));
  });

  it('refuses a list past it', () => {
    expect(run({ var: 'vars.list' }, { vars: { list: [...big, 1] } })).toEqual(limited);
  });

  it('refuses a string past its limit', () => {
    expect(run({ var: 'vars.text' }, { vars: { text: 'a'.repeat(STRING + 1) } })).toEqual(limited);
  });

  it('refuses a cat that outgrows the limit', () => {
    const text = 'a'.repeat(STRING);
    expect(run({ cat: [{ var: 'vars.text' }, 'a'] }, { vars: { text } })).toEqual(limited);
  });

  it('refuses a merge that outgrows the limit', () => {
    expect(run({ merge: [{ var: 'vars.list' }, 1] }, { vars: { list: big } })).toEqual(limited);
  });

  it('refuses a replacement that outgrows the limit before building it', () => {
    const rule = { replace_all: [{ var: 'vars.text' }, 'a', { var: 'vars.text' }] };
    expect(run(rule, { vars: { text: 'a'.repeat(STRING) } })).toEqual(limited);
  });

  it('refuses a replace_chars that outgrows the limit', () => {
    const rule = { replace_chars: [{ var: 'vars.text' }, 'a', { var: 'vars.text' }] };
    expect(run(rule, { vars: { text: 'a'.repeat(STRING) } })).toEqual(limited);
  });

  it('refuses a split into more elements than a list may hold', () => {
    const rule = { split: [{ var: 'vars.text' }, ','] };
    expect(run(rule, { vars: { text: ','.repeat(ARRAY) } })).toEqual(limited);
  });

  it('counts iteration elements against the budget', () => {
    const grid = Array.from({ length: 200 }, () => big);
    const rule = { map: [{ var: 'vars.grid' }, { map: [{ var: '' }, { var: '' }] }] };
    expect(run(rule, { vars: { grid } })).toEqual(limited);
  });

  it('counts a costly search against the budget', () => {
    const search = { in: [`${'a'.repeat(STRING / 2)}b`, { var: 'text' }] };
    const list = Array.from({ length: 20 }, () => ({ text: 'a'.repeat(STRING) }));
    expect(
      run({ filter: [{ var: 'vars.one' }, search] }, { vars: { one: list.slice(0, 1) } }),
    ).toEqual(value([]));
    expect(run({ filter: [{ var: 'vars.list' }, search] }, { vars: { list } })).toEqual(limited);
  });

  it('counts deep work within the evaluation budget in bounded time', () => {
    const rule = { reduce: [{ var: 'vars.list' }, { cat: [{ var: 'accumulator' }, 'a'] }, ''] };
    const started = process.cpuUsage();
    expect(run(rule, { vars: { list: big } }).outcome).toBe('value');
    const { user } = process.cpuUsage(started);
    expect(user).toBeLessThan(2_000_000);
  });
});

describe('no host error ever escapes (C114.7)', () => {
  const OPERATORS = [
    'and',
    'or',
    '!',
    '!!',
    'if',
    '===',
    '!==',
    '==',
    '!=',
    '<',
    '<=',
    '>',
    '>=',
    '+',
    '-',
    '*',
    '/',
    '%',
    'min',
    'max',
    'in',
    'cat',
    'substr',
    'merge',
    'all',
    'some',
    'none',
    'map',
    'filter',
    'reduce',
    'count',
    'first',
    'last',
    'includes',
    'length',
    'trim',
    'split',
    'replace_all',
    'replace_chars',
    'email_domain',
    'email_username',
    'before',
    'after',
    'days_between',
    'sort_asc',
    'sort_desc',
  ] as const;

  const data = {
    vars: { a: 1, b: 'x', c: [1, 'a', null, { d: 1 }], e: { f: null }, g: null, h: true },
    trigger: JSON.parse('{"__proto__": {"x": 1}, "y": [[], {}, ""]}') as JsonValue,
  };
  const leaves: readonly unknown[] = [
    0,
    1,
    -1,
    1.5,
    1e308,
    '',
    'a',
    '2026-01-01',
    true,
    false,
    null,
    [],
    [1],
    ['a', 'b'],
    { var: 'vars.a' },
    { var: 'vars.b' },
    { var: 'vars.c' },
    { var: 'vars.e' },
    { var: 'vars.e.f' },
    { var: 'vars.g' },
    { var: 'vars.h' },
    { var: 'vars.unset' },
    { var: 'trigger.y' },
    { var: 'trigger.__proto' },
    { now: [] },
  ];

  it('answers a value, an unknown or a step error for 20,000 random conditions', () => {
    const random = seeded(8_114);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const rule = (depth: number): unknown => {
      if (depth === 0 || random() < 0.3) {
        return pick(leaves);
      }
      const arity = 1 + Math.floor(random() * 3);
      return { [pick(OPERATORS)]: Array.from({ length: arity }, () => rule(depth - 1)) };
    };
    let evaluated = 0;
    for (let index = 0; index < 20_000; index += 1) {
      const raw = rule(4);
      const expression = (() => {
        try {
          return parsed(raw);
        } catch {
          return null;
        }
      })();
      if (expression !== null) {
        const result = evaluateExpression(expression, scopeOf(data));
        expect(['value', 'null', 'error'], JSON.stringify(raw)).toContain(result.outcome);
        if (result.outcome === 'value') {
          expect(result.value, JSON.stringify(raw)).not.toBeUndefined();
        }
        evaluated += 1;
      }
    }
    expect(evaluated).toBeGreaterThan(5_000);
  });
});
