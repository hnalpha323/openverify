/**
 * C148.3 (owner `flow-spec-logic`; P03, V10): field patterns in the restricted grammar, compiled
 * to our own linear-time matcher, never to `RegExp`. The server's field validation and both
 * clients' inline feedback run this one matcher (Android's Kotlin port in Phase 10 passes the same
 * golden vectors, `vectors.json`), so they always agree on a value. A pattern applies to the whole
 * value, as v1's did.
 */
import { PATTERN_INPUT_LIMIT, PATTERN_SOURCE_LIMIT, type PatternRefusalReason } from './limits.js';
import { PatternRefusal, parsePattern } from './parse.js';
import { compileProgram, runProgram, type Program } from './vm.js';

export {
  PATTERN_INPUT_LIMIT,
  PATTERN_PROGRAM_LIMIT,
  PATTERN_REFUSAL_REASONS,
  PATTERN_SOURCE_LIMIT,
  type PatternRefusalReason,
} from './limits.js';

/** An opaque compiled pattern. */
export interface CompiledPattern {
  readonly source: string;
}

export type CompilePatternResult =
  | { readonly ok: true; readonly pattern: CompiledPattern }
  | { readonly ok: false; readonly reason: string; readonly index: number | null };

/** Each compiled pattern's program, kept out of the object a caller holds. */
const PROGRAMS = new WeakMap<CompiledPattern, Program>();

function programOf(source: string): Program | PatternRefusal {
  if (source.length === 0) return new PatternRefusal('empty', null);
  if (source.length > PATTERN_SOURCE_LIMIT) return new PatternRefusal('too_long', null);
  try {
    return compileProgram(parsePattern(source));
  } catch (error) {
    if (error instanceof PatternRefusal) return error;
    throw error;
  }
}

/** The pattern compiled, or the reason (`pattern_refused`) and where it starts. */
export function compilePattern(source: string): CompilePatternResult {
  const program = programOf(source);
  if (program instanceof PatternRefusal) {
    const reason: PatternRefusalReason = program.reason;
    return { ok: false, reason, index: program.index };
  }
  const pattern: CompiledPattern = Object.freeze({ source });
  PROGRAMS.set(pattern, program);
  return { ok: true, pattern };
}

/**
 * Whether the whole of `input` matches. An input past `PATTERN_INPUT_LIMIT` does not match, and
 * neither does anything for a pattern that cannot be compiled (failing closed).
 */
export function matchPattern(pattern: CompiledPattern, input: string): boolean {
  if (input.length > PATTERN_INPUT_LIMIT) return false;
  let program = PROGRAMS.get(pattern);
  if (program === undefined) {
    const compiled = programOf(pattern.source);
    if (compiled instanceof PatternRefusal) return false;
    program = compiled;
  }
  return runProgram(program, input);
}
