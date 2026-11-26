/**
 * C171.3 (Workflow 9D, `a11y-audit`): the console's own tests of WCAG 2.4.11 and 3.3.8 on the full
 * stack, which axe cannot decide. Budget: 90 s per test (header line, rule 4 of the 9D prompt).
 *
 * 1. 2.4.11: tabbing through the console's main pages, as an admin, no focused control is covered
 *    by anything (`elementFromPoint` at its centre and corners).
 * 2. 2.4.11 with a toast on screen: the settings page saved unchanged ("Nothing changed."), the
 *    toast kept on screen by the pointer resting on it, then the page tabbed through from its start.
 * 3. 3.3.8: the sign-in's password field takes a pasted password (no paste blocked), and both
 *    fields name their purpose for a password manager.
 * 4. KP10-1 (Workflow 10A, carry-10a): test 2 again with every animation frame late, as on a
 *    loaded CI runner, and the check's own control: it judges the page once it has settled, so an
 *    overlay that moves clear a frame after the focus is no cover and one that stays still is.
 *
 * Signs in only through `signInAs`; changes no setting (the save is unchanged); sends no OTP.
 */
import { expect, test, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { coveredWhileTabbing, focusPageStart } from './support/ui-a11y.js';
import { signInAs } from './support/ui.js';

/** The structured sample's static console pages (`docs/accessibility/audit-2026-11-07.md`). */
const PAGES = [
  '/',
  '/inquiries',
  '/templates',
  '/analytics',
  '/exports',
  '/theme-sets',
  '/users',
  '/roles',
  '/api-keys',
  '/webhooks',
  '/settings',
  '/account/security',
] as const;

/** More presses than the header, navigation and a page's first controls hold. */
const PRESSES = 40;

test('2.4.11: tabbing through the console’s main pages, no focused control is covered (C171.3)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  await signInAs(page, stack, 'admin');

  const covered: string[] = [];
  for (const path of PAGES) {
    await page.goto(`${stack.dashboardUrl}${path}`);
    await expect(page.locator('h1').first()).toBeVisible();
    await focusPageStart(page);
    covered.push(...(await coveredWhileTabbing(page, PRESSES, path)));
  }
  expect(covered).toEqual([]);
});

/**
 * The settings page saved unchanged, its toast kept on screen by the pointer, then tabbed through
 * from its start: answers each covered stop.
 */
async function tabWithToast(page: Page): Promise<string[]> {
  const stack = readStackInfo();
  await signInAs(page, stack, 'admin');
  await page.goto(`${stack.dashboardUrl}/settings`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Save settings' }).click();
  const toast = page.getByRole('region', { name: 'Notifications' }).getByRole('status');
  await expect(toast).toHaveText(/Nothing changed\./u);
  await focusPageStart(page);

  // A toast waits while it is pointed at, so the pointer follows it (the stack may move to keep
  // clear of the focus) and it stays for the whole pass, as an error toast does until dismissed.
  const covered: string[] = [];
  for (let press = 0; press < 60; press += 1) {
    await toast.hover();
    covered.push(
      ...(await coveredWhileTabbing(page, 1, `/settings with a toast, stop ${String(press + 1)}`)),
    );
  }
  await expect(toast).toBeVisible();
  return covered;
}

test('2.4.11: with a toast on screen, no focused control is covered (C171.3)', async ({ page }) => {
  test.setTimeout(90_000);
  expect(await tabWithToast(page)).toEqual([]);
});

/**
 * KP10-1: how late each animation frame comes on the slow runner below, in ms. A frame on a loaded
 * CI runner arrives after the next CDP command; 120 ms makes that order certain here.
 */
const LATE_FRAME_MS = 120;

test('2.4.11: with a toast on screen on a slow runner (every frame late), no focused control is covered (C171.3, KP10-1)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  // CI 42476248527 failed the test above at stop 55 while it passes here: the stack moves clear of
  // the focus one animation frame after `focusin` (toasts.tsx), and a slow runner judged it first.
  // Every frame of this page comes LATE_FRAME_MS late, in order, with cancellation kept.
  await page.addInitScript((lateMs: number) => {
    const nativeRequest = window.requestAnimationFrame.bind(window);
    const nativeCancel = window.cancelAnimationFrame.bind(window);
    const pending = new Map<number, { timer?: number; frame?: number }>();
    let next = 0;
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      next += 1;
      const id = next;
      const entry: { timer?: number; frame?: number } = {};
      entry.timer = window.setTimeout(() => {
        entry.frame = nativeRequest((time) => {
          pending.delete(id);
          callback(time);
        });
      }, lateMs);
      pending.set(id, entry);
      return id;
    };
    window.cancelAnimationFrame = (id: number): void => {
      const entry = pending.get(id);
      if (entry === undefined) return;
      pending.delete(id);
      window.clearTimeout(entry.timer);
      if (entry.frame !== undefined) nativeCancel(entry.frame);
    };
  }, LATE_FRAME_MS);
  expect(await tabWithToast(page)).toEqual([]);
});

/** A page whose fixed overlay covers its only field, and moves clear of it or stays. */
const OVERLAY_PAGE = `<!doctype html><html lang="en"><head><title>Overlay</title></head><body>
<label for="field">Field</label><input id="field">
<div id="cover" style="position:fixed;inset:0 auto auto 0;width:400px;height:120px;background:#fff"></div>
</body></html>`;

test('the 2.4.11 check judges the settled page: an overlay that moves clear a frame later is no cover, one that stays is (C171.3, KP10-1)', async ({
  page,
}) => {
  test.setTimeout(30_000);
  for (const moves of [true, false]) {
    await page.setContent(OVERLAY_PAGE);
    await page.evaluate((clears) => {
      // As ToastProvider does: after `focusin`, the next frame decides, and the move lands later.
      document.addEventListener('focusin', () => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            const cover = document.getElementById('cover');
            if (clears && cover !== null) cover.style.top = '400px';
          }, 200);
        });
      });
    }, moves);
    await focusPageStart(page);
    const covered = await coveredWhileTabbing(page, 1, moves ? 'moves clear' : 'stays');
    expect(covered).toEqual(moves ? [] : ['stays, Tab 1: input#field under div#cover']);
  }
});

test('3.3.8: the sign-in’s password field takes a pasted password (C171.3)', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: stack.dashboardUrl,
  });
  await page.goto(`${stack.dashboardUrl}/login`);
  const email = page.getByLabel('Email');
  const password = page.getByLabel('Password');
  await expect(email).toHaveAttribute('autocomplete', 'username');
  await expect(password).toHaveAttribute('autocomplete', 'current-password');

  // Nothing on the page cancels a paste into the field.
  const prevented = await password.evaluate((input) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'synthetic-pasted-password');
    const paste = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(paste);
    return paste.defaultPrevented;
  });
  expect(prevented).toBe(false);

  // A real paste from the clipboard, as a password manager's copy would give it.
  await page.evaluate(() => navigator.clipboard.writeText('synthetic-pasted-password-0123'));
  await password.focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(password).toHaveValue('synthetic-pasted-password-0123');
});
