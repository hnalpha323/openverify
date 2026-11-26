'use client';

/**
 * The outline view of a definition (C141.2, editor note 2.4): the shared editor's APG tree
 * (`graph-editor/outline-tree.tsx`, C155.1) over the definition's items, named "Outline of the
 * definition". Up and Down move between visible items, Right expands a group or enters it, Left
 * collapses it or returns to its parent, Home and End go to the first and last item, Enter or a
 * click selects an item.
 */
import type { Ref } from 'react';
import { OutlineTree, type OutlineHandle } from '../graph-editor/outline-tree';
import type { OutlineItem } from './definition-outline-model';

export { outlineName, type OutlineHandle } from '../graph-editor/outline-tree';

export interface DefinitionOutlineProps {
  readonly items: readonly OutlineItem[];
  /** Called with the item Enter, Space or a click selected. */
  readonly onSelect?: (item: OutlineItem) => void;
  /** Called after `onSelect` when Enter activates an item: the editor opens its menu. */
  readonly onActivate?: (item: OutlineItem, element: HTMLElement) => void;
  /** Lets the page move focus to a step (the errors panel's "Go to step"). */
  readonly ref?: Ref<OutlineHandle>;
}

export function DefinitionOutline(props: DefinitionOutlineProps) {
  return <OutlineTree label="Outline of the definition" {...props} />;
}
