/**
 * C252 (Workflow 11B, ingestion-11b; hardening H16, G-REGEX, BX-D1): operator text becomes a
 * pattern only through C148.3's restricted grammar and linear-time matcher, or it is refused at
 * write time. This holds flow-spec's two entry points to the known catastrophic pattern, `(a+)+$`
 * over 10,000 `a`s and a `!`, each refused or matched within 50 ms of CPU time:
 * - a flow-spec 1 text field's `validation.pattern` (`flow.ts`), which was compiled with the
 *   native engine to check its syntax; it is now checked with `compilePattern` at write
 *   (`v1FieldPatternProblems`, called by the API's save and publish rules), while a stored flow
 *   whose pattern the grammar refuses still parses, because stored versions are never rewritten
 *   (the v2 migration already reports such a pattern, `pattern_refused`);
 * - C148.3's own `compilePattern` and `matchPattern`, which the v2 publish rule, the server's
 *   screen submission and both clients call.
 */
import { describe, expect, it } from 'vitest';
import { parseFlow, safeParseFlow, v1FieldPatternProblems } from './flow.js';
import { mutateFlow, stepIndex } from './test-fixtures.js';
import { baseFlow } from './v2/golden/graph-cases.js';
import { checkFlowGraph } from './v2/graph.js';
import { migrateFlowWithNotes } from './v2/migrate.js';
import { PATTERN_INPUT_LIMIT, compilePattern, matchPattern } from './v2/pattern/index.js';
import { flowV2Schema } from './v2/schemas/flow.js';

/** The plan's known catastrophic pattern and input (C252.3). */
const CATASTROPHIC = '(a+)+$';
const CATASTROPHIC_INPUT = `${'a'.repeat(10_000)}!`;
/** C252.3's budget for one refusal or one match, in CPU milliseconds (rule 6: never the wall clock). */
const CPU_BUDGET_MS = 50;

/**
 * The CPU time `run` takes, as `packages/checks/src/document/testing.ts`'s `cpuMilliseconds`
 * measures it (that helper is the checks package's own, which flow-spec cannot import).
 *
 * The least of three runs, as its `cpuRatio` takes the least of its rounds, so a garbage collection
 * another test's allocations started inside one run is not counted (rule 6: the budget held only
 * one test under the load of a whole shard).
 */
function cpuMilliseconds(run: () => void): number {
  let least = Number.POSITIVE_INFINITY;
  for (let round = 0; round < 3; round += 1) {
    const before = process.cpuUsage();
    run();
    const used = process.cpuUsage(before);
    least = Math.min(least, (used.user + used.system) / 1000);
  }
  return least;
}

/** The fixture flow with its first text field's pattern set to `pattern`. */
function withPattern(pattern: string): Record<string, unknown> {
  return mutateFlow((flow) => {
    const step = flow.steps[stepIndex('details')] as { fields: { validation: object }[] };
    const field = step.fields[0];
    if (field === undefined) throw new Error('the fixture lost its text field');
    field.validation = { ...field.validation, pattern };
  });
}

const POINTER = `/steps/${String(stepIndex('details'))}/fields/0/validation/pattern`;

