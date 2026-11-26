/**
 * C114.1, C114.7: json-logic-js 2.0.5, a dev-only oracle, for the operators whose semantics we keep.
 * Excluded by the plan and by decisions 5 and 6: anything it coerces (loose equality, numbers from
 * strings), `!==` with null, `log`, and the limits it does not have.
 */
import jsonLogic from 'json-logic-js';
import { describe, expect, it } from 'vitest';
import type { JsonValue } from './json.js';
import { parseCondition } from './parse.js';
import { run, seeded } from './testing.js';

const data = {
  vars: {
    a: 7,
    b: 2,
    c: 0,
    s: 'logic',
    t: '',
    l: [1, 2, 3],
    w: ['x', 'y'],
    e: [],
    yes: true,
    no: false,
  },
} satisfies Readonly<Record<string, JsonValue>>;

const oracle = (rule: unknown): unknown => jsonLogic.apply(rule, data);

const numbers: readonly unknown[] = [
  0,
  1,
  2,
  -3,
  2.5,
  { var: 'vars.a' },
  { var: 'vars.b' },
  { var: 'vars.c' },
];
const strings: readonly unknown[] = ['', 'a', 'log', { var: 'vars.s' }, { var: 'vars.t' }];
const booleans: readonly unknown[] = [true, false, { var: 'vars.yes' }, { var: 'vars.no' }];
const lists: readonly unknown[] = [
  [],
  [1, 2],
  { var: 'vars.l' },
  { var: 'vars.w' },
  { var: 'vars.e' },
];

function generator(seed: number) {
  const random = seeded(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const count = (most: number): number => 1 + Math.floor(random() * most);

  const number = (depth: number): unknown => {
    if (depth === 0 || random() < 0.4) {
      return pick(numbers);
    }
    const operator = pick(['+', '*', 'min', 'max', '-'] as const);
    if (operator === '-') {
      return { '-': [number(depth - 1), number(depth - 1)] };
    }
    return { [operator]: Array.from({ length: count(3) }, () => number(depth - 1)) };
  };

  const string = (depth: number): unknown => {
    if (depth === 0 || random() < 0.5) {
      return pick(strings);
    }
    return random() < 0.5
      ? { cat: [string(depth - 1), pick(strings)] }
      : { substr: [string(depth - 1), pick([0, 1, -1, 2]), pick([1, 2, -1])] };
  };

  const list = (depth: number): unknown => {
    if (depth === 0 || random() < 0.5) {
      return pick(lists);
    }
    return random() < 0.5
      ? { merge: [pick(lists), pick(lists), pick(numbers)] }
      : {
          filter: [pick(lists), { '!==': [{ var: '' }, pick([1, 'x'])] }],
        };
  };

  const predicate = (): unknown =>
    pick([{ var: '' }, { '!==': [{ var: '' }, 1] }, { '!': [{ var: '' }] }]);

  const boolean = (depth: number): unknown => {
    if (depth === 0) {
      return pick(booleans);
    }
    const next = depth - 1;
    switch (pick(['compare', 'order', 'between', 'logic', 'not', 'in', 'each'] as const)) {
      case 'compare':
        return { [pick(['===', '!=='])]: [number(next), number(next)] };
      case 'order':
        return { [pick(['<', '<=', '>', '>='])]: [number(next), number(next)] };
      case 'between':
        return { [pick(['<', '<='])]: [number(next), number(next), number(next)] };
      case 'logic':
        return { [pick(['and', 'or'])]: [boolean(next), boolean(next)] };
      case 'not':
        return { [pick(['!', '!!'])]: [boolean(next)] };
      case 'in':
        return random() < 0.5
          ? { in: [pick(strings), string(next)] }
          : { in: [pick(numbers), list(next)] };
      default:
        return { [pick(['all', 'some', 'none'])]: [list(next), predicate()] };
    }
  };

  const any = (depth: number): unknown => {
    switch (
      pick(['number', 'string', 'list', 'boolean', 'if', 'map', 'reduce', 'missing'] as const)
    ) {
      case 'number':
        return number(depth);
      case 'string':
        return string(depth);
      case 'list':
        return list(depth);
      case 'boolean':
        return boolean(depth);
      case 'if':
        return { if: [boolean(depth), any(depth - 1 < 0 ? 0 : depth - 1), any(0)] };
      case 'map':
        return { map: [{ var: 'vars.l' }, { '*': [{ var: '' }, pick(numbers.slice(0, 5))] }] };
      case 'reduce':
        return {
          reduce: [
            { var: 'vars.l' },
            { '+': [{ var: 'accumulator' }, { var: 'current' }] },
            pick(numbers.slice(0, 5)),
          ],
        };
      default:
        return random() < 0.5
          ? { missing: ['vars.a', 'vars.t', 'vars.zz'] }
          : { missing_some: [pick([1, 2, 3]), ['vars.a', 'vars.zz', 'vars.t']] };
    }
  };

  return any;
}

const finite = (value: unknown): boolean => typeof value !== 'number' || Number.isFinite(value);

describe('the differential test against json-logic-js (C114.7)', () => {
  it.each([
    ['var of a member', { var: 'vars.a' }, 7],
    ['the three-argument less-than', { '<': [1, 2, 3] }, true],
    ['all of nothing', { all: [[], true] }, false],
  ])('the oracle is what it was: %s', (_label, rule, expected) => {
    expect(oracle(rule)).toEqual(expected);
  });

  it('agrees on 10,000 generated conditions, none of them coercing', () => {
    const any = generator(114);
    let compared = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const rule = any(3);
      const expected = oracle(rule);
      if (finite(expected)) {
        const label = JSON.stringify(rule);
        const answer = typeof expected === 'number' ? expected + 0 : (expected ?? null);
        expect(run(rule, data), label).toEqual({ outcome: 'value', value: answer });
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(9_000);
  });

  it('agrees on array indexes in our spelling', () => {
    expect(oracle({ var: 'vars.l.1' })).toBe(2);
    expect(run({ var: 'vars.l[1]' }, data)).toEqual({ outcome: 'value', value: 2 });
  });

  it('differs where the plan says it must', () => {
    expect(oracle({ '==': [1, '1'] })).toBe(true);
    expect(run({ '==': [1, '1'] }, data)).toEqual({ outcome: 'value', value: false });
    expect(oracle({ var: 'vars.constructor' })).toBeTypeOf('function');
    expect(parseCondition({ var: 'vars.constructor' }).ok).toBe(false);
  });
});
