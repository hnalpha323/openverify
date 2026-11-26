/**
 * The evaluator of our JSONLogic dialect (plan C114). It walks a parsed tree and answers a value, an
 * unknown, or a step error, and nothing else: no host error ever leaves it (C114.7), and nothing it
 * reads becomes code (C113.8).
 *
 * Three rules set it apart from JSONLogic, each on purpose:
 * - no coercion: an operator takes the types it states, and anything else is a step error;
 * - unknown is not false (C114.6, H04): a null that reaches an operator other than the explicit
 *   `=== null`, `missing` and `missing_some` stops the evaluation as an unknown, and the position that
 *   holds the condition decides what happens, by its declared `on-null`;
 * - a budget (C114.3): every operator and list element is charged, and a costly string operation by
 *   its size, so a condition's time is bounded by what it is allowed, never by what it reads.
 *
 * The evaluation log lives in `positions.ts`'s callers: this file never logs, because what it holds
 * are run values (C117.11).
 */
import { Temporal } from 'temporal-polyfill';
import { EXPRESSION_LIMITS, type EngineErrorCode } from '../limits/index.js';
import { isJsonRecord, type JsonValue } from './json.js';
import type { Expression, OperationExpression, PredicateOnNull, WhereComparison } from './parse.js';
import { readRootPath, readSegments, type ParsedPath } from './paths.js';

export interface EvaluationScope {
  /** The roots of C114.4. An absent root reads as null. */
  readonly roots: Readonly<Record<string, JsonValue | undefined>>;
  /** The run's clock, recorded on the step so a resume reads the same value. */
  readonly now: string | null;
}

export type Evaluation<Value = JsonValue> =
  | { readonly outcome: 'value'; readonly value: Value }
  | { readonly outcome: 'null' }
  | { readonly outcome: 'error'; readonly code: EngineErrorCode };

/** How a walk stops early. Caught in this file alone. */
class Halt extends Error {
  override readonly name = 'Halt';

  constructor(readonly result: Exclude<Evaluation, { outcome: 'value' }>) {
    super('halt');
  }
}

const UNKNOWN = new Halt({ outcome: 'null' });

const stop = (code: EngineErrorCode): never => {
  throw new Halt({ outcome: 'error', code });
};

const unknown = (): never => {
  throw UNKNOWN;
};

const STRING_LIMIT = EXPRESSION_LIMITS['string-characters'].value;
const ARRAY_LIMIT = EXPRESSION_LIMITS['array-elements'].value;
const BUDGET = EXPRESSION_LIMITS.evaluations.value;

/** Characters of linear string work one evaluation pays for. */
const LINEAR_CHARGE = 256;
/** Character comparisons of a substring search one evaluation pays for. */
const SEARCH_CHARGE = 65_536;

interface Walk {
  readonly scope: EvaluationScope;
  spent: number;
  /** C150.12 (Phase 9): the root paths read as null, kept only by the flow's entry point. */
  readonly nulls?: string[];
  /** C150.12 (Phase 9, H03): a null operand of `!==` is unknown, as it is of `===`. */
  readonly flow?: boolean;
}

/** What a path is read against: the roots, or the element of a list operator. */
type Frame = { readonly value: JsonValue } | null;

function charge(walk: Walk, units: number): void {
  walk.spent += units;
  if (walk.spent > BUDGET) {
    stop('expression_limit_exceeded');
  }
}

const chargeText = (walk: Walk, length: number): void => {
  charge(walk, 1 + Math.floor(length / LINEAR_CHARGE));
};

const chargeSearch = (walk: Walk, haystack: number, needle: number): void => {
  charge(walk, 1 + Math.floor((haystack * needle) / SEARCH_CHARGE));
};

function bounded<Value extends JsonValue>(value: Value): Value {
  if (typeof value === 'string' && value.length > STRING_LIMIT) {
    stop('expression_limit_exceeded');
  }
  if (Array.isArray(value) && value.length > ARRAY_LIMIT) {
    stop('expression_limit_exceeded');
  }
  return value;
}

