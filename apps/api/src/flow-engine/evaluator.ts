/**
 * C150.3, C150.4, C150.12 (Workflow 9A, api-flow-engine): the one evaluator of flow routes, on the
 * server only (ADR 0008). It runs `@openverify/workflow-engine`'s `evaluateFlowCondition`, never
 * Phase 8's `evaluateCondition`, which reads a null under `!==` as true (H03), and gives
 * `nextPosition` what it needs:
 * - a value;
 * - a `null` with the paths read as null and whether any is of the `needs_review` class;
 * - an evaluation error read as a `null` of the review class, so it never chooses a route;
 * - `missing` for a path the stored version names and the scope no longer has (a removed signal, a
 *   step the flow does not hold, an unknown root), which never follows `else` (C150.4).
 *
 * No operator text reaches `eval`, `Function` or a `RegExp` (rule 18): the dialect is data.
 */
import { SIGNAL_REGISTRY } from '@openverify/core';
import type { ConditionEvaluator, ConditionResult, FlowV2 } from '@openverify/flow-spec';
import { evaluateFlowCondition } from '@openverify/workflow-engine';
import type { AssembledScope } from './scope.js';

const ROOTS: ReadonlySet<string> = new Set([
  'inquiry',
  'verifications',
  'account',
  'device',
  'signals',
  'lists',
  'workflows',
  'session',
]);

/** Every `var` path a condition reads, in order. */
export function conditionPaths(condition: unknown): string[] {
  const paths: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object' || node === null) {
      return;
    }
    for (const [operator, argument] of Object.entries(node)) {
      if (operator === 'var') {
        const path: unknown = Array.isArray(argument) ? (argument as unknown[])[0] : argument;
        if (typeof path === 'string' && !paths.includes(path)) {
          paths.push(path);
        }
      } else {
        visit(argument);
      }
    }
  };
  visit(condition);
  return paths;
}

const FLOW_PROVISIONAL: ReadonlySet<string> = new Set(
  SIGNAL_REGISTRY.filter((signal) => signal.flowProvisional).map((signal) => signal.name),
);

/** Whether the scope the flow is walked over still has `path` (C150.4). */
export function scopeHasPath(flow: FlowV2, path: string): boolean {
  const [root, second] = path.split('.');
  if (root === undefined || !ROOTS.has(root)) {
    return false;
  }
  if (root === 'signals') {
    return second !== undefined && FLOW_PROVISIONAL.has(path.slice('signals.'.length));
  }
  if (root === 'verifications' || root === 'workflows') {
    return second !== undefined && flow.steps.some((step) => step.id === second);
  }
  return true;
}

/** The evaluator `nextPosition` takes, over `scope`, for the flow `flow`. */
export function flowConditionEvaluator(flow: FlowV2, scope: AssembledScope): ConditionEvaluator {
  return (condition): ConditionResult => {
    const missing = conditionPaths(condition).find((path) => !scopeHasPath(flow, path));
    if (missing !== undefined) {
      return { outcome: 'missing', path: missing };
    }
    const result = evaluateFlowCondition(condition, scope.values);
    switch (result.outcome) {
      case 'value':
        return { outcome: 'value', value: result.value };
      case 'null':
        return {
          outcome: 'null',
          paths: result.nullPaths,
          reviewClass: result.nullPaths.some((path) => scope.reviewClassPaths.has(path)),
        };
      case 'error':
        return { outcome: 'null', paths: result.nullPaths, reviewClass: true };
    }
  };
}
