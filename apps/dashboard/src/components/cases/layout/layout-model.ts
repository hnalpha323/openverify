/**
 * A case template version's layout (C172.1; Phase 8 decision 70) as the case page arranges it: one
 * to three columns, each module once, ordered within its column. Pure, so the page and the layout
 * editor read the same arrangement.
 */
import type { CaseLayout } from '@openverify/contracts';
import type { CaseLayoutModule } from '@openverify/core';

export interface PlacedModule {
  readonly key: CaseLayoutModule;
  readonly collapsed: boolean;
}

export interface ModuleArrangement {
  readonly columns: number;
  /** One list per column, each ordered by `order`, holding only the modules the reader sees. */
  readonly placed: readonly (readonly PlacedModule[])[];
}

/**
 * The arrangement of `layout` for a reader who sees `visible`; `null` for a version without a
 * layout, whose page keeps the default arrangement. A module the layout does not place is not
 * shown: removing a module from the layout is how an author hides it.
 */
export function arrangeModules(
  layout: CaseLayout | null | undefined,
  visible: ReadonlySet<CaseLayoutModule>,
): ModuleArrangement | null {
  if (layout === null || layout === undefined) {
    return null;
  }
  const placed = Array.from({ length: layout.columns }, (_, index) =>
    layout.modules
      .filter((module) => module.column === index + 1 && visible.has(module.key))
      .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
      .map((module) => ({ key: module.key, collapsed: module.collapsed })),
  );
  return { columns: layout.columns, placed };
}
