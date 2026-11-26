/**
 * C171.3 (Workflow 9D, `a11y-audit`): WCAG 2.5.7 for the flow builder's canvas on the full stack.
 * Budget: 90 s per test.
 *
 * A developer edits a flow-spec 2 draft with a single pointer and never drags: picks a step on the
 * canvas by a click, opens its actions from the "Actions for the selected step" button, adds an
 * exhausted fallback from the palette, connects it on to completion from the connect dialog, and
 * places every step with "Tidy up"; the draft saves itself. The page counts every pointer move made
 * with a button held (a drag), and there must be none. axe passes and no CSP violation is met.
 *
 * Every object is made in the spec (`builderDraft`) and archived in `afterAll`; the operator signs
 * in through `signInAs`. No OTP is sent.
 */
import { expect, test, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { expectAccessible } from './support/accessible.js';
import { archiveBuilderDraft, builderDraft, type BuilderDraft } from './support/ui-flow-builder.js';
import { recordPolicyViolations } from './support/ui-settings.js';
import { signInAs } from './support/ui.js';

let made: BuilderDraft | undefined;

test.beforeAll(async () => {
  test.setTimeout(60_000);
  made = await builderDraft(readStackInfo());
});

test.afterAll(async () => {
  await archiveBuilderDraft(readStackInfo(), made);
});

/** Counts pointer moves made with a button held, from the page's first script on. */
async function countDrags(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const counted = window as unknown as { openverifyDrags: number };
    counted.openverifyDrags = 0;
    window.addEventListener(
      'pointermove',
      (event) => {
        if (event.buttons !== 0) counted.openverifyDrags += 1;
      },
      true,
    );
  });
  return () =>
    page.evaluate(() => (window as unknown as { openverifyDrags: number }).openverifyDrags);
}

test('2.5.7: the flow builder edited by a single pointer, never a drag (C171.3, C155)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  if (made === undefined) throw new Error('beforeAll made no draft');
  const stack = readStackInfo();
  const violations = await recordPolicyViolations(page);
  const drags = await countDrags(page);
  await signInAs(page, stack, 'developer');
  await page.goto(`${stack.dashboardUrl}/templates/${made.templateId}/flow`);
  await expect(page.getByRole('heading', { level: 1, name: 'Flow' })).toBeVisible();

  const outline = page.getByRole('tree', { name: 'Outline of the flow' });
  const canvas = page.getByRole('region', { name: 'Canvas' });
  const actions = page.getByRole('button', { name: 'Actions for the selected step' });
  await expect(canvas.locator('.react-flow__node')).toHaveCount(6);

  // A click on the canvas selects the step: its actions are the ones the button opens.
  await expect(actions).toBeDisabled();
  await canvas.locator('.react-flow__node[aria-label^="Government ID"]').click();
  await actions.click();
  await expect(page.getByRole('menu', { name: /^Actions for Government ID/ })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Add a fallback when attempts run out' }).click();
  const palette = page.getByRole('dialog', { name: /^Add a step after When attempts run out/ });
  await palette.getByRole('button', { name: /^Screen/ }).click();
  const fallback = outline.getByRole('treeitem', { name: /^Screen s_[a-z2-7]{8}, \d+ errors?$/ });
  await expect(fallback).toBeVisible();
  await fallback.click();

  await actions.click();
  await page.getByRole('menuitem', { name: 'Connect Next to' }).click();
  const connect = page.getByRole('dialog', { name: /^Connect Next of Screen s_/ });
  await connect.getByRole('radio', { name: /^Completion/ }).click();
  await connect.getByRole('button', { name: 'Connect' }).click();
  await expect(outline.getByRole('treeitem', { name: /^Screen s_[a-z2-7]{8}$/ })).toBeVisible();

  await page.getByRole('button', { name: 'Tidy up' }).click();
  await expect(page.getByRole('status', { name: 'Draft status' })).toContainText('Saved', {
    timeout: 15_000,
  });
  await expect(canvas.locator('.react-flow__node')).toHaveCount(7);
  await expectAccessible(page, { where: 'flow builder, edited by a single pointer' });

  expect(await drags()).toBe(0);
  expect(await violations()).toEqual([]);
});
