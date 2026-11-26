'use client';

/**
 * The shared editor's outline (C141.2, C155.2, editor note 2.4): an APG tree view with one tab stop,
 * for any document an adapter describes (a workflow's definition, a flow).
 * Up and Down move between visible items, Right expands a group or enters it, Left collapses it or
 * returns to its parent, Home and End go to the first and last item, Enter or a click selects an
 * item. Each item is named by its type, name and error count, from its label alone (a group's
 * children are not part of its name).
 */
import {
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';

/** One item of the tree: its label alone names it (WCAG 2.5.3), with its problems counted. */
export interface OutlineTreeItem {
  readonly id: string;
  readonly label: string;
  readonly issues: readonly unknown[];
  readonly children: readonly OutlineTreeItem[];
}

export interface OutlineTreeProps<Item extends OutlineTreeItem> {
  /** Names the tree: "Outline of the flow". */
  readonly label: string;
  readonly items: readonly Item[];
  /** Called with the item Enter, Space or a click selected. */
  readonly onSelect?: (item: Item) => void;
  /** Called after `onSelect` when Enter activates an item: the editor opens its menu. */
  readonly onActivate?: (item: Item, element: HTMLElement) => void;
  /** Lets the page move focus to a step (the errors panel's "Go to step"). */
  readonly ref?: Ref<OutlineHandle>;
}

export interface OutlineHandle {
  /** Expands the groups on the way to the item `id` and moves focus to it. */
  readonly focusItem: (id: string) => void;
  /**
   * Expands the groups on the way to `id` and makes it the outline's tab stop without moving
   * focus, so a selection made elsewhere (the canvas) is where Tab enters the outline.
   */
  readonly revealItem: (id: string) => void;
}

interface Visible<Item extends OutlineTreeItem> {
  readonly item: Item;
  readonly parent: string | null;
  /** APG: `aria-level`, `aria-posinset` and `aria-setsize`, since the items are not nested. */
  readonly depth: number;
  readonly position: number;
  readonly size: number;
}

/** Each level's indent; Tailwind needs the literal classes. */
const INDENT = ['', 'ml-5', 'ml-10', 'ml-15', 'ml-20', 'ml-25', 'ml-30', 'ml-35'] as const;

const plural = (count: number) => `${String(count)} ${count === 1 ? 'error' : 'errors'}`;

export const outlineName = (item: OutlineTreeItem) =>
  item.issues.length === 0 ? item.label : `${item.label}, ${plural(item.issues.length)}`;

function allGroups(items: readonly OutlineTreeItem[]): string[] {
  return items.flatMap((item) =>
    item.children.length === 0 ? [] : [item.id, ...allGroups(item.children)],
  );
}

function pathTo(items: readonly OutlineTreeItem[], id: string): string[] | null {
  for (const item of items) {
    if (item.id === id) {
      return [];
    }
    const below = pathTo(item.children, id);
    if (below !== null) {
      return [item.id, ...below];
    }
  }
  return null;
}

export function OutlineTree<Item extends OutlineTreeItem>({
  label,
  items,
  onSelect,
  onActivate,
  ref,
}: OutlineTreeProps<Item>) {
  const base = useId();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const known = useMemo(() => new Set(allGroups(items)), [items]);

  const visible = useMemo(() => {
    const list: Visible<Item>[] = [];
    const walk = (level: readonly Item[], parent: string | null, depth: number) => {
      level.forEach((item, index) => {
        list.push({ item, parent, depth, position: index + 1, size: level.length });
        if (item.children.length > 0 && !collapsed.has(item.id)) {
          walk(item.children as readonly Item[], item.id, depth + 1);
        }
      });
    };
    walk(items, null, 1);
    return list;
  }, [items, collapsed]);

  const current = visible.some((entry) => entry.item.id === active)
    ? active
    : (visible[0]?.item.id ?? null);

  const focus = (id: string | undefined) => {
    if (id === undefined) {
      return;
    }
    setActive(id);
    refs.current.get(id)?.focus();
  };

  useImperativeHandle(ref, () => {
    const reveal = (id: string): boolean => {
      const path = pathTo(items, id);
      if (path === null) {
        return false;
      }
      setCollapsed((previous) => new Set([...previous].filter((group) => !path.includes(group))));
      setActive(id);
      return true;
    };
    return {
      focusItem: (id: string) => {
        if (reveal(id)) {
          // Focus once the groups on the path have rendered.
          requestAnimationFrame(() => {
            refs.current.get(id)?.focus();
          });
        }
      },
      revealItem: (id: string) => {
        reveal(id);
      },
    };
  }, [items]);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = visible.findIndex((entry) => entry.item.id === current);
    const entry = visible[index];
    if (entry === undefined) {
      return;
    }
    const { item, parent } = entry;
    const expandable = item.children.length > 0;
    const isCollapsed = collapsed.has(item.id);
    let handled = true;
    switch (event.key) {
      case 'ArrowDown':
        focus(visible[index + 1]?.item.id);
        break;
      case 'ArrowUp':
        focus(visible[index - 1]?.item.id);
        break;
      case 'Home':
        focus(visible[0]?.item.id);
        break;
      case 'End':
        focus(visible.at(-1)?.item.id);
        break;
      case 'ArrowRight':
        if (expandable && isCollapsed) {
          setCollapsed((previous) => new Set([...previous].filter((id) => id !== item.id)));
        } else if (expandable) {
          focus(item.children[0]?.id);
        }
        break;
      case 'ArrowLeft':
        if (expandable && !isCollapsed) {
          setCollapsed((previous) => new Set([...previous, item.id]));
        } else if (parent !== null) {
          focus(parent);
        }
        break;
      case 'Enter': {
        onSelect?.(item);
        const element = refs.current.get(item.id);
        if (element !== undefined) {
          onActivate?.(item, element);
        }
        break;
      }
      case ' ':
        onSelect?.(item);
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
    }
  };

  return (
    <ul role="tree" aria-label={label} onKeyDown={onKeyDown} className="flex flex-col">
      {/* A flat list of the visible items (APG tree view: levels, set sizes and positions
          stated), so each item's visible text is its own label and nothing of its children's
          (WCAG 2.5.3). */}
      {visible.map(({ item, depth, position, size }) => {
        const expandable = item.children.length > 0 && known.has(item.id);
        const open = expandable && !collapsed.has(item.id);
        const labelId = `${base}-${item.id}`;
        return (
          <li
            key={item.id}
            role="treeitem"
            aria-labelledby={labelId}
            aria-level={depth}
            aria-posinset={position}
            aria-setsize={size}
            aria-selected={item.id === active}
            {...(expandable ? { 'aria-expanded': open } : {})}
            tabIndex={item.id === current ? 0 : -1}
            ref={(node) => {
              if (node === null) {
                refs.current.delete(item.id);
              } else {
                refs.current.set(item.id, node);
              }
            }}
            onClick={() => {
              setActive(item.id);
              onSelect?.(item);
            }}
            onFocus={(event) => {
              if (event.target === event.currentTarget) {
                setActive(item.id);
              }
            }}
            className={`rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${INDENT[Math.min(depth - 1, INDENT.length - 1)] ?? ''} ${depth > 1 ? 'border-l border-line pl-3' : ''}`}
          >
            <span id={labelId} className="block py-1 text-sm">
              {item.label}
              {item.issues.length > 0 && (
                <span className="font-semibold">, {plural(item.issues.length)}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
