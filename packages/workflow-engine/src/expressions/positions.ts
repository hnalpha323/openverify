/**
 * What each condition position does with an unknown (plan C114.6, V15). There is no default anywhere:
 * publish refuses a position that reads a nullable path without its `on-null`, and if a null reaches
 * one at run time anyway the step errors, so an unknown never reads as false.
 */
import type { EngineErrorCode } from '../limits/index.js';
import { evaluateCondition, type EvaluationScope } from './evaluate.js';
import type { Expression } from './parse.js';

const ROUTE_PREFIX = 'route:';

/** A route as the engine reads it: `condition` is `null` for a catch-all (C113.2). */
export interface ParsedRoute {
  readonly key: string;
  readonly condition: Expression | null;
  /** `error`, `skip-route` or `route:<key>`. */
  readonly onNull: string | null;
}

export type RouteDecision =
  | { readonly kind: 'route'; readonly key: string }
  | { readonly kind: 'else' }
  | { readonly kind: 'error'; readonly code: EngineErrorCode };

const NULL_ERROR = { kind: 'error', code: 'condition_input_null' } as const;

/** C119.5: the first route whose condition holds, in order, and `else` last. */
export function decideRoutes(
  routes: readonly ParsedRoute[],
  scope: EvaluationScope,
): RouteDecision {
  for (const { key, condition, onNull } of routes) {
    const answer: ReturnType<typeof evaluateCondition> =
      condition === null ? { outcome: 'value', value: true } : evaluateCondition(condition, scope);
    if (answer.outcome === 'error') {
      return { kind: 'error', code: answer.code };
    }
    if (answer.outcome === 'value') {
      if (answer.value) {
        return { kind: 'route', key };
      }
    } else if (onNull?.startsWith(ROUTE_PREFIX) === true) {
      return { kind: 'route', key: onNull.slice(ROUTE_PREFIX.length) };
    } else if (onNull !== 'skip-route') {
      return NULL_ERROR;
    }
  }
  return { kind: 'else' };
}

export type TriggerDecision =
  | { readonly kind: 'admit' }
  | { readonly kind: 'filtered'; readonly reason: 'criteria' | 'on-null' }
  | { readonly kind: 'error'; readonly code: EngineErrorCode };

/** C118.1, C118.4: a trigger's criteria or a recurring filter; `on-null` is `error`, `admit`, `skip`. */
export function decideTrigger(
  condition: Expression | null,
  onNull: string | null,
  scope: EvaluationScope,
): TriggerDecision {
  if (condition === null) {
    return { kind: 'admit' };
  }
  const answer = evaluateCondition(condition, scope);
  switch (answer.outcome) {
    case 'error':
      return { kind: 'error', code: answer.code };
    case 'value':
      return answer.value ? { kind: 'admit' } : { kind: 'filtered', reason: 'criteria' };
    default:
      if (onNull === 'admit') {
        return { kind: 'admit' };
      }
      return onNull === 'skip' ? { kind: 'filtered', reason: 'on-null' } : NULL_ERROR;
  }
}

export type WaitDecision =
  | { readonly kind: 'accept' }
  | { readonly kind: 'keep-waiting' }
  | { readonly kind: 'error'; readonly code: EngineErrorCode };

/** C119.3: a wait's filter; `on-null` is `error`, `keep-waiting` or `accept`. */
export function decideWaitFilter(
  condition: Expression | null,
  onNull: string | null,
  scope: EvaluationScope,
): WaitDecision {
  if (condition === null) {
    return { kind: 'accept' };
  }
  const answer = evaluateCondition(condition, scope);
  switch (answer.outcome) {
    case 'error':
      return { kind: 'error', code: answer.code };
    case 'value':
      return { kind: answer.value ? 'accept' : 'keep-waiting' };
    default:
      if (onNull === 'accept' || onNull === 'keep-waiting') {
        return { kind: onNull };
      }
      return NULL_ERROR;
  }
}

export type WhileDecision =
  | { readonly kind: 'continue' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'error'; readonly code: EngineErrorCode };

/** C119.6: a `while` loop's condition; `on-null` is `error` or `stop`. */
export function decideWhile(
  condition: Expression,
  onNull: string | null,
  scope: EvaluationScope,
): WhileDecision {
  const answer = evaluateCondition(condition, scope);
  switch (answer.outcome) {
    case 'error':
      return { kind: 'error', code: answer.code };
    case 'value':
      return { kind: answer.value ? 'continue' : 'stop' };
    default:
      return onNull === 'stop' ? { kind: 'stop' } : NULL_ERROR;
  }
}
