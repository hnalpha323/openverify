/**
 * A test-only evaluator with the flow's null rules (C114.6 as the flow reads it, C150.3, H03), so
 * the flow-spec tests can drive `nextPosition` without `@openverify/workflow-engine` (which depends
 * on this package). The server injects the real one, `evaluateFlowCondition` of the workflow engine.
 *
 * The rules mirrored: a path read as `null` (absent or null) stops the condition as an unknown when
 * it reaches any operator but `===` or `!==` against the literal `null`; so `{"!==": [x, "failed"]}`
 * with `x` null is unknown, never "not failed". A path in `missing` is one the scope no longer has.
 * `==` and `!=` read as `===` and `!==`.
 */
import type { ConditionEvaluator, ConditionResult, FlowScopeValues } from './next-position.js';

class Unknown extends Error {}
class Missing extends Error {
  constructor(readonly path: string) {
    super(path);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function readScopePath(scope: FlowScopeValues, path: string): unknown {
  let current: unknown = scope;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return null;
    current = current[segment];
  }
  return current ?? null;
}

const truthy = (value: unknown): boolean => {
  if (value === null) throw new Unknown();
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
};

const isNullLiteral = (node: unknown): boolean => node === null;

interface TestEvaluatorOptions {
  /** Paths the scope no longer has (a removed signal): `missing`, never `null`. */
  readonly missing?: readonly string[];
  /** Paths whose null is of the `needs_review` class (C150.3). */
  readonly reviewClass?: readonly string[];
}

export function testEvaluator(options: TestEvaluatorOptions = {}): ConditionEvaluator {
  const missing = new Set(options.missing ?? []);
  const reviewClass = new Set(options.reviewClass ?? []);
  return (condition, scope): ConditionResult => {
    const nulls: string[] = [];
    const evaluate = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(evaluate);
      if (!isRecord(node)) return node;
      const [operator] = Object.keys(node);
      const raw = operator === undefined ? undefined : node[operator];
      const args: unknown[] = Array.isArray(raw) ? raw : [raw];
      switch (operator) {
        case 'var': {
          const path = String(args[0]);
          if (missing.has(path)) throw new Missing(path);
          const value = readScopePath(scope, path);
          if (value === null) nulls.push(path);
          return value;
        }
        case '===':
        case '==':
        case '!==':
        case '!=': {
          const left = evaluate(args[0]);
          const right = evaluate(args[1]);
          const equal = left === right;
          const explicit = isNullLiteral(args[0]) || isNullLiteral(args[1]);
          if (!explicit && (left === null || right === null)) throw new Unknown();
          return operator === '===' || operator === '==' ? equal : !equal;
        }
        case '!':
          return !truthy(evaluate(args[0]));
        case '!!':
          return truthy(evaluate(args[0]));
        case 'and': {
          let value: unknown = true;
          for (const arg of args) {
            value = evaluate(arg);
            if (!truthy(value)) return value;
          }
          return value;
        }
        case 'or': {
          let value: unknown = false;
          for (const arg of args) {
            value = evaluate(arg);
            if (truthy(value)) return value;
          }
          return value;
        }
        case 'in': {
          const needle = evaluate(args[0]);
          const haystack = evaluate(args[1]);
          if (needle === null || haystack === null) throw new Unknown();
          return Array.isArray(haystack) ? haystack.includes(needle) : false;
        }
        case '<':
        case '>':
        case '<=':
        case '>=': {
          const left = evaluate(args[0]);
          const right = evaluate(args[1]);
          if (typeof left !== 'number' || typeof right !== 'number') throw new Unknown();
          if (operator === '<') return left < right;
          if (operator === '>') return left > right;
          return operator === '<=' ? left <= right : left >= right;
        }
        default:
          throw new Error(`test evaluator: no operator ${String(operator)}`);
      }
    };
    try {
      return { outcome: 'value', value: truthy(evaluate(condition)) };
    } catch (error) {
      if (error instanceof Missing) return { outcome: 'missing', path: error.path };
      if (error instanceof Unknown) {
        return {
          outcome: 'null',
          paths: nulls,
          reviewClass: nulls.some((path) => reviewClass.has(path)),
        };
      }
      throw error;
    }
  };
}
