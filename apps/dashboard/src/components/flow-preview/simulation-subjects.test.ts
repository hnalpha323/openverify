import { describe, expect, it } from 'vitest';
import { SIGNAL_REGISTRY } from '@openverify/core';
import type { AnyFlow } from '@openverify/flow-spec';
import { simulationSubjectsOf } from './simulation-subjects';

const flow = {
  metadata: { specVersion: 2, id: 'synthetic_flow', version: 1, name: 'Synthetic flow' },
  entry: 'consent',
  steps: [
    { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
    {
      id: 'id_card',
      type: 'government_id',
      sides: 'front',
      maxAttempts: 2,
      captureMethods: ['camera'],
    },
    {
      id: 'screen_list',
      type: 'branch',
      routes: [
        {
          key: 'hit',
          when: { op: 'eq', path: 'lists.blocklist_main.matched', value: true },
          onNull: 'review',
        },
      ],
    },
    {
      id: 'risk_run',
      type: 'action',
      action: {
        kind: 'run_workflow',
        workflowId: 'wfl_01JB0000000000000000000001',
        version: 'latest-published',
        inputs: {},
      },
    },
    { id: 'tag', type: 'action', action: { kind: 'tag_inquiry', tags: ['synthetic'] } },
    { id: 'done', type: 'completion' },
  ],
  edges: [],
} as unknown as AnyFlow;

describe('what a simulation can set for a version (C156.4)', () => {
  it('names the verification steps, the run_workflow steps and the lists the routes read', () => {
    const subjects = simulationSubjectsOf(flow);

    expect(subjects.verifications).toEqual([{ id: 'id_card', type: 'government_id' }]);
    expect(subjects.workflows).toEqual([{ id: 'risk_run' }]);
    expect(subjects.lists).toEqual(['blocklist_main']);
  });

  it('offers every flow-provisional signal of the registry, and no other', () => {
    const subjects = simulationSubjectsOf(flow);

    expect(subjects.signals.map(({ name }) => name)).toEqual(
      SIGNAL_REGISTRY.filter((signal) => signal.flowProvisional).map((signal) => signal.name),
    );
    expect(subjects.signals.length).toBeGreaterThan(0);
  });

  it('reads a flow it cannot migrate as having nothing to set but signals', () => {
    const subjects = simulationSubjectsOf({ steps: 'not a list' } as unknown as AnyFlow);

    expect(subjects.verifications).toEqual([]);
    expect(subjects.workflows).toEqual([]);
    expect(subjects.lists).toEqual([]);
  });
});
