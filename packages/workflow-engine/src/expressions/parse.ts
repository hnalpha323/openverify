/**
 * Conditions (plan C114.1-C114.3): JSONLogic as stored, labelled ours, read by this parser into a
 * tree the evaluator walks. An operator is an allowlist entry, so anything else is refused, and no
 * part of a condition ever reaches `eval`, `Function` or a template compiler (C113.8). The limits are
 * checked before any recursion, so a deep condition is a refusal, never a stack overflow.
 *
 * A finding names the operand by JSON Pointer and quotes nothing it was given.
 */
import { EXPRESSION_LIMITS } from '../limits/index.js';
import { pointerOf, type DefinitionIssue, type JsonScalar } from './json.js';
import { FLOW_PATH_MEMBER, isPathRoot, isSecretPath, parsePath, type ParsedPath } from './paths.js';

export const WHERE_COMPARISONS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'] as const;
export type WhereComparison = (typeof WHERE_COMPARISONS)[number];

export const CONVERT_TARGETS = ['string', 'number', 'boolean', 'date', 'datetime'] as const;
export type ConvertTarget = (typeof CONVERT_TARGETS)[number];

export const PREDICATE_ON_NULL = ['error', 'include', 'exclude'] as const;
export type PredicateOnNull = (typeof PREDICATE_ON_NULL)[number];

export interface LiteralExpression {
  readonly kind: 'literal';
  readonly value: JsonScalar;
  readonly pointer: string;
}

export interface ArrayExpression {
  readonly kind: 'array';
  readonly items: readonly Expression[];
  readonly pointer: string;
}

export interface VarExpression {
  readonly kind: 'var';
  readonly path: ParsedPath;
  readonly pointer: string;
}

export interface MissingExpression {
  readonly kind: 'missing';
  readonly paths: readonly ParsedPath[];
  /** `missing_some`'s count, or `null` for `missing`. */
  readonly need: number | null;
  readonly pointer: string;
}

export interface OperationExpression {
  readonly kind: 'operation';
  readonly operator: string;
  readonly args: readonly Expression[];
  readonly pointer: string;
  readonly key?: ParsedPath;
  readonly comparison?: WhereComparison;
  readonly target?: ConvertTarget;
  readonly onNull?: PredicateOnNull;
}

export type Expression =
  LiteralExpression | ArrayExpression | VarExpression | MissingExpression | OperationExpression;

export type ParsedCondition =
  | { readonly ok: true; readonly expression: Expression }
  | { readonly ok: false; readonly issues: readonly DefinitionIssue[] };

interface Arity {
  readonly min: number;
  readonly max: number;
}

const UNBOUNDED = Number.MAX_SAFE_INTEGER;
const exactly = (count: number): Arity => ({ min: count, max: count });
const atLeast = (min: number): Arity => ({ min, max: UNBOUNDED });

/** C114.2: the allowlist. `==` and `!=` read as `===` and `!==` (decision 6). */
const PLAIN_OPERATORS: ReadonlyMap<string, Arity> = new Map([
  ['and', atLeast(1)],
  ['or', atLeast(1)],
  ['!', exactly(1)],
  ['!!', exactly(1)],
  ['if', atLeast(2)],
  ['===', exactly(2)],
  ['!==', exactly(2)],
  ['<', { min: 2, max: 3 }],
  ['<=', { min: 2, max: 3 }],
  ['>', { min: 2, max: 3 }],
  ['>=', { min: 2, max: 3 }],
  ['+', atLeast(1)],
  ['-', { min: 1, max: 2 }],
  ['*', atLeast(1)],
  ['/', exactly(2)],
  ['%', exactly(2)],
  ['min', atLeast(1)],
  ['max', atLeast(1)],
  ['in', exactly(2)],
  ['cat', atLeast(1)],
  ['substr', { min: 2, max: 3 }],
  ['merge', atLeast(1)],
  ['count', exactly(1)],
  ['first', exactly(1)],
  ['last', exactly(1)],
  ['includes', exactly(2)],
  ['length', exactly(1)],
  ['trim', exactly(1)],
  ['split', exactly(2)],
  ['replace_all', exactly(3)],
  ['replace_chars', exactly(3)],
  ['email_domain', exactly(1)],
  ['email_username', exactly(1)],
  ['before', exactly(2)],
  ['after', exactly(2)],
  ['days_between', exactly(2)],
  ['now', exactly(0)],
]);

const ALIASES: ReadonlyMap<string, string> = new Map([
  ['==', '==='],
  ['!=', '!=='],
]);

/** The list operators whose body reads each element: a path there is relative to it. */
const PREDICATES: ReadonlySet<string> = new Set(['all', 'some', 'none', 'filter']);

