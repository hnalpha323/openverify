import { describe, expect, it } from 'vitest';
import type { DraftDefinition } from './document-model';
import { NODE_HEIGHT, tidyLayout } from './layout';

const definition: DraftDefinition = {
  'schema-version': 1,
  trigger: { type: 'trigger-api', config: {} },
  inputs: [],
  variables: [],
  steps: [
    { id: 'check', name: 'Check', type: 'conditional', routes: [{ key: 'a', label: 'A' }] },
    { id: 'left', name: 'Left', type: 'wait' },
    { id: 'right', name: 'Right', type: 'wait' },
    { id: 'output', name: 'Output', type: 'output' },
    { id: 'loose', name: 'Loose', type: 'wait' },
  ],
  edges: [
    { id: 'e1', from: 'trigger', 'from-port': 'next', to: 'check' },
    { id: 'e2', from: 'check', 'from-port': 'route:a', to: 'left' },
    { id: 'e3', from: 'check', 'from-port': 'else', to: 'right' },
    { id: 'e4', from: 'left', 'from-port': 'next', to: 'output' },
    { id: 'e5', from: 'right', 'from-port': 'next', to: 'output' },
    { id: 'back', from: 'right', 'from-port': 'error', to: 'check', 'to-port': 'continue' },
    { id: 'dangling', from: 'left', 'from-port': 'error', to: 'nowhere' },
  ],
  outputs: [],
  layout: { check: { x: 999, y: 999 } },
};

describe('tidy up (C141.3, @dagrejs/dagre top to bottom)', () => {
  it('places every node, the trigger included, in whole pixels', () => {
    const layout = tidyLayout(definition);
    expect(Object.keys(layout).sort()).toEqual([
      'check',
      'left',
      'loose',
      'output',
      'right',
      'trigger',
    ]);
    for (const position of Object.values(layout)) {
      expect(Number.isInteger(position.x) && Number.isInteger(position.y)).toBe(true);
    }
  });

  it('lays the graph out top to bottom, each rank below the one that leads to it', () => {
    const layout = tidyLayout(definition);
    const y = (id: string) => layout[id]?.y ?? Number.NaN;
    expect(y('trigger')).toBeLessThan(y('check'));
    expect(y('check') + NODE_HEIGHT).toBeLessThanOrEqual(y('left'));
    expect(y('left')).toBe(y('right'));
    expect(y('left')).toBeLessThan(y('output'));
    expect(layout.left?.x).not.toBe(layout.right?.x);
  });

  it('ignores the positions already stored, and answers the same layout for the same graph', () => {
    expect(tidyLayout(definition)).toEqual(tidyLayout({ ...definition, layout: {} }));
  });
});
