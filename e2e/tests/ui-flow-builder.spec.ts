/**
 * Workflow 9C (`dashboard-flow-builder`): the flow builder on the full stack (C155.10; C178.4's
 * console specs). Budget: 90 s per test.
 *
 * 1. A developer opens a flow-spec 2 draft and, by keyboard only through the outline, gives the
 *    government ID step an exhausted fallback (a screen) and connects the screen on to completion;
 *    the outline and the canvas show the same steps; undo and redo; the draft saves itself with
 *    If-Match.
 * 2. Someone else saves the draft, so the console's next save meets the 412: "reload the latest
 *    draft" lists what changed, and reloading replaces the editor's flow.
 * 3. The admin publishes the draft through the dialog, giving each acknowledgement the API asks for
 *    (the branch that fails a minor needs `adverse-path`), and compares the new version with the
 *    first on the template page as a list.
 * 4. (Workflow 9D, fix-builder; C155.5, C155.10) On a new draft, by keyboard only through the
 *    outline and the screen editor: a screen with two fields and a visibility rule, then a branch
 *    on a flow-provisional signal with its onNull and its waitFor.
 *
 * Every page is checked by axe at each state and records zero `securitypolicyviolation` events under
 * the console's real header. Every object is made inside the spec and archived in `afterAll`; the
 * operators sign in through `signInAs`. No OTP is sent.
 */
import { expect, test, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { expectAccessible } from './support/accessible.js';
import {
  archiveBuilderDraft,
  builderDraft,
  changeDraftElsewhere,
  type BuilderDraft,
} from './support/ui-flow-builder.js';
import { recordCspViolations } from './support/ui-graph.js';
import { signInAs } from './support/ui.js';

let made: BuilderDraft | undefined;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(60_000);
  made = await builderDraft(readStackInfo());
});

test.afterAll(async () => {
  await archiveBuilderDraft(readStackInfo(), made);
});

function draft(): BuilderDraft {
  if (made === undefined) {
    throw new Error('beforeAll made no draft');
  }
  return made;
}

const outline = (page: Page) => page.getByRole('tree', { name: 'Outline of the flow' });
const item = (page: Page, name: string | RegExp) =>
  outline(page).getByRole('treeitem', { name, exact: typeof name === 'string' });

