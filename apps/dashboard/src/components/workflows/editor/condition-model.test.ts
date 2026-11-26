import { WORKFLOW_TRIGGER_ON_NULL, WORKFLOW_WAIT_ON_NULL } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  clauseProblem,
  onNullChoicesOf,
  operatorsFor,
  readCondition,
  readsNullable,
  writeCondition,
  type Clause,
} from './condition-model';
import type { ScopePath } from './variable-scope';

const path = (overrides: Partial<ScopePath> & Pick<ScopePath, 'path' | 'type'>): ScopePath => ({
  options: [],
  nullable: false,
  pii: false,
  source: 'Step',
  ...overrides,
});

const MATCHED = path({ path: 'steps.check.output.matched', type: 'boolean', nullable: true });
const RISK = path({ path: 'vars.risk', type: 'number' });
const EMAIL = path({ path: 'inputs.email', type: 'string', pii: true });
const STATUS = path({ path: 'trigger.status', type: 'enum', options: ['completed', 'failed'] });

const clause = (on: string, operator: Clause['operator'], value: unknown): Clause => ({
  path: on,
  operator,
  value,
});

describe('writeCondition (C114.1, C114.2): ordered routes write the dialect', () => {
  it('writes one comparison as itself, AND inside a group and OR between groups', () => {
    expect(writeCondition([[clause('vars.risk', 'more', 3)]])).toEqual({
      '>': [{ var: 'vars.risk' }, 3],
    });
    expect(
      writeCondition([
        [clause('vars.risk', 'at-least', 3), clause('trigger.status', 'is', 'completed')],
        [clause('steps.check.output.matched', 'is', true)],
      ]),
    ).toEqual({
      or: [
        {
          and: [
            { '>=': [{ var: 'vars.risk' }, 3] },
            { '===': [{ var: 'trigger.status' }, 'completed'] },
          ],
        },
        { '===': [{ var: 'steps.check.output.matched' }, true] },
      ],
    });
  });

  it('writes is-not as strict !==, the bounds, and "is unknown" as === null', () => {
    expect(writeCondition([[clause('vars.risk', 'is-not', 1)]])).toEqual({
      '!==': [{ var: 'vars.risk' }, 1],
    });
    expect(writeCondition([[clause('vars.risk', 'less', 1)]])).toEqual({
      '<': [{ var: 'vars.risk' }, 1],
    });
    expect(writeCondition([[clause('vars.risk', 'at-most', 1)]])).toEqual({
      '<=': [{ var: 'vars.risk' }, 1],
    });
    expect(writeCondition([[clause('steps.check.output.matched', 'is-null', null)]])).toEqual({
      '===': [{ var: 'steps.check.output.matched' }, null],
    });
  });

  it('writes no condition, a catch-all route, for no clause', () => {
    expect(writeCondition([])).toBeUndefined();
    expect(writeCondition([[]])).toBeUndefined();
  });
});

describe('readCondition: the builder reads back what it wrote, and nothing else', () => {
  it('reads its own conditions back', () => {
    const groups = [
      [clause('vars.risk', 'at-least', 3), clause('trigger.status', 'is', 'completed')],
      [clause('steps.check.output.matched', 'is-null', null)],
    ];

    expect(readCondition(writeCondition(groups))).toEqual(groups);
    expect(readCondition(undefined)).toEqual([]);
  });

  it('leaves a condition written by hand to the definition', () => {
    expect(readCondition({ some: [{ var: 'vars.list' }, { '>': [{ var: '' }, 1] }] })).toBeNull();
    expect(readCondition({ '===': [1, { var: 'vars.risk' }] })).toBeNull();
    expect(readCondition({ '!': [{ var: 'vars.flag' }] })).toBeNull();
  });
});

describe('operatorsFor (C114.5, C114.6): what a path may be compared by', () => {
  it('never offers is-not on a value that can be unknown, and offers is-unknown there', () => {
    expect(operatorsFor(MATCHED)).toEqual(['is', 'is-null']);
  });

  it('offers the bounds on numbers, and is and is-not on known values', () => {
    expect(operatorsFor(RISK)).toEqual(['is', 'is-not', 'less', 'at-most', 'more', 'at-least']);
    expect(operatorsFor(STATUS)).toEqual(['is', 'is-not']);
  });

  it('never compares personal data with typed text (pii_literal_in_condition)', () => {
    expect(operatorsFor(EMAIL)).toEqual([]);
    expect(clauseProblem(clause('inputs.email', 'is', 'a@example.com'), EMAIL)).toBe(
      'Personal data is never compared with typed text (C114.5): screen it with Get List Match instead.',
    );
    expect(clauseProblem(clause('vars.risk', 'more', 3), RISK)).toBeNull();
    expect(clauseProblem(clause('vars.gone', 'more', 3), undefined)).toBe(
      'Nothing in scope here has this path.',
    );
  });
});

describe('on-null at every condition position (C114.6): every choice, never a default', () => {
  it('says whether a condition reads a value that can be unknown', () => {
    const scope = [MATCHED, RISK];

    expect(readsNullable([[clause('steps.check.output.matched', 'is', true)]], scope)).toBe(true);
    expect(readsNullable([[clause('vars.risk', 'more', 1)]], scope)).toBe(false);
  });

  it('offers a route error, skipping the route, or any other route by name', () => {
    expect(
      onNullChoicesOf(
        'route',
        [
          { key: 'hit', label: 'Hit' },
          { key: 'miss', label: 'Miss' },
        ],
        'hit',
      ).map((choice) => choice.value),
    ).toEqual(['error', 'skip-route', 'route:miss']);
  });

  it.each([
    ['trigger', WORKFLOW_TRIGGER_ON_NULL],
    ['wait', WORKFLOW_WAIT_ON_NULL],
  ] as const)('offers every %s choice the dialect has, each in words', (position, values) => {
    const choices = onNullChoicesOf(position);

    expect(choices.map((choice) => choice.value)).toEqual([...values]);
    expect(
      choices.every((choice) => choice.label.length > 0 && choice.label !== choice.value),
    ).toBe(true);
  });
});

describe('a flow branch’s on-null choices (C150.3, Workflow 9C)', () => {
  it('offers the next route, another route, else and review, never an error, and no default', () => {
    expect(
      onNullChoicesOf(
        'flow-route',
        [
          { key: 'minor', label: 'Under 18' },
          { key: 'adult', label: 'Adult' },
        ],
        'minor',
      ).map((choice) => choice.value),
    ).toEqual(['skip-route', 'route:adult', 'else', 'review']);
    expect(onNullChoicesOf('flow-route').find((choice) => choice.value === 'review')?.label).toBe(
      'Take else, and send the inquiry to review at completion',
    );
  });
});
