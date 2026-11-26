/** C114.2, C114.3: an allowlist of operators and limits on what is stored; anything else is refused. */
import { describe, expect, it } from 'vitest';
import { parseCondition } from './parse.js';

const codes = (raw: unknown): readonly string[] => {
  const result = parseCondition(raw);
  return result.ok ? [] : result.issues.map(({ code }) => code);
};

const pointers = (raw: unknown): readonly string[] => {
  const result = parseCondition(raw);
  return result.ok ? [] : result.issues.map(({ pointer }) => pointer);
};

/** Built in a loop: a depth past the stack must be the parser's problem, not the test's. */
function nested(depth: number): unknown {
  let rule: unknown = true;
  for (let level = 0; level < depth; level += 1) {
    rule = { '!': [rule] };
  }
  return rule;
}

describe('parseCondition: what it accepts (C114.2)', () => {
  it.each<[string, unknown]>([
    ['a literal true', true],
    ['a literal number', 3],
    ['a literal string', 'a'],
    ['a literal null', null],
    ['and', { and: [true, false] }],
    ['or', { or: [true] }],
    ['not, unwrapped', { '!': true }],
    ['double not', { '!!': [1] }],
    ['if', { if: [true, 1, 2] }],
    ['strict equality', { '===': [1, 1] }],
    ['strict inequality', { '!==': [1, 2] }],
    ['the loose aliases', { '==': [1, 1] }],
    ['the loose not', { '!=': [1, 1] }],
    ['between', { '<': [1, 2, 3] }],
    ['between or equal', { '<=': [1, 2, 3] }],
    ['descending', { '>': [3, 2, 1] }],
    ['descending or equal', { '>=': [3, 2, 1] }],
    ['var', { var: 'trigger.status' }],
    ['var in an array', { var: ['trigger.status'] }],
    ['missing', { missing: ['trigger.a', 'vars.b'] }],
    ['missing, one name', { missing: 'trigger.a' }],
    ['missing, a list', { missing: [['trigger.a']] }],
    ['missing_some', { missing_some: [1, ['trigger.a', 'trigger.b']] }],
    ['plus', { '+': [1, 2, 3] }],
    ['minus', { '-': [1, 2] }],
    ['negate', { '-': [1] }],
    ['times', { '*': [1, 2] }],
    ['divide', { '/': [1, 2] }],
    ['modulo', { '%': [1, 2] }],
    ['min', { min: [1, 2] }],
    ['max', { max: [1, 2] }],
    ['in a literal list', { in: [1, [1, 2]] }],
    ['cat', { cat: ['a', 'b'] }],
    ['substr', { substr: ['abc', 1] }],
    ['substr with a length', { substr: ['abc', 1, 1] }],
    ['merge', { merge: [[1], [2]] }],
    ['all', { all: [[1], { '>': [{ var: '' }, 0] }] }],
    ['all, with its on-null', { all: [[1], { var: '' }, 'exclude'] }],
    ['some', { some: [[1], { var: 'a' }, 'include'] }],
    ['none', { none: [[1], { var: 'a' }, 'error'] }],
    ['filter', { filter: [[1], { var: '' }] }],
    ['map', { map: [[1], { var: '' }] }],
    ['reduce', { reduce: [[1], { '+': [{ var: 'accumulator' }, { var: 'current' }] }, 0] }],
    ['count', { count: [[1]] }],
    ['first', { first: [[1]] }],
    ['last', { last: [[1]] }],
    ['includes', { includes: [[1], 1] }],
    ['where', { where: [[{ a: 1 }].length, 'a', 'eq', 1] }],
    ['where, with its on-null', { where: [[], 'a.b', 'in', [1], 'exclude'] }],
    ['sort_asc', { sort_asc: [[1]] }],
    ['sort_desc by key', { sort_desc: [[], 'a'] }],
    ['collect', { collect: [[], 'a'] }],
    ['length', { length: 'abc' }],
    ['trim', { trim: 'abc' }],
    ['split', { split: ['a,b', ','] }],
    ['replace_all', { replace_all: ['a', 'a', 'b'] }],
    ['replace_chars', { replace_chars: ['a', 'ab', 'c'] }],
    ['email_domain', { email_domain: 'a@example.com' }],
    ['email_username', { email_username: 'a@example.com' }],
    ['convert_to', { convert_to: ['1', 'number'] }],
    ['before', { before: ['2026-01-01', '2026-01-02'] }],
    ['after', { after: ['2026-01-01', '2026-01-02'] }],
    ['days_between', { days_between: ['2026-01-01', '2026-01-02'] }],
    ['now', { now: [] }],
    ['the element itself', { filter: [[], { '===': [{ var: '' }, 1] }] }],
  ])('%s', (_label, raw) => {
    expect(codes(raw)).toEqual([]);
  });

  it('reads every root as written', () => {
    const roots = ['trigger.a', 'inputs.a', 'vars.a', 'steps.a.output', 'loop.item'];
    for (const root of [...roots, 'current_case.a', 'current_run.id', 'event.a']) {
      expect(codes({ var: root })).toEqual([]);
    }
  });
});

