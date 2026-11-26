/**
 * The publish-time check of a condition (plan C114.5, C114.6): every `var` resolved against the scope
 * of its node, operands that can be compared, no PII compared with a literal string, and no nullable
 * path in a boolean position. It also says whether the condition reads a nullable path, which is what
 * makes its position declare `on-null`.
 *
 * An issue names the operand by pointer and quotes no value, because a definition is served back in a
 * problem (C143.5).
 */
import {
  ANY_TYPE,
  listType,
  objectType,
  resolvePath,
  scalarType,
  withMarks,
  type ScopeType,
} from '../variables/types.js';
import type { DefinitionIssue } from './json.js';
import type { Expression, OperationExpression } from './parse.js';
import type { ParsedPath } from './paths.js';

export interface PathRead {
  readonly path: ParsedPath;
  readonly nullable: boolean;
  readonly pii: boolean;
  readonly pointer: string;
}

export interface ConditionTyping {
  readonly issues: readonly DefinitionIssue[];
  /** Every path the condition reads, in order: what the static analyses walk. */
  readonly reads: readonly PathRead[];
  /** C114.6: it reads a nullable path outside an explicit test, so it must declare `on-null`. */
  readonly readsNullable: boolean;
}

/** What an operand can hold. */
interface Inferred {
  readonly type: ScopeType;
  readonly literal: boolean;
}

interface Check {
  readonly scope: ScopeType;
  readonly issues: DefinitionIssue[];
  readonly reads: PathRead[];
  readsNullable: boolean;
}

/** Whose paths an expression reads: the roots, or the element of a list operator. */
type Frame = ScopeType | null;

const BOOLEAN = scalarType('boolean');
const NUMBER = scalarType('number');
const INTEGER = scalarType('integer');
const STRING = scalarType('string');
const NULL_LITERAL = withMarks(ANY_TYPE, { nullable: true });

const NUMBER_KINDS: ReadonlySet<string> = new Set(['number', 'integer']);
const TEXT_KINDS: ReadonlySet<string> = new Set(['string', 'id', 'enum', 'datetime']);

const isAny = (type: ScopeType): boolean => type.kind === 'any';
const isNumeric = (type: ScopeType): boolean => isAny(type) || NUMBER_KINDS.has(type.kind);
const isText = (type: ScopeType): boolean => isAny(type) || TEXT_KINDS.has(type.kind);
const isList = (type: ScopeType): boolean => isAny(type) || type.kind === 'list';

const report = (check: Check, pointer: string, code: string, detail: string): void => {
  check.issues.push({ pointer, code, detail });
};

const incomparable = (check: Check, pointer: string): void => {
  report(check, pointer, 'type_incomparable', 'These operands cannot be compared');
};

const mismatch = (check: Check, pointer: string): void => {
  report(check, pointer, 'type_incomparable', 'This operand has the wrong type for its operator');
};

const familyOf = (type: ScopeType): string =>
  NUMBER_KINDS.has(type.kind) ? 'number' : TEXT_KINDS.has(type.kind) ? 'text' : type.kind;

function literalFitsEnum(enumerated: ScopeType, other: Expression): boolean {
  return (
    enumerated.kind !== 'enum' ||
    other.kind !== 'literal' ||
    typeof other.value !== 'string' ||
    enumerated.values.includes(other.value)
  );
}

function comparable(left: Inferred, right: Inferred, [one, other]: readonly Expression[]): boolean {
  if (left.literal && one?.kind === 'literal' && one.value === null) {
    return true;
  }
  if (right.literal && other?.kind === 'literal' && other.value === null) {
    return true;
  }
  if (isAny(left.type) || isAny(right.type)) {
    return true;
  }
  return (
    familyOf(left.type) === familyOf(right.type) &&
    (other === undefined || literalFitsEnum(left.type, other)) &&
    (one === undefined || literalFitsEnum(right.type, one))
  );
}

