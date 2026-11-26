/** C172.1: every move of the layout editor is one pure change, whichever way the author makes it. */
import { describe, expect, it } from 'vitest';
import {
  addModule,
  editorLayoutOf,
  layoutOf,
  moveTo,
  moveWithin,
  positionOf,
  removeModule,
  setCollapsed,
  setColumns,
  startLayout,
} from './layout-editor-model';

const keysOf = (state: ReturnType<typeof startLayout>) =>
  state.placed.map((column) => column.map((module) => module.key));

describe('the layout editor model', () => {
  it('reads a saved layout by column and order, and keeps null as the default layout', () => {
    expect(editorLayoutOf(null)).toBeNull();
    const state = editorLayoutOf({
      columns: 2,
      modules: [
        { key: 'comments', column: 2, order: 0, collapsed: true },
        { key: 'timeline', column: 1, order: 1, collapsed: false },
        { key: 'graph', column: 1, order: 0, collapsed: false },
      ],
    });
    expect(state === null ? null : keysOf(state)).toEqual([['graph', 'timeline'], ['comments']]);
  });

  it('starts a layout with every offered module in one column, and saves each module’s column and order', () => {
    const state = setCollapsed(startLayout(['timeline', 'comments']), 'comments', true);

    expect(layoutOf(state)).toEqual({
      columns: 1,
      modules: [
        { key: 'timeline', column: 1, order: 0, collapsed: false },
        { key: 'comments', column: 1, order: 1, collapsed: true },
      ],
    });
  });

  it('moves a module up and down within its column, and leaves it at either end', () => {
    const state = startLayout(['timeline', 'comments', 'graph']);

    expect(keysOf(moveWithin(state, 'graph', -1))).toEqual([['timeline', 'graph', 'comments']]);
    expect(keysOf(moveWithin(state, 'timeline', 1))).toEqual([['comments', 'timeline', 'graph']]);
    expect(keysOf(moveWithin(state, 'timeline', -1))).toEqual(keysOf(state));
    expect(keysOf(moveWithin(state, 'graph', 1))).toEqual(keysOf(state));
  });

  it('moves a module to another column, at its end or before a module there', () => {
    const state = setColumns(startLayout(['timeline', 'comments', 'graph']), 2);

    const appended = moveTo(state, 'timeline', 2);
    expect(keysOf(appended)).toEqual([['comments', 'graph'], ['timeline']]);
    expect(positionOf(appended, 'timeline')).toEqual({ column: 2, index: 0 });
    expect(keysOf(moveTo(appended, 'graph', 2, 'timeline'))).toEqual([
      ['comments'],
      ['graph', 'timeline'],
    ]);
  });

  it('moves the modules of a column taken away into the new last column', () => {
    const three = moveTo(setColumns(startLayout(['timeline', 'comments']), 3), 'comments', 3);

    expect(keysOf(setColumns(three, 1))).toEqual([['timeline', 'comments']]);
    expect(setColumns(three, 4).columns).toBe(3);
    expect(setColumns(three, 0).columns).toBe(1);
  });

  it('adds a module at the end of the first column and takes one out of the layout', () => {
    const state = addModule(startLayout(['timeline']), 'graph');

    expect(keysOf(state)).toEqual([['timeline', 'graph']]);
    expect(keysOf(addModule(state, 'graph'))).toEqual([['timeline', 'graph']]);
    expect(keysOf(removeModule(state, 'timeline'))).toEqual([['graph']]);
    expect(positionOf(removeModule(state, 'timeline'), 'timeline')).toBeNull();
  });
});