const SPECIAL: ReadonlySet<string> = new Set([
  'var',
  'missing',
  'missing_some',
  'map',
  'reduce',
  'where',
  'sort_asc',
  'sort_desc',
  'collect',
  'convert_to',
  ...PREDICATES,
]);

const isOperator = (name: string): boolean =>
  PLAIN_OPERATORS.has(name) || ALIASES.has(name) || SPECIAL.has(name);

interface Reading {
  readonly issues: DefinitionIssue[];
  depth: number;
  /** C150.12 (Phase 9): a flow's own roots, in place of Phase 8's (absent for Phase 8). */
  readonly roots?: ReadonlySet<string>;
}

function refuse(
  reading: Reading,
  pointer: string,
  code: string,
  detail: string,
): LiteralExpression {
  reading.issues.push({ pointer, code, detail });
  return { kind: 'literal', value: null, pointer };
}

function readPath(
  text: string,
  pointer: string,
  relative: boolean,
  reading: Reading,
): ParsedPath | null {
  const path = reading.roots === undefined ? parsePath(text) : parsePath(text, FLOW_PATH_MEMBER);
  if (path === null) {
    refuse(reading, pointer, 'path_invalid', 'This path is not in the path grammar');
    return null;
  }
  if (relative) {
    return path;
  }
  if (isSecretPath(path)) {
    refuse(reading, pointer, 'secret_placement_refused', 'A condition never reads a secret');
    return null;
  }
  const [root] = path.segments;
  if (reading.roots === undefined ? !isPathRoot(root) : !reading.roots.has(String(root))) {
    refuse(reading, pointer, 'path_unknown', 'A path starts at one of the stated roots');
    return null;
  }
  return path;
}

const argumentsOf = (raw: unknown): readonly unknown[] =>
  Array.isArray(raw) ? (raw as readonly unknown[]) : [raw];

function readVar(raw: unknown, pointer: string, relative: boolean, reading: Reading): Expression {
  const args = argumentsOf(raw);
  if (args.length > 1) {
    return refuse(reading, pointer, 'var_default_refused', 'A default would read unknown as known');
  }
  const [text] = args;
  if (typeof text !== 'string') {
    return refuse(reading, pointer, 'condition_malformed', 'var takes a path');
  }
  const path = readPath(text, pointer, relative, reading);
  return path === null ? { kind: 'literal', value: null, pointer } : { kind: 'var', path, pointer };
}

function readMissingPaths(
  names: readonly unknown[],
  pointer: string,
  relative: boolean,
  reading: Reading,
): readonly ParsedPath[] {
  return names.flatMap((name, index) => {
    if (typeof name !== 'string') {
      refuse(reading, pointerOf(pointer, index), 'operator_argument', 'This must be a path');
      return [];
    }
    const path = readPath(name, pointerOf(pointer, index), relative, reading);
    return path === null ? [] : [path];
  });
}

function readMissing(
  raw: unknown,
  pointer: string,
  relative: boolean,
  reading: Reading,
): Expression {
  const args = argumentsOf(raw);
  const [first] = args;
  const names = args.length === 1 && Array.isArray(first) ? (first as readonly unknown[]) : args;
  return {
    kind: 'missing',
    need: null,
    paths: readMissingPaths(names, pointer, relative, reading),
    pointer,
  };
}

function readMissingSome(
  raw: unknown,
  pointer: string,
  relative: boolean,
  reading: Reading,
): Expression {
  const [need, names] = argumentsOf(raw);
  if (typeof need !== 'number' || !Number.isInteger(need) || need < 0) {
    return refuse(reading, pointer, 'operator_argument', 'missing_some takes a count first');
  }
  if (!Array.isArray(names)) {
    return refuse(reading, pointer, 'operator_argument', 'missing_some takes a list of paths');
  }
  const paths = readMissingPaths(names as readonly unknown[], pointer, relative, reading);
  return { kind: 'missing', need, paths, pointer };
}

function readEnumOption<Value extends string>(
  raw: unknown,
  values: readonly Value[],
  pointer: string,
  reading: Reading,
): Value | undefined {
  const found = values.find((value) => value === raw);
  if (found === undefined) {
    refuse(reading, pointer, 'operator_argument', 'This value is not one the operator takes');
  }
  return found;
}

function readKey(raw: unknown, pointer: string, reading: Reading): ParsedPath | undefined {
  const path = typeof raw === 'string' ? parsePath(raw) : null;
  if (path === null || path.segments.length === 0) {
    refuse(reading, pointer, 'operator_argument', 'This must be a member path');
    return undefined;
  }
  return path;
}

