'use client';

import { useEffect, useId, useState } from 'react';

const HIDDEN_EXPLANATION = 'Your role cannot see personal data (the pii:view permission).';

export interface HiddenValueProps {
  /**
   * Why the value is hidden, naming the permission the role lacks: `pii:view` by default
   * (Workflow 2E E001: an image can be hidden for want of another permission).
   */
  readonly explanation?: string | undefined;
}

/**
 * A value the API masked (C15: `null` for an operator without `pii:view`). Keyboard users reach
 * it with Tab; the explanation is its accessible description and shows as a tooltip while the
 * value is hovered or focused (WCAG 1.4.13, Workflow 2D F009): the pointer can move onto the
 * tooltip to read it, and Escape dismisses it until both hover and focus have left.
 */
export function HiddenValue({ explanation = HIDDEN_EXPLANATION }: HiddenValueProps) {
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const shown = (hovered || focused) && !dismissed;

  useEffect(() => {
    if (!shown) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDismissed(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [shown]);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
        if (!focused) {
          setDismissed(false);
        }
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
        if (!hovered) {
          setDismissed(false);
        }
      }}
    >
      <span
        tabIndex={0}
        aria-describedby={tooltipId}
        className="rounded bg-canvas px-1.5 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-line ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        Hidden
      </span>
      {/* Padding, not a margin, joins it to the value, so the pointer can cross onto it. */}
      <span
        role="tooltip"
        id={tooltipId}
        hidden={!shown}
        className="absolute start-0 bottom-full z-10 w-64 pb-1"
      >
        <span className="block rounded-md bg-ink px-2 py-1 text-xs text-surface">
          {explanation}
        </span>
      </span>
    </span>
  );
}
