/**
 * Workflow 10B (`api-integrity`; C210.5, a Phase 8 publish-check amendment): a workflow's decline and
 * every other adverse step reached from a route reading a `decisive-alone: false` signal, with no
 * `run_verification` and route on its outcome in between, is refused in every environment
 * (`signal_not_decisive_alone`), not only warned; a path reading such a signal asks
 * `heuristic:<step id>` in production, whatever the signal's tier. Every value is synthetic.
 */
import type { WorkflowDefinition } from '@openverify/contracts';
import { analyzeAdverseSteps, checkDefinition } from '@openverify/workflow-engine';
import { describe, expect, it } from 'vitest';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';
import { evaluatePublishRules, type PublishFacts, type PublishRuleReport } from './rules.js';
import { chain, decline } from './testing.js';

const BASIS = {
  'decision-basis': 'contract',
  'contest-route': { url: 'https://help.example.com/contest' },
  'biometric-basis': 'explicit-consent',
};

const FACTS: PublishFacts = {
  environmentKind: 'production',
  flowHost: 'flow.example.com',
  linkHosts: ['help.example.com'],
  emailRecipients: [],
  smsRecipients: [],
  boundAdapters: new Set(['none']),
  listPurposes: new Map(),
  transactionAdverseStatuses: new Set(['declined']),
  transactionTypesContest: false,
  accountTypesContest: false,
  secrets: new Map(),
  knownReferences: new Set(),
  exposeSignals: true,
};

function evaluate(
  definition: WorkflowDefinition,
  facts: Partial<PublishFacts> = {},
): PublishRuleReport {
  return evaluatePublishRules({
    definition,
    analyses: analyzeAdverseSteps(definition, { registry: WORKFLOW_ACTIONS }),
    egress: checkDefinition(definition, {
      kind: 'workflow',
      mode: 'publish',
      registry: WORKFLOW_ACTIONS,
    }).egress,
    registry: WORKFLOW_ACTIONS,
    facts: { ...FACTS, ...facts },
  });
}

/** A route on `condition` to a decline with its basis; else the output. */
function onSignal(condition: unknown): WorkflowDefinition {
  const definition = chain([
    {
      id: 'device',
      type: 'conditional',
      name: 'device',
      routes: [{ key: 'hit', label: 'Hit', condition, 'on-null': 'skip-route' }],
    },
    decline('no', BASIS),
  ]);
  definition.edges = [
    { id: 'e0', from: 'trigger', 'from-port': 'next', to: 'device' },
    { id: 'e1', from: 'device', 'from-port': 'route:hit', to: 'no' },
    { id: 'e2', from: 'device', 'from-port': 'else', to: 'output' },
    { id: 'e3', from: 'no', 'from-port': 'next', to: 'output' },
  ];
  return definition;
}

const ROOTED = { '===': [{ var: 'trigger.signals.device_rooted' }, true] };

describe('signal_not_decisive_alone on a workflow (C210.5)', () => {
  it('refuses the decline in production and in a sandbox alike', () => {
    for (const environmentKind of ['production', 'sandbox'] as const) {
      const report = evaluate(onSignal(ROOTED), { environmentKind });
      expect(report.errors, environmentKind).toEqual([
        expect.objectContaining({ code: 'signal_not_decisive_alone', pointer: '/steps/1' }),
      ]);
      expect(report.errors[0]?.detail).toContain('inquiry/device_rooted');
    }
  });

  it('refuses it whatever the route joins: a trivially true fact with and, an unrelated one with or', () => {
    expect(
      evaluate(onSignal({ and: [ROOTED, { '===': [1, 1] }] })).errors.map(({ code }) => code),
    ).toEqual(['signal_not_decisive_alone']);
    expect(
      evaluate(
        onSignal({ or: [ROOTED, { '===': [{ var: 'trigger.status' }, 'completed'] }] }),
      ).errors.map(({ code }) => code),
    ).toEqual(['signal_not_decisive_alone']);
  });

  it('asks heuristic:<step id> in production for an A-tier signal read on the path', () => {
    const report = evaluate(
      onSignal({ '===': [{ var: 'trigger.signals.app_recognized' }, false] }),
    );
    expect(report.acknowledgements.map(({ key }) => key)).toContain('heuristic:no');
  });

  it('leaves a decisive signal alone', () => {
    const report = evaluate(onSignal({ '>': [{ var: 'trigger.signals.bot_score' }, 80] }));
    expect(report.errors).toEqual([]);
    expect(report.acknowledgements.map(({ key }) => key)).not.toContain('heuristic:no');
  });
});
