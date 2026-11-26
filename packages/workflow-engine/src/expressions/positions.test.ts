/** C114.6: every condition position declares what an unknown does, with no default. */
import { describe, expect, it } from 'vitest';
import { decideRoutes, decideTrigger, decideWaitFilter, decideWhile } from './positions.js';
import { parsed, scopeOf } from './testing.js';

const signal = { var: 'trigger.signals.vpn' };
const matched = { var: 'steps.list.output.matched' };
const report = { var: 'steps.report.output.has-match' };

/** Golden: a null signal, `matched: null`, and a report step that continued on error. */
const scope = scopeOf({
  trigger: { signals: { vpn: null }, status: 'completed' },
  steps: { list: { output: { matched: null } }, report: { output: null } },
});

const route = (key: string, condition: unknown, onNull: string | null = null) => ({
  key,
  condition: condition === undefined ? null : parsed(condition),
  onNull,
});

const isTrue = (rule: unknown) => ({ '===': [rule, true] });

describe('a conditional route (C114.6)', () => {
  it('takes the first route that holds', () => {
    const routes = [route('a', false), route('b', true), route('c', true)];
    expect(decideRoutes(routes, scope)).toEqual({ kind: 'route', key: 'b' });
  });

  it('takes else when none holds', () => {
    expect(decideRoutes([route('a', false)], scope)).toEqual({ kind: 'else' });
  });

  it('takes a route without a condition as a catch-all', () => {
    expect(decideRoutes([route('a', undefined)], scope)).toEqual({ kind: 'route', key: 'a' });
  });

  it.each<[string, unknown]>([
    ['a null signal', isTrue(signal)],
    ['matched: null', isTrue(matched)],
    ['a report that continued on error', isTrue(report)],
  ])('on-null error: %s stops the step', (_label, rule) => {
    expect(decideRoutes([route('a', rule, 'error')], scope)).toEqual({
      kind: 'error',
      code: 'condition_input_null',
    });
  });

  it.each<[string, unknown]>([
    ['a null signal', isTrue(signal)],
    ['matched: null', isTrue(matched)],
    ['a report that continued on error', isTrue(report)],
  ])('on-null route: %s takes the named route', (_label, rule) => {
    const routes = [route('a', rule, 'route:review'), route('review', false)];
    expect(decideRoutes(routes, scope)).toEqual({ kind: 'route', key: 'review' });
  });

  it.each<[string, unknown]>([
    ['a null signal', isTrue(signal)],
    ['matched: null', isTrue(matched)],
    ['a report that continued on error', isTrue(report)],
  ])('on-null skip-route: %s evaluates the next route', (_label, rule) => {
    const routes = [route('a', rule, 'skip-route'), route('b', true)];
    expect(decideRoutes(routes, scope)).toEqual({ kind: 'route', key: 'b' });
  });

  it('skip-route on the last route takes else, because nothing holds', () => {
    expect(decideRoutes([route('a', isTrue(matched), 'skip-route')], scope)).toEqual({
      kind: 'else',
    });
  });

  it('an unexpected null with no on-null stops the step: the unknown never reads as false', () => {
    expect(decideRoutes([route('a', isTrue(matched))], scope)).toEqual({
      kind: 'error',
      code: 'condition_input_null',
    });
  });

  it('passes on any other step error, whatever the on-null says', () => {
    const rule = { '/': [1, 0] };
    expect(decideRoutes([route('a', rule, 'skip-route')], scope)).toEqual({
      kind: 'error',
      code: 'expression_arithmetic_error',
    });
  });
});

describe('a trigger criterion or a recurring filter (C114.6, V15)', () => {
  it('admits with no criterion', () => {
    expect(decideTrigger(null, null, scope)).toEqual({ kind: 'admit' });
  });

  it('admits what holds and filters what does not', () => {
    expect(decideTrigger(parsed(true), null, scope)).toEqual({ kind: 'admit' });
    expect(decideTrigger(parsed(false), null, scope)).toEqual({
      kind: 'filtered',
      reason: 'criteria',
    });
  });

  it.each<[string, object]>([
    ['admit', { kind: 'admit' }],
    ['skip', { kind: 'filtered', reason: 'on-null' }],
    ['error', { kind: 'error', code: 'condition_input_null' }],
  ])('on-null %s', (onNull, expected) => {
    expect(decideTrigger(parsed(isTrue(signal)), onNull, scope)).toEqual(expected);
  });

  it('has no default', () => {
    expect(decideTrigger(parsed(isTrue(signal)), null, scope)).toEqual({
      kind: 'error',
      code: 'condition_input_null',
    });
  });

  it('passes on a step error', () => {
    expect(decideTrigger(parsed({ '/': [1, 0] }), 'admit', scope)).toEqual({
      kind: 'error',
      code: 'expression_arithmetic_error',
    });
  });
});

describe('a wait filter (C114.6, V15)', () => {
  it('accepts with no filter', () => {
    expect(decideWaitFilter(null, null, scope)).toEqual({ kind: 'accept' });
  });

  it('accepts what holds and keeps waiting on what does not', () => {
    expect(decideWaitFilter(parsed(true), null, scope)).toEqual({ kind: 'accept' });
    expect(decideWaitFilter(parsed(false), null, scope)).toEqual({ kind: 'keep-waiting' });
  });

  it.each<[string, object]>([
    ['accept', { kind: 'accept' }],
    ['keep-waiting', { kind: 'keep-waiting' }],
    ['error', { kind: 'error', code: 'condition_input_null' }],
  ])('on-null %s', (onNull, expected) => {
    expect(decideWaitFilter(parsed(isTrue(matched)), onNull, scope)).toEqual(expected);
  });

  it('has no default', () => {
    expect(decideWaitFilter(parsed(isTrue(matched)), null, scope)).toEqual({
      kind: 'error',
      code: 'condition_input_null',
    });
  });

  it('passes on a step error', () => {
    expect(decideWaitFilter(parsed({ '%': [1, 0] }), 'accept', scope)).toEqual({
      kind: 'error',
      code: 'expression_arithmetic_error',
    });
  });
});

describe('a while condition (C114.6, V15)', () => {
  it('continues while it holds and stops when it does not', () => {
    expect(decideWhile(parsed(true), null, scope)).toEqual({ kind: 'continue' });
    expect(decideWhile(parsed(false), null, scope)).toEqual({ kind: 'stop' });
  });

  it.each<[string, object]>([
    ['stop', { kind: 'stop' }],
    ['error', { kind: 'error', code: 'condition_input_null' }],
  ])('on-null %s', (onNull, expected) => {
    expect(decideWhile(parsed(isTrue(report)), onNull, scope)).toEqual(expected);
  });

  it('has no default', () => {
    expect(decideWhile(parsed(isTrue(report)), null, scope)).toEqual({
      kind: 'error',
      code: 'condition_input_null',
    });
  });

  it('passes on a step error', () => {
    expect(decideWhile(parsed({ '/': [1, 0] }), 'stop', scope)).toEqual({
      kind: 'error',
      code: 'expression_arithmetic_error',
    });
  });
});
