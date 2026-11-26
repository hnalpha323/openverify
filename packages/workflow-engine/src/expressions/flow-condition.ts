/**
 * C150.12 (Phase 9, review F05; owner `flow-spec-logic`, a borrowed edit): a flow branch's
 * condition typed against the flow's scope description and evaluated over the flow's roots, with
 * the paths whose null stopped it named, so `nextPosition` (`@openverify/flow-spec`) can apply the
 * flow's own `onNull`. Phase 8's entry points are unchanged: these run the same parser, typing and
 * evaluator, over the flow's roots (`parseConditionOver`), with a member grammar that takes a
 * signal's `/`, and with one rule of the flow's own: a null operand of `!==` is unknown, as it is
 * of `===` (H03; Phase 8 reads it as unequal and refuses it only at publish).
 */
import type { EngineErrorCode } from '../limits/index.js';
import { enumType, listType, objectType, scalarType, type ScopeType } from '../variables/types.js';
import { evaluateFlowExpression } from './evaluate.js';
import type { DefinitionIssue, JsonValue } from './json.js';
import { parseConditionOver } from './parse.js';
import { typeCheckCondition } from './typing.js';

/** One concrete path of a flow scope (C150.2), as `@openverify/flow-spec` describes it. */
export interface FlowConditionPath {
  readonly path: string;
  readonly type:
    'string' | 'integer' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum' | 'string-array';
  readonly options?: readonly string[];
  readonly nullable: boolean;
  readonly pii: boolean;
}

export interface FlowConditionTyping {
  readonly issues: readonly DefinitionIssue[];
  readonly reads: readonly {
    readonly path: string;
    readonly nullable: boolean;
    readonly pii: boolean;
    readonly pointer: string;
  }[];
  readonly readsNullable: boolean;
}

export type FlowConditionEvaluation =
  | { readonly outcome: 'value'; readonly value: boolean; readonly nullPaths: readonly string[] }
  | { readonly outcome: 'null'; readonly nullPaths: readonly string[] }
  | {
      readonly outcome: 'error';
      readonly code: EngineErrorCode;
      readonly nullPaths: readonly string[];
    };

/** A leaf's type with its marks. A date is compared as its ISO text (no date kind in C115.3). */
function leafType(path: FlowConditionPath): ScopeType {
  const marks = { nullable: path.nullable, pii: path.pii };
  switch (path.type) {
    case 'enum':
      return enumType(path.options ?? [], marks);
    case 'string-array':
      return listType(scalarType('string'), marks);
    case 'date':
      return scalarType('string', marks);
    default:
      return scalarType(path.type, marks);
  }
}

interface Node {
  leaf: FlowConditionPath | null;
  readonly members: Map<string, Node>;
}

const toScopeType = (node: Node): ScopeType =>
  node.leaf !== null
    ? leafType(node.leaf)
    : objectType(
        Object.fromEntries([...node.members].map(([name, member]) => [name, toScopeType(member)])),
      );

/** The scope as Phase 8's typed model: closed objects down to each path's leaf. */
function scopeOf(paths: readonly FlowConditionPath[]): ScopeType {
  const root: Node = { leaf: null, members: new Map() };
  for (const path of paths) {
    let node = root;
    for (const segment of path.path.split('.')) {
      let next = node.members.get(segment);
      if (next === undefined) {
        next = { leaf: null, members: new Map() };
        node.members.set(segment, next);
      }
      node = next;
    }
    node.leaf = path;
  }
  return toScopeType(root);
}

const rootsOf = (paths: readonly string[]): ReadonlySet<string> =>
  new Set(paths.map((path) => path.split('.')[0] ?? ''));

/** C150.3: the condition typed against the flow's scope, with every path it reads and its marks. */
export function typeFlowCondition(
  raw: unknown,
  paths: readonly FlowConditionPath[],
): FlowConditionTyping {
  const parsed = parseConditionOver(raw, rootsOf(paths.map(({ path }) => path)));
  if (!parsed.ok) {
    return { issues: parsed.issues, reads: [], readsNullable: false };
  }
  const typing = typeCheckCondition(parsed.expression, scopeOf(paths));
  return {
    issues: typing.issues,
    reads: typing.reads.map(({ path, nullable, pii, pointer }) => ({
      path: path.text,
      nullable,
      pii,
      pointer,
    })),
    readsNullable: typing.readsNullable,
  };
}

/**
 * C150.3, C150.4: the condition over the flow's roots: a value, an unknown (`null`) with the root
 * paths read as null, or a step error. A condition that does not parse is an error, never a value.
 */
export function evaluateFlowCondition(
  raw: unknown,
  roots: Readonly<Record<string, JsonValue | undefined>>,
): FlowConditionEvaluation {
  const parsed = parseConditionOver(raw, new Set(Object.keys(roots)));
  if (!parsed.ok) {
    return { outcome: 'error', code: 'expression_evaluation_failed', nullPaths: [] };
  }
  const { evaluation, nullPaths } = evaluateFlowExpression(parsed.expression, { roots, now: null });
  switch (evaluation.outcome) {
    case 'value':
      return { outcome: 'value', value: evaluation.value, nullPaths };
    case 'null':
      return { outcome: 'null', nullPaths };
    case 'error':
      return { outcome: 'error', code: evaluation.code, nullPaths };
  }
}
