import {
  FLOW_V2_STEP_TYPES,
  VERIFICATION_STEP_TYPES,
  flowV2Schema,
  stepV2Schema,
  type FlowV2,
} from '@openverify/flow-spec';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BUILDER_STEP_TYPES,
  OPAQUE_STEP_ID,
  addBranchRoute,
  canConnectFlow,
  connectFlowPort,
  connectionProblem,
  deleteFlowStep,
  insertStepAfter,
  moveBranchRoute,
  opaqueId,
  requiredStepPorts,
  setStepName,
  stepPorts,
  stepTemplate,
} from './flow-model';

/** A deterministic random source: the values in turn, then 0. */
const sequence = (...values: number[]) => {
  let index = 0;
  return () => values[index++] ?? 0;
};

const baseFlow = (): FlowV2 =>
  flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'synthetic', version: 1, name: 'Synthetic' },
    entry: 's_consent0',
    steps: [
      stepTemplate('consent', 's_consent0'),
      stepTemplate('screen', 's_screen00'),
      stepTemplate('government_id', 's_govid000'),
      {
        id: 's_branch00',
        type: 'branch',
        routes: [
          {
            key: 'minor',
            label: 'Under 18',
            condition: { '<': [{ var: 'x' }, 18] },
            onNull: 'else',
          },
          { key: 'other', label: 'Other', condition: { '==': [1, 1] } },
        ],
      },
      stepTemplate('completion', 's_done0000'),
      stepTemplate('failure', 's_fail0000'),
    ],
    edges: [
      { id: 'e_1', from: 's_consent0', port: 'next', to: 's_screen00' },
      { id: 'e_2', from: 's_screen00', port: 'next', to: 's_govid000' },
      { id: 'e_3', from: 's_govid000', port: 'next', to: 's_branch00' },
      { id: 'e_4', from: 's_branch00', port: 'route:minor', to: 's_fail0000' },
      { id: 'e_5', from: 's_branch00', port: 'else', to: 's_done0000' },
    ],
  });

let base: FlowV2;

beforeAll(() => {
  base = baseFlow();
});

describe('opaque ids (C151.8)', () => {
  it('makes s_ and 8 base32 characters, never one already taken', () => {
    const taken = new Set(['s_aaaaaaaa']);
    const id = opaqueId('s', sequence(0, 0, 0, 0, 0, 0, 0, 0, 0.99, 0.5, 0, 0, 0, 0, 0, 0), taken);

    expect(id).toMatch(OPAQUE_STEP_ID);
    expect(id).not.toBe('s_aaaaaaaa');
    expect(id).toBe('s_7qaaaaaa');
    expect(opaqueId('e', sequence(), new Set())).toBe('e_aaaaaaaa');
  });
});

describe('the palette’s step types (C155.3)', () => {
  it('offers every v2 step type, form excluded since v2 has none (migration makes it a screen)', () => {
    expect(BUILDER_STEP_TYPES).toEqual(FLOW_V2_STEP_TYPES);
    expect(BUILDER_STEP_TYPES).not.toContain('form');
  });

  it.each(FLOW_V2_STEP_TYPES)('makes a %s step the format accepts', (type) => {
    expect(stepV2Schema.safeParse(stepTemplate(type, 's_aaaaaaaa')).success).toBe(true);
  });
});

describe('ports (C147.4)', () => {
  it('gives each type its ports, and marks the required ones', () => {
    const step = (id: string) => {
      const found = base.steps.find((candidate) => candidate.id === id);
      if (found === undefined) {
        throw new Error(id);
      }
      return found;
    };
    expect(stepPorts(step('s_consent0'))).toEqual(['next']);
    expect(stepPorts(step('s_govid000'))).toEqual(['next', 'exhausted']);
    expect(requiredStepPorts(step('s_govid000'))).toEqual(['next']);
    expect(stepPorts(step('s_branch00'))).toEqual(['route:minor', 'route:other', 'else']);
    expect(requiredStepPorts(step('s_branch00'))).toEqual(['else']);
    expect(stepPorts(step('s_done0000'))).toEqual([]);
    expect(stepPorts(stepTemplate('action', 's_action00'))).toEqual(['next', 'error']);
    expect(requiredStepPorts(stepTemplate('action', 's_action00'))).toEqual(['next', 'error']);
    for (const type of VERIFICATION_STEP_TYPES) {
      expect(stepPorts(stepTemplate(type, 's_aaaaaaaa'))).toContain('exhausted');
    }
  });

  it('gives a screen a button port for each further submit button', () => {
    const screen = stepTemplate('screen', 's_screen00');
    const withButton = {
      ...screen,
      components: [
        ...('components' in screen ? screen.components : []),
        {
          id: 'back',
          kind: 'button',
          labelKey: 'back.button',
          action: 'submit',
          port: 'back',
        },
      ],
    };

    expect(stepPorts(stepV2Schema.parse(withButton))).toEqual(['next', 'button:back']);
  });
});