function checkArity(
  args: readonly unknown[],
  { min, max }: Arity,
  pointer: string,
  reading: Reading,
): boolean {
  if (args.length >= min && args.length <= max) {
    return true;
  }
  refuse(reading, pointer, 'operator_arity', 'This operator takes another number of arguments');
  return false;
}

interface Operands {
  readonly operator: string;
  readonly raw: readonly unknown[];
  readonly pointer: string;
  readonly relative: boolean;
  readonly reading: Reading;
}

type Parts = Pick<OperationExpression, 'key' | 'comparison' | 'target' | 'onNull'>;

function operation(
  { operator, pointer }: Operands,
  args: readonly Expression[],
  parts: Parts = {},
): OperationExpression {
  return { kind: 'operation', operator, args, pointer, ...parts };
}

const argumentPointer = ({ operator, pointer }: Operands, index: number): string =>
  pointerOf(pointer, operator, index);

function readArgument(operands: Operands, index: number, relative = operands.relative): Expression {
  return readExpression(
    operands.raw[index],
    argumentPointer(operands, index),
    relative,
    operands.reading,
  );
}

function readPredicate(operands: Operands): Expression {
  if (!checkArity(operands.raw, { min: 2, max: 3 }, operands.pointer, operands.reading)) {
    return { kind: 'literal', value: null, pointer: operands.pointer };
  }
  const onNull =
    operands.raw.length === 3
      ? readEnumOption(
          operands.raw[2],
          PREDICATE_ON_NULL,
          argumentPointer(operands, 2),
          operands.reading,
        )
      : undefined;
  return operation(
    operands,
    [readArgument(operands, 0), readArgument(operands, 1, true)],
    onNull === undefined ? {} : { onNull },
  );
}

function readWhere(operands: Operands): Expression {
  const { raw, pointer, reading } = operands;
  if (!checkArity(raw, { min: 4, max: 5 }, pointer, reading)) {
    return { kind: 'literal', value: null, pointer };
  }
  const key = readKey(raw[1], argumentPointer(operands, 1), reading);
  const comparison = readEnumOption(
    raw[2],
    WHERE_COMPARISONS,
    argumentPointer(operands, 2),
    reading,
  );
  const onNull =
    raw.length === 5
      ? readEnumOption(raw[4], PREDICATE_ON_NULL, argumentPointer(operands, 4), reading)
      : undefined;
  return operation(operands, [readArgument(operands, 0), readArgument(operands, 3)], {
    ...(key === undefined ? {} : { key }),
    ...(comparison === undefined ? {} : { comparison }),
    ...(onNull === undefined ? {} : { onNull }),
  });
}

function readKeyed(operands: Operands, arity: Arity, required: boolean): Expression {
  const { raw, pointer, reading } = operands;
  if (!checkArity(raw, arity, pointer, reading)) {
    return { kind: 'literal', value: null, pointer };
  }
  const key =
    required || raw.length === 2
      ? readKey(raw[1], argumentPointer(operands, 1), reading)
      : undefined;
  return operation(operands, [readArgument(operands, 0)], key === undefined ? {} : { key });
}

function readConvert(operands: Operands): Expression {
  const { raw, pointer, reading } = operands;
  if (!checkArity(raw, exactly(2), pointer, reading)) {
    return { kind: 'literal', value: null, pointer };
  }
  const target = readEnumOption(raw[1], CONVERT_TARGETS, argumentPointer(operands, 1), reading);
  return operation(operands, [readArgument(operands, 0)], target === undefined ? {} : { target });
}

function readBodied(operands: Operands, arity: Arity): Expression {
  const { raw, pointer, reading } = operands;
  if (!checkArity(raw, arity, pointer, reading)) {
    return { kind: 'literal', value: null, pointer };
  }
  const args = [readArgument(operands, 0), readArgument(operands, 1, true)];
  return operation(operands, arity.max === 3 ? [...args, readArgument(operands, 2)] : args);
}

