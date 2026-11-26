import { describe, expect, it } from 'vitest';
import { graphChangesOf, graphConnectionOf } from './graph-changes';
import { LINE, LINE_ADAPTER } from './test-adapter';

const LABELS = new Map([
  ['a', 'Node a'],
  ['b', 'Node b'],
  ['c', 'Node c'],
]);

describe('graphChangesOf (C141.3, C155.1)', () => {
  it('selects, keeps a drag, and places a released node at whole pixels as one gesture', () => {
    const changes = graphChangesOf(
      LINE_ADAPTER,
      LINE,
      [
        { type: 'select', id: 'b', selected: true },
        { type: 'position', id: 'a', position: { x: 10.4, y: 20.6 }, dragging: true },
        { type: 'position', id: 'c', position: { x: 5.5, y: 7.2 }, dragging: false },
        { type: 'dimensions', id: 'b' },
      ],
      LABELS,
      true,
    );

    expect(changes.select).toEqual(['b']);
    expect(changes.dragging).toEqual({ a: { x: 10.4, y: 20.6 } });
    expect(changes.released).toEqual(['c']);
    expect(changes.edits).toEqual([
      {
        edited: { document: { ...LINE, layout: { c: { x: 6, y: 7 } } }, select: 'c' },
        message: 'Moved Node c on the canvas.',
        gesture: 'move:c',
      },
    ]);
  });

  it('only selects on a read-only canvas', () => {
    const changes = graphChangesOf(
      LINE_ADAPTER,
      LINE,
      [
        { type: 'select', id: 'a', selected: true },
        { type: 'position', id: 'a', position: { x: 1, y: 1 }, dragging: false },
      ],
      LABELS,
      false,
    );

    expect(changes).toEqual({ select: ['a'], dragging: {}, released: [], edits: [] });
  });
});

describe('graphConnectionOf (C141.3, C155.11)', () => {
  it('connects through the adapter’s rules, and refuses what the format cannot express', () => {
    expect(
      graphConnectionOf(
        LINE_ADAPTER,
        LINE,
        { source: 'b', sourceHandle: 'next', target: 'c' },
        LABELS,
      )?.message,
    ).toBe('Connected Node b to Node c.');
    expect(
      graphConnectionOf(
        LINE_ADAPTER,
        LINE,
        { source: 'c', sourceHandle: 'next', target: 'a' },
        LABELS,
      ),
    ).toBeNull();
    expect(
      graphConnectionOf(
        LINE_ADAPTER,
        LINE,
        { source: 'a', sourceHandle: null, target: 'b' },
        LABELS,
      ),
    ).toBeNull();
  });
});