/** JSONLogic's truthiness, with an unknown stopped at the door. */
function truthy(value: JsonValue): boolean {
  if (value === null) {
    return unknown();
  }
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

const expectText = (value: JsonValue): string => {
  if (value === null) {
    return unknown();
  }
  return typeof value === 'string' ? value : stop('expression_type_mismatch');
};

const expectNumber = (value: JsonValue): number => {
  if (value === null) {
    return unknown();
  }
  return typeof value === 'number' ? value : stop('expression_type_mismatch');
};

const expectList = (value: JsonValue): readonly JsonValue[] => {
  if (value === null) {
    return unknown();
  }
  return Array.isArray(value) ? value : stop('expression_type_mismatch');
};

/** JSON has no negative zero, and a sealed value must read back as it was computed. */
const finite = (value: number): number =>
  Number.isFinite(value) ? value + 0 : stop('expression_arithmetic_error');

function readVariable(walk: Walk, frame: Frame, path: ParsedPath): JsonValue {
  if (frame !== null) {
    return bounded(readSegments(frame.value, path.segments) ?? null);
  }
  const read = readRootPath(walk.scope.roots, path);
  if (read.kind === 'unset') {
    return stop('variable_unset');
  }
  const value = bounded(read.value ?? null);
  if (value === null && walk.nulls !== undefined && !walk.nulls.includes(path.text)) {
    walk.nulls.push(path.text);
  }
  return value;
}

function isMissing(walk: Walk, frame: Frame, path: ParsedPath): boolean {
  const base = frame === null ? (walk.scope.roots as JsonValue) : frame.value;
  const value = readSegments(base, path.segments) ?? null;
  return value === null || value === '';
}

const isScalar = (value: JsonValue): boolean => typeof value !== 'object' || value === null;

/** `=== null` is the one comparison that reads an unknown as an answer (C114.6). */
const isNullLiteral = (expression: Expression | undefined): boolean =>
  expression?.kind === 'literal' && expression.value === null;

function strictlyEqual(left: JsonValue, right: JsonValue): boolean {
  if (!isScalar(left) || !isScalar(right)) {
    return stop('expression_type_mismatch');
  }
  return left === right;
}

function ordered(left: JsonValue, right: JsonValue, holds: (order: number) => boolean): boolean {
  if (left === null || right === null) {
    return unknown();
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return holds(left - right);
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return holds(left < right ? -1 : left > right ? 1 : 0);
  }
  return stop('expression_type_mismatch');
}

const ORDERS: Readonly<Record<string, (order: number) => boolean>> = {
  '<': (order) => order < 0,
  '<=': (order) => order <= 0,
  '>': (order) => order > 0,
  '>=': (order) => order >= 0,
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
// eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
const NUMBER = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
const DAY_MILLISECONDS = 86_400_000;
const ISO_DATE_LENGTH = 10;

/** C114.2: ISO 8601 instants and dates, as epoch milliseconds, or a step error. */
function instantOf(value: JsonValue): number {
  if (value === null) {
    return unknown();
  }
  if (typeof value !== 'string') {
    return stop('expression_conversion_failed');
  }
  try {
    if (INSTANT.test(value)) {
      return Temporal.Instant.from(value).epochMilliseconds;
    }
    if (DATE.test(value)) {
      const date = Temporal.PlainDate.from(value, { overflow: 'reject' });
      return date.toZonedDateTime('UTC').epochMilliseconds;
    }
  } catch {
    return stop('expression_conversion_failed');
  }
  return stop('expression_conversion_failed');
}

function convertToNumber(value: JsonValue): number {
  if (typeof value === 'number') {
    return value;
  }
  return typeof value === 'string' && NUMBER.test(value)
    ? finite(Number(value))
    : stop('expression_conversion_failed');
}

function convertToBoolean(value: JsonValue): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true' || value === 1) {
    return true;
  }
  return value === 'false' || value === 0 ? false : stop('expression_conversion_failed');
}

function convert(value: JsonValue, target: OperationExpression['target']): JsonValue {
  if (value === null) {
    return unknown();
  }
  if (typeof value === 'object') {
    return stop('expression_type_mismatch');
  }
  switch (target) {
    case 'number':
      return convertToNumber(value);
    case 'boolean':
      return convertToBoolean(value);
    case 'date':
      return new Date(instantOf(value)).toISOString().slice(0, ISO_DATE_LENGTH);
    case 'datetime':
      return new Date(instantOf(value)).toISOString();
    default:
      return String(value);
  }
}

const compareWhere: Readonly<
  Record<Exclude<WhereComparison, 'eq' | 'ne' | 'in'>, (order: number) => boolean>
