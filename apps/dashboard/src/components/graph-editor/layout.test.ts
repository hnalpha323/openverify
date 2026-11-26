import { describe, expect, it } from 'vitest';
import { NODE_HEIGHT, tidyGraph } from './layout';

describe('tidyGraph (C141.3)', () => {
  it('lays a graph out top to bottom, at whole pixels, ignoring edges to unknown nodes', () => {
    const layout = tidyGraph(
      ['a', 'b', 'c'],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'missing' },
      ],
    );

    expect(Object.keys(layout)).toEqual(['a', 'b', 'c']);
    const ys = ['a', 'b', 'c'].map((id) => layout[id]?.y ?? Number.NaN);
    expect(ys[1]).toBeGreaterThanOrEqual((ys[0] ?? 0) + NODE_HEIGHT);
    expect(ys[2]).toBeGreaterThanOrEqual((ys[1] ?? 0) + NODE_HEIGHT);
    for (const position of Object.values(layout)) {
      expect(Number.isInteger(position.x) && Number.isInteger(position.y)).toBe(true);
    }
  });
});
