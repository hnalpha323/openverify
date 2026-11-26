'use client';

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ToastInput {
  /** `error` interrupts (role alert); `success` and `info` wait (role status). */
  readonly tone: 'success' | 'error' | 'info';
  readonly message: string;
}

interface Toast extends ToastInput {
  readonly id: number;
}

export interface ToastApi {
  /**
   * Shows a short message after an action. A success or info message goes away on its own; an
   * error stays until dismissed, since its reason may be shown nowhere else (Workflow 2D F011).
   */
  readonly show: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** How long a success or info toast stays when nobody points at or focuses it. */
export const TOAST_DURATION_MS = 6_000;

const TONES: Record<Toast['tone'], string> = {
  success: 'border-green-300 bg-green-50 text-green-900',
  error: 'border-red-300 bg-red-50 text-red-900',
  info: 'border-blue-300 bg-blue-50 text-blue-900',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    // An error is not timed (WCAG 2.2.1): it stays until the operator dismisses it.
    if (paused || toast.tone === 'error') {
      return undefined;
    }
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, TOAST_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [paused, onDismiss, toast.id, toast.tone]);

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => {
        setPaused(true);
      }}
      onMouseLeave={() => {
        setPaused(false);
      }}
      onFocus={() => {
        setPaused(true);
      }}
      onBlur={() => {
        setPaused(false);
      }}
      className={`flex items-start gap-3 rounded-lg border border-s-4 p-3 text-sm shadow-md ${TONES[toast.tone]}`}
    >
      <p className="flex-1">{toast.message}</p>
      <button
        type="button"
        aria-label={`Dismiss: ${toast.message}`}
        onClick={() => {
          onDismiss(toast.id);
        }}
        className="rounded px-1 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

/** Where the stack sits: at the bottom end, or at the top end while that would cover the focus. */
type Placement = 'bottom' | 'top';

/** The stack's gap from the viewport's edge (Tailwind's `bottom-4` and `top-4`), in CSS px. */
const EDGE_PX = 16;

const overlaps = (a: DOMRect, b: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * WCAG 2.4.11 (Workflow 9D, a11y-audit): the placement that leaves `focused` uncovered: the
 * current one unless the stack covers it there, then the other edge unless that covers it too.
 */
export function placementClearOf(
  focused: DOMRect,
  stack: DOMRect,
  current: Placement,
  viewportHeight: number,
): Placement {
  if (!overlaps(focused, stack)) {
    return current;
  }
  const other: Placement = current === 'bottom' ? 'top' : 'bottom';
  const top = other === 'top' ? EDGE_PX : viewportHeight - EDGE_PX - stack.height;
  return overlaps(focused, {
    left: stack.left,
    right: stack.right,
    top,
    bottom: top + stack.height,
  })
    ? current
    : other;
}

/**
 * Holds the console's toasts. Messages are announced through a polite live region (errors as
 * alerts), stay while hovered or focused, and can be dismissed; errors stay until dismissed.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const [placement, setPlacement] = useState<Placement>('bottom');
  const nextId = useRef(0);
  const region = useRef<HTMLElement>(null);

  // WCAG 2.4.11 (Workflow 9D): while toasts are shown, focus landing under the stack (an error
  // stays until dismissed) moves the stack to the other edge, after the browser has scrolled.
  const shown = toasts.length > 0;
  useEffect(() => {
    if (!shown) {
      return undefined;
    }
    let frame = 0;
    const onFocusIn = (event: FocusEvent) => {
      const { target } = event;
      const stack = region.current;
      if (!(target instanceof Element) || stack === null || stack.contains(target)) {
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setPlacement((current) =>
          placementClearOf(
            target.getBoundingClientRect(),
            stack.getBoundingClientRect(),
            current,
            window.innerHeight,
          ),
        );
      });
    };
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      cancelAnimationFrame(frame);
    };
  }, [shown]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const show = useCallback((toast: ToastInput) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => [...current, { ...toast, id }]);
  }, []);
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext value={api}>
      {children}
      <section
        ref={region}
        aria-label="Notifications"
        aria-live="polite"
        // A dialog never makes it inert, so a toast shown as a dialog closes is announced.
        data-live-region=""
        data-placement={placement}
        className={`pointer-events-none fixed end-4 z-40 flex w-full max-w-sm flex-col gap-2 *:pointer-events-auto ${placement === 'top' ? 'top-4' : 'bottom-4'}`}
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </section>
    </ToastContext>
  );
}

/**
 * The toasts of the nearest `ToastProvider` (the root layout has one).
 * @throws {Error} outside a provider.
 */
export function useToast(): ToastApi {
  const api = use(ToastContext);
  // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
  if (api === null) {
    throw new Error('useToast() needs a <ToastProvider> above it');
  }
  return api;
}
