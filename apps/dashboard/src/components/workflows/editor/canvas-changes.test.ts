/**
 * C141.3 (Workflow 8D review R005): the canvas's pointer gestures, the only pointer path that moves
 * or connects a node, tested as data: a selection selects, a drag keeps its place until released, a
 * release writes only the layout member at whole pixels as one gesture, a read-only canvas only
 * selects, and a connection goes through the outline's port rules.
 */
import { describe, expect, it } from 'vitest';
import { canvasChangesOf, canvasConnectionOf } from './canvas-changes';
import type { DraftDefinition } from './document-model';

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

const LABELS: ReadonlyMap<string, string> = new Map([
  ['notify', 'Action send_slack_message: Notify'],
  ['wait', 'Wait: Wait a day'],
]);

describe('the canvas’s node changes (C141.3, R005)', () => {
  it('selects a node the pointer selects, and nothing for a deselection', () => {
    const changes = canvasChangesOf(
      definition(),
      [
        { type: 'select', id: 'wait', selected: true },
        { type: 'select', id: 'notify', selected: false },
      ],
      LABELS,
      true,
    );

    expect(changes.select).toEqual(['wait']);
    expect(changes.edits).toEqual([]);
  });

  it('keeps a node where it is dragged, and writes nothing until it is released', () => {
    const changes = canvasChangesOf(
      definition(),
      [{ type: 'position', id: 'wait', position: { x: 10.4, y: 20.6 }, dragging: true }],
      LABELS,
      true,
    );

    expect(changes.dragging).toEqual({ wait: { x: 10.4, y: 20.6 } });
    expect(changes.released).toEqual([]);
    expect(changes.edits).toEqual([]);
  });

  it('places a released node in the layout alone, at whole pixels, as one gesture', () => {
    const before = definition();
    const changes = canvasChangesOf(
      before,
      [{ type: 'position', id: 'wait', position: { x: 10.4, y: 20.6 }, dragging: false }],
      LABELS,
      true,
    );

    expect(changes.released).toEqual(['wait']);
    expect(changes.edits).toHaveLength(1);
    const [edit] = changes.edits;
    expect(edit?.edited.select).toBe('wait');
    expect(edit?.edited.definition.layout).toEqual({
      notify: { x: 500, y: 300 },
      wait: { x: 10, y: 21 },
    });
    expect({ ...edit?.edited.definition, layout: before.layout }).toEqual(before);
    expect(edit?.message).toBe('Moved Wait: Wait a day on the canvas.');
    expect(edit?.gesture).toBe('move:wait');
  });

  it('only selects on a read-only canvas, and ignores a change with no place', () => {
    const changes = canvasChangesOf(
      definition(),
      [
        { type: 'position', id: 'wait', position: { x: 1, y: 2 }, dragging: false },
        { type: 'position', id: 'notify', dragging: true },
        { type: 'select', id: 'wait', selected: true },
      ],
      LABELS,
      false,
    );

    expect(changes).toEqual({ select: ['wait'], dragging: {}, released: [], edits: [] });
    expect(
      canvasChangesOf(definition(), [{ type: 'position', id: 'notify' }], LABELS, true),
    ).toEqual({ select: [], dragging: {}, released: [], edits: [] });
  });
});

describe('a connection drawn on the canvas (C141.3, R005)', () => {
  it('connects through the outline’s port rules, saying what it connected', () => {
    const edit = canvasConnectionOf(
      definition(),
      { source: 'notify', sourceHandle: 'next', target: 'wait' },
      LABELS,
    );

    expect(edit?.edited.definition.edges.find((edge) => edge.id === 'e4')?.to).toBe('wait');
    expect(edit?.message).toBe('Connected Action send_slack_message: Notify to Wait: Wait a day.');
    expect(edit?.gesture).toBeUndefined();
  });

  it('refuses what the port rules refuse, and a connection with no port', () => {
    expect(
      canvasConnectionOf(
        definition(),
        { source: 'wait', sourceHandle: 'next', target: 'check' },
        LABELS,
      ),
    ).toBeNull();
    expect(
      canvasConnectionOf(
        definition(),
        { source: 'notify', sourceHandle: null, target: 'wait' },
        LABELS,
      ),
    ).toBeNull();
  });

  it('names a node it has no label for by its id', () => {
    const edit = canvasConnectionOf(
      definition(),
      { source: 'notify', sourceHandle: 'next', target: 'wait' },
      new Map(),
    );

    expect(edit?.message).toBe('Connected notify to wait.');
  });
});