function readOperation(
  name: string,
  value: unknown,
  pointer: string,
  reading: Reading,
  relative: boolean,
): Expression {
  const inner = pointerOf(pointer, name);
  if (name === 'var') {
    return readVar(value, inner, relative, reading);
  }
  if (name === 'missing') {
    return readMissing(value, inner, relative, reading);
  }
  if (name === 'missing_some') {
    return readMissingSome(value, inner, relative, reading);
  }
  const operator = ALIASES.get(name) ?? name;
  const operands: Operands = {
    operator,
    raw: argumentsOf(value),
    pointer,
    relative,
    reading,
  };
  if (PREDICATES.has(operator)) {
    return readPredicate(operands);
  }
  switch (operator) {
    case 'where':
      return readWhere(operands);
    case 'sort_asc':
    case 'sort_desc':
      return readKeyed(operands, { min: 1, max: 2 }, false);
    case 'collect':
      return readKeyed(operands, exactly(2), true);
    case 'convert_to':
      return readConvert(operands);
    case 'map':
      return readBodied(operands, exactly(2));
    case 'reduce':
      return readBodied(operands, exactly(3));
    default: {
      const arity = PLAIN_OPERATORS.get(operator) ?? exactly(0);
      if (!checkArity(operands.raw, arity, pointer, reading)) {
        return { kind: 'literal', value: null, pointer };
      }
      return operation(
        operands,
        operands.raw.map((_raw, index) => readArgument(operands, index)),
      );
    }
  }
}

function readExpression(
  raw: unknown,
  pointer: string,
  relative: boolean,
  reading: Reading,
): Expression {
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') {
    return { kind: 'literal', value: raw, pointer };
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { kind: 'literal', value: raw, pointer }
      : refuse(reading, pointer, 'condition_malformed', 'A number must be finite');
  }
  if (Array.isArray(raw)) {
    const items = (raw as readonly unknown[]).map((item, index) =>
      readExpression(item, pointerOf(pointer, index), relative, reading),
    );
    return { kind: 'array', items, pointer };
  }
  if (typeof raw !== 'object') {
    return refuse(reading, pointer, 'condition_malformed', 'A condition is a JSON value');
  }
  const members = Object.entries(raw as Readonly<Record<string, unknown>>);
  const [member] = members;
  if (member === undefined || members.length > 1) {
    return refuse(reading, pointer, 'condition_malformed', 'An operation has exactly one operator');
  }
  const [name, value] = member;
  if (!isOperator(name)) {
    return refuse(reading, pointer, 'operator_refused', 'This operator is not in the dialect');
  }
  reading.depth += 1;
  if (reading.depth > EXPRESSION_LIMITS.depth.value) {
    reading.depth -= 1;
    return refuse(reading, pointer, 'expression_limit_exceeded', 'A condition is nested too deep');
  }
  const expression = readOperation(name, value, pointer, reading, relative);
  reading.depth -= 1;
  return expression;
}

/** The JSON depth of the deepest condition the limit admits: an object and a list per level. */
const MAX_JSON_DEPTH = EXPRESSION_LIMITS.depth.value * 2 + 2;

/** An iterative walk, so a value deeper than the stack is measured, never recursed into. */
function fitsTheLimits(raw: unknown): boolean {
  const stack: { readonly value: unknown; readonly depth: number }[] = [{ value: raw, depth: 1 }];
  let nodes = 0;
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    nodes += 1;
    if (nodes > EXPRESSION_LIMITS.nodes.value || entry.depth > MAX_JSON_DEPTH) {
      return false;
    }
    if (typeof entry.value === 'object' && entry.value !== null) {
      for (const value of Object.values(entry.value) as readonly unknown[]) {
        stack.push({ value, depth: entry.depth + 1 });
      }
    }
  }
  return true;
}

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** The JSON Pointer `''`: the condition's own root. */
const ROOT = '';

/**
 * C114.2, C114.3: a stored condition as a tree, or every problem with it. Never throws, whatever it
 * is given; the pointers are relative to the condition.
 */
export function parseCondition(raw: unknown): ParsedCondition {
  return parseWith(raw, { issues: [], depth: 0 });
}

/**
 * C150.12 (Phase 9, a borrowed edit): `parseCondition` over a flow's own roots, whose members may
 * hold a `/`. Phase 8's roots are not among them unless the caller names them.
 */
export function parseConditionOver(raw: unknown, roots: ReadonlySet<string>): ParsedCondition {
  return parseWith(raw, { issues: [], depth: 0, roots });
}

function parseWith(raw: unknown, reading: Reading): ParsedCondition {
  if (!fitsTheLimits(raw)) {
    refuse(
      reading,
      ROOT,
      'expression_limit_exceeded',
      'A condition is too deep or has too many nodes',
    );
    return { ok: false, issues: reading.issues };
  }
  const expression = readExpression(raw, ROOT, false, reading);
  if (reading.issues.length > 0) {
    return { ok: false, issues: reading.issues };
  }
  if (utf8Bytes(JSON.stringify(raw)) > EXPRESSION_LIMITS['condition-bytes'].value) {
    refuse(reading, ROOT, 'expression_limit_exceeded', 'A condition is at most 16 KiB serialised');
    return { ok: false, issues: reading.issues };
  }
  return { ok: true, expression };
}
