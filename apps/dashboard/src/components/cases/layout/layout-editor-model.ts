/**
 * The layout editor's state (C172.1): the modules of each column in order, each collapsed or not,
 * and the moves an author makes by keyboard, by a single pointer or by dragging, each one the same
 * pure change. `null` is the version's default layout.
 */
import type { CaseLayout } from '@openverify/contracts';
import type { CaseLayoutModule } from '@openverify/core';
import { arrangeModules, type PlacedModule } from './layout-model';

export interface EditorLayout {
  readonly columns: number;
  readonly placed: readonly (readonly PlacedModule[])[];
}

/** The contract's bounds on a layout's columns (`caseLayoutSchema`). */
export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 3;

/** The editor's state of a saved layout; `null` stays the default layout. */
export function editorLayoutOf(layout: CaseLayout | null | undefined): EditorLayout | null {
  if (layout === null || layout === undefined) {
    return null;
  }
  return arrangeModules(layout, new Set(layout.modules.map((module) => module.key)));
}

/** Every offered module in one column, in the order given: the start of a new layout. */
export function startLayout(offered: readonly CaseLayoutModule[]): EditorLayout {
  return { columns: 1, placed: [offered.map((key) => ({ key, collapsed: false }))] };
}

/** The layout to save: each module's column and its order within it. */
export function layoutOf(state: EditorLayout): CaseLayout {
  return {
    columns: state.columns,
    modules: state.placed.flatMap((column, index) =>
      column.map((module, order) => ({
        key: module.key,
        column: index + 1,
        order,
        collapsed: module.collapsed,
      })),
    ),
  };
}

/** Where a module is: its column (1-based) and position (0-based), or `null`. */
export function positionOf(
  state: EditorLayout,
  key: CaseLayoutModule,
): { readonly column: number; readonly index: number } | null {
  for (const [column, modules] of state.placed.entries()) {
    const index = modules.findIndex((module) => module.key === key);
    if (index !== -1) {
      return { column: column + 1, index };
    }
  }
  return null;
}

const moduleOf = (state: EditorLayout, key: CaseLayoutModule): PlacedModule | undefined =>
  state.placed.flat().find((module) => module.key === key);

const without = (state: EditorLayout, key: CaseLayoutModule) =>
  state.placed.map((column) => column.filter((module) => module.key !== key));

/** One step up (`-1`) or down (`1`) in its column; unchanged at either end. */
export function moveWithin(state: EditorLayout, key: CaseLayoutModule, step: -1 | 1): EditorLayout {
  const at = positionOf(state, key);
  if (at === null) {
    return state;
  }
  const column = [...(state.placed[at.column - 1] ?? [])];
  const target = at.index + step;
  const moving = column[at.index];
  const other = column[target];
  if (moving === undefined || other === undefined) {
    return state;
  }
  column[target] = moving;
  column[at.index] = other;
  return {
    ...state,
    placed: state.placed.map((each, index) => (index === at.column - 1 ? column : each)),
  };
}

/**
 * Into `column` before `before` (at the column's end when `null`): the drop of a drag, and "Move to
 * column", which appends. A column outside the layout, or a module not laid out, changes nothing.
 */
export function moveTo(
  state: EditorLayout,
  key: CaseLayoutModule,
  column: number,
  before: CaseLayoutModule | null = null,
): EditorLayout {
  const moving = moduleOf(state, key);
  if (moving === undefined || column < 1 || column > state.columns || before === key) {
    return state;
  }
  const placed = without(state, key).map((modules, index) => {
    if (index !== column - 1) {
      return modules;
    }
    const at = before === null ? -1 : modules.findIndex((module) => module.key === before);
    return at === -1
      ? [...modules, moving]
      : [...modules.slice(0, at), moving, ...modules.slice(at)];
  });
  return { ...state, placed };
}

/** One to three columns; the modules of a column taken away move to the new last column. */
export function setColumns(state: EditorLayout, columns: number): EditorLayout {
  const count = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.trunc(columns)));
  const kept = Array.from({ length: count }, (_, index) => [...(state.placed[index] ?? [])]);
  const moved = state.placed.slice(count).flat();
  kept[count - 1] = [...(kept[count - 1] ?? []), ...moved];
  return { columns: count, placed: kept };
}

/** A module added at the end of the first column; one already laid out stays where it is. */
export function addModule(state: EditorLayout, key: CaseLayoutModule): EditorLayout {
  if (positionOf(state, key) !== null) {
    return state;
  }
  return {
    ...state,
    placed: state.placed.map((column, index) =>
      index === 0 ? [...column, { key, collapsed: false }] : column,
    ),
  };
}

/** A module taken out of the layout: the case page will not show it. */
export function removeModule(state: EditorLayout, key: CaseLayoutModule): EditorLayout {
  return { ...state, placed: without(state, key) };
}

/** A module shown collapsed at first, or open. */
export function setCollapsed(
  state: EditorLayout,
  key: CaseLayoutModule,
  collapsed: boolean,
): EditorLayout {
  return {
    ...state,
    placed: state.placed.map((column) =>
      column.map((module) => (module.key === key ? { ...module, collapsed } : module)),
    ),
  };
}
