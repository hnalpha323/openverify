/**
 * C171.3 (Workflow 9D, `a11y-audit`): the preview workbench and the simulate panel by keyboard only
 * on the full stack (WCAG 2.1.1, 2.4.11). Budget: 90 s per test.
 *
 * A developer reaches every control by Tab from the page's start and operates it with keys only: the
 * width (arrow keys in its radio group), the step and the language (typing in a closed select), each
 * step's simulated status and "Simulate" (Enter). The preview frame and the simulated path follow, no
 * focused control is ever covered (`elementFromPoint` at its centre and corners), and axe passes.
 *
 * The draft is made in the spec (`previewDraft`) and archived in `afterAll`; the operator signs in
 * through `signInAs`. No OTP is sent.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { expectAccessible } from './support/accessible.js';
import { coveredFocus, focusPageStart } from './support/ui-a11y.js';
import {
  DETAILS_TEXT,
  archivePreviewDraft,
  previewDraft,
  type PreviewDraft,
} from './support/ui-preview.js';
import { recordPolicyViolations } from './support/ui-settings.js';
import { signInAs } from './support/ui.js';

let draft: PreviewDraft | undefined;

test.beforeAll(async () => {
  test.setTimeout(60_000);
  draft = await previewDraft(readStackInfo());
});

test.afterAll(async () => {
  await archivePreviewDraft(readStackInfo(), draft);
});

/** Presses Tab until `target` has focus, failing after `max` presses; collects covered stops. */
async function tabTo(page: Page, target: Locator, covered: string[], max = 80): Promise<void> {
  for (let press = 0; press < max; press += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
    const cover = await coveredFocus(page);
    if (cover !== null) covered.push(cover);
  }
  throw new Error(`Tab never reached ${target.toString()}`);
}

test('the preview workbench and the simulate panel by keyboard only (C171.3, C156)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  if (draft === undefined) throw new Error('beforeAll made no draft');
  const stack = readStackInfo();
  const violations = await recordPolicyViolations(page);
  await signInAs(page, stack, 'developer');
  await page.goto(
    `${stack.dashboardUrl}/templates/${draft.templateId}/preview?version=${draft.versionId}`,
  );
  await expect(page.getByRole('heading', { level: 1, name: 'Preview' })).toBeVisible();
  const frameElement = page.locator('iframe[title="Flow preview"]');
  const frame = page.frameLocator('iframe[title="Flow preview"]');
  await expect(page.getByText('The preview is showing step consent.')).toBeVisible();
  await focusPageStart(page);
  const covered: string[] = [];

  // The width: one tab stop for the group, arrow keys within it.
  await tabTo(page, page.getByRole('radio', { checked: true, name: / px$/u }), covered);
  for (let press = 0; press < 3; press += 1) {
    if (await page.getByRole('radio', { name: '320 px' }).isChecked()) break;
    await page.keyboard.press('ArrowLeft');
  }
  await expect(page.getByRole('radio', { name: '320 px' })).toBeChecked();
  await expect(frameElement).toHaveClass(/w-\[320px\]/u);

  // The step and the language, typed into closed selects.
  await tabTo(page, page.getByLabel('Step'), covered);
  await page.keyboard.type('details');
  await expect(frame.getByText(DETAILS_TEXT, { exact: true })).toBeVisible();
  await tabTo(page, page.getByLabel('Language'), covered);
  await page.keyboard.type('en-XA');
  await expect(frame.getByText(/^\[.+\]$/u).first()).toBeVisible();

  // Simulate: each step's status, then the button by Enter.
  const simulate = page.getByRole('region', { name: 'Simulate a path' });
  await tabTo(page, simulate.getByLabel('id_card: Status'), covered);
  await page.keyboard.type('failed');
  await expect(simulate.getByLabel('id_card: Status')).toHaveValue('failed');
  await tabTo(page, simulate.getByLabel('poa: Status'), covered);
  await page.keyboard.type('passed');
  await expect(simulate.getByLabel('poa: Status')).toHaveValue('passed');
  await tabTo(page, simulate.getByRole('button', { name: 'Simulate', exact: true }), covered);
  await page.keyboard.press('Enter');
  const path = simulate.getByRole('region', { name: 'Simulated path' });
  await expect(path.getByText('Simulated', { exact: true })).toBeVisible();
  await expect(path.getByText('Left by exhausted')).toBeVisible();

  expect(covered).toEqual([]);
  await expectAccessible(page, { where: '/templates/[id]/preview, by keyboard' });
  expect(await violations()).toEqual([]);
});