/** C114.5: identifiers of people never go into immutable definitions. */
const piiText = (type: ScopeType): boolean => type.pii && (isAny(type) || type.kind === 'string');

const isStringLiteral = (expression: Expression | undefined): boolean =>
  expression?.kind === 'literal' && typeof expression.value === 'string';

const holdsStringLiteral = (expression: Expression | undefined): boolean =>
  isStringLiteral(expression) ||
  (expression?.kind === 'array' && expression.items.some(isStringLiteral));

const PII_LITERAL_DETAIL = 'A condition never holds a literal person; use get_list_match';

function checkPiiLiteral(
  check: Check,
  value: Inferred,
  literal: Expression | undefined,
  pointer: string,
): void {
  if (piiText(value.type) && holdsStringLiteral(literal)) {
    report(check, pointer, 'pii_literal_in_condition', PII_LITERAL_DETAIL);
  }
}

const isNullLiteral = (expression: Expression | undefined): boolean =>
  expression?.kind === 'literal' && expression.value === null;

function checkBooleanOperand(check: Check, operand: Inferred, pointer: string): void {
  if (operand.type.nullable && !operand.literal) {
    report(
      check,
      pointer,
      'nullable_in_boolean_position',
      'A nullable path must be tested with === null or missing first',
    );
  }
}

function readPath(check: Check, frame: Frame, path: ParsedPath, pointer: string): ScopeType {
  const base = frame ?? check.scope;
  const resolved = resolvePath(base, path.segments);
  if (resolved.ok) {
    check.reads.push({ path, nullable: resolved.nullable, pii: resolved.pii, pointer });
    return withMarks(resolved.type, { nullable: resolved.nullable, pii: resolved.pii });
  }
  if (frame === null && path.segments[0] === 'current_case' && resolved.at === 0) {
    report(check, pointer, 'current_case_unavailable', 'current_case has no provider yet');
  } else if (resolved.reason === 'untyped') {
    report(check, pointer, 'path_untyped', 'No schema says what this value holds');
  } else {
    report(check, pointer, 'path_unknown', 'This path is not in scope at this node');
  }
  return ANY_TYPE;
}

function infer(check: Check, frame: Frame, expression: Expression): Inferred {
  switch (expression.kind) {
    case 'literal': {
      const { value } = expression;
      if (value === null) {
        return { type: NULL_LITERAL, literal: true };
      }
      const type =
        typeof value === 'string' ? STRING : typeof value === 'number' ? NUMBER : BOOLEAN;
      return { type, literal: true };
    }
    case 'array': {
      const items = expression.items.map((item) => infer(check, frame, item).type);
      const [first] = items;
      const same = items.every((item) => familyOf(item) === (first && familyOf(first)));
      return { type: listType(same && first !== undefined ? first : ANY_TYPE), literal: false };
    }
    case 'var': {
      const type = readPath(check, frame, expression.path, expression.pointer);
      check.readsNullable ||= type.nullable;
      return { type, literal: false };
    }
    case 'missing':
      return { type: listType(STRING), literal: false };
    default: {
      const inferOperation = OPERATIONS[expression.operator] ?? inferPlain;
      return { type: inferOperation(check, frame, expression), literal: false };
    }
  }
}

const arg = (expression: OperationExpression, index: number): Expression =>
  expression.args[index] ?? { kind: 'literal', value: null, pointer: expression.pointer };

/** An operand of an explicit test: reading it is the test, so it needs no `on-null`. */
function inferUnderTest(check: Check, frame: Frame, expression: Expression): Inferred {
  const before = check.readsNullable;
  const inferred = infer(check, frame, expression);
  check.readsNullable = before;
  return inferred;
}

function inferEquality(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const [one, other] = [arg(expression, 0), arg(expression, 1)];
  const explicit = isNullLiteral(one) || isNullLiteral(other);
  const read = explicit ? inferUnderTest : infer;
  const [left, right] = [read(check, frame, one), read(check, frame, other)];
  if (!comparable(left, right, [one, other])) {
    incomparable(check, expression.pointer);
  }
  checkPiiLiteral(check, left, other, expression.pointer);
  checkPiiLiteral(check, right, one, expression.pointer);
  return BOOLEAN;
}

