'use client';

/**
 * An outline item's menu (C141.2, editor note 2.4), on the APG menu pattern: focus moves to its
 * first item when it opens; Up and Down move (wrapping), Home and End jump; Enter, Space or a
 * click picks; Escape closes and Tab closes and moves on, and whoever opened it puts focus back.
 * A disabled item stays in the list with `aria-disabled` and says why, so nothing an operator
 * looks for silently disappears. Every target is at least 24 px high (WCAG 2.5.8).
 */
import { useEffect, useId, useRef, type KeyboardEvent } from 'react';

/** One entry of an outline item's menu; `disabled` says why it cannot be used. */
export interface EditMenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled: string | null;
}

export interface EditMenuProps {
  /** Names the menu ("Actions for Trigger: The API"). */
  readonly label: string;
  readonly items: readonly EditMenuItem[];
  readonly onPick: (id: string) => void;
  /** Escape or Tab: the menu closes and focus returns to what opened it. */
  readonly onClose: () => void;
}

export function EditMenu({ label, items, onPick, onClose }: EditMenuProps) {
  const base = useId();
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const focusAt = (index: number) => {
    const count = items.length;
    refs.current[((index % count) + count) % count]?.focus();
  };

  const pick = (item: EditMenuItem) => {
    if (item.disabled === null) {
      onPick(item.id);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const item = items[index];
    switch (event.key) {
      case 'ArrowDown':
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        focusAt(index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(items.length - 1);
        break;
      case 'Enter':
      case ' ':
        if (item !== undefined) {
          pick(item);
        }
        break;
      case 'Escape':
        onClose();
        break;
      case 'Tab':
        onClose();
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <ul
      role="menu"
      aria-label={label}
      className="z-10 flex min-w-64 flex-col rounded-md border border-line bg-surface p-1 shadow-lg"
    >
      {items.map((item, index) => (
        <li
          key={item.id}
          role="menuitem"
          tabIndex={-1}
          aria-disabled={item.disabled === null ? undefined : true}
          aria-labelledby={`${base}-${item.id}-label`}
          aria-describedby={item.disabled === null ? undefined : `${base}-${item.id}`}
          ref={(node) => {
            refs.current[index] = node;
          }}
          onKeyDown={(event) => {
            onKeyDown(event, index);
          }}
          onClick={() => {
            pick(item);
          }}
          className={`flex min-h-6 cursor-default flex-col rounded px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${item.disabled === null ? 'hover:bg-canvas' : 'text-ink-muted'}`}
        >
          <span id={`${base}-${item.id}-label`}>{item.label}</span>
          {item.disabled !== null && (
            <span id={`${base}-${item.id}`} className="text-xs">
              {item.disabled}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
