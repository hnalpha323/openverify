import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FLOW_GRAPH_PROBLEM_CODES,
  FLOW_GRAPH_WARNING_CODES,
  checkFieldSchemaChanges,
  checkFlowGraph,
  type FlowGraphOptions,
} from './graph.js';
import {
  BASE_PROBLEMS,
  GRAPH_CASES,
  baseFlow,
  type ExpectedProblem,
} from './golden/graph-cases.js';
import { graphGoldens } from './golden/graph-golden.js';
import { flowV2Schema } from './schemas/flow.js';
import { FLOW_V2_CAPS } from './schemas/common.js';

const GOLDEN = new URL('./golden/graph/', import.meta.url);

const keyOf = ([severity, code, pointer]: ExpectedProblem): string =>
  `${severity} ${code} ${pointer}`;

function problemsOf(flow: unknown, options: Partial<FlowGraphOptions> = {}): string[] {
  return checkFlowGraph(flowV2Schema.parse(flow), { mode: 'publish', ...options })
    .map(({ severity, code, pointer }) => keyOf([severity, code, pointer]))
    .sort();
}

describe('checkFlowGraph: the golden flows (C147.6, C147.5, C148.3, C148.4, C152.1)', () => {
  it('the base flow has only its spec-1 warnings', () => {
    expect(problemsOf(baseFlow())).toEqual(BASE_PROBLEMS.map(keyOf).sort());
  });

  it('every golden file is the one the cases write (not stale)', () => {
    const goldens = graphGoldens();
    const files = readdirSync(GOLDEN).filter((file) => file.endsWith('.json'));
    expect(files.sort()).toEqual(goldens.map(([name]) => `${name}.json`).sort());
    for (const [name, content] of goldens) {
      expect(JSON.parse(readFileSync(new URL(`${name}.json`, GOLDEN), 'utf8'))).toEqual(content);
    }
  });

  it.each(GRAPH_CASES.map((golden) => [golden.name, golden] as const))('%s', (_name, golden) => {
    const base = new Set(BASE_PROBLEMS.map(keyOf));
    const found = problemsOf(golden.flow, golden.options);
    expect(found.filter((key) => !base.has(key))).toEqual(golden.added.map(keyOf).sort());
    expect([...base].filter((key) => !found.includes(key))).toEqual([]);
  });

  it('gives each problem a known code, an RFC 6901 pointer and a detail', () => {
    for (const golden of GRAPH_CASES) {
      const problems = checkFlowGraph(flowV2Schema.parse(golden.flow), {
        mode: 'publish',
        ...golden.options,
      });
      for (const problem of problems) {
        const codes: readonly string[] =
          problem.severity === 'error' ? FLOW_GRAPH_PROBLEM_CODES : FLOW_GRAPH_WARNING_CODES;
        expect(codes).toContain(problem.code);
        // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
        expect(problem.pointer).toMatch(/^(?:\/[^/]*)*$/);
        expect(problem.detail.length).toBeGreaterThan(0);
      }
    }
  });

  it('runs every rule in both modes', () => {
    for (const golden of GRAPH_CASES) {
      const flow = flowV2Schema.parse(golden.flow);
      expect(checkFlowGraph(flow, { mode: 'save', ...golden.options })).toEqual(
        checkFlowGraph(flow, { mode: 'publish', ...golden.options }),
      );
    }
    expect(checkFlowGraph(flowV2Schema.parse(baseFlow()))).toHaveLength(BASE_PROBLEMS.length);
  });

  it('refuses a flow past 512 KiB serialised (C147.5)', () => {
    const flow = baseFlow();
    const keys = Array.from(
      { length: 70 },
      (_unused, index) => `consent.${String(index).padStart(3, '0')}.${'k'.repeat(185)}`,
    );
    for (let index = 0; index < 40; index += 1) {
      flow.steps.push({
        id: `more_${String(index)}`,
        type: 'consent',
        textKeys: keys,
        required: true,
      });
    }
    const problems = problemsOf(flow);
    expect(problems).toContain('error flow_too_large ');
    expect(JSON.stringify(flow).length).toBeGreaterThan(FLOW_V2_CAPS.flowBytes);
  });
});

describe('checkFieldSchemaChanges (C149.2)', () => {
  const field = (key: string, type: string) => ({ key, type });

  it('keeps a key’s type in every later version', () => {
    expect(
      checkFieldSchemaChanges(
        [field('nickname', 'integer'), field('country', 'string'), field('extra', 'boolean')],
        [[field('nickname', 'string'), field('gone', 'date')], [field('country', 'string')]],
      ),
    ).toEqual([
      {
        pointer: '/0/type',
        code: 'field_type_changed',
        detail: 'Field "nickname" was published as string and keeps that type',
        severity: 'error',
      },
    ]);
  });

  it('caps the fields at 1,000', () => {
    const many = Array.from({ length: 1001 }, (_unused, index) =>
      field(`f${String(index)}`, 'string'),
    );
    expect(checkFieldSchemaChanges(many, []).map(({ code, pointer }) => [code, pointer])).toEqual([
      ['fields_too_many', ''],
    ]);
    expect(checkFieldSchemaChanges(many.slice(1), [])).toEqual([]);
  });
});