function inferInequality(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  inferEquality(check, frame, expression);
  for (const operand of expression.args) {
    if (operand.kind === 'var') {
      const resolved = resolvePath(frame ?? check.scope, operand.path.segments);
      if (resolved.ok) {
        checkBooleanOperand(
          check,
          { type: withMarks(resolved.type, { nullable: resolved.nullable }), literal: false },
          operand.pointer,
        );
      }
    }
  }
  return BOOLEAN;
}

function inferOrder(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const operands = expression.args.map((operand) => infer(check, frame, operand));
  for (let index = 1; index < operands.length; index += 1) {
    const [left, right] = [operands[index - 1], operands[index]] as [Inferred, Inferred];
    const orderable = isNumeric(left.type) || isText(left.type);
    if (
      !orderable ||
      !comparable(left, right, [arg(expression, index - 1), arg(expression, index)])
    ) {
      incomparable(check, expression.pointer);
    }
  }
  return BOOLEAN;
}

function inferBoolean(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  for (const operand of expression.args) {
    checkBooleanOperand(check, infer(check, frame, operand), operand.pointer);
  }
  return BOOLEAN;
}

function inferIf(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const { args } = expression;
  const results: ScopeType[] = [];
  args.forEach((operand, index) => {
    const inferred = infer(check, frame, operand);
    if (index % 2 === 0 && index < args.length - 1) {
      checkBooleanOperand(check, inferred, operand.pointer);
    } else {
      results.push(inferred.type);
    }
  });
  const [first = ANY_TYPE, ...others] = results;
  return withMarks(others.reduce(mergeBranches, first), { nullable: args.length % 2 === 0 });
}

const mergeBranches = (left: ScopeType, right: ScopeType): ScopeType =>
  familyOf(left) === familyOf(right)
    ? withMarks(left, { nullable: right.nullable, pii: right.pii })
    : withMarks(ANY_TYPE, {
        nullable: left.nullable || right.nullable,
        pii: left.pii || right.pii,
      });

function inferNumbers(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  let pii = false;
  for (const operand of expression.args) {
    const { type } = infer(check, frame, operand);
    pii ||= type.pii;
    if (!isNumeric(type)) {
      mismatch(check, operand.pointer);
    }
  }
  return withMarks(NUMBER, { pii });
}

/** One text operand after another, the result carrying their PII. */
function inferTexts(
  check: Check,
  frame: Frame,
  expression: OperationExpression,
  result: ScopeType,
): ScopeType {
  let pii = false;
  for (const operand of expression.args) {
    const { type } = infer(check, frame, operand);
    pii ||= type.pii;
    if (!isText(type)) {
      mismatch(check, operand.pointer);
    }
  }
  return withMarks(result, { pii });
}

function inferCat(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  let pii = false;
  for (const operand of expression.args) {
    const { type } = infer(check, frame, operand);
    pii ||= type.pii;
    if (type.kind === 'list' || type.kind === 'object') {
      mismatch(check, operand.pointer);
    }
  }
  return withMarks(STRING, { pii });
}

function inferSubstr(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const [text, ...numbers] = expression.args;
  const { type } = infer(check, frame, text ?? arg(expression, 0));
  if (!isText(type)) {
    mismatch(check, expression.pointer);
  }
  for (const operand of numbers) {
    if (!isNumeric(infer(check, frame, operand).type)) {
      mismatch(check, operand.pointer);
    }
  }
  return withMarks(STRING, { pii: type.pii });
}

function listOperand(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const operand = arg(expression, 0);
  const { type } = infer(check, frame, operand);
  if (!isList(type)) {
    mismatch(check, operand.pointer);
    return ANY_TYPE;
  }
  return type;
}

const elementOf = (list: ScopeType): ScopeType =>
  list.kind === 'list' ? withMarks(list.of, { pii: list.pii }) : ANY_TYPE;

