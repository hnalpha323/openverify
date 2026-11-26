import { describe, expect, it } from 'vitest';
import { scopePathsSchema } from '../../graph-editor/graph-adapter';
import { canvasOf, connectionOf, diffMarksOf } from './canvas-model';
import { CANVAS_ARIA_LABELS } from './canvas-words';
import { placeNode, type DraftDefinition } from './document-model';
import { paletteOf } from './palette-model';
import { portWords, portsOf, validTargets } from './port-rules';
import { scopeAt } from './variable-scope';
import { WORKFLOW_ADAPTER } from './workflow-adapter';

const definition: DraftDefinition = {
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
  ],
  outputs: [],
  layout: {},
};

const issues = [{ pointer: '/steps/1/config/text', detail: 'is required' }];
const context = { actions: [], triggerPaths: [] };

describe('the workflow adapter (C155.1): Phase 8’s rules behind the GraphAdapter', () => {
  it('draws exactly what the workflow canvas drew, in the workflow’s words', () => {
    const view = WORKFLOW_ADAPTER.viewOf(definition, issues, { wait: 'added' });
    const before = canvasOf(definition, issues, { wait: 'added' });

    expect(view.edges).toEqual(before.edges);
    expect(view.nodes).toEqual(
      before.nodes.map((node) => ({ id: node.id, position: node.position, ...node.data })),
    );
    expect(WORKFLOW_ADAPTER.ariaLabels).toBe(CANVAS_ARIA_LABELS);
    expect(WORKFLOW_ADAPTER.noun).toBe('workflow');
  });

  it('offers and accepts the connections the port rules allow, and edits as they did', () => {
    for (const step of definition.steps) {
      for (const port of portsOf(step)) {
        expect(WORKFLOW_ADAPTER.portsOf(definition, step.id)).toEqual(portsOf(step));
        expect(WORKFLOW_ADAPTER.validTargets(definition, step.id, port)).toEqual(
          validTargets(definition, step.id, port),
        );
        for (const target of definition.steps) {
          const connection = { source: step.id, sourceHandle: port, target: target.id };
          expect(WORKFLOW_ADAPTER.connect(definition, connection)).toEqual(
            connectionOf(definition, connection),
          );
          expect(WORKFLOW_ADAPTER.isValidConnection(definition, connection)).toBe(
            connectionOf(definition, connection) !== null,
          );
        }
      }
    }
    expect(WORKFLOW_ADAPTER.portsOf(definition, 'trigger')).toEqual(['next']);
    expect(WORKFLOW_ADAPTER.portWords('route:high')).toBe(portWords('route:high'));
    expect(WORKFLOW_ADAPTER.place(definition, 'wait', { x: 3, y: 4 })).toEqual({
      definition: placeNode(definition, 'wait', { x: 3, y: 4 }),
      select: 'wait',
    });
  });

  it('maps a problem’s pointer to its step, the trigger to its node, and the rest to none', () => {
    expect(WORKFLOW_ADAPTER.problemNode(definition, '/steps/1/config/text')).toBe('notify');
    expect(WORKFLOW_ADAPTER.problemNode(definition, '/trigger/config')).toBe('trigger');
    expect(WORKFLOW_ADAPTER.problemNode(definition, '/outputs/0')).toBeNull();
    expect(WORKFLOW_ADAPTER.problemNode(definition, '/steps/9')).toBeNull();
  });

  it('reads the condition scope, its JSON Schema, the palette and the diff marks as Phase 8 did', () => {
    const scope = scopeAt(definition, 'check', [], []);

    expect(WORKFLOW_ADAPTER.conditionScope(definition, 'check', context)).toEqual(scope);
    expect(WORKFLOW_ADAPTER.conditionScopeSchema(definition, 'check', context)).toEqual(
      scopePathsSchema(scope),
    );
    expect(WORKFLOW_ADAPTER.paletteOf(definition, 'check', context)).toEqual(
      paletteOf([], 'trigger-api'),
    );
    const diff = { steps: { added: ['wait'], changed: [{ id: 'notify' }] } };
    expect(WORKFLOW_ADAPTER.diffMarksOf(diff)).toEqual(diffMarksOf(diff));
  });
});
