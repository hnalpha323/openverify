/**
 * C148.4 (owner `flow-spec-logic`; F26): the one strict evaluator of a component's `visibleWhen`
 * and `enabledWhen`, shared by the web flow (on load and every change) and the server (over the
 * submitted values, so a hidden component's value is discarded and its `required` ignored).
 *
 * The subset: `var` over `screen.<field>` of the same screen only (no default); `===`, `!==`, `==`
 * as an alias of `===`; `!`, `!!`, `and`, `or`; `in` over a list of literals, a field's list or a
 * string. Operands are a `var`, an operator of the subset, or a literal (a string, number, boolean,
 * `null`, or a list of those). Nothing else: a rule naming another screen's field or any server
 * fact is `visibility_scope_invalid`, anything else outside the subset `visibility_rule_invalid`,
 * so no signal, verification or account fact ever reaches a client for presentation, and no rule
 * reaches `eval`, `Function` or `RegExp`.
 *
 * Evaluation: a field with no value reads `null`; equality is strict (two lists are never equal);
 * `!`, `!!`, `and`, `or` use JSONLogic truthiness (an empty list is false) and answer booleans.
 * A rule outside the subset throws `VisibilityRuleError`, never a guess.
 */
import { toJsonPointer } from '../flow.js';
import type { FlowProblem } from './schemas/problems.js';

/** A rule's bounds (ours, provisional): what a screen's own logic needs, with room. */
export const VISIBILITY_RULE_LIMITS = Object.freeze({ depth: 16, nodes: 200 });

/** What `evaluateVisibility` throws for a rule outside the strict subset (never a guess). */
export class VisibilityRuleError extends Error {
  override readonly name = 'VisibilityRuleError';
}

type Path = readonly (string | number)[];

const ARITY: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  '===': [2, 2],
  '==': [2, 2],
  '!==': [2, 2],
  '!': [1, 1],
  '!!': [1, 1],
  and: [1, Number.MAX_SAFE_INTEGER],
  or: [1, Number.MAX_SAFE_INTEGER],
  in: [2, 2],
});

const SCREEN_PATH = /^screen\.([a-z][a-z0-9_]{0,63})$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalar = (value: unknown): boolean =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

const argsOf = (raw: unknown): readonly unknown[] => (Array.isArray(raw) ? raw : [raw]);

interface Checking {
  readonly fields: ReadonlySet<string>;
  readonly problems: FlowProblem[];
  nodes: number;
}

function problem(
  checking: Checking,
  path: Path,
  code: 'visibility_scope_invalid' | 'visibility_rule_invalid',
  detail: string,
): void {
  checking.problems.push({ pointer: toJsonPointer(path), code, detail, severity: 'error' });
}

/** A literal operand: a scalar, or a list of scalars (each other member reported). */
function checkLiteral(checking: Checking, value: unknown, path: Path): void {
  if (isScalar(value)) return;
  if (!Array.isArray(value)) {
    problem(checking, path, 'visibility_rule_invalid', 'This is not a rule of the strict subset');
    return;
  }
  value.forEach((item: unknown, index) => {
    checking.nodes += 1;
    if (!isScalar(item)) {
      problem(checking, [...path, index], 'visibility_rule_invalid', 'A list holds literals only');
    }
  });
}

function checkVar(checking: Checking, raw: unknown, path: Path): void {
  const at = [...path, 'var'];
  if (typeof raw !== 'string') {
    problem(checking, at, 'visibility_rule_invalid', 'var takes one path and no default');
    return;
  }
  const field = SCREEN_PATH.exec(raw)?.[1];
  if (field === undefined || !checking.fields.has(field)) {
    problem(
      checking,
      at,
      'visibility_scope_invalid',
      'A visibility rule reads only the fields of its own screen',
    );
  }
}

