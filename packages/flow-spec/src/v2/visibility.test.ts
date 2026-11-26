import { describe, expect, it } from 'vitest';
import {
  VISIBILITY_RULE_LIMITS,
  VisibilityRuleError,
  checkVisibilityRule,
  evaluateVisibility,
} from './visibility.js';
import { v } from './test-flows.js';

const FIELDS = ['country', 'has_middle_name', 'interests', 'age'];

describe('checkVisibilityRule (C148.4)', () => {
  it('accepts the strict subset over the screen’s own fields', () => {
    const rules = [
      { '===': [v('screen.country'), 'US'] },
      { '==': [v('screen.country'), 'US'] },
      { '!==': [v('screen.country'), null] },
      { '!': [v('screen.has_middle_name')] },
      { '!!': v('screen.has_middle_name') },
      { and: [{ '!!': [v('screen.has_middle_name')] }, { '===': [v('screen.age'), 18] }] },
      {
        or: [{ in: ['music', v('screen.interests')] }, { in: [v('screen.country'), ['US', 'CA']] }],
      },
      { '===': [true, v('screen.has_middle_name')] },
    ];
    for (const rule of rules) {
      expect(checkVisibilityRule(rule, FIELDS), JSON.stringify(rule)).toEqual([]);
    }
  });

  it('refuses another screen’s field and every server fact, by pointer', () => {
    expect(checkVisibilityRule({ '===': [v('screen.other_field'), 'x'] }, FIELDS)).toEqual([
      {
        pointer: '/===/0/var',
        code: 'visibility_scope_invalid',
        detail: 'A visibility rule reads only the fields of its own screen',
        severity: 'error',
      },
    ]);
    for (const path of [
      'verifications.id_card.status',
      'signals.inquiry/bot_score',
      'inquiry.fields.country',
      'screen',
      'screen.country.length',
      'country',
    ]) {
      const problems = checkVisibilityRule({ and: [true, { '!!': v(path) }] }, FIELDS);
      expect(problems.map(({ code, pointer }) => [code, pointer])).toEqual([
        ['visibility_scope_invalid', '/and/1/!!/var'],
      ]);
    }
  });

  it('refuses every operator outside the subset and every malformed node', () => {
    const cases: [unknown, string][] = [
      [{ '!=': [v('screen.age'), 1] }, '/!='],
      [{ '<': [v('screen.age'), 18] }, '/<'],
      [{ if: [true, true, false] }, '/if'],
      [{ var: ['screen.age', 3] }, '/var'],
      [{ var: 7 }, '/var'],
      [{ '===': [v('screen.age')] }, '/==='],
      [{ '!': [true, false] }, '/!'],
      [{ and: [] }, '/and'],
      [{ in: [v('screen.age'), { '!!': true }] }, '/in/1'],
      [{ '===': [{ a: 1 }, 1] }, '/===/0/a'],
      [{ '===': [v('screen.age'), 1], '!': [true] }, ''],
      [[true], ''],
      ['plain', ''],
      [{ in: ['a', [v('screen.age')]] }, '/in/1/0'],
    ];
    for (const [rule, pointer] of cases) {
      const problems = checkVisibilityRule(rule as Record<string, unknown>, FIELDS);
      expect(
        problems.map((problem) => [problem.code, problem.pointer]),
        JSON.stringify(rule),
      ).toEqual([['visibility_rule_invalid', pointer]]);
    }
  });

  it('refuses a rule past its depth or size limit', () => {
    let deep: unknown = { '!!': v('screen.age') };
    for (let level = 0; level < VISIBILITY_RULE_LIMITS.depth; level += 1) deep = { '!': [deep] };
    expect(
      checkVisibilityRule(deep as Record<string, unknown>, FIELDS).map(({ code }) => code),
    ).toContain('visibility_rule_invalid');
    const wide = { or: Array.from({ length: VISIBILITY_RULE_LIMITS.nodes }, () => true) };
    expect(checkVisibilityRule(wide, FIELDS).map(({ code }) => code)).toEqual([
      'visibility_rule_invalid',
    ]);
  });
});

describe('evaluateVisibility (C148.4, the one strict evaluator)', () => {
  const values = { country: 'US', has_middle_name: false, interests: ['music', 'art'], age: 0 };

  it('holds for an absent rule', () => {
    expect(evaluateVisibility(undefined, {})).toBe(true);
  });

  it('compares strictly, with == read as ===', () => {
    expect(evaluateVisibility({ '===': [v('screen.country'), 'US'] }, values)).toBe(true);
    expect(evaluateVisibility({ '==': [v('screen.age'), '0'] }, values)).toBe(false);
    expect(evaluateVisibility({ '==': [v('screen.age'), 0] }, values)).toBe(true);
    expect(evaluateVisibility({ '!==': [v('screen.country'), 'CA'] }, values)).toBe(true);
    expect(evaluateVisibility({ '===': [v('screen.interests'), ['music', 'art']] }, values)).toBe(
      false,
    );
  });

  it('reads a field with no value as null, never as another field', () => {
    expect(evaluateVisibility({ '===': [v('screen.missing'), null] }, values)).toBe(true);
    expect(evaluateVisibility({ '!': [v('screen.missing')] }, values)).toBe(true);
    expect(evaluateVisibility({ '===': [v('screen.constructor'), null] }, values)).toBe(true);
  });

  it('uses JSONLogic truthiness for !, !!, and, or (an empty list is false)', () => {
    expect(evaluateVisibility({ '!!': [v('screen.has_middle_name')] }, values)).toBe(false);
    expect(evaluateVisibility({ '!': v('screen.age') }, values)).toBe(true);
    expect(evaluateVisibility({ '!!': [[]] }, values)).toBe(false);
    expect(evaluateVisibility({ '!!': [['x']] }, values)).toBe(true);
    expect(evaluateVisibility({ and: [true, v('screen.country')] }, values)).toBe(true);
    expect(evaluateVisibility({ and: [v('screen.age'), true] }, values)).toBe(false);
    expect(evaluateVisibility({ or: [false, '', v('screen.country')] }, values)).toBe(true);
    expect(evaluateVisibility({ or: [false, 0] }, values)).toBe(false);
  });

  it('tests membership with in, over a list or inside a string', () => {
    expect(evaluateVisibility({ in: ['music', v('screen.interests')] }, values)).toBe(true);
    expect(evaluateVisibility({ in: ['sport', v('screen.interests')] }, values)).toBe(false);
    expect(evaluateVisibility({ in: [v('screen.country'), ['US', 'CA']] }, values)).toBe(true);
    expect(evaluateVisibility({ in: ['S', v('screen.country')] }, values)).toBe(true);
    expect(evaluateVisibility({ in: [1, v('screen.country')] }, values)).toBe(false);
    expect(evaluateVisibility({ in: ['x', v('screen.missing')] }, values)).toBe(false);
  });

  it('throws on a rule outside the subset, so no client or server guesses', () => {
    expect(() => evaluateVisibility({ '<': [v('screen.age'), 1] }, values)).toThrow(
      VisibilityRuleError,
    );
    expect(() => evaluateVisibility({ '===': [v('inquiry.status'), 'x'] }, values)).toThrow(
      VisibilityRuleError,
    );
  });
});
