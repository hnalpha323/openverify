import { describe, expect, it } from 'vitest';
import { FLOW_ADAPTER } from './flow-adapter';
import { canConnectFlow, connectFlowPort, stepPorts } from './flow-model';
import { builderFlow } from './test-flows';

const flow = builderFlow();

describe('the flow adapter (C155.1)', () => {
  it('draws each step with its ports in words, the entry with no way in', () => {
    const view = FLOW_ADAPTER.viewOf(
      flow,
      [{ pointer: '/flow/steps/1', detail: 'needs a label' }],
      {
        s_doc00000: 'added',
      },
    );

    const node = (id: string) => view.nodes.find((candidate) => candidate.id === id);
    expect(node('s_consent0')).toMatchObject({ start: true, position: { x: 10, y: 20 } });
    expect(node('s_govid000')?.ports).toEqual([
      { port: 'next', label: 'Next' },
      { port: 'exhausted', label: 'When attempts run out' },
    ]);
    expect(node('s_branch00')?.ports.map((port) => port.label)).toEqual([
      'Route Under 18',
      'Otherwise (else)',
    ]);
    expect(node('s_screen00')?.issues).toEqual(['needs a label']);
    expect(node('s_doc00000')?.mark).toBe('added');
    expect(node('s_done0000')?.ports).toEqual([]);
    expect(view.edges.find((edge) => edge.id === 'e_4')).toMatchObject({
      source: 's_govid000',
      sourceHandle: 'exhausted',
      label: 'When attempts run out',
    });
    expect(FLOW_ADAPTER.ariaLabels['controls.fitView.ariaLabel']).toBe('Fit the flow in view');
  });

  it('accepts on the canvas exactly what the outline offers, through one rule', () => {
    for (const step of flow.steps) {
      for (const port of stepPorts(step)) {
        const targets = FLOW_ADAPTER.validTargets(flow, step.id, port);
        for (const target of flow.steps) {
          const connection = { source: step.id, sourceHandle: port, target: target.id };
          expect(FLOW_ADAPTER.isValidConnection(flow, connection)).toBe(
            canConnectFlow(flow, step.id, port, target.id),
          );
          expect(targets.includes(target.id)).toBe(canConnectFlow(flow, step.id, port, target.id));
        }
      }
    }
    expect(
      FLOW_ADAPTER.isValidConnection(flow, {
        source: 's_screen00',
        sourceHandle: null,
        target: 's_done0000',
      }),
    ).toBe(false);
  });

  it('connects with a fresh edge id, and moves only the layout', () => {
    const edit = FLOW_ADAPTER.connect(flow, {
      source: 's_screen00',
      sourceHandle: 'next',
      target: 's_branch00',
    });
    const edgeId = edit?.flow.edges.find((edge) => edge.from === 's_screen00')?.id ?? '';
    expect(edgeId).toMatch(/^e_[a-z2-7]{8}$/);
    expect(edit?.flow).toEqual(connectFlowPort(flow, 's_screen00', 'next', 's_branch00', edgeId));
    expect(FLOW_ADAPTER.place(flow, 's_done0000', { x: 5, y: 6 })).toEqual({
      flow: { ...flow, layout: { ...flow.layout, s_done0000: { x: 5, y: 6 } } },
      select: 's_done0000',
    });
  });

  it('reads the branch scope with each fact’s tier, stage and source, and marks diff changes', () => {
    const scope = FLOW_ADAPTER.conditionScope(flow, 's_branch00', {});
    const age = scope.find((path) => path.path === 'verifications.s_govid000.age-years');
    expect(age).toMatchObject({ nullable: true, source: 'Verification' });
    expect(scope.find((path) => path.path === 'device.kind')?.source).toBe('Client-reported');
    expect(scope.some((path) => path.path.startsWith('lists.'))).toBe(false);
    expect(FLOW_ADAPTER.conditionScopeSchema(flow, 's_branch00', {})).toMatchObject({
      type: 'object',
    });
    expect(
      FLOW_ADAPTER.diffMarksOf({
        steps: {
          added: ['s_doc00000'],
          removed: [],
          changed: [{ 'step-id': 's_screen00', changes: [] }],
        },
      }),
    ).toEqual({ s_doc00000: 'added', s_screen00: 'changed' });
    expect(FLOW_ADAPTER.problemNode(flow, '/flow/steps/3/documentTypes')).toBe('s_doc00000');
  });

  it('offers every step type in the palette, and says why a second verification of a type cannot be added', () => {
    const palette = FLOW_ADAPTER.paletteOf(flow, 's_screen00', {});

    expect(palette.find((entry) => entry.type === 'selfie')?.refusal).toBeNull();
    expect(palette.find((entry) => entry.type === 'government_id')?.refusal).toBe(
      'The flow already has a Government ID step; a flow has at most one step of each verification type.',
    );
    expect(palette.find((entry) => entry.type === 'screen')?.refusal).toBeNull();
  });
});
