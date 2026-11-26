/**
 * C156.4 (Workflow 9B, api-templates-carry): the simulated path and outcome of a template version,
 * walked by the engine's own functions over a simulated scope. Every value is synthetic.
 */
import { readFileSync } from 'node:fs';
import { defaultInquiryTemplateAttributes, type SimulatedScope } from '@openverify/contracts';
import { flowV2Schema, type FlowV2 } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import {
  simulateFlow,
  SimulationScopeError,
  type SimulationContext,
  type TemplateSimulation,
} from './simulate.js';

const fixture = (path: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../../../contracts/fixtures/${path}`, import.meta.url), 'utf8'),
  ) as unknown;

const flowOf = (name: string): FlowV2 => flowV2Schema.parse(fixture(`flows/v2/${name}.json`));

const config = defaultInquiryTemplateAttributes()['verification-config'];
const NOW = new Date('2026-11-05T12:00:00.000Z');
const context: SimulationContext = { verificationConfig: config, fieldSchemas: [], now: NOW };

const simulate = (flow: FlowV2, scope: SimulatedScope, more: Partial<SimulationContext> = {}) =>
  simulateFlow(flow, scope, { ...context, ...more });

const pathOf = (simulation: TemplateSimulation) =>
  simulation.steps.map((step) => `${step['step-id']}:${step.port ?? '-'}`);

/** A flow built here, held to the v2 schema. */
const flow = (steps: unknown[], edges: [string, string, string][], entry = 'consent'): FlowV2 =>
  flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'simulated', version: 1, name: 'Simulated' },
    entry,
    steps: [
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      ...steps,
      { id: 'done', type: 'completion' },
      { id: 'refused', type: 'failure' },
    ],
    edges: edges.map(([from, port, to], index) => ({
      id: `e${String(index)}`,
      from,
      port,
      to,
    })),
  });

const ID_STEP = {
  id: 'id_card',
  type: 'government_id',
  sides: 'front',
  maxAttempts: 2,
  captureMethods: ['camera'],
};

describe('simulateFlow (C156.4)', () => {
  it('walks the golden flow to the golden answer: a minor takes the route to the extra screen', () => {
    const simulation = simulate(flowOf('projection-branch'), {
      verifications: { id_card: { status: 'passed', extractions: { 'age-years': 16 } } },
    });
    const golden = fixture('api/template-simulation.json') as {
      data: { attributes: TemplateSimulation };
    };
    expect(simulation).toEqual(golden.data.attributes);
  });

  it('takes else when no route holds, with the route result false', () => {
    const simulation = simulate(flowOf('projection-branch'), {
      verifications: { id_card: { status: 'passed', extractions: { 'age-years': 30 } } },
    });
    expect(pathOf(simulation)).toEqual([
      'consent:next',
      'id_card:next',
      'age_route:else',
      'done:-',
    ]);
    expect(simulation.steps[2]?.route).toEqual({
      key: null,
      'condition-result': false,
      'on-null': null,
      'null-paths': [],
    });
    expect(simulation.outcome.status).toBe('completed');
  });

  it("follows the route's onNull for a fact the scope leaves unknown, never reading it as false", () => {
    const simulation = simulate(flowOf('projection-branch'), {
      verifications: { id_card: { status: 'passed' } },
    });
    expect(simulation.steps[2]).toMatchObject({
      port: 'else',
      route: {
        key: null,
        'condition-result': null,
        'on-null': 'else',
        'null-paths': ['verifications.id_card.age-years'],
      },
    });
  });

  it('computes age-years from a simulated birthdate, as the engine does', () => {
    const simulation = simulate(flowOf('projection-branch'), {
      verifications: { id_card: { status: 'passed', extractions: { birthdate: '2012-01-01' } } },
    });
    expect(simulation.steps[2]?.port).toBe('route:minor');
  });

  it("derives a verification's status from its per-check overrides through core's decision", () => {
    const failed = simulate(flowOf('projection-exhausted'), {
      verifications: {
        id_card: { checks: { id_expired_detection: 'failed' } },
        proof: { status: 'passed' },
      },
    });
    expect(pathOf(failed)).toEqual(['consent:next', 'id_card:exhausted', 'proof:next', 'done:-']);
    expect(failed.outcome).toEqual({
      status: 'needs_review',
      'flow-outcome': {
        'verification-types-on-path': ['government-id', 'document'],
        'fallbacks-taken': ['id_card'],
        flags: [],
      },
    });
    // An advisory check that fails never changes the decision.
    const advisory = simulate(flowOf('projection-exhausted'), {
      verifications: { id_card: { checks: { id_barcode_detection: 'failed' } } },
    });
    expect(pathOf(advisory)).toEqual(['consent:next', 'id_card:next', 'done:-']);
    expect(advisory.outcome.status).toBe('completed');
  });

  it('reads an errored required check as null of the review class, and decides review', () => {
    const errored = simulate(flowOf('projection-exhausted'), {
      verifications: { id_card: { checks: { id_expired_detection: null } } },
    });
    expect(pathOf(errored)).toEqual(['consent:next', 'id_card:next', 'done:-']);
    expect(errored.outcome.status).toBe('needs_review');
    const branchOnCheck = flow(
      [
        ID_STEP,
        {
          id: 'expiry',
          type: 'branch',
          routes: [
            {
              key: 'current',
              label: 'Not expired',
              condition: {
                '===': [
                  { var: 'verifications.id_card.checks.id_barcode_detection.status' },
                  'passed',
                ],
              },
              onNull: 'else',
            },
          ],
        },
      ],
      [
        ['consent', 'next', 'id_card'],
        ['id_card', 'next', 'expiry'],
        ['expiry', 'route:current', 'done'],
        ['expiry', 'else', 'done'],
      ],
    );
    const simulation = simulate(branchOnCheck, {
      verifications: { id_card: { checks: { id_barcode_detection: null } } },
    });
    expect(simulation.steps[2]).toMatchObject({
      'step-id': 'expiry',
      port: 'else',
      notes: ['review-class-null'],
    });
    expect(simulation.outcome.status).toBe('needs_review');
  });

  it('refuses a status that its own checks contradict, at its pointer', () => {
    expect(() =>
      simulate(flowOf('projection-exhausted'), {
        verifications: {
          id_card: { status: 'passed', checks: { id_expired_detection: 'failed' } },
        },
      }),
    ).toThrow(
      expect.objectContaining({
        problems: [expect.objectContaining({ pointer: '/verifications/id_card/status' })],
      }),
    );
  });

  it('fails the inquiry at a verification that ends without passing and has no fallback', () => {
    const simulation = simulate(flowOf('projection-linear'), {
      verifications: { id_card: { status: 'failed' } },
    });
    expect(pathOf(simulation)).toEqual(['consent:next', 'id_card:-']);
    expect(simulation.outcome.status).toBe('failed');
    expect(simulation.halted).toBeNull();
  });

  it('stops, pending, at a verification the scope does not simulate', () => {
    const simulation = simulate(flowOf('projection-linear'), {
      verifications: { id_card: { status: 'passed' } },
    });
    expect(pathOf(simulation)).toEqual(['consent:next', 'id_card:next', 'face:-']);
    expect(simulation.outcome.status).toBe('pending');
  });

  it("marks a fallback taken with onFallback continue as the engine does, and doesn't flag review", () => {
    const fallback = flowOf('projection-exhausted');
    const steps = fallback.steps.map((step) =>
      step.id === 'id_card' ? { ...step, onFallback: 'continue' } : step,
    );
    const simulation = simulate(flowV2Schema.parse({ ...fallback, steps }), {
      verifications: { id_card: { status: 'failed' }, proof: { status: 'passed' } },
    });
    expect(simulation.steps[1]).toMatchObject({ port: 'exhausted', notes: ['fallback-continue'] });
    expect(simulation.outcome.status).toBe('completed');
  });

  it('records a flag_for_review action and sends the inquiry to review at completion', () => {
    const simulation = simulate(flowOf('projection-action'), {});
    expect(simulation.steps[1]).toMatchObject({
      'step-id': 'notify',
      'step-type': 'action',
      port: 'next',
      notes: ['flag_for_review:manual_check'],
    });
    expect(simulation.outcome.status).toBe('needs_review');
    expect(simulation.outcome['flow-outcome'].flags).toContain('flag_for_review:manual_check');
  });

  const workflowFlow = flow(
    [
      {
        id: 'enrich',
        type: 'action',
        action: {
          kind: 'run_workflow',
          workflowId: 'wfl_01M5CN00000000000000009B01',
          version: 'latest-published',
          timeoutSeconds: 30,
        },
      },
      {
        id: 'outcome_route',
        type: 'branch',
        routes: [
          {
            key: 'timed_out',
            label: 'Timed out',
            condition: { '===': [{ var: 'workflows.enrich.error-type' }, 'timeout'] },
            onNull: 'else',
          },
        ],
      },
    ],
    [
      ['consent', 'next', 'enrich'],
      ['enrich', 'next', 'done'],
      ['enrich', 'error', 'outcome_route'],
      ['outcome_route', 'route:timed_out', 'refused'],
      ['outcome_route', 'else', 'done'],
    ],
  );

  it('never runs a workflow: a run_workflow step takes the port its simulated status gives', () => {
    const completed = simulate(workflowFlow, {
      workflows: { enrich: { status: 'completed', outputs: { score: 3 } } },
    });
    expect(pathOf(completed)).toEqual(['consent:next', 'enrich:next', 'done:-']);
    const timedOut = simulate(workflowFlow, {
      workflows: { enrich: { status: 'timed-out', 'error-type': 'timeout' } },
    });
    expect(pathOf(timedOut)).toEqual([
      'consent:next',
      'enrich:error',
      'outcome_route:route:timed_out',
      'refused:-',
    ]);
    expect(timedOut.outcome.status).toBe('failed');
    // Not simulated: the path waits at the action, pending.
    const waiting = simulate(workflowFlow, {});
    expect(pathOf(waiting)).toEqual(['consent:next', 'enrich:-']);
    expect(waiting.outcome.status).toBe('pending');
  });

  const signalFlow = flow(
    [
      {
        id: 'bot_route',
        type: 'branch',
        waitFor: { facts: ['signals.inquiry/bot_score'], maxSeconds: 5 },
        routes: [
          {
            key: 'bot',
            label: 'Likely a bot',
            condition: { '>=': [{ var: 'signals.inquiry/bot_score' }, 90] },
            onNull: 'review',
          },
        ],
      },
    ],
    [
      ['consent', 'next', 'bot_route'],
      ['bot_route', 'route:bot', 'refused'],
      ['bot_route', 'else', 'done'],
    ],
  );

  it('lets a provisional signal choose a route, with the tier, stage and source of what it read', () => {
    const simulation = simulate(signalFlow, { signals: { 'inquiry/bot_score': 95 } });
    expect(simulation.steps[1]).toMatchObject({
      'step-id': 'bot_route',
      port: 'route:bot',
      waited: false,
      facts: [expect.objectContaining({ path: 'signals.inquiry/bot_score' })],
    });
    expect(simulation.steps[1]?.facts[0]?.tier).not.toBeUndefined();
    expect(simulation.outcome.status).toBe('failed');
  });

  it('waits for a missing fact until the deadline, then follows onNull', () => {
    const simulation = simulate(signalFlow, {});
    expect(simulation.steps[1]).toMatchObject({
      'step-id': 'bot_route',
      port: 'else',
      waited: true,
      notes: ['waited_for_facts', 'on-null-review'],
      route: { 'on-null': 'review', 'null-paths': ['signals.inquiry/bot_score'] },
    });
    expect(simulation.outcome.status).toBe('needs_review');
  });

  it('halts with scope_path_missing on a fact the flow scope no longer has, never taking else', () => {
    const missing = flow(
      [
        {
          id: 'list_route',
          type: 'branch',
          routes: [
            {
              key: 'matched',
              label: 'Matched',
              condition: { '>': [{ var: 'signals.inquiry/list_match_count' }, 0] },
              onNull: 'else',
            },
          ],
        },
      ],
      [
        ['consent', 'next', 'list_route'],
        ['list_route', 'route:matched', 'refused'],
        ['list_route', 'else', 'done'],
      ],
    );
    const simulation = simulate(missing, {});
    expect(simulation.halted).toBe('scope_path_missing');
    expect(simulation.steps.at(-1)).toMatchObject({
      'step-id': 'list_route',
      port: null,
      notes: ['scope_path_missing'],
    });
    expect(simulation.outcome.status).toBe('needs_review');
  });

  it('applies a tag_inquiry action to the scope a later branch reads', () => {
    const tagged = flow(
      [
        { id: 'tag', type: 'action', action: { kind: 'tag_inquiry', add: ['vip'] } },
        {
          id: 'vip_route',
          type: 'branch',
          routes: [
            {
              key: 'vip',
              label: 'VIP',
              condition: { in: ['vip', { var: 'inquiry.tags' }] },
            },
          ],
        },
      ],
      [
        ['consent', 'next', 'tag'],
        ['tag', 'next', 'vip_route'],
        ['tag', 'error', 'done'],
        ['vip_route', 'route:vip', 'done'],
        ['vip_route', 'else', 'refused'],
      ],
    );
    expect(pathOf(simulate(tagged, {}))).toEqual([
      'consent:next',
      'tag:next',
      'vip_route:route:vip',
      'done:-',
    ]);
  });

  it('reads a verification only once the path has entered its step, as the live scope does', () => {
    const early = flow(
      [
        {
          id: 'early_route',
          type: 'branch',
          routes: [
            {
              key: 'passed',
              label: 'Passed',
              condition: { '===': [{ var: 'verifications.id_card.status' }, 'passed'] },
              onNull: 'else',
            },
          ],
        },
        ID_STEP,
      ],
      [
        ['consent', 'next', 'early_route'],
        ['early_route', 'route:passed', 'done'],
        ['early_route', 'else', 'id_card'],
        ['id_card', 'next', 'done'],
      ],
    );
    const simulation = simulate(early, { verifications: { id_card: { status: 'passed' } } });
    expect(pathOf(simulation)).toEqual([
      'consent:next',
      'early_route:else',
      'id_card:next',
      'done:-',
    ]);
  });

  it('halts with flow_loop_limit past the per-step cap', () => {
    const loop = flow(
      [
        {
          id: 'ask',
          type: 'screen',
          components: [{ id: 'go', kind: 'button', labelKey: 'ask.go.button', action: 'submit' }],
        },
        {
          id: 'again',
          type: 'branch',
          routes: [{ key: 'never', label: 'Never', condition: { '===': [1, 2] } }],
        },
      ],
      [
        ['consent', 'next', 'ask'],
        ['ask', 'next', 'again'],
        ['again', 'route:never', 'done'],
        ['again', 'else', 'ask'],
      ],
    );
    const simulation = simulate(loop, {});
    expect(simulation.halted).toBe('flow_loop_limit');
    expect(simulation.outcome.status).toBe('pending');
    // Twenty entries, then the one the engine records the halt on (C151.2).
    expect(simulation.steps.filter((step) => step['step-id'] === 'ask')).toHaveLength(21);
    expect(simulation.steps.at(-1)).toMatchObject({
      'step-id': 'ask',
      port: null,
      notes: ['flow_loop_limit'],
    });
  });

  it.each([
    [{ verifications: { nowhere: { status: 'passed' } } }, '/verifications/nowhere'],
    [{ verifications: { consent: { status: 'passed' } } }, '/verifications/consent'],
    [
      { verifications: { id_card: { checks: { selfie_pose_detection: 'passed' } } } },
      '/verifications/id_card/checks/selfie_pose_detection',
    ],
    [
      { verifications: { id_card: { extractions: { 'document-type': 'passport' } } } },
      '/verifications/id_card/extractions/document-type',
    ],
    [
      { verifications: { id_card: { attempts: 5, status: 'passed' } } },
      '/verifications/id_card/attempts',
    ],
    [{ signals: { 'inquiry/list_match_count': 1 } }, '/signals/inquiry~1list_match_count'],
    [{ workflows: { consent: { status: 'completed' } } }, '/workflows/consent'],
  ] as [SimulatedScope, string][])(
    'refuses a scope member the version does not hold (%j), at %s',
    (scope, pointer) => {
      let thrown: unknown;
      try {
        simulate(flowOf('projection-linear'), scope);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(SimulationScopeError);
      expect((thrown as SimulationScopeError).problems.map((problem) => problem.pointer)).toEqual([
        pointer,
      ]);
    },
  );

  it('refuses per-check overrides for a type the version does not configure', () => {
    expect(() =>
      simulate(
        flowOf('projection-linear'),
        { verifications: { id_card: { checks: { id_expired_detection: 'failed' } } } },
        { verificationConfig: {} },
      ),
    ).toThrow(SimulationScopeError);
  });
});