describe('a flow-spec 1 text field pattern (C252, C148.3)', () => {
  it('refuses the catastrophic pattern at write, within 50 ms of CPU', () => {
    const flow = parseFlow(withPattern(CATASTROPHIC));
    let problems: ReturnType<typeof v1FieldPatternProblems> = [];
    const cpu = cpuMilliseconds(() => {
      problems = v1FieldPatternProblems(flow);
    });

    expect(problems).toEqual([
      {
        pointer: POINTER,
        code: 'pattern_refused',
        detail: 'The pattern is outside the restricted grammar (nested_quantifier)',
      },
    ]);
    expect(cpu).toBeLessThan(CPU_BUDGET_MS);
  });

  it.each([
    ['([a-z', 'syntax'],
    ['(a)\\1', 'backreference'],
    ['(?=a)a', 'lookaround'],
    ['(?<first>a)', 'named_group'],
    ['a{1000}', 'quantifier_too_large'],
  ])('refuses %s at write with the reason C148.3 gives (%s)', (pattern, reason) => {
    expect(compilePattern(pattern)).toMatchObject({ ok: false, reason });
    expect(v1FieldPatternProblems(parseFlow(withPattern(pattern)))).toEqual([
      {
        pointer: POINTER,
        code: 'pattern_refused',
        detail: `The pattern is outside the restricted grammar (${reason})`,
      },
    ]);
  });

  it('accepts a pattern in the grammar, and a field without one', () => {
    expect(v1FieldPatternProblems(parseFlow(withPattern('^[^0-9]+$')))).toEqual([]);
    const plain = mutateFlow((flow) => {
      const step = flow.steps[stepIndex('details')] as { fields: { validation?: object }[] };
      for (const field of step.fields) delete field.validation;
    });
    expect(v1FieldPatternProblems(parseFlow(plain))).toEqual([]);
  });

  it('lists every refused field of every form step, in order', () => {
    const flow = mutateFlow((flow) => {
      const index = stepIndex('details');
      const step = flow.steps[index] as { fields: Record<string, unknown>[] };
      step.fields.push({
        type: 'text',
        name: 'nickname',
        labelKey: 'form.nickname',
        required: false,
        validation: { pattern: CATASTROPHIC },
      });
      const first = step.fields[0] as { validation: object };
      first.validation = { ...first.validation, pattern: '(a*)*' };
    });
    const index = stepIndex('details');
    const parsed = parseFlow(flow);
    const last = (parsed.steps[index] as { fields: unknown[] }).fields.length - 1;
    expect(v1FieldPatternProblems(parsed).map((problem) => problem.pointer)).toEqual([
      `/steps/${String(index)}/fields/0/validation/pattern`,
      `/steps/${String(index)}/fields/${String(last)}/validation/pattern`,
    ]);
  });

  it('still parses a stored flow whose pattern the grammar refuses (stored versions are never rewritten)', () => {
    for (const pattern of [CATASTROPHIC, '([a-z', '(a)\\1']) {
      expect(safeParseFlow(withPattern(pattern)).success).toBe(true);
    }
  });

  it('keeps the 500-character bound on a stored pattern', () => {
    expect(safeParseFlow(withPattern('a'.repeat(501))).success).toBe(false);
  });
});

describe('C148.3’s matcher, which every other entry point calls (C252.3)', () => {
  it('refuses the catastrophic pattern within 50 ms of CPU', () => {
    let result: ReturnType<typeof compilePattern> | undefined;
    const cpu = cpuMilliseconds(() => {
      result = compilePattern(CATASTROPHIC);
    });

    expect(result).toMatchObject({ ok: false, reason: 'nested_quantifier' });
    expect(cpu).toBeLessThan(CPU_BUDGET_MS);
  });

  it.each(['^(a|aa)*$', '(a|a)*$', '^a*a*a*a*$'])(
    'matches the catastrophic input against an ambiguous pattern it accepts (%s), within 50 ms of CPU',
    (pattern) => {
      const compiled = compilePattern(pattern);
      if (!compiled.ok) throw new Error(`refused ${pattern}: ${compiled.reason}`);
      const atLimit = `${'a'.repeat(PATTERN_INPUT_LIMIT - 1)}!`;
      let matched: boolean[] = [];
      const cpu = cpuMilliseconds(() => {
        matched = [
          matchPattern(compiled.pattern, atLimit),
          matchPattern(compiled.pattern, 'a'.repeat(PATTERN_INPUT_LIMIT)),
          matchPattern(compiled.pattern, CATASTROPHIC_INPUT),
        ];
      });

      // The last input is 10,001 characters, past the cap, so it never reaches the matcher.
      expect(matched).toEqual([false, true, false]);
      expect(cpu).toBeLessThan(CPU_BUDGET_MS * 3);
    },
  );
});

describe('the entry points that already compile through C148.3 (C252.3)', () => {
  it('refuses the catastrophic pattern in a v2 screen component at publish, within 50 ms of CPU', () => {
    const flow = baseFlow();
    const screen = flow.steps.find((step) => step.id === 'details') as {
      components: Record<string, unknown>[];
    };
    const nickname = screen.components[1];
    if (nickname === undefined) throw new Error('the golden base lost its nickname input');
    nickname.pattern = CATASTROPHIC;
    const parsed = flowV2Schema.parse(flow);
    checkFlowGraph(flowV2Schema.parse(baseFlow()), { mode: 'publish' }); // warm the rules once
    let problems: ReturnType<typeof checkFlowGraph> = [];
    const cpu = cpuMilliseconds(() => {
      problems = checkFlowGraph(parsed, { mode: 'publish' });
    });

    expect(problems).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'pattern_refused',
        pointer: '/steps/1/components/1/pattern',
      }),
    );
    expect(cpu).toBeLessThan(CPU_BUDGET_MS);
  });

  it('notes the catastrophic pattern of a v1 field when the flow is migrated to v2', () => {
    const { notes } = migrateFlowWithNotes(parseFlow(withPattern(CATASTROPHIC)));
    expect(notes).toContainEqual(
      expect.objectContaining({ code: 'pattern_refused', pointer: POINTER }),
    );
  });
});