describe('parseCondition: what it refuses (C114.2)', () => {
  it.each<[string, unknown, string]>([
    ['log', { log: [1] }, 'operator_refused'],
    ['method', { method: ['a', 'toString'] }, 'operator_refused'],
    ['the JSONLogic ternary', { '?:': [true, 1, 2] }, 'operator_refused'],
    ['an unknown operator', { regex: ['a', 'b'] }, 'operator_refused'],
    ['a prototype name', { constructor: [] }, 'operator_refused'],
    ['two keys', { and: [true], or: [true] }, 'condition_malformed'],
    ['no key', {}, 'condition_malformed'],
    ['an undefined value', undefined, 'condition_malformed'],
    ['a function', () => 1, 'condition_malformed'],
    ['a NaN', Number.NaN, 'condition_malformed'],
    ['a path off the grammar', { var: 'a b' }, 'path_invalid'],
    ['the prototype chain', { var: 'trigger.__proto__.x' }, 'path_invalid'],
    ['an unknown root', { var: 'process.env' }, 'path_unknown'],
    ['a secret', { var: 'secrets.api_key' }, 'secret_placement_refused'],
    [
      'the public secret spelling',
      { var: 'current_run.environment.secrets.k' },
      'secret_placement_refused',
    ],
    ['a var default', { var: ['trigger.a', false] }, 'var_default_refused'],
    ['a var of a number', { var: 1 }, 'condition_malformed'],
    ['no argument to not', { '!': [] }, 'operator_arity'],
    ['three to equality', { '===': [1, 2, 3] }, 'operator_arity'],
    ['one to less-than', { '<': [1] }, 'operator_arity'],
    ['four to less-than', { '<': [1, 2, 3, 4] }, 'operator_arity'],
    ['an argument to now', { now: [1] }, 'operator_arity'],
    ['a where comparison off the list', { where: [[], 'a', 'matches', 1] }, 'operator_argument'],
    ['a where key that is no path', { where: [[], 'a b', 'eq', 1] }, 'operator_argument'],
    ['a where key that is no string', { where: [[], 1, 'eq', 1] }, 'operator_argument'],
    ['an on-null off the list', { filter: [[], true, 'maybe'] }, 'operator_argument'],
    ['a convert_to target off the list', { convert_to: [1, 'money'] }, 'operator_argument'],
    ['a sort key that is no path', { sort_asc: [[], 'a b'] }, 'operator_argument'],
    ['a collect key that is no string', { collect: [[], { var: 'a' }] }, 'operator_argument'],
    ['missing of a computed list', { missing: { merge: [[], []] } }, 'operator_argument'],
    ['missing_some with no count', { missing_some: ['a', ['b']] }, 'operator_argument'],
    ['missing_some with no list', { missing_some: [1, 'b'] }, 'operator_argument'],
    ['a missing path off the grammar', { missing: ['a b'] }, 'path_invalid'],
  ])('%s', (_label, raw, code) => {
    expect(codes(raw)).toContain(code);
  });

  it('points at the JSON Pointer of the operand', () => {
    expect(pointers({ and: [true, { or: [{ regex: [] }] }] })).toEqual(['/and/1/or/0']);
    expect(pointers({ '/': [1, { var: 'a b' }] })).toEqual(['/~1/1/var']);
  });

  it('collects every problem, not the first', () => {
    expect(codes({ and: [{ regex: [] }, { var: 'process.env' }] })).toEqual([
      'operator_refused',
      'path_unknown',
    ]);
  });

  it('never quotes what it was given', () => {
    const canary = 'change-me-canary-value';
    const result = parseCondition({ [canary]: [canary] });
    expect(JSON.stringify(result)).not.toContain(canary);
  });
});

describe('inside a list operator a path is relative to the element (C114.2)', () => {
  it('takes any member', () => {
    expect(codes({ some: [[], { '===': [{ var: 'status' }, 'x'] }] })).toEqual([]);
  });

  it('still refuses a path off the grammar', () => {
    expect(codes({ some: [[], { var: 'a.__proto__' }] })).toEqual(['path_invalid']);
  });

  it('holds the outer scope to its roots in the list and in a where value', () => {
    expect(codes({ some: [{ var: 'process' }, true] })).toEqual(['path_unknown']);
    expect(codes({ where: [[], 'a', 'eq', { var: 'process' }] })).toEqual(['path_unknown']);
    expect(codes({ map: [{ map: [[], { var: 'x' }] }, { var: 'y' }] })).toEqual([]);
  });
});

describe('the limits (C114.3)', () => {
  it('takes a condition at the depth limit', () => {
    expect(codes(nested(32))).toEqual([]);
  });

  it('refuses one past it', () => {
    expect(codes(nested(33))).toEqual(['expression_limit_exceeded']);
  });

  it('survives a depth that would overflow a recursive walk', () => {
    expect(codes(nested(200_000))).toEqual(['expression_limit_exceeded']);
  });

  it('takes a condition at the node limit', () => {
    expect(codes({ in: [1, Array.from({ length: 996 }, () => 1)] })).toEqual([]);
  });

  it('refuses one past the node limit', () => {
    expect(codes({ in: [1, Array.from({ length: 997 }, () => 1)] })).toEqual([
      'expression_limit_exceeded',
    ]);
  });

  it('refuses a condition past 16 KiB in UTF-8 bytes', () => {
    expect(codes({ cat: ['é'.repeat(8_200)] })).toEqual(['expression_limit_exceeded']);
    expect(codes({ cat: ['a'.repeat(16_000)] })).toEqual([]);
  });
});
