import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PATTERN_VECTOR_SOURCES,
  generatePatternVectors,
  regExpAnswer,
  type PatternVectors,
} from '../../../scripts/pattern-vector-sources.js';
import {
  PATTERN_INPUT_LIMIT,
  PATTERN_PROGRAM_LIMIT,
  PATTERN_REFUSAL_REASONS,
  compilePattern,
  matchPattern,
  type CompiledPattern,
} from './index.js';

const committed = JSON.parse(
  readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'),
) as PatternVectors;

function compiled(source: string): CompiledPattern {
  const result = compilePattern(source);
  if (!result.ok) {
    throw new Error(`refused ${source}: ${result.reason}`);
  }
  return result.pattern;
}

/** CPU time, not wall time (rule 6), as `cpuMilliseconds` of packages/checks measures it. */
function cpuMilliseconds(run: () => void): number {
  const before = process.cpuUsage();
  run();
  const used = process.cpuUsage(before);
  return (used.user + used.system) / 1000;
}

describe('the golden vectors (C148.3, P03, V10)', () => {
  it('are the file scripts/write-pattern-vectors.ts writes (not stale)', () => {
    expect(committed).toEqual(generatePatternVectors(PATTERN_VECTOR_SOURCES));
    expect(committed.matches.length).toBeGreaterThan(500);
  });

  it('agree with RegExp and with our matcher on every match vector', () => {
    const disagreements = committed.matches.filter(
      ({ pattern, input, matches }) =>
        regExpAnswer(pattern, input) !== matches ||
        matchPattern(compiled(pattern), input) !== matches,
    );
    expect(disagreements).toEqual([]);
  });

  it('refuse each refusal vector with its reason', () => {
    const answers = committed.refusals.map(({ pattern }) => {
      const result = compilePattern(pattern);
      return result.ok ? 'compiled' : result.reason;
    });
    expect(answers).toEqual(committed.refusals.map(({ reason }) => reason));
    for (const { reason } of committed.refusals) {
      expect(PATTERN_REFUSAL_REASONS).toContain(reason);
    }
  });
});

describe('compilePattern', () => {
  it('gives the index of the refused construct, or null for the whole pattern', () => {
    expect(compilePattern('ab(?=c)')).toEqual({ ok: false, reason: 'lookaround', index: 2 });
    expect(compilePattern('x\\1')).toEqual({ ok: false, reason: 'backreference', index: 1 });
    expect(compilePattern('a'.repeat(501))).toEqual({ ok: false, reason: 'too_long', index: null });
  });

  it('keeps the source and nothing a caller could run', () => {
    const result = compilePattern('^[a-z]+$');
    expect(result.ok && result.pattern.source).toBe('^[a-z]+$');
    expect(Object.keys(result.ok ? result.pattern : {})).toEqual(['source']);
  });

  it('accepts a program up to its limit and refuses one past it', () => {
    const per = '[a-z]{100}';
    const fits = per.repeat(Math.floor(PATTERN_PROGRAM_LIMIT / 100) - 1);
    expect(compilePattern(fits).ok).toBe(true);
    expect(compilePattern(per.repeat(Math.floor(PATTERN_PROGRAM_LIMIT / 100) + 1))).toMatchObject({
      ok: false,
      reason: 'pattern_too_complex',
    });
  });
});

describe('matchPattern', () => {
  it('refuses an input past the 10,000-character cap before matching', () => {
    const any = compiled('[^]*');
    expect(matchPattern(any, 'a'.repeat(PATTERN_INPUT_LIMIT))).toBe(true);
    expect(matchPattern(any, 'a'.repeat(PATTERN_INPUT_LIMIT + 1))).toBe(false);
  });

  it('matches nothing for a pattern it did not compile and cannot compile, failing closed', () => {
    expect(matchPattern({ source: '(a)\\1' }, 'aa')).toBe(false);
    expect(matchPattern({ source: 'ab' }, 'ab')).toBe(true);
  });
});

describe('linear time on the pathological patterns (P03; rule 6, CPU time)', () => {
  /**
   * Budget: 500 ms of CPU for one 10,000-character match (provisional; basis: the Pike VM visits
   * each instruction at most once per input character, and these took at most 74 ms each with
   * coverage instrumentation on, at a load of 1 to 4, so the budget leaves about seven times that
   * for a slower CI runner). A backtracking engine takes 2^n steps on the first two and n^5 on the
   * third, far past any budget.
   */
  const BUDGET_MS = 500;
  const PATHOLOGICAL: readonly [string, string][] = [
    ['(?:a|a)*', `${'a'.repeat(PATTERN_INPUT_LIMIT - 1)}b`],
    ['(?:a|ab|b)*c', 'ab'.repeat(PATTERN_INPUT_LIMIT / 2)],
    ['a*a*a*a*a*b', 'a'.repeat(PATTERN_INPUT_LIMIT)],
    ['.*.*.*.*=x', 'x='.repeat(PATTERN_INPUT_LIMIT / 2)],
    ['(?:\\w|\\d|[a-z0-9_])*!', 'a1_'.repeat(3333)],
    ['[a-z]{100}'.repeat(19), 'a'.repeat(PATTERN_INPUT_LIMIT)],
  ];

  it.each(PATHOLOGICAL)('%s on 10,000 characters stays within the budget', (source, input) => {
    const pattern = compiled(source);
    let answer = true;
    const spent = cpuMilliseconds(() => {
      answer = matchPattern(pattern, input);
    });
    expect(answer).toBe(false);
    expect(spent).toBeLessThan(BUDGET_MS);
  });
});
