import { describe, expect, it } from 'vitest';
import { canvasOf, canvasSummary, connectionOf, diffMarksOf } from './canvas-model';
import type { DraftDefinition } from './document-model';
import { tidyLayout } from './layout';

/** trigger -> check -> (route high -> notify, else -> wait) -> output. */
function definition(): DraftDefinition {
  return {
    'schema-version': 1,
    trigger: { type: 'trigger-api', config: {} },
    inputs: [],
    variables: [],
    steps: [
      { id: 'check', name: 'Check', type: 'conditional', routes: [{ key: 'high', label: 'High' }] },
      { id: 'notify', name: 'Notify', type: 'action', 'action-key': 'send_slack_message' },
      { id: 'wait', name: 'Wait a day', type: 'wait', mode: 'time', seconds: 86400 },
      { id: 'output', name: 'Output', type: 'output', mappings: {} },
    ],
    edges: [
      { id: 'e1', from: 'trigger', 'from-port': 'next', to: 'check' },
      { id: 'e2', from: 'check', 'from-port': 'route:high', to: 'notify' },
      { id: 'e3', from: 'check', 'from-port': 'else', to: 'wait' },
      { id: 'e4', from: 'notify', 'from-port': 'next', to: 'output' },
      { id: 'e5', from: 'wait', 'from-port': 'next', to: 'output' },
    ],
    outputs: [],
    layout: { notify: { x: 500, y: 300 } },
  };
}

describe('what the canvas draws (C141.3)', () => {
  it('draws the trigger and each step, named as the outline names them, with their ports in words', () => {
    const { nodes } = canvasOf(definition(), [], {});
    expect(nodes.map((node) => [node.id, node.data.label, node.data.start])).toEqual([
      ['trigger', 'Trigger: The API', true],
      ['check', 'Conditional: Check', false],
      ['notify', 'Action send_slack_message: Notify', false],
      ['wait', 'Wait: Wait a day', false],
      ['output', 'Output: Output', false],
    ]);
    expect(nodes[1]?.data.ports).toEqual([
      { port: 'route:high', label: 'Route high' },
      { port: 'else', label: 'Else' },
    ]);
    expect(nodes[2]?.data.ports.map((port) => port.port)).toEqual(['next', 'error']);
    expect(nodes[4]?.data.ports).toEqual([]);
  });

  it('places a node where the layout member says, and the rest where tidy-up would', () => {
    const { nodes } = canvasOf(definition(), [], {});
    const tidy = tidyLayout(definition());
    expect(nodes.find((node) => node.id === 'notify')?.position).toEqual({ x: 500, y: 300 });
    expect(nodes.find((node) => node.id === 'wait')?.position).toEqual(tidy.wait);
  });

  it('draws each edge from its port to the step, naming every port but next, and a loop back-edge at continue', () => {
    const looped: DraftDefinition = {
      ...definition(),
      edges: [
        ...definition().edges,
        { id: 'back', from: 'wait', 'from-port': 'error', to: 'check', 'to-port': 'continue' },
      ],
    };
    const { edges } = canvasOf(looped, [], {});
    expect(
      edges.map((edge) => [edge.id, edge.sourceHandle, edge.targetHandle, edge.label]),
    ).toEqual([
      ['e1', 'next', 'in', null],
      ['e2', 'route:high', 'in', 'Route high'],
      ['e3', 'else', 'in', 'Else'],
      ['e4', 'next', 'in', null],
      ['e5', 'next', 'in', null],
      ['back', 'error', 'continue', 'On error'],
    ]);
  });

  it('gives each node the problems whose pointer falls inside it, and its mark against the live version', () => {
    const { nodes } = canvasOf(
      definition(),
      [
        { pointer: '/steps/1/config/text', detail: 'is required' },
        { pointer: '/steps/1', detail: 'cannot be reached' },
        { pointer: '/steps/12', detail: 'not this one' },
        { pointer: '/trigger/config', detail: 'trigger problem' },
      ],
      { notify: 'changed', wait: 'added' },
    );
    expect(nodes.map((node) => [node.id, node.data.issues, node.data.mark])).toEqual([
      ['trigger', ['trigger problem'], null],
      ['check', [], null],
      ['notify', ['is required', 'cannot be reached'], 'changed'],
      ['wait', [], 'added'],
      ['output', [], null],
    ]);
  });

  it('draws no trigger node before a trigger is set', () => {
    const { nodes } = canvasOf({ ...definition(), trigger: null }, [], {});
    expect(nodes.map((node) => node.id)).not.toContain('trigger');
  });
});

describe('the canvas summary (C141.3, WCAG 1.1.1)', () => {
  it('counts the steps, the branches and the errors in words', () => {
    expect(canvasSummary(definition(), 1)).toBe('3 steps, 2 branches, 1 error.');
    const parallel: DraftDefinition = {
      ...definition(),
      steps: [
        {
          id: 'fork',
          name: 'Fork',
          type: 'parallel',
          branches: [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
        },
        { id: 'fork_join', name: 'Join', type: 'join', 'join-of': 'fork' },
        { id: 'output', name: 'Output', type: 'output', mappings: {} },
      ],
    };
    expect(canvasSummary(parallel, 0)).toBe('1 step, 3 branches, 0 errors.');
  });
});

describe('the diff marks (C116.6, C141.5)', () => {
  it('marks each added and changed step, and nothing else', () => {
    expect(diffMarksOf({ steps: { added: ['new_step'], changed: [{ id: 'old_step' }] } })).toEqual({
      new_step: 'added',
      old_step: 'changed',
    });
  });
});

describe('a connection drawn on the canvas (C141.3)', () => {
  it('connects through the same port rules as the outline, and refuses what they refuse', () => {
    const connected = connectionOf(definition(), {
      source: 'notify',
      sourceHandle: 'next',
      target: 'wait',
    });
    expect(connected?.definition.edges.find((edge) => edge.id === 'e4')?.to).toBe('wait');
    expect(
      connectionOf(definition(), { source: 'wait', sourceHandle: 'next', target: 'check' }),
    ).toBeNull();
    expect(
      connectionOf(definition(), { source: 'notify', sourceHandle: null, target: 'wait' }),
    ).toBeNull();
  });
});
