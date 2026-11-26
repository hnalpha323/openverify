/**
 * The path grammar conditions and templates share (plan C114.2, C114.4, C115.1): dotted members with
 * `[n]` for array indexes, read as own properties of plain JSON values. A path can never name the
 * prototype chain, so nothing an operator writes reaches anything but the run's own data.
 */
import { isJsonRecord, type JsonValue } from './json.js';

export const PATH_ROOTS = [
  'trigger',
  'inputs',
  'vars',
  'steps',
  'loop',
  'current_case',
  'current_run',
  'event',
] as const;
export type PathRoot = (typeof PATH_ROOTS)[number];

export type PathSegment = string | number;

export interface ParsedPath {
  readonly text: string;
  readonly segments: readonly PathSegment[];
}

/** No member of a run's data has such a name, and none may be read. */
const REFUSED_MEMBERS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

const MEMBER = /^[\w-]+$/;
/**
 * C150.12 (Phase 9): a flow scope's members may hold a `/`, as every signal name does
 * (`signals.inquiry/bot_score`). Only the flow's entry points pass it.
 */
export const FLOW_PATH_MEMBER = /^[\w/-]+$/;
const INDEX = /^\d{1,9}$/;

/** C113.4's nesting and a definition's own depth stay far below this. */
const MAX_SEGMENTS = 32;

function parsePart(part: string, segments: PathSegment[], member: RegExp): boolean {
  const bracket = part.indexOf('[');
  const name = bracket === -1 ? part : part.slice(0, bracket);
  if (!member.test(name) || REFUSED_MEMBERS.has(name)) {
    return false;
  }
  segments.push(name);
  let rest = bracket === -1 ? '' : part.slice(bracket);
  while (rest.length > 0) {
    const close = rest.indexOf(']');
    const index = rest.slice(1, close);
    if (!rest.startsWith('[') || close === -1 || !INDEX.test(index)) {
      return false;
    }
    segments.push(Number(index));
    rest = rest.slice(close + 1);
  }
  return true;
}

/**
 * C114.4: a path, or `null` for one the grammar refuses. The empty path is the element itself inside
 * a list operator (C114.2), as in JSONLogic. `member` is the member grammar (`FLOW_PATH_MEMBER` for
 * a flow's paths, C150.12).
 */
export function parsePath(text: string, member: RegExp = MEMBER): ParsedPath | null {
  if (text === '') {
    return { text, segments: [] };
  }
  const segments: PathSegment[] = [];
  for (const part of text.split('.')) {
    if (!parsePart(part, segments, member)) {
      return null;
    }
  }
  return segments.length > MAX_SEGMENTS ? null : { text, segments };
}

const ROOTS: ReadonlySet<PathSegment | undefined> = new Set(PATH_ROOTS);

export function isPathRoot(value: PathSegment | undefined): value is PathRoot {
  return ROOTS.has(value);
}

/**
 * C125.3: a secret reference, stored as `secrets.<key>` and accepted in the public spelling
 * `current_run.environment.secrets.<key>`. A condition may read neither.
 */
export function isSecretPath({ segments }: ParsedPath): boolean {
  const [first, second, third] = segments;
  return (
    first === 'secrets' ||
    (first === 'current_run' && second === 'environment' && third === 'secrets')
  );
}

/** C114.2: `undefined` where the value has no such own member or index. */
export function readSegments(
  value: JsonValue | undefined,
  segments: readonly PathSegment[],
): JsonValue | undefined {
  let current = value;
  for (const segment of segments) {
    if (typeof segment === 'number') {
      current = Array.isArray(current) ? current[segment] : undefined;
    } else {
      current =
        isJsonRecord(current) && Object.hasOwn(current, segment) ? current[segment] : undefined;
    }
    if (current === undefined) {
      return undefined;
    }
  }
  return current;
}

export type ScopeRead =
  { readonly kind: 'value'; readonly value: JsonValue | undefined } | { readonly kind: 'unset' };

/**
 * C115.4: a path read from a run's roots. A variable that holds no value is its own answer, because
 * reading one before it holds a value is a step error, never a null.
 */
export function readRootPath(
  roots: Readonly<Record<string, JsonValue | undefined>>,
  { segments }: ParsedPath,
): ScopeRead {
  const [root, name] = segments;
  if (root === 'vars' && typeof name === 'string') {
    const variables = roots.vars;
    if (!isJsonRecord(variables) || !Object.hasOwn(variables, name)) {
      return { kind: 'unset' };
    }
  }
  return { kind: 'value', value: readSegments(roots as JsonValue, segments) };
}