/** Moves the outline's focus down to the item `name`, by keyboard only. */
async function arrowTo(page: Page, name: string | RegExp) {
  for (let step = 0; step < 30; step += 1) {
    if (await item(page, name).evaluate((element) => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`The outline never reached ${String(name)}`);
}

/** Opens the focused item's menu and picks `entry`, by keyboard only. */
async function menuPick(page: Page, entry: string) {
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  for (let step = 0; step < 12; step += 1) {
    if (
      await menu
        .getByRole('menuitem', { name: entry, exact: true })
        .evaluate((element) => element === document.activeElement)
    ) {
      break;
    }
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('Enter');
}

const status = (page: Page) => page.getByRole('status', { name: 'Draft status' });

test('keyboard-only authoring through the outline: an exhausted fallback connected on, undo and redo, autosave (C155.2, C155.6, C155.10)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const violations = await recordCspViolations(page);
  await signInAs(page, stack, 'developer');
  await page.goto(`${stack.dashboardUrl}/templates/${draft().templateId}/flow`);

  await expect(page.getByRole('heading', { level: 1, name: 'Flow' })).toBeVisible();
  await expect(outline(page)).toMatchAriaSnapshot(`
    - tree "Outline of the flow":
      - treeitem /^Consent/
      - treeitem /^Screen. Introduction/
      - treeitem /^Government ID/
      - treeitem /^Branch. Age/
      - treeitem "Route Under 18"
      - treeitem /^Failure/
      - treeitem "Otherwise (else)"
      - treeitem /^Completion/
  `);
  await expectAccessible(page, { where: 'flow builder' });

  await item(page, /^Consent/).focus();
  await arrowTo(page, /^Government ID/);
  await menuPick(page, 'Add a fallback when attempts run out');
  const palette = page.getByRole('dialog', { name: /^Add a step after When attempts run out/ });
  await expect(palette).toBeVisible();
  await expectAccessible(page, { where: 'flow builder palette' });
  await palette.getByRole('button', { name: /^Screen/ }).press('Enter');

  await expect(item(page, 'When attempts run out')).toBeVisible();
  const fallback = item(page, /^Screen s_[a-z2-7]{8}, \d+ errors?$/);
  await expect(fallback).toBeVisible();
  await fallback.focus();
  await menuPick(page, 'Connect Next to');
  const connect = page.getByRole('dialog', { name: /^Connect Next of Screen s_/ });
  await connect.getByRole('radio', { name: /^Completion/ }).press('Space');
  await connect.getByRole('button', { name: 'Connect' }).press('Enter');
  await expect(item(page, /^Screen s_[a-z2-7]{8}$/)).toBeVisible();
  await expect(status(page)).toContainText('Saved', { timeout: 15_000 });

  // The canvas draws the same steps the outline lists.
  const canvas = page.getByRole('region', { name: 'Canvas' });
  await expect(canvas.locator('.react-flow__node')).toHaveCount(7);

  await page.getByRole('button', { name: 'Undo' }).press('Enter');
  await expect(item(page, /^Screen s_[a-z2-7]{8}, \d+ errors?$/)).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).press('Enter');
  await expect(item(page, /^Screen s_[a-z2-7]{8}$/)).toBeVisible();
  await expect(status(page)).toContainText('Saved', { timeout: 15_000 });
  await expectAccessible(page, { where: 'flow builder edited' });

  expect(await violations()).toEqual([]);
});

test('a draft saved elsewhere meets the 412: reload the latest draft, with what changed (C154.3, C155.6)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const violations = await recordCspViolations(page);
  await signInAs(page, stack, 'developer');
  await page.goto(`${stack.dashboardUrl}/templates/${draft().templateId}/flow`);
  await expect(outline(page)).toBeVisible();

  await changeDraftElsewhere(stack, draft());
  await page.getByRole('button', { name: 'Save draft' }).press('Enter');

  const dialog = page.getByRole('dialog', { name: 'The draft changed since you opened it' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expectAccessible(page, { where: 'flow builder 412' });
  await dialog.getByRole('button', { name: 'Reload the latest draft' }).press('Enter');
  await expect(status(page)).toContainText('Loaded the latest draft');
  await page.getByRole('button', { name: 'Save draft' }).press('Enter');
  await expect(status(page)).toContainText('Saved', { timeout: 15_000 });

  expect(await violations()).toEqual([]);
});

test('publish with every acknowledgement the API asks for, then the diff of two versions as a list (C154.9, C155.6, C155.7)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const violations = await recordCspViolations(page);
  await signInAs(page, stack, 'admin');
  await page.goto(`${stack.dashboardUrl}/templates/${draft().templateId}/flow`);
  await expect(outline(page)).toBeVisible();

  await page.getByRole('button', { name: 'Publish…' }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Publish this draft' });
  const adverse = dialog.getByRole('checkbox', { name: /adverse-path:s_minor000/ });
  await expect(adverse).toBeVisible({ timeout: 30_000 });
  await expectAccessible(page, { where: 'flow builder publish' });
  const publish = dialog.getByRole('button', { name: 'Publish version' });
  await expect(publish).toBeDisabled();
  for (const checkbox of await dialog.getByRole('checkbox').all()) {
    await checkbox.press('Space');
  }
  await dialog.getByRole('textbox', { name: 'Publish note' }).fill('Synthetic publish note');
  await publish.press('Enter');
  await expect(status(page)).toContainText('Published', { timeout: 30_000 });

  await page.goto(
    `${stack.dashboardUrl}/templates/${draft().templateId}?compare=${draft().draftId}&against=${draft().publishedId}`,
  );
  const compare = page.getByRole('region', { name: 'Compare versions' });
  await expect(compare.getByRole('list', { name: 'Changes' })).toContainText('Step added');
  await expectAccessible(page, { where: 'template versions' });

  expect(await violations()).toEqual([]);
});

const SIGNAL = 'signals.inquiry/automation_artefact_count';

test('keyboard-only: a screen with two fields and a visibility rule, and a branch on a flow-provisional signal with onNull and waitFor (C155.5, C155.10)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const violations = await recordCspViolations(page);
  await signInAs(page, stack, 'developer');
  // The previous test published the draft: a new one starts from the published version.
  await page.goto(`${stack.dashboardUrl}/templates/${draft().templateId}`);
  await page.getByRole('button', { name: 'New draft' }).press('Enter');
  await expect(page).toHaveURL(/\/versions\/itmplv_/, { timeout: 30_000 });
  await page.goto(`${stack.dashboardUrl}/templates/${draft().templateId}/flow`);
  await expect(outline(page)).toBeVisible();

  // A screen after consent, with a checkbox and a text field shown only when it is ticked.
  await item(page, /^Consent/).focus();
  await menuPick(page, 'Add a step after');
  const palette = page.getByRole('dialog', { name: /^Add a step after Consent/ });
  await palette.getByRole('button', { name: /^Screen/ }).press('Enter');
  const editor = page.getByRole('region', { name: 'Components of the screen' });
  await expect(editor).toBeVisible();
  const kind = editor.getByRole('combobox', { name: 'Kind' });
  await kind.selectOption('checkbox');
  await editor.getByRole('button', { name: 'Add', exact: true }).press('Enter');
  await kind.selectOption('text_input');
  await editor.getByRole('button', { name: 'Add', exact: true }).press('Enter');
  const rows = editor.getByRole('list', { name: 'Components of the screen' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await editor
    .getByRole('group', { name: 'Actions for text_input_1' })
    .getByRole('button', { name: 'Edit' })
    .press('Enter');
  await editor.getByRole('tab', { name: 'Data' }).press('ArrowRight');
  await expect(editor.getByRole('tab', { name: 'Logic' })).toHaveAttribute('aria-selected', 'true');
  const rule = editor.getByRole('region', { name: 'Show text_input_1 when' });
  await rule.getByRole('button', { name: 'Add a comparison' }).press('Enter');
  await expect(rule.getByRole('combobox', { name: 'Path of comparison 1 of group 1' })).toHaveValue(
    /^screen\./,
  );
  await expect(status(page)).toContainText('Saved', { timeout: 15_000 });
  await expectAccessible(page, { where: 'flow builder screen editor' });

  // A branch after that screen, on a flow-provisional signal, with its onNull and its wait.
  // The screen just added is the selected step; its id names it in the outline.
  const selected = await page.getByRole('region', { name: 'Selected step' }).textContent();
  const screenId = /Step: (s_[a-z2-7]{8})/.exec(selected ?? '')?.[1] ?? 'none';
  const added = item(page, new RegExp(`^Screen ${screenId}`));
  await added.focus();
  await menuPick(page, 'Add a step after');
  await page
    .getByRole('dialog', { name: new RegExp(`^Add a step after Screen ${screenId}`) })
    .getByRole('button', { name: /^Branch/ })
    .press('Enter');
  const route = page.getByRole('region', { name: 'Condition of the route Route 1' });
  await expect(route).toBeVisible();
  await route.getByRole('button', { name: 'Add a comparison' }).press('Enter');
  await route
    .getByRole('combobox', { name: 'Path of comparison 1 of group 1' })
    .selectOption(SIGNAL);
  await route
    .getByRole('combobox', { name: 'When a value it reads is unknown (null)' })
    .selectOption('review');
  const wait = page.getByRole('group', { name: 'Wait for facts (waitFor)' });
  await wait.getByRole('checkbox', { name: SIGNAL }).press('Space');
  await expect(wait.getByRole('spinbutton', { name: 'Longest wait, in seconds' })).toHaveValue('5');
  await expect(
    wait.getByRole('list', { name: 'After the wait, an unknown value follows' }),
  ).toContainText('Route Route 1: Take else, and send the inquiry to review at completion');
  await expect(status(page)).toContainText('Saved', { timeout: 15_000 });
  await expectAccessible(page, { where: 'flow builder branch on a signal' });

  expect(await violations()).toEqual([]);
});
