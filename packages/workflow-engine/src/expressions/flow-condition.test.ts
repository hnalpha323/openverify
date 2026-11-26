/**
 * C150.12 (Phase 9, review F05; flow-spec-logic's borrowed edit): typing a flow branch's condition
 * against the flow's scope description, and evaluating it over the flow's roots with the null that
 * stopped it named. Phase 8's own entry points are unchanged (their suites stay green).
 */
import { describe, expect, it } from 'vitest';
import { evaluateCondition } from './evaluate.js';
import {
  evaluateFlowCondition,
  typeFlowCondition,
  type FlowConditionPath,
} from './flow-condition.js';
import { parseCondition } from './parse.js';

const PATHS: readonly FlowConditionPath[] = [
  {
    path: 'inquiry.status',
    type: 'enum',
    options: ['pending', 'completed'],
    nullable: false,
    pii: false,
  },
  { path: 'verifications.id_card.age-years', type: 'integer', nullable: true, pii: true },
  { path: 'verifications.id_card.country-code', type: 'string', nullable: true, pii: false },
  {
    path: 'verifications.id_card.checks.id_barcode_detection.status',
    type: 'enum',
    options: ['passed', 'failed', 'not_applicable'],
    nullable: true,
    pii: false,
  },
  { path: 'signals.inquiry/bot_score', type: 'integer', nullable: true, pii: false },
  { path: 'inquiry.fields.nickname', type: 'string', nullable: true, pii: true },
  { path: 'inquiry.tags', type: 'string-array', nullable: false, pii: false },
  { path: 'session.resumed', type: 'boolean', nullable: false, pii: false },
  { path: 'verifications.id_card.birthdate', type: 'date', nullable: true, pii: true },
];

const v = (path: string): Record<string, unknown> => ({ var: path });

describe('typeFlowCondition (C150.3 over the flow scope)', () => {
  it('reads the flow’s own roots and a signal name with its slash', () => {
    const typing = typeFlowCondition({ '>': [v('signals.inquiry/bot_score'), 80] }, PATHS);
    expect(typing.issues).toEqual([]);
    expect(typing.reads).toEqual([
      { path: 'signals.inquiry/bot_score', nullable: true, pii: false, pointer: '/>/0/var' },
    ]);
    expect(typing.readsNullable).toBe(true);
    expect(typeFlowCondition({ '===': [v('inquiry.status'), 'pending'] }, PATHS)).toEqual({
      issues: [],
      reads: [{ path: 'inquiry.status', nullable: false, pii: false, pointer: '/===/0/var' }],
      readsNullable: false,
    });
  });

  it('refuses a path the description does not hold, and Phase 8’s roots', () => {
    for (const path of [
      'verifications.id_card.unknown',
      'lists.x.matched',
      'trigger.inquiry.status',
    ]) {
      expect(typeFlowCondition({ '!!': [v(path)] }, PATHS).issues.map(({ code }) => code)).toEqual([
        'path_unknown',
      ]);
    }
  });

  it('keeps Phase 8’s rules: a nullable path in a boolean position, a PII literal comparison', () => {
    expect(
      typeFlowCondition(
        { '!==': [v('verifications.id_card.checks.id_barcode_detection.status'), 'failed'] },
        PATHS,
      ).issues.map(({ code }) => code),
    ).toEqual(['nullable_in_boolean_position']);
    expect(
      typeFlowCondition({ '===': [v('inquiry.fields.nickname'), 'jo'] }, PATHS).issues.map(
        ({ code }) => code,
      ),
    ).toEqual(['pii_literal_in_condition']);
    expect(typeFlowCondition({ in: ['vip', v('inquiry.tags')] }, PATHS).issues).toEqual([]);
    expect(typeFlowCondition({ '===': [v('session.resumed'), true] }, PATHS).issues).toEqual([]);
  });

  it('reports a malformed condition as the parser does, never throwing', () => {
    expect(typeFlowCondition({ eval: ['x'] }, PATHS).issues.map(({ code }) => code)).toEqual([
      'operator_refused',
    ]);
    expect(
      typeFlowCondition({ var: ['inquiry.status', 'x'] }, PATHS).issues.map(({ code }) => code),
    ).toEqual(['var_default_refused']);
  });
});

describe('evaluateFlowCondition (C150.3, C150.4, H03)', () => {
  const roots = {
    inquiry: { status: 'pending', fields: { nickname: 'Jo' }, tags: ['vip'] },
    verifications: {
      id_card: {
        'age-years': null,
        'country-code': 'US',
        checks: { id_barcode_detection: { status: null } },
      },
    },
    signals: { 'inquiry/bot_score': 91 },
    session: { resumed: false },
  };

  it('answers a value with no null met', () => {
    expect(evaluateFlowCondition({ '>': [v('signals.inquiry/bot_score'), 80] }, roots)).toEqual({
      outcome: 'value',
      value: true,
      nullPaths: [],
    });
    expect(evaluateFlowCondition({ in: ['vip', v('inquiry.tags')] }, roots)).toMatchObject({
      outcome: 'value',
      value: true,
    });
  });

  it('names the path whose null stopped the condition', () => {
    expect(
      evaluateFlowCondition({ '<': [v('verifications.id_card.age-years'), 18] }, roots),
    ).toEqual({
      outcome: 'null',
      nullPaths: ['verifications.id_card.age-years'],
    });
    expect(
      evaluateFlowCondition({ '===': [v('verifications.id_card.unknown_attribute'), 'x'] }, roots),
    ).toEqual({ outcome: 'null', nullPaths: ['verifications.id_card.unknown_attribute'] });
  });

  it('reads a null operand of !== as unknown, never "not failed" (H03), where Phase 8 answers true', () => {
    const notFailed = {
      '!==': [v('verifications.id_card.checks.id_barcode_detection.status'), 'failed'],
    };
    expect(evaluateFlowCondition(notFailed, roots)).toEqual({
      outcome: 'null',
      nullPaths: ['verifications.id_card.checks.id_barcode_detection.status'],
    });
    const parsed = parseCondition({ '!==': [v('trigger.status'), 'failed'] });
    if (!parsed.ok) throw new Error('parse');
    expect(
      evaluateCondition(parsed.expression, { roots: { trigger: { status: null } }, now: null }),
    ).toEqual({
      outcome: 'value',
      value: true,
    });
    // The explicit test for null still answers, as in Phase 8.
    expect(
      evaluateFlowCondition({ '!==': [v('verifications.id_card.age-years'), null] }, roots),
    ).toMatchObject({ outcome: 'value', value: false });
    expect(
      evaluateFlowCondition(
        {
          '!': [
            { '===': [v('verifications.id_card.checks.id_barcode_detection.status'), 'failed'] },
          ],
        },
        roots,
      ),
    ).toMatchObject({ outcome: 'null' });
  });

  it('answers an error for a condition it cannot evaluate, with the nulls read', () => {
    expect(
      evaluateFlowCondition({ '+': [v('verifications.id_card.country-code'), 1] }, roots),
    ).toEqual({
      outcome: 'error',
      code: 'expression_type_mismatch',
      nullPaths: [],
    });
    expect(evaluateFlowCondition({ nope: [] }, roots)).toEqual({
      outcome: 'error',
      code: 'expression_evaluation_failed',
      nullPaths: [],
    });
  });
});
