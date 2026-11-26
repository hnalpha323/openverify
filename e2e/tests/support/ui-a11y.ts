/**
 * C171.3 (Workflow 9D, `a11y-audit`): the page checks of the console's own WCAG tests
 * (`ui-a11y-*.spec.ts`), for what axe cannot decide. Each runs in the browser and answers what it
 * found, so a spec fails with the evidence. The flow's twin is `apps/flow/e2e/support/wcag-checks.ts`.
 */
import type { Page } from '@playwright/test';

/**
 * KP10-1 (Workflow 10A): how long a cover may take to move clear of the focus, in ms of the page's
 * own clock. Provisional, ours: the console's toast stack moves on the frame after `focusin` and
 * React commits it a task later, well inside this on a loaded runner; a cover that lasts longer is
 * a cover.
 */
export const SETTLE_BOUND_MS = 1_000;

/**
 * 2.4.11, as C171.3 states it: the focused element is failed when the topmost element at its centre
 * or at any corner (2 px in) is something else. The page is judged once it has settled: after two
 * animation frames, then at each frame until nothing covers the focus or `boundMs` has passed
 * (KP10-1: the toast stack moves clear on the frame after `focusin`, so a judgement straight after
 * the key press read the stack before it moved on a slow runner). Answers the focused element and
 * what covers it, or `null`.
 */
export function coveredFocus(
  page: Page,
  boundMs: number = SETTLE_BOUND_MS,
): Promise<string | null> {
  return page.evaluate(async (bound) => {
    const describe = (element: Element) =>
      `${element.tagName.toLowerCase()}${element.id === '' ? '' : `#${element.id}`}${
        element.getAttribute('aria-label') === null
          ? ''
          : `[aria-label="${element.getAttribute('aria-label') ?? ''}"]`
      }`;
    const judge = (): string | null => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement) || focused === document.body) return null;
      const box = focused.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return null;
      const inset = 2;
      const points = [
        [box.left + box.width / 2, box.top + box.height / 2],
        [box.left + inset, box.top + inset],
        [box.right - inset, box.top + inset],
        [box.left + inset, box.bottom - inset],
        [box.right - inset, box.bottom - inset],
      ];
      for (const [x = 0, y = 0] of points) {
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        if (top !== null && top !== focused && !focused.contains(top) && !top.contains(focused)) {
          return `${describe(focused)} under ${describe(top)}`;
        }
      }
      return null;
    };
    const frame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    await frame();
    await frame();
    const start = performance.now();
    let cover = judge();
    while (cover !== null && performance.now() - start < bound) {
      await frame();
      cover = judge();
    }
    return cover;
  }, boundMs);
}

/** 2.4.11: tabs `presses` times from where focus is, answering each covered stop. */
export async function coveredWhileTabbing(
  page: Page,
  presses: number,
  where: string,
): Promise<string[]> {
  const covered: string[] = [];
  for (let press = 0; press < presses; press += 1) {
    await page.keyboard.press('Tab');
    const cover = await coveredFocus(page);
    if (cover !== null) covered.push(`${where}, Tab ${String(press + 1)}: ${cover}`);
  }
  return covered;
}

/** 1.4.10: how far the page scrolls sideways, in CSS px (0 when it reflows). */
export function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Moves focus to the start of the page, as a person who has just opened it. */
export async function focusPageStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
}
