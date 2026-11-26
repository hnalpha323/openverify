/**
 * The condition builder's model (C114, C141.4): a route's condition as groups of comparisons, AND
 * inside a group and OR between groups, written in our JSONLogic dialect and read back from it. A
 * condition the builder did not write (a list predicate, a calculation) stays as it is and is
 * edited in the definition.
 *
 * The null rules (C114.6) shape what is offered: a value that can be unknown is compared only with
 * `===` (never `!==`, never on its own as true or false), "is unknown" tests for it explicitly, and
 * a condition that reads one says what happens then (`on-null`), with no default. Personal data is
 * never compared with typed text (C114.5, P37).
 */
import {
  WORKFLOW_PREDICATE_ON_NULL,
  WORKFLOW_TRIGGER_ON_NULL,
  WORKFLOW_WAIT_ON_NULL,
  WORKFLOW_WHILE_ON_NULL,
} from '@openverify/core';
import type { ScopePath } from './variable-scope';

export type ClauseOperator =
  | 'is'
  | 'is-not'
  | 'less'
  | 'at-most'
  | 'more'
  | 'at-least'
  | 'is-null'
  | 'any-is'
  | 'all-are'
  | 'none-is';

export interface Clause {
  readonly path: string;
  readonly operator: ClauseOperator;
  readonly value: unknown;
  /** R005: a list predicate's on-null for an element it cannot read (C114.6). */
  readonly predicateOnNull?: string;
}

/** OR between groups, AND inside a group. */
export type ConditionGroups = readonly (readonly Clause[])[];

/** Where a condition stands: a conditional's route, a trigger's criteria or filter, a wait's filter. */
/** `visibility` (C155.5): a screen component's rule, which has no on-null (C148.4). */
export type ConditionPosition =
  'route' | 'trigger' | 'wait' | 'flow-route' | 'while' | 'visibility';

export interface OnNullChoice {
  readonly value: string;
  readonly label: string;
}

const OPERATORS: Readonly<
  Record<Exclude<ClauseOperator, 'is-null' | 'any-is' | 'all-are' | 'none-is'>, string>
> = {
  is: '===',
  'is-not': '!==',
  less: '<',
  'at-most': '<=',
  more: '>',
  'at-least': '>=',
};

const PREDICATES = { 'any-is': 'some', 'all-are': 'all', 'none-is': 'none' } as const;

const BY_PREDICATE = new Map<string, ClauseOperator>(
  Object.entries(PREDICATES).map(([operator, key]) => [key, operator as ClauseOperator] as const),
);

/** R005: what a list predicate does with an element it cannot read, in words (C114.6). */
export const PREDICATE_ON_NULL_WORDS: Readonly<Record<string, string>> = {
  error: 'Stop the run with an error (condition_input_null)',
  include: 'Count it as holding',
  exclude: 'Count it as not holding',
};

export const PREDICATE_ON_NULL_CHOICES: readonly string[] = WORKFLOW_PREDICATE_ON_NULL;

const BY_SYMBOL = new Map(
  Object.entries(OPERATORS).map(([operator, symbol]) => [symbol, operator as ClauseOperator]),
);

const WORDS: Readonly<Record<ClauseOperator, string>> = {
  is: 'is',
  'is-not': 'is not',
  less: 'is less than',
  'at-most': 'is at most',
  more: 'is more than',
  'at-least': 'is at least',
  'is-null': 'is unknown (null)',
  'any-is': 'has an element that is',
  'all-are': 'has only elements that are',
  'none-is': 'has no element that is',
};

export function operatorWords(operator: ClauseOperator): string {
  return WORDS[operator];
}