function checkNode(checking: Checking, node: unknown, path: Path, depth: number): void {
  checking.nodes += 1;
  if (depth > VISIBILITY_RULE_LIMITS.depth || checking.nodes > VISIBILITY_RULE_LIMITS.nodes) {
    throw new LimitReached();
  }
  if (!isRecord(node)) {
    if (depth === 0) {
      problem(checking, path, 'visibility_rule_invalid', 'A rule is one operator node');
    } else {
      checkLiteral(checking, node, path);
    }
    return;
  }
  const keys = Object.keys(node);
  const [operator] = keys;
  if (keys.length !== 1 || operator === undefined) {
    problem(checking, path, 'visibility_rule_invalid', 'A rule node holds exactly one operator');
    return;
  }
  const raw = node[operator];
  if (operator === 'var') {
    checkVar(checking, raw, path);
    return;
  }
  const arity = Object.hasOwn(ARITY, operator) ? ARITY[operator] : undefined;
  const args = argsOf(raw);
  const at = [...path, operator];
  if (arity === undefined) {
    problem(checking, at, 'visibility_rule_invalid', 'This operator is outside the strict subset');
    return;
  }
  if (args.length < arity[0] || args.length > arity[1]) {
    problem(
      checking,
      at,
      'visibility_rule_invalid',
      'This operator has the wrong number of operands',
    );
    return;
  }
  args.forEach((arg, index) => {
    const argPath = Array.isArray(raw) ? [...at, index] : at;
    if (
      operator === 'in' &&
      index === 1 &&
      isRecord(arg) &&
      !('var' in arg && Object.keys(arg).length === 1)
    ) {
      problem(
        checking,
        argPath,
        'visibility_rule_invalid',
        'in looks in a field, a list or a string',
      );
      return;
    }
    checkNode(checking, arg, argPath, depth + 1);
  });
}

/** Thrown inside a check once a limit is passed; caught in `checkVisibilityRule` alone. */
class LimitReached extends Error {}

/** Problems of a rule that leaves the strict subset or names another screen's field. */
export function checkVisibilityRule(
  rule: Readonly<Record<string, unknown>>,
  screenFields: readonly string[],
): FlowProblem[] {
  const checking: Checking = { fields: new Set(screenFields), problems: [], nodes: 0 };
  try {
    checkNode(checking, rule, [], 0);
  } catch (error) {
    if (!(error instanceof LimitReached)) throw error;
    return [
      {
        pointer: '',
        code: 'visibility_rule_invalid',
        detail: `A visibility rule is at most ${String(VISIBILITY_RULE_LIMITS.depth)} deep and ${String(VISIBILITY_RULE_LIMITS.nodes)} nodes`,
        severity: 'error',
      },
    ];
  }
  return checking.problems;
}

const truthy = (value: unknown): boolean =>
  Array.isArray(value) ? value.length > 0 : Boolean(value);

function evaluate(node: unknown, values: Readonly<Record<string, unknown>>): unknown {
  if (!isRecord(node)) return node;
  const [operator] = Object.keys(node);
  const raw = operator === undefined ? undefined : node[operator];
  const args = argsOf(raw);
  const operand = (index: number): unknown => evaluate(args[index], values);
  switch (operator) {
    case 'var': {
      const field = typeof raw === 'string' ? SCREEN_PATH.exec(raw)?.[1] : undefined;
      if (field === undefined) throw new VisibilityRuleError('A rule reads only screen.<field>');
      return Object.hasOwn(values, field) ? (values[field] ?? null) : null;
    }
    case '===':
    case '==': {
      const left = operand(0);
      const right = operand(1);
      return isScalar(left) && isScalar(right) && left === right;
    }
    case '!==': {
      const left = operand(0);
      const right = operand(1);
      return !(isScalar(left) && isScalar(right) && left === right);
    }
    case '!':
      return !truthy(operand(0));
    case '!!':
      return truthy(operand(0));
    case 'and':
      return args.every((_arg, index) => truthy(operand(index)));
    case 'or':
      return args.some((_arg, index) => truthy(operand(index)));
    case 'in': {
      const needle = operand(0);
      const haystack = operand(1);
      if (Array.isArray(haystack)) return isScalar(needle) && haystack.includes(needle);
      return (
        typeof haystack === 'string' && typeof needle === 'string' && haystack.includes(needle)
      );
    }
    default:
      throw new VisibilityRuleError('This operator is outside the strict subset');
  }
}

/**
 * Whether a rule holds over the screen's current values (by field key); an absent rule holds.
 * Throws `VisibilityRuleError` for a rule `checkVisibilityRule` refuses.
 */
export function evaluateVisibility(
  rule: Readonly<Record<string, unknown>> | undefined,
  values: Readonly<Record<string, unknown>>,
): boolean {
  if (rule === undefined) return true;
  const fields = Object.keys(values);
  const problems = checkVisibilityRule(rule, [...fields, ...referencedFields(rule)]);
  if (problems.length > 0) {
    throw new VisibilityRuleError(problems.map(({ detail }) => detail).join('; '));
  }
  return truthy(evaluate(rule, values));
}

/** Every `screen.<field>` a rule names, so a field with no value yet still reads `null`. */
function referencedFields(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(referencedFields);
  if (!isRecord(node)) return [];
  return Object.entries(node).flatMap(([key, value]) => {
    if (key !== 'var') return referencedFields(value);
    const field = typeof value === 'string' ? SCREEN_PATH.exec(value)?.[1] : undefined;
    return field === undefined ? [] : [field];
  });
}
