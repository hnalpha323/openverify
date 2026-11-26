/**
 * C171.3 (Workflow 9A, flow-renderer; shared in Workflow 9D, a11y-audit): the page checks of our
 * own WCAG tests, for what axe cannot decide. Each runs in the browser through `page.evaluate` and
 * answers what it found, so a spec fails with the evidence.
 */
import type { Page } from '@playwright/test';

/**
 * 2.4.11: the focused element covered at its centre or a corner, by the selector of what covers
 * it, or `null`.
 */
export function coveredFocus(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || focused === document.body) return null;
    const box = focused.getBoundingClientRect();
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
        return `${top.tagName.toLowerCase()}${top.id === '' ? '' : `#${top.id}`}`;
      }
    }
    return null;
  });
}

/** 2.4.11: tabs `presses` times, answering each press whose focused element something covered. */
export async function coveredWhileTabbing(page: Page, presses: number): Promise<string[]> {
  const covered: string[] = [];
  for (let press = 0; press < presses; press += 1) {
    await page.keyboard.press('Tab');
    const cover = await coveredFocus(page);
    if (cover !== null) covered.push(`${String(press)}: ${cover}`);
  }
  return covered;
}

/** A control smaller than 24 by 24 CSS px. */
export interface SmallTarget {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

/**
 * 2.5.8: the shown controls under `selector` smaller than 24 by 24 CSS px. The flow holds every
 * control to the size itself, without the criterion's spacing exception.
 */
export function smallTargets(
  page: Page,
  selector = 'main button, main select, main input, main textarea, footer select',
): Promise<SmallTarget[]> {
  return page.evaluate(
    (controls) =>
      Array.from(document.querySelectorAll<HTMLElement>(controls))
        .filter((control) => control.offsetParent !== null)
        .map((control) => {
          const box = control.getBoundingClientRect();
          return {
            name: control.getAttribute('name') ?? control.getAttribute('type') ?? control.tagName,
            width: box.width,
            height: box.height,
          };
        })
        .filter(({ width, height }) => width < 24 || height < 24),
    selector,
  );
}

/** 3.2.6: whether the help slot (the language selector) follows the page's main content. */
export function helpSlotAfterMain(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const slot = document.querySelector('footer[data-slot="help"]');
    return (
      main !== null &&
      slot !== null &&
      slot.querySelector('select') !== null &&
      (main.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
  });
}