> = {
  gt: (order) => order > 0,
  gte: (order) => order >= 0,
  lt: (order) => order < 0,
  lte: (order) => order <= 0,
};

function whereHolds(comparison: WhereComparison, member: JsonValue, target: JsonValue): boolean {
  switch (comparison) {
    case 'eq':
      return strictlyEqual(member, target);
    case 'ne':
      return !strictlyEqual(member, target);
    case 'in':
      return expectList(target).includes(member);
    default:
      return ordered(member, target, compareWhere[comparison]);
  }
}

/** What a list predicate does with an element it cannot read: C114.6's `on-null`. */
function underOnNull(onNull: PredicateOnNull | undefined, read: () => boolean): boolean {
  try {
    return read();
  } catch (error) {
    if (error !== UNKNOWN || onNull === undefined) {
      throw error;
    }
    return onNull === 'error' ? stop('condition_input_null') : onNull === 'include';
  }
}

const NOTHING: Expression = { kind: 'literal', value: null, pointer: '' };

/** The parser checked the arity, so this reads a real argument. */
const argument = (expression: OperationExpression, index: number): Expression =>
  expression.args[index] ?? NOTHING;

const EMPTY_KEY: ParsedPath = { text: '', segments: [] };

function walkArgs(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue[] {
  return expression.args.map((arg) => evaluate(walk, frame, arg));
}

function evaluatePredicate(
  walk: Walk,
  frame: Frame,
  expression: OperationExpression,
): readonly boolean[] {
  const list = expectList(evaluate(walk, frame, argument(expression, 0)));
  const body = argument(expression, 1);
  const answers: boolean[] = [];
  for (const value of list) {
    charge(walk, 1);
    answers.push(underOnNull(expression.onNull, () => truthy(evaluate(walk, { value }, body))));
  }
  return answers;
}

function evaluateFilter(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const list = expectList(evaluate(walk, frame, argument(expression, 0)));
  const body = argument(expression, 1);
  return list.filter((value) => {
    charge(walk, 1);
    return underOnNull(expression.onNull, () => truthy(evaluate(walk, { value }, body)));
  });
}

function evaluateWhere(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const [listed, target] = walkArgs(walk, frame, expression) as [JsonValue, JsonValue];
  const { segments } = expression.key ?? EMPTY_KEY;
  const comparison = expression.comparison ?? 'eq';
  return expectList(listed).filter((element) => {
    charge(walk, 1);
    return underOnNull(expression.onNull, () => {
      const member = readSegments(element, segments) ?? null;
      return member === null ? unknown() : whereHolds(comparison, member, target);
    });
  });
}

function evaluateSort(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const list = expectList(evaluate(walk, frame, argument(expression, 0)));
  const segments = expression.key?.segments ?? [];
  charge(walk, list.length * Math.ceil(Math.log2(list.length + 1)));
  const keyed = list.map((element, index) => {
    const key = readSegments(element, segments) ?? null;
    if (key === null) {
      return unknown();
    }
    return typeof key === 'object' ? stop('expression_type_mismatch') : { element, index, key };
  });
  const direction = expression.operator === 'sort_desc' ? -1 : 1;
  const sorted = keyed.toSorted((left, right) => {
    if (typeof left.key !== typeof right.key || typeof left.key === 'boolean') {
      return stop('expression_type_mismatch');
    }
    const order = ordered(left.key, right.key, (difference) => difference !== 0)
      ? direction * (left.key < right.key ? -1 : 1)
      : 0;
    return order === 0 ? left.index - right.index : order;
  });
  return sorted.map(({ element }) => element);
}

function evaluateCollect(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const list = expectList(evaluate(walk, frame, argument(expression, 0)));
  const { segments } = expression.key ?? EMPTY_KEY;
  return list.map((element) => {
    charge(walk, 1);
    return readSegments(element, segments) ?? null;
  });
}

function evaluateReduce(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const list = expectList(evaluate(walk, frame, argument(expression, 0)));
  const body = argument(expression, 1);
  let accumulator = evaluate(walk, frame, argument(expression, 2));
  for (const current of list) {
    charge(walk, 1);
    accumulator = evaluate(walk, { value: { accumulator, current } }, body);
  }
  return accumulator;
}

function evaluateMerge(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const merged: JsonValue[] = [];
  for (const value of walkArgs(walk, frame, expression)) {
    if (value === null) {
      return unknown();
    }
    if (isJsonRecord(value)) {
      return stop('expression_type_mismatch');
    }
    charge(walk, 1);
    for (const item of Array.isArray(value) ? value : [value]) {
      merged.push(item);
      bounded(merged);
    }
  }
  return merged;
}

function evaluateIn(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const [needle, haystack] = walkArgs(walk, frame, expression) as [JsonValue, JsonValue];
  if (needle === null || haystack === null) {
    return unknown();
  }
  if (typeof haystack === 'string') {
    const text = expectText(needle);
    chargeSearch(walk, haystack.length, text.length);
    // JSONLogic reads an empty string as nothing to search.
    return haystack !== '' && haystack.includes(text);
  }
  if (!Array.isArray(haystack) || !isScalar(needle)) {
    return stop('expression_type_mismatch');
  }
  charge(walk, haystack.length);
  return haystack.includes(needle);
}

function evaluateCat(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  let text = '';
  for (const value of walkArgs(walk, frame, expression)) {
    if (value === null) {
      return unknown();
    }
    if (typeof value === 'object') {
      return stop('expression_type_mismatch');
    }
    text = bounded(text + String(value));
  }
  chargeText(walk, text.length);
  return text;
}

/** JSONLogic's `substr`, with its negative length. */
function evaluateSubstr(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const [source, start, length] = walkArgs(walk, frame, expression) as [
    JsonValue,
    JsonValue,
    JsonValue | undefined,
  ];
  const text = expectText(source);
  const from = expectNumber(start);
  chargeText(walk, text.length);
  const begin = from < 0 ? Math.max(text.length + from, 0) : from;
  if (length === undefined) {
    return text.slice(begin);
  }
  const span = expectNumber(length);
  const rest = text.slice(begin);
  return span < 0 ? rest.slice(0, Math.max(rest.length + span, 0)) : rest.slice(0, span);
}

function evaluateReplaceAll(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const [source, from, to] = walkArgs(walk, frame, expression).map(expectText) as [
    string,
    string,
    string,
  ];
  if (from === '') {
    return stop('expression_type_mismatch');
  }
  chargeSearch(walk, source.length, from.length);
  const parts = source.split(from);
  const size = source.length + (parts.length - 1) * (to.length - from.length);
  return size > STRING_LIMIT ? stop('expression_limit_exceeded') : parts.join(to);
}

function evaluateReplaceChars(
  walk: Walk,
  frame: Frame,
  expression: OperationExpression,
): JsonValue {
  const [source, chars, to] = walkArgs(walk, frame, expression).map(expectText) as [
    string,
    string,
    string,
  ];
  chargeSearch(walk, source.length, chars.length);
  const set = new Set(chars);
  let text = '';
  for (const character of source) {
    text += set.has(character) ? to : character;
    bounded(text);
  }
  return text;
}

function evaluateSplit(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const [source, separator] = walkArgs(walk, frame, expression).map(expectText) as [string, string];
  chargeSearch(walk, source.length, Math.max(separator.length, 1));
  return bounded(source.split(separator));
}

function evaluateEmail(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const text = expectText(evaluate(walk, frame, argument(expression, 0)));
  const at = text.lastIndexOf('@');
  if (at === -1) {
    return null;
  }
  return expression.operator === 'email_domain' ? text.slice(at + 1) : text.slice(0, at);
}

function evaluateLength(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const value = evaluate(walk, frame, argument(expression, 0));
  if (value === null) {
    return unknown();
  }
  return typeof value === 'string' || Array.isArray(value)
    ? value.length
    : stop('expression_type_mismatch');
}

function evaluateIf(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const { args } = expression;
  let index = 0;
  for (; index < args.length - 1; index += 2) {
    if (truthy(evaluate(walk, frame, argument(expression, index)))) {
      return evaluate(walk, frame, argument(expression, index + 1));
    }
  }
  return index === args.length - 1 ? evaluate(walk, frame, argument(expression, index)) : null;
}

function evaluateAnd(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  let value: JsonValue = null;
  for (const arg of expression.args) {
    value = evaluate(walk, frame, arg);
    if (!truthy(value)) {
      return value;
    }
  }
  return value;
}

function evaluateOr(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  let value: JsonValue = null;
  for (const arg of expression.args) {
    value = evaluate(walk, frame, arg);
    if (truthy(value)) {
      return value;
    }
  }
  return value;
}

function evaluateEquals(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const [left, right] = walkArgs(walk, frame, expression) as [JsonValue, JsonValue];
  if (isNullLiteral(expression.args[0]) || isNullLiteral(expression.args[1])) {
    return left === right;
  }
  return left === null || right === null ? unknown() : strictlyEqual(left, right);
}

function evaluateOrder(walk: Walk, frame: Frame, expression: OperationExpression): JsonValue {
  const values = walkArgs(walk, frame, expression);
  const holds = ORDERS[expression.operator] ?? (() => false);
  return values.slice(1).every((value, index) => ordered(values[index] as JsonValue, value, holds));
}

function evaluateFold(
  walk: Walk,
  frame: Frame,
  expression: OperationExpression,
  fold: (numbers: readonly number[]) => number,
): JsonValue {
  return finite(fold(walkArgs(walk, frame, expression).map(expectNumber)));
}

function evaluateDivision(
  walk: Walk,
  frame: Frame,
  expression: OperationExpression,
  divide: (left: number, right: number) => number,
): JsonValue {
  const [left, right] = walkArgs(walk, frame, expression).map(expectNumber) as [number, number];
  return right === 0 ? stop('expression_arithmetic_error') : finite(divide(left, right));
}

type Operation = (walk: Walk, frame: Frame, expression: OperationExpression) => JsonValue;

const sum = (numbers: readonly number[]): number =>
  numbers.reduce((left, right) => left + right, 0);

const OPERATIONS: Readonly<Record<string, Operation>> = {
  and: evaluateAnd,
  or: evaluateOr,
  if: evaluateIf,
  '!': (walk, frame, expression) => !truthy(evaluate(walk, frame, argument(expression, 0))),
  '!!': (walk, frame, expression) => truthy(evaluate(walk, frame, argument(expression, 0))),
  '===': evaluateEquals,
  '!==': (walk, frame, expression) => {
    const [left, right] = walkArgs(walk, frame, expression) as [JsonValue, JsonValue];
    const explicit = isNullLiteral(expression.args[0]) || isNullLiteral(expression.args[1]);
    if (walk.flow === true && !explicit && (left === null || right === null)) {
      return unknown();
    }
    return !strictlyEqual(left, right);
  },
  '<': evaluateOrder,
  '<=': evaluateOrder,
  '>': evaluateOrder,
  '>=': evaluateOrder,
  '+': (walk, frame, expression) => evaluateFold(walk, frame, expression, sum),
  '*': (walk, frame, expression) =>
    evaluateFold(walk, frame, expression, (numbers) =>
      numbers.reduce((left, right) => left * right, 1),
    ),
  '-': (walk, frame, expression) =>
    evaluateFold(walk, frame, expression, ([left = 0, right]) =>
      right === undefined ? -left : left - right,
    ),
  '/': (walk, frame, expression) =>
    evaluateDivision(walk, frame, expression, (left, right) => left / right),
  '%': (walk, frame, expression) =>
    evaluateDivision(walk, frame, expression, (left, right) => left % right),
  min: (walk, frame, expression) =>
    evaluateFold(walk, frame, expression, (numbers) => Math.min(...numbers)),
  max: (walk, frame, expression) =>
    evaluateFold(walk, frame, expression, (numbers) => Math.max(...numbers)),
  in: evaluateIn,
  cat: evaluateCat,
  substr: evaluateSubstr,
  merge: evaluateMerge,
  all: (walk, frame, expression) => {
    const answers = evaluatePredicate(walk, frame, expression);
    return answers.length > 0 && answers.every(Boolean);
  },
  some: (walk, frame, expression) => evaluatePredicate(walk, frame, expression).some(Boolean),
  none: (walk, frame, expression) => !evaluatePredicate(walk, frame, expression).some(Boolean),
  filter: evaluateFilter,
  map: (walk, frame, expression) => {
    const list = expectList(evaluate(walk, frame, argument(expression, 0)));
    const body = argument(expression, 1);
    return list.map((value) => {
      charge(walk, 1);
      return evaluate(walk, { value }, body);
    });
  },
  reduce: evaluateReduce,
  count: (walk, frame, expression) =>
    expectList(evaluate(walk, frame, argument(expression, 0))).length,
  first: (walk, frame, expression) =>
    expectList(evaluate(walk, frame, argument(expression, 0)))[0] ?? null,
  last: (walk, frame, expression) =>
    expectList(evaluate(walk, frame, argument(expression, 0))).at(-1) ?? null,
  includes: (walk, frame, expression) => {
    const [listed, value] = walkArgs(walk, frame, expression) as [JsonValue, JsonValue];
    const list = expectList(listed);
    charge(walk, list.length);
    return value === null ? unknown() : list.includes(value);
  },
  where: evaluateWhere,
  sort_asc: evaluateSort,
  sort_desc: evaluateSort,
  collect: evaluateCollect,
  length: evaluateLength,
  trim: (walk, frame, expression) =>
    expectText(evaluate(walk, frame, argument(expression, 0))).trim(),
  split: evaluateSplit,
  replace_all: evaluateReplaceAll,
  replace_chars: evaluateReplaceChars,
  email_domain: evaluateEmail,
  email_username: evaluateEmail,
  convert_to: (walk, frame, expression) =>
    convert(evaluate(walk, frame, argument(expression, 0)), expression.target),
  before: (walk, frame, expression) => {
    const [left, right] = walkArgs(walk, frame, expression).map(instantOf) as [number, number];
    return left < right;
  },
  after: (walk, frame, expression) => {
    const [left, right] = walkArgs(walk, frame, expression).map(instantOf) as [number, number];
    return left > right;
  },
  days_between: (walk, frame, expression) => {
    const [left, right] = walkArgs(walk, frame, expression).map(instantOf) as [number, number];
    return Math.trunc((right - left) / DAY_MILLISECONDS);
  },
  now: (walk) => walk.scope.now ?? stop('expression_clock_missing'),
};

function evaluate(walk: Walk, frame: Frame, expression: Expression): JsonValue {
  switch (expression.kind) {
    case 'literal':
      return expression.value;
    case 'array':
      return expression.items.map((item) => evaluate(walk, frame, item));
    case 'var':
      charge(walk, 1);
      return readVariable(walk, frame, expression.path);
    case 'missing': {
      charge(walk, expression.paths.length);
      const absent = expression.paths.filter((path) => isMissing(walk, frame, path));
      const found = expression.paths.length - absent.length;
      if (expression.need !== null && found >= expression.need) {
        return [];
      }
      return absent.map(({ text }) => text);
    }
    default: {
      charge(walk, 1);
      // Every operator the parser admits is in the table.
      const operation = OPERATIONS[expression.operator];
      return operation === undefined
        ? stop('expression_evaluation_failed')
        : bounded(operation(walk, frame, expression));
    }
  }
}

function settle<Value>(read: () => Value): Evaluation<Value> {
  try {
    return { outcome: 'value', value: read() };
  } catch (error) {
    // Only a stack overflow on a value nested past any limit can land in the second branch.
    return error instanceof Halt
      ? error.result
      : { outcome: 'error', code: 'expression_evaluation_failed' };
  }
}

/** C114: a value, an unknown (C114.6) or a step error; never a host error (C114.7). */
export function evaluateExpression(expression: Expression, scope: EvaluationScope): Evaluation {
  return settle(() => evaluate({ scope, spent: 0 }, null, expression));
}

/** C114.6: the answer of a condition position, by JSONLogic truthiness, with unknown kept apart. */
export function evaluateCondition(
  expression: Expression,
  scope: EvaluationScope,
): Evaluation<boolean> {
  return settle(() => truthy(evaluate({ scope, spent: 0 }, null, expression)));
}

/**
 * C150.12 (Phase 9, a borrowed edit): `evaluateCondition` with the flow's null rule for `!==` (a
 * null operand is unknown, so an errored check never reads "not failed", H03), and the root paths
 * read as null, so the flow can tell which fact stopped it and apply its own `onNull`.
 */
export function evaluateFlowExpression(
  expression: Expression,
  scope: EvaluationScope,
): { readonly evaluation: Evaluation<boolean>; readonly nullPaths: readonly string[] } {
  const nulls: string[] = [];
  const evaluation = settle(() =>
    truthy(evaluate({ scope, spent: 0, nulls, flow: true }, null, expression)),
  );
  return { evaluation, nullPaths: nulls };
}