function writeClause(clause: Clause): unknown {
  const operand = { var: clause.path };
  switch (clause.operator) {
    case 'is-null':
      return { '===': [operand, null] };
    case 'any-is':
    case 'all-are':
    case 'none-is':
      // R005: a list predicate over the list's elements (C114.2's some, all, none), each element
      // compared as `{"var": ""}`, with its own on-null when one is chosen (C114.6).
      return {
        [PREDICATES[clause.operator]]: [
          operand,
          { '===': [{ var: '' }, clause.value] },
          ...(clause.predicateOnNull === undefined ? [] : [clause.predicateOnNull]),
        ],
      };
    default:
      return { [OPERATORS[clause.operator]]: [operand, clause.value] };
  }
}

const joined = (key: 'and' | 'or', items: readonly unknown[]): unknown =>
  items.length === 1 ? items[0] : { [key]: items };

/** The dialect's JSON for `groups`; `undefined`, a catch-all route, for no comparison. */
export function writeCondition(groups: ConditionGroups): unknown {
  const written = groups
    .filter((group) => group.length > 0)
    .map((group) => joined('and', group.map(writeClause)));
  return written.length === 0 ? undefined : joined('or', written);
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLiteral = (value: unknown): boolean =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

function readPredicate(operator: ClauseOperator, operands: unknown): Clause | null {
  if (!Array.isArray(operands) || operands.length < 2 || operands.length > 3) {
    return null;
  }
  const [list, body, onNull] = operands as unknown[];
  if (!isRecord(list) || typeof list.var !== 'string' || Object.keys(list).length !== 1) {
    return null;
  }
  const compared = isRecord(body) && Object.keys(body).length === 1 ? body['==='] : undefined;
  if (!Array.isArray(compared) || compared.length !== 2) {
    return null;
  }
  const [element, value] = compared as unknown[];
  if (!isRecord(element) || element.var !== '' || !isLiteral(value) || value === null) {
    return null;
  }
  if (
    onNull !== undefined &&
    !(typeof onNull === 'string' && PREDICATE_ON_NULL_CHOICES.includes(onNull))
  ) {
    return null;
  }
  return {
    path: list.var,
    operator,
    value,
    ...(onNull === undefined ? {} : { predicateOnNull: onNull }),
  };
}

function readClause(value: unknown): Clause | null {
  if (!isRecord(value)) {
    return null;
  }
  const entries = Object.entries(value);
  const [entry] = entries;
  if (entries.length !== 1 || entry === undefined) {
    return null;
  }
  const [symbol, operands] = entry;
  const predicate = BY_PREDICATE.get(symbol);
  if (predicate !== undefined) {
    return readPredicate(predicate, operands);
  }
  const operator = BY_SYMBOL.get(symbol);
  if (operator === undefined || !Array.isArray(operands) || operands.length !== 2) {
    return null;
  }
  const [left, right] = operands as unknown[];
  if (!isRecord(left) || typeof left.var !== 'string' || Object.keys(left).length !== 1) {
    return null;
  }
  if (!isLiteral(right)) {
    return null;
  }
  if (right === null) {
    return operator === 'is' ? { path: left.var, operator: 'is-null', value: null } : null;
  }
  return { path: left.var, operator, value: right };
}

const listOf = (value: unknown, key: 'and' | 'or'): readonly unknown[] | null =>
  isRecord(value) && Object.keys(value).length === 1 && Array.isArray(value[key])
    ? (value[key] as readonly unknown[])
    : null;

function readGroup(value: unknown): Clause[] | null {
  const items = listOf(value, 'and') ?? [value];
  const clauses = items.map(readClause);
  return clauses.every((clause): clause is Clause => clause !== null) ? clauses : null;
}

/** The groups the builder wrote, `[]` for no condition, or `null` for one written by hand. */
export function readCondition(condition: unknown): ConditionGroups | null {
  if (condition === undefined) {
    return [];
  }
  const groups = (listOf(condition, 'or') ?? [condition]).map(readGroup);
  return groups.every((group): group is Clause[] => group !== null) ? groups : null;
}

const ORDERED = new Set(['number', 'integer', 'datetime']);

/** C114.5, C114.6: what a path may be compared by. */
export function operatorsFor(path: ScopePath): readonly ClauseOperator[] {
  if (path.type === 'list') {
    // R005: a list is read through a predicate over its elements; personal data never is.
    return path.pii ? [] : ['any-is', 'all-are', 'none-is'];
  }
  if (path.pii && (path.type === 'string' || path.type === 'any')) {
    return path.nullable ? ['is-null'] : [];
  }
  const equality: ClauseOperator[] = path.nullable ? ['is'] : ['is', 'is-not'];
  const bounds: ClauseOperator[] = ORDERED.has(path.type)
    ? ['less', 'at-most', 'more', 'at-least']
    : [];
  return [...equality, ...bounds, ...(path.nullable ? (['is-null'] as const) : [])];
}

/** Why a comparison cannot stand, in words, or `null` when it can. */
export function clauseProblem(clause: Clause, path: ScopePath | undefined): string | null {
  if (path === undefined) {
    return 'Nothing in scope here has this path.';
  }
  if (path.pii && clause.operator !== 'is-null' && typeof clause.value === 'string') {
    return 'Personal data is never compared with typed text (C114.5): screen it with Get List Match instead.';
  }
  return operatorsFor(path).includes(clause.operator)
    ? null
    : `A value that ${path.nullable ? 'can be unknown' : 'of this type'} is not compared that way.`;
}

/** Whether any comparison reads a path that can be unknown (C114.6). */
export function readsNullable(groups: ConditionGroups, scope: readonly ScopePath[]): boolean {
  const nullable = new Set(scope.filter((path) => path.nullable).map((path) => path.path));
  return groups.some((group) => group.some((clause) => nullable.has(clause.path)));
}

const TRIGGER_WORDS: Readonly<Record<string, string>> = {
  error: 'Refuse the event, recorded with its reason',
  admit: 'Start a run anyway',
  skip: 'Skip the event: no run',
};

const WHILE_WORDS: Readonly<Record<string, string>> = {
  error: 'Stop the run with an error (condition_input_null)',
  stop: 'End the loop: the run goes on after it',
};

const WAIT_WORDS: Readonly<Record<string, string>> = {
  error: 'End the wait with an error',
  'keep-waiting': 'Keep waiting for another event',
  accept: 'Accept the event',
};

/**
 * C114.6: every on-null choice of a position, in words, never with a default: a route can stop
 * with an error, try the next route, or take any other route; a trigger and a wait have their own.
 */
export function onNullChoicesOf(
  position: ConditionPosition,
  routes: readonly { readonly key: string; readonly label: string }[] = [],
  own = '',
): readonly OnNullChoice[] {
  switch (position) {
    case 'trigger':
      return WORKFLOW_TRIGGER_ON_NULL.map((value) => ({
        value,
        label: TRIGGER_WORDS[value] ?? value,
      }));
    case 'wait':
      return WORKFLOW_WAIT_ON_NULL.map((value) => ({ value, label: WAIT_WORDS[value] ?? value }));
    case 'visibility':
      return [];
    case 'while':
      // R005, C114.6: a while loop's condition stops the run or ends the loop, with no default.
      return WORKFLOW_WHILE_ON_NULL.map((value) => ({ value, label: WHILE_WORDS[value] ?? value }));
    case 'flow-route':
      // C150.3: the flow's own on-null values; there is no `error`, so a person never reaches a
      // dead end, and no default.
      return [
        { value: 'skip-route', label: 'Try the next route' },
        ...routes
          .filter((route) => route.key !== own)
          .map((route) => ({
            value: `route:${route.key}`,
            label: `Take the route ${route.label}`,
          })),
        { value: 'else', label: 'Take else (the catch-all)' },
        { value: 'review', label: 'Take else, and send the inquiry to review at completion' },
      ];
    case 'route':
      return [
        { value: 'error', label: 'Stop the run with an error (condition_input_null)' },
        { value: 'skip-route', label: 'Try the next route' },
        ...routes
          .filter((route) => route.key !== own)
          .map((route) => ({
            value: `route:${route.key}`,
            label: `Take the route ${route.label}`,
          })),
      ];
  }
}