function inferIn(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const [needle, haystack] = [arg(expression, 0), arg(expression, 1)];
  const value = infer(check, frame, needle);
  const within = infer(check, frame, haystack);
  const element = within.type.kind === 'list' ? within.type.of : within.type;
  const fits =
    (within.type.kind === 'list' || isText(within.type)) &&
    comparable(value, { type: element, literal: false }, []) &&
    (haystack.kind !== 'array' ||
      haystack.items.every((item) => literalFitsEnum(value.type, item)));
  if (!fits) {
    incomparable(check, expression.pointer);
  }
  checkPiiLiteral(check, value, haystack, expression.pointer);
  return BOOLEAN;
}

function inferIncludes(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const list = listOperand(check, frame, expression);
  const operand = arg(expression, 1);
  const value = infer(check, frame, operand);
  if (!comparable({ type: elementOf(list), literal: false }, value, [])) {
    incomparable(check, expression.pointer);
  }
  checkPiiLiteral(check, { type: elementOf(list), literal: false }, operand, expression.pointer);
  return BOOLEAN;
}

/** Whether `read` reads a nullable path, leaving the condition's own answer as it was. */
function readsNullableIn(check: Check, read: () => void): boolean {
  const before = check.readsNullable;
  check.readsNullable = false;
  read();
  const reads: boolean = check.readsNullable;
  check.readsNullable = before;
  return reads;
}

function requireOnNull(
  check: Check,
  reads: boolean,
  { onNull, pointer }: OperationExpression,
): void {
  if (reads && onNull === undefined) {
    report(check, pointer, 'on_null_missing', 'This predicate reads a nullable path');
  }
}

function inferPredicate(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const list = listOperand(check, frame, expression);
  const reads = readsNullableIn(check, () => {
    infer(check, elementOf(list), arg(expression, 1));
  });
  requireOnNull(check, reads, expression);
  return expression.operator === 'filter' ? list : BOOLEAN;
}

function inferWhere(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const list = listOperand(check, frame, expression);
  const value = infer(check, frame, arg(expression, 1));
  const { key, pointer } = expression;
  if (key !== undefined) {
    const member = readPath(check, elementOf(list), key, pointer);
    requireOnNull(check, member.nullable, expression);
    if (
      expression.comparison !== 'in' &&
      !comparable({ type: member, literal: false }, value, [])
    ) {
      incomparable(check, pointer);
    }
    checkPiiLiteral(check, { type: member, literal: false }, arg(expression, 1), pointer);
  }
  return list;
}

function inferMap(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const list = listOperand(check, frame, expression);
  const body = infer(check, elementOf(list), arg(expression, 1));
  return listType(body.type);
}

function inferReduce(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const list = listOperand(check, frame, expression);
  const initial = infer(check, frame, arg(expression, 2));
  const element = objectType({ accumulator: initial.type, current: elementOf(list) });
  return infer(check, element, arg(expression, 1)).type;
}

function inferCollect(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const list = listOperand(check, frame, expression);
  const { key, pointer } = expression;
  return key === undefined ? ANY_TYPE : listType(readPath(check, elementOf(list), key, pointer));
}

function inferSort(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const list = listOperand(check, frame, expression);
  const { key, pointer } = expression;
  if (key !== undefined) {
    readPath(check, elementOf(list), key, pointer);
  }
  return list;
}

function inferMerge(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const operands = expression.args.map((operand) => infer(check, frame, operand).type);
  const elements = operands.map((type) => (type.kind === 'list' ? type.of : type));
  const [first] = elements;
  const same =
    first !== undefined && elements.every((element) => familyOf(element) === familyOf(first));
  return listType(same ? first : ANY_TYPE);
}

function inferDates(check: Check, frame: Frame, expression: OperationExpression): void {
  for (const operand of expression.args) {
    const { type } = infer(check, frame, operand);
    if (!isText(type)) {
      mismatch(check, operand.pointer);
    }
  }
}

