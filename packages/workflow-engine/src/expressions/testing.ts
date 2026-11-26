/** Test support for the expression tests. */
import type { JsonValue } from './json.js';
import {
  evaluateCondition,
  evaluateExpression,
  type Evaluation,
  type EvaluationScope,
} from './evaluate.js';
import { parseCondition, type Expression } from './parse.js';

export const NOW = '2026-10-20T12:00:00.000Z';

export const scopeOf = (
  roots: Readonly<Record<string, JsonValue | undefined>> = {},
  now: string | null = NOW,
): EvaluationScope => ({ roots, now });

/** A parsed condition, or a failure that names the first issue. */
export function parsed(raw: unknown): Expression {
  const result = parseCondition(raw);
  if (!result.ok) {
    throw new Error(`refused: ${JSON.stringify(result.issues[0])}`);
  }
  return result.expression;
}

export const run = (
  raw: unknown,
  roots: Readonly<Record<string, JsonValue | undefined>> = {},
): Evaluation => evaluateExpression(parsed(raw), scopeOf(roots));

export const decide = (
  raw: unknown,
  roots: Readonly<Record<string, JsonValue | undefined>> = {},
): Evaluation<boolean> => evaluateCondition(parsed(raw), scopeOf(roots));

/** A deterministic generator, so a failing property case can be read again. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}
