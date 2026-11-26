'use client';

import { Button } from '@openverify/ui';
import { useEffect, useId, useState } from 'react';
import { Dialog } from '../../dialog';

/** The browser key under which this viewer's choice is kept: a convenience, never shared. */
export const PAGE_SHORTCUTS_KEY = 'openverify.case-page-shortcuts';

/**
 * The page chords (editor note 7.6): Alt+Shift with a letter, read by its physical key so a
 * keyboard layout or the Option key does not change it. Each moves focus; none changes anything, and
 * no decision has a shortcut.
 */
const CHORDS: readonly {
  readonly code: string;
  readonly keys: string;
  readonly target: string;
  readonly words: string;
}[] = Object.freeze([
  { code: 'KeyC', keys: 'Alt+Shift+C', target: 'comment', words: 'Write a comment' },
  { code: 'KeyV', keys: 'Alt+Shift+V', target: 'compare', words: 'Go to the compare panel' },
  { code: 'KeyT', keys: 'Alt+Shift+T', target: 'timeline', words: 'Go to the timeline' },
]);

function readChoice(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  try {
    return window.localStorage.getItem(PAGE_SHORTCUTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function keepChoice(enabled: boolean): void {
  try {
    window.localStorage.setItem(PAGE_SHORTCUTS_KEY, enabled ? 'on' : 'off');
  } catch {
    // A browser that refuses storage keeps the choice for this page only.
  }
}

const targetOf = (name: string) =>
  document.querySelector<HTMLElement>(`[data-shortcut-target="${name}"]`);

/**
 * The case page's keyboard shortcuts (C142.3, WCAG 2.1.4): the viewer's character keys work only
 * while a viewer has focus; the page chords can be switched off here, a choice this browser keeps.
 * Every shortcut is listed in a dialog and named on its target with `aria-keyshortcuts`.
 */
export function CaseShortcuts() {
  // Read once, in the browser: the server renders no page chord and no checked box.
  const [enabled, setEnabled] = useState(readChoice);
  const [open, setOpen] = useState(false);
  const toggleId = useId();

  useEffect(() => {
    for (const chord of CHORDS) {
      const target = targetOf(chord.target);
      if (enabled) target?.setAttribute('aria-keyshortcuts', chord.keys);
      else target?.removeAttribute('aria-keyshortcuts');
    }
    if (!enabled) {
      return undefined;
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const chord = CHORDS.find((each) => each.code === event.code);
      const target = chord === undefined ? null : targetOf(chord.target);
      if (target !== null) {
        event.preventDefault();
        target.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setOpen(true);
        }}
      >
        Keyboard shortcuts
      </Button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Keyboard shortcuts"
        description="No decision has a shortcut: approving or declining always takes a button and a confirmation."
      >
        <div className="flex flex-col gap-4 text-sm">
          <section className="flex flex-col gap-1">
            <h3 className="font-semibold">In an image viewer, while it has focus</h3>
            <p>
              +, -, 0, the arrows and R: zoom in, zoom out, reset, move the image and rotate it.
              Every one is also a button.
            </p>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">On the page</h3>
            <ul className="flex flex-col gap-1">
              {CHORDS.map((chord) => (
                <li key={chord.code}>
                  <kbd className="font-mono">{chord.keys}</kbd>: {chord.words}
                </li>
              ))}
            </ul>
            <label htmlFor={toggleId} className="flex min-h-6 items-center gap-2">
              <input
                id={toggleId}
                type="checkbox"
                checked={enabled}
                onChange={(event) => {
                  setEnabled(event.target.checked);
                  keepChoice(event.target.checked);
                }}
              />
              Use the page shortcuts
            </label>
          </section>
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
