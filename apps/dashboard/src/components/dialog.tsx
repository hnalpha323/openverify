'use client';

import { cx } from '@openverify/ui';
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const SIZES = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

/** The page content (`console-layout.tsx`), focusable with `tabIndex={-1}`. */
const CONTENT_ID = 'content';
/** How long focus keeps following a page that a dialog's action is still changing. */
const FOLLOW_MS = 10_000;

const canTakeFocus = (element: HTMLElement | null): element is HTMLElement =>
  element?.isConnected === true && !element.matches(':disabled');

/**
 * Gives focus back to `opener` after a dialog closed (Workflow 2D F007). A confirmed action often
 * removes the opener (an Approve button once approved) or disables it while it runs, and the
 * revalidated page arrives after the dialog closed: focus would then fall to `<body>`. So, until
 * focus moves elsewhere, focus follows the page: to the opener when it can take focus, else to
 * the page content.
 */
function returnFocus(opener: HTMLElement | null): void {
  const content = () => document.getElementById(CONTENT_ID);
  // Whether focus waits on the content because this function put it there.
  let parked = false;
  const lost = () => {
    const active = document.activeElement;
    return active === null || active === document.body || (parked && active === content());
  };
  const settle = () => {
    if (canTakeFocus(opener)) {
      if (lost()) {
        opener.focus();
        parked = false;
      }
    } else if (document.activeElement === null || document.activeElement === document.body) {
      content()?.focus();
      parked = document.activeElement === content();
    }
  };
  settle();
  if (opener === null) {
    return;
  }
  const observer = new MutationObserver(() => {
    if (!lost() && document.activeElement !== opener) {
      // The operator (or the page) moved focus on: stop following.
      stop();
      return;
    }
    settle();
  });
  const timer = setTimeout(() => {
    stop();
  }, FOLLOW_MS);
  function stop() {
    observer.disconnect();
    clearTimeout(timer);
  }
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled'],
  });
}

export interface DialogProps {
  readonly open: boolean;
  /** Called on Escape, a click on the backdrop, or a close button inside. */
  readonly onClose: () => void;
  /** Names the dialog. */
  readonly title: ReactNode;
  /** Describes the dialog to assistive tech. */
  readonly description?: ReactNode;
  readonly children: ReactNode;
  /** What gets focus first; by default the first focusable element, else the dialog. */
  readonly initialFocus?: RefObject<HTMLElement | null>;
  /** False while an action runs: Escape and the backdrop then do nothing. Defaults to true. */
  readonly dismissible?: boolean;
  readonly size?: keyof typeof SIZES;
}

/**
 * A modal dialog: rendered over the page, which becomes inert; focus moves in, Tab stays inside,
 * Escape closes, and focus returns to what was focused before it opened, or to the page content
 * when the dialog's action removed it (Workflow 2D F007).
 */
export function Dialog(props: DialogProps) {
  return props.open ? <OpenDialog {...props} /> : null;
}

/** Marks a live region (`ToastProvider`) that a dialog never makes inert (Workflow 2D F008). */
const LIVE_REGION_ATTRIBUTE = 'data-live-region';

/**
 * Makes everything on the page inert except `keep` and the live regions, and answers what it made
 * inert. An element that contains one of them is not made inert itself: its other children are.
 * A live region must stay in the accessibility tree, or what is added to it while a dialog closes
 * (a success toast) is never announced.
 */
function inertOutside(keep: HTMLElement | null): HTMLElement[] {
  const kept = [
    ...(keep === null ? [] : [keep]),
    ...document.querySelectorAll<HTMLElement>(`[${LIVE_REGION_ATTRIBUTE}]`),
  ];
  const made: HTMLElement[] = [];
  const visit = (parent: Element) => {
    for (const child of parent.children) {
      if (!(child instanceof HTMLElement) || kept.includes(child)) {
        continue;
      }
      if (kept.some((element) => child.contains(element))) {
        visit(child);
      } else if (!child.hasAttribute('inert')) {
        child.setAttribute('inert', '');
        made.push(child);
      }
    }
  };
  visit(document.body);
  return made;
}

function focusablesIn(element: HTMLElement): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

function OpenDialog({
  onClose,
  title,
  description,
  children,
  initialFocus,
  dismissible = true,
  size = 'md',
}: DialogProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef(initialFocus);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = rootRef.current;
    const dialog = dialogRef.current;
    // Everything else on the page stops taking focus, clicks and assistive tech reading, except
    // the live regions, which must keep announcing (Workflow 2D F008).
    const madeInert = inertOutside(root);
    if (dialog !== null) {
      (initialFocusRef.current?.current ?? focusablesIn(dialog)[0] ?? dialog).focus();
    }
    return () => {
      for (const element of madeInert) {
        element.removeAttribute('inert');
      }
      returnFocus(previous);
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (dismissible) {
        onClose();
      }
      return;
    }
    const dialog = dialogRef.current;
    if (event.key !== 'Tab' || dialog === null) {
      return;
    }
    const focusables = focusablesIn(dialog);
    const first = focusables[0];
    const last = focusables.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      ref={rootRef}
      data-dialog-root=""
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cx(
          'flex max-h-[90dvh] w-full flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          SIZES[size],
        )}
      >
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {title}
        </h2>
        {description !== undefined && (
          <div id={descriptionId} className="text-sm text-ink-muted">
            {description}
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
