/**
 * C152.2, C152.4 (Workflow 9A): reading a mapping's value from the flow scope the engine assembled.
 * A path is parsed by the workflow engine's flow member grammar (`signals.inquiry/bot_score` holds a
 * `/`), so a mapping reads exactly what a route's condition would; a member that is absent reads
 * `null`, and only own members are ever read.
 */
import {
  FLOW_PATH_MEMBER,
  parsePath,
  type JsonRecord,
  type JsonValue,
} from '@openverify/workflow-engine';
import type { FlowScopeRoots } from './run-action.js';

/** A mapping's source: a scope path or a literal (the v2 schema's `valueSourceSchema`). */
export type FlowValueSource = { path: string } | { literal: JsonValue };

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value at `path` in `roots`, or `null` when any member on the way is absent. */
export function readScopeValue(roots: FlowScopeRoots, path: string): JsonValue {
  const parsed = parsePath(path, FLOW_PATH_MEMBER);
  if (parsed === null) {
    return null;
  }
  let current: JsonValue | undefined = roots as JsonRecord;
  for (const segment of parsed.segments) {
    if (typeof segment === 'number') {
      current = Array.isArray(current) ? current[segment] : undefined;
    } else {
      current = isRecord(current) && Object.hasOwn(current, segment) ? current[segment] : undefined;
    }
    if (current === undefined) {
      return null;
    }
  }
  return current ?? null;
}

/**
 * Each mapped value, in key order: `undefined` when the mapping reads the scope and none was given
 * (the caller takes `error`), else the values with `null` for an unknown one.
 */
export function resolveMapping(
  mapping: Readonly<Record<string, FlowValueSource>>,
  scope: FlowScopeRoots | undefined,
): [string, JsonValue][] | undefined {
  const entries = Object.entries(mapping).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const resolved: [string, JsonValue][] = [];
  for (const [key, source] of entries) {
    if ('literal' in source) {
      resolved.push([key, source.literal]);
    } else if (scope === undefined) {
      return undefined;
    } else {
      resolved.push([key, readScopeValue(scope, source.path)]);
    }
  }
  return resolved;
}
