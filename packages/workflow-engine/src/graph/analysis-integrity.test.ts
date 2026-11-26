/**
 * Workflow 10B (`api-integrity`; C210.5): what the adverse-step analysis says about signals that are
 * not decisive alone (`signalsNotDecisiveAlone`, the predicate Phase 9's flow rules share). A path to
 * an adverse step that reads one is `nonDecisiveSignals` (publish then asks `heuristic:<step id>`,
 * whatever the signal's tier); one read by a route from which the step is reached with no
 * `run_verification` and no route on its outcome in between is `undecidedSignals` (publish refuses the
 * step). The routes after the signal's, and `else`, depend on it too.
 */
import type { WorkflowDefinition, WorkflowStep } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { analyzeAdverseSteps } from './analysis.js';
import { conditional } from './golden-invalid.js';
import { action, chain, edge, output, registry } from './testing.js';

const decline = (): WorkflowStep =>
  action('decline', 'decline_inquiry', { 'inquiry-id': '{{ trigger.id }}' });
const verify = (): WorkflowStep =>
  action('verify', 'run_verification', {
    'inquiry-id': '{{ trigger.id }}',
    'verification-type': 'database',
  });
const rooted = { '===': [{ var: 'trigger.signals.device_rooted' }, true] };

const analysisOf = (definition: WorkflowDefinition) => {
  const [analysis] = analyzeAdverseSteps(definition, { registry });
  if (analysis === undefined) {
    throw new Error('no adverse step');
  }
  return analysis;
};

function routed(
  condition: unknown,
  routePort: 'route:one' | 'else' = 'route:one',
): WorkflowDefinition {
  return chain([], {
    steps: [conditional('device', [{ key: 'one', label: 'One', condition }]), decline(), output()],
    edges: [
      edge('e0', 'trigger', 'next', 'device'),
      edge('e1', 'device', routePort, 'decline'),
      edge('e2', 'device', routePort === 'else' ? 'route:one' : 'else', 'output'),
      edge('e3', 'decline', 'next', 'output'),
    ],
  });
}

describe('signals that are not decisive alone (C210.5)', () => {
  it('golden: a decline right after a route on a device heuristic is undecided', () => {
    expect(analysisOf(routed(rooted))).toMatchObject({
      nonDecisiveSignals: ['inquiry/device_rooted'],
      undecidedSignals: ['inquiry/device_rooted'],
    });
  });

  it('golden: and with a trivially true fact, or with an unrelated one, changes nothing', () => {
    expect(analysisOf(routed({ and: [rooted, { '===': [1, 1] }] })).undecidedSignals).toEqual([
      'inquiry/device_rooted',
    ]);
    expect(
      analysisOf(routed({ or: [rooted, { '===': [{ var: 'trigger.status' }, 'completed'] }] }))
        .undecidedSignals,
    ).toEqual(['inquiry/device_rooted']);
  });

  it('golden: a decline behind else depends on the route too', () => {
    expect(
      analysisOf(
        routed(
          { in: [{ var: 'trigger.signals.device_integrity_level' }, ['strong', 'device']] },
          'else',
        ),
      ).undecidedSignals,
    ).toEqual(['inquiry/device_integrity_level']);
  });

  it('golden: a run_verification and a route on its outcome in between decide it', () => {
    const definition = chain([], {
      steps: [
        conditional('device', [{ key: 'one', label: 'One', condition: rooted }]),
        verify(),
        conditional('outcome', [
          {
            key: 'failed',
            label: 'Failed',
            condition: { '===': [{ var: 'steps.verify.output.object.status' }, 'failed'] },
          },
        ]),
        decline(),
        output(),
      ],
      edges: [
        edge('e0', 'trigger', 'next', 'device'),
        edge('e1', 'device', 'route:one', 'verify'),
        edge('e2', 'device', 'else', 'output'),
        edge('e3', 'verify', 'next', 'outcome'),
        edge('e4', 'outcome', 'route:failed', 'decline'),
        edge('e5', 'outcome', 'else', 'output'),
        edge('e6', 'decline', 'next', 'output'),
      ],
    });
    expect(analysisOf(definition)).toMatchObject({
      nonDecisiveSignals: ['inquiry/device_rooted'],
      undecidedSignals: [],
    });
  });

  it('golden: a run_verification whose outcome no route reads is not enough', () => {
    const definition = chain([], {
      steps: [
        conditional('device', [{ key: 'one', label: 'One', condition: rooted }]),
        verify(),
        decline(),
        output(),
      ],
      edges: [
        edge('e0', 'trigger', 'next', 'device'),
        edge('e1', 'device', 'route:one', 'verify'),
        edge('e2', 'device', 'else', 'output'),
        edge('e3', 'verify', 'next', 'decline'),
        edge('e6', 'decline', 'next', 'output'),
      ],
    });
    expect(analysisOf(definition).undecidedSignals).toEqual(['inquiry/device_rooted']);
  });

  it('leaves a decisive signal to Phase 8’s rules', () => {
    expect(analysisOf(routed({ '>': [{ var: 'trigger.signals.bot_score' }, 80] }))).toMatchObject({
      nonDecisiveSignals: [],
      undecidedSignals: [],
    });
  });
});
