import { useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Moves focus to the heading (`h1`) inside the returned container whenever `screen` changes, so
 * screen readers announce the new screen. The first screen keeps the page's own focus.
 *
 * A layout effect, so focus moves in the commit that shows the new screen: a flow API answer
 * arrives outside any event, and a passive effect would leave focus on the page until it ran.
 */
export function useScreenFocus(screen: string): RefObject<HTMLDivElement | null> {
  const container = useRef<HTMLDivElement>(null);
  const focused = useRef<string | null>(null);

  useLayoutEffect(() => {
    const previous = focused.current;
    focused.current = screen;
    if (previous === null || previous === screen) {
      return;
    }
    const heading = container.current?.querySelector('h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }, [screen]);

  return container;
}
