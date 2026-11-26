import { render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useScreenFocus } from './use-screen-focus';

/** Shows `first`, then `second` once a macrotask has passed, as a flow API answer arrives. */
function Screens({ first, second }: { readonly first: string; readonly second: string }) {
  const [current, setCurrent] = useState(first);
  const container = useScreenFocus(current);
  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrent(second);
    }, 10);
    return () => {
      clearTimeout(timer);
    };
  }, [second]);
  return (
    <div ref={container}>
      <h1 key={current}>{current}</h1>
    </div>
  );
}

describe('useScreenFocus', () => {
  it('has focus on the new heading when it appears, never on the page (WCAG 2.4.3)', async () => {
    // A mutation observer runs right after the commit that inserts the heading, before React's
    // passive effects, so it sees focus where the browser has it at that moment.
    let focusedWhenShown: boolean | undefined;
    const observer = new MutationObserver(() => {
      const heading = screen.queryByRole('heading', { name: 'Next screen' });
      if (heading !== null && focusedWhenShown === undefined) {
        focusedWhenShown = heading === document.activeElement;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    render(<Screens first="First screen" second="Next screen" />);
    // The order of the commit and the passive effects is the point, not the speed: on a busy
    // machine (every package's suite at once) the 10 ms answer took more than findByRole's 1 s
    // default, so the wait is bounded by most of the test's own timeout instead.
    await screen.findByRole('heading', { name: 'Next screen' }, { timeout: 15_000 });
    observer.disconnect();

    expect(focusedWhenShown).toBe(true);
  });

  it('leaves focus alone on the first screen', () => {
    render(<Screens first="First screen" second="First screen" />);

    expect(document.activeElement).toBe(document.body);
  });
});