describe('connections the format can express (C147.4, C147.6, C155.11)', () => {
  it('accepts a forward connection and a cycle of screens and branches only', () => {
    expect(canConnectFlow(base, 's_screen00', 'next', 's_branch00')).toBe(true);
    expect(canConnectFlow(base, 's_branch00', 'route:other', 's_branch00')).toBe(false);
    // A branch leading back to a screen through a verification is a cycle through it.
    expect(connectionProblem(base, 's_branch00', 'route:other', 's_screen00')).toBe(
      'cycle_not_allowed',
    );
    expect(connectionProblem(base, 's_done0000', 'next', 's_screen00')).toBe('port_unknown');
    expect(connectionProblem(base, 's_screen00', 'next', 'missing')).toBe('target_unknown');
  });

  it('allows going back to a screen from a branch right after it', () => {
    const loop = connectFlowPort(base, 's_screen00', 'next', 's_branch00', 'e_9');

    expect(canConnectFlow(loop, 's_branch00', 'route:other', 's_screen00')).toBe(true);
  });

  it('puts one edge on a port, replacing the one there', () => {
    const next = connectFlowPort(base, 's_screen00', 'next', 's_branch00', 'e_9');

    expect(next.edges.filter((edge) => edge.from === 's_screen00')).toEqual([
      { id: 'e_9', from: 's_screen00', port: 'next', to: 's_branch00' },
    ]);
  });
});

describe('editing (C155.2)', () => {
  it('inserts a step after a port, the old target now after it', () => {
    const step = stepTemplate('screen', 's_new00000');
    const { flow, select } = insertStepAfter(base, { from: 's_consent0', port: 'next' }, step, [
      'e_10',
      'e_11',
    ]);

    expect(select).toBe('s_new00000');
    expect(flow.edges).toContainEqual({
      id: 'e_10',
      from: 's_consent0',
      port: 'next',
      to: 's_new00000',
    });
    expect(flow.edges).toContainEqual({
      id: 'e_11',
      from: 's_new00000',
      port: 'next',
      to: 's_screen00',
    });
    expect(flow.edges.some((edge) => edge.id === 'e_1')).toBe(false);
    expect(flowV2Schema.safeParse(flow).success).toBe(true);
  });

  it('deletes a step, leading what came into it to where it led', () => {
    const flow = deleteFlowStep(base, 's_screen00');

    expect(flow?.steps.map((step) => step.id)).not.toContain('s_screen00');
    expect(flow?.edges).toContainEqual({
      id: 'e_1',
      from: 's_consent0',
      port: 'next',
      to: 's_govid000',
    });
    expect(flow?.edges.some((edge) => edge.from === 's_screen00' || edge.to === 's_screen00')).toBe(
      false,
    );
  });

  it('moves the entry when the entry step is deleted, and refuses deleting the only step', () => {
    expect(deleteFlowStep(base, 's_consent0')?.entry).toBe('s_screen00');
    const single = flowV2Schema.parse({
      ...base,
      steps: [stepTemplate('completion', 's_only0000')],
      edges: [],
      entry: 's_only0000',
    });
    expect(deleteFlowStep(single, 's_only0000')).toBeNull();
  });

  it('adds a route before else, and moves a route up or down', () => {
    const added = addBranchRoute(base, 's_branch00', 'adult', 'Adult');
    const branch = added.steps.find((step) => step.id === 's_branch00');

    expect(branch?.type === 'branch' ? branch.routes.map((route) => route.key) : []).toEqual([
      'minor',
      'other',
      'adult',
    ]);
    const moved = moveBranchRoute(added, 's_branch00', 'adult', 'up');
    const after = moved?.steps.find((step) => step.id === 's_branch00');
    expect(after?.type === 'branch' ? after.routes.map((route) => route.key) : []).toEqual([
      'minor',
      'adult',
      'other',
    ]);
    expect(moveBranchRoute(base, 's_branch00', 'minor', 'up')).toBeNull();
  });

  it('names a step that has a name, keeping its opaque id', () => {
    const named = setStepName(base, 's_screen00', 'Your details');

    expect(named.steps.find((step) => step.id === 's_screen00')).toMatchObject({
      id: 's_screen00',
      name: 'Your details',
    });
  });
});