function inferConvert(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  const { type } = infer(check, frame, arg(expression, 0));
  if (type.kind === 'list' || type.kind === 'object') {
    mismatch(check, expression.pointer);
  }
  switch (expression.target) {
    case 'number':
      return withMarks(NUMBER, { pii: type.pii });
    case 'boolean':
      return withMarks(BOOLEAN, { pii: type.pii });
    case 'date':
    case 'datetime':
      return withMarks(scalarType('datetime'), { pii: type.pii });
    default:
      return withMarks(STRING, { pii: type.pii });
  }
}

function inferPlain(check: Check, frame: Frame, expression: OperationExpression): ScopeType {
  for (const operand of expression.args) {
    infer(check, frame, operand);
  }
  return ANY_TYPE;
}

type InferOperation = (check: Check, frame: Frame, expression: OperationExpression) => ScopeType;

const EMAIL_PART: InferOperation = (check, frame, expression) =>
  withMarks(inferTexts(check, frame, expression, STRING), { nullable: true });

const LIST_HEAD: InferOperation = (check, frame, expression) => {
  check.readsNullable = true;
  return withMarks(elementOf(listOperand(check, frame, expression)), { nullable: true });
};

const COUNT: InferOperation = (check, frame, expression) => {
  listOperand(check, frame, expression);
  return INTEGER;
};

const LENGTH: InferOperation = (check, frame, expression) => {
  const operand = arg(expression, 0);
  const { type } = infer(check, frame, operand);
  if (!isText(type) && !isList(type)) {
    mismatch(check, operand.pointer);
  }
  return INTEGER;
};

const OPERATIONS: Readonly<Record<string, InferOperation>> = {
  and: inferBoolean,
  or: inferBoolean,
  '!': inferBoolean,
  '!!': inferBoolean,
  if: inferIf,
  '===': inferEquality,
  '!==': inferInequality,
  '<': inferOrder,
  '<=': inferOrder,
  '>': inferOrder,
  '>=': inferOrder,
  '+': inferNumbers,
  '-': inferNumbers,
  '*': inferNumbers,
  '/': inferNumbers,
  '%': inferNumbers,
  min: inferNumbers,
  max: inferNumbers,
  in: inferIn,
  cat: inferCat,
  substr: inferSubstr,
  merge: inferMerge,
  all: inferPredicate,
  some: inferPredicate,
  none: inferPredicate,
  filter: inferPredicate,
  map: inferMap,
  reduce: inferReduce,
  count: COUNT,
  length: LENGTH,
  first: LIST_HEAD,
  last: LIST_HEAD,
  includes: inferIncludes,
  where: inferWhere,
  sort_asc: inferSort,
  sort_desc: inferSort,
  collect: inferCollect,
  trim: (check, frame, expression) => inferTexts(check, frame, expression, STRING),
  replace_all: (check, frame, expression) => inferTexts(check, frame, expression, STRING),
  replace_chars: (check, frame, expression) => inferTexts(check, frame, expression, STRING),
  split: (check, frame, expression) => listType(inferTexts(check, frame, expression, STRING)),
  email_domain: EMAIL_PART,
  email_username: EMAIL_PART,
  convert_to: inferConvert,
  before: (check, frame, expression) => {
    inferDates(check, frame, expression);
    return BOOLEAN;
  },
  after: (check, frame, expression) => {
    inferDates(check, frame, expression);
    return BOOLEAN;
  },
  days_between: (check, frame, expression) => {
    inferDates(check, frame, expression);
    return INTEGER;
  },
  now: () => scalarType('datetime'),
};

/** C114.5, C114.6: the check of one condition against `scope`, an object of the roots in scope. */
export function typeCheckCondition(expression: Expression, scope: ScopeType): ConditionTyping {
  const check: Check = { scope, issues: [], reads: [], readsNullable: false };
  infer(check, null, expression);
  return { issues: check.issues, reads: check.reads, readsNullable: check.readsNullable };
}
