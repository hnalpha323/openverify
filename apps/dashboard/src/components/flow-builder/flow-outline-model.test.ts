import { describe, expect, it } from 'vitest';
import {
  flowOutlineOf,
  flowProblemStep,
  flowStepLabel,
  type FlowOutlineItem,
} from './flow-outline-model';
import { builderFlow } from './test-flows';

const shape = (items: readonly FlowOutlineItem[]): unknown[] =>
  items.map((item) =>
    item.children.length === 0 ? item.label : [item.label, shape(item.children)],
  );

describe('the flow outline (C155.2): a tree from the entry along next', () => {
  it('lists the path from the entry, each other port a group, a step met again a go-to', () => {
    expect(shape(flowOutlineOf(builderFlow(), []))).toEqual([
      'Consent',
      'Screen: Your details',
      ['Government ID', [['When attempts run out', ['Document', 'Completion']]]],
      [
        'Branch: Age',
        [
          ['Route Under 18', ['Failure']],
          ['Otherwise (else)', ['Go to Completion']],
        ],
      ],
    ]);
  });

  it('names an unwired port as not connected, and groups steps the entry does not reach', () => {
    const flow = builderFlow();
    const cut = {
      ...flow,
      edges: flow.edges.filter((edge) => edge.id !== 'e_7' && edge.id !== 'e_4'),
    };

    const outline = flowOutlineOf(cut, []);

    const branch = outline.find((item) => item.stepId === 's_branch00' && item.kind === 'step');
    expect(shape(branch?.children ?? [])).toEqual([
      ['Route Under 18', ['Failure']],
      ['Otherwise (else)', ['Not connected']],
    ]);
    expect(shape(outline.slice(-1))).toEqual([
      ['Not reachable from the start', ['Document', 'Completion']],
    ]);
  });

  it('puts each problem on the step its pointer falls inside, at any prefix the API uses', () => {
    const flow = builderFlow();
    expect(flowProblemStep(flow, '/steps/1/components/0')).toBe('s_screen00');
    expect(flowProblemStep(flow, '/flow/steps/2')).toBe('s_govid000');
    expect(flowProblemStep(flow, '/data/attributes/flow/steps/4/routes/0')).toBe('s_branch00');
    expect(flowProblemStep(flow, '/flow/edges/0')).toBeNull();
    expect(flowProblemStep(flow, '/steps/99')).toBeNull();

    const outline = flowOutlineOf(flow, [
      { pointer: '/flow/steps/1', detail: 'needs a label' },
      { pointer: '/flow/edges/2', detail: 'not on a step' },
    ]);
    expect(outline.find((item) => item.stepId === 's_screen00')?.issues).toEqual(['needs a label']);
  });

  it('labels a step by its type, its name when it has one, its id when its type repeats', () => {
    const flow = builderFlow();
    const screen = flow.steps[1];
    expect(screen === undefined ? '' : flowStepLabel(flow, screen)).toBe('Screen: Your details');
    const twoScreens = {
      ...flow,
      steps: [...flow.steps, { id: 's_screen01', type: 'screen' as const, components: [] }],
    };
    const second = twoScreens.steps.at(-1);
    expect(second === undefined ? '' : flowStepLabel(twoScreens, second)).toBe('Screen s_screen01');
  });
});
