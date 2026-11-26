/**
 * Workflow 8D (C141.8): helpers of `ui-workflow-editor.spec.ts`, the workflow editor driven through
 * its outline by keyboard. Every name is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';

/** A workflow name no other run of the spec on a reused stack has. */
export const editorWorkflowName = (): string =>
  `Synthetic editor workflow ${randomUUID().replaceAll('-', '').slice(0, 10)}`;

/** The outline, the editor's keyboard view (C141.2). */
export const outlineOf = (page: Page): Locator =>
  page.getByRole('tree', { name: 'Outline of the definition' });

/** An outline item by its exact name (type, name and error count). */
export const outlineItem = (page: Page, name: string): Locator =>
  outlineOf(page).getByRole('treeitem', { name, exact: true });

/** A node of the canvas by its step id. */
export const canvasNode = (page: Page, id: string): Locator =>
  page.locator(`.react-flow__node[data-id="${id}"]`);

/**
 * Opens the menu of the outline item `name` with Enter (after focusing it, as a Tab and the arrow
 * keys would), moves down to `entry` with the arrow keys and picks it with Enter.
 */
export async function pickFromMenu(page: Page, name: string, entry: string): Promise<void> {
  const item = outlineItem(page, name);
  await item.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: `Actions for ${name}` });
  await expect(menu).toBeVisible();
  const entries = await menu.getByRole('menuitem').allTextContents();
  const index = entries.findIndex((text) => text.startsWith(entry));
  expect(index, `${entry} in the menu of ${name}`).toBeGreaterThanOrEqual(0);
  for (let step = 0; step < index; step += 1) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(menu.getByRole('menuitem', { name: entry, exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
}

/** In the open palette, types `filter` (focus starts there) and adds the one entry it leaves. */
export async function addFromPalette(page: Page, filter: string, label: string): Promise<void> {
  const palette = page.getByRole('dialog', { name: 'Add a step' });
  await expect(palette.getByRole('searchbox', { name: 'Filter' })).toBeFocused();
  await page.keyboard.type(filter);
  await expect(palette.getByRole('radio', { name: new RegExp(`^${label}`) })).toBeChecked();
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
}

/** The definition the raw editor holds now. */
export async function definitionOf(page: Page): Promise<{
  readonly steps: readonly Record<string, unknown>[];
  readonly edges: readonly Record<string, unknown>[];
  readonly layout: Readonly<Record<string, unknown>>;
}> {
  return JSON.parse(
    await page.getByRole('textbox', { name: /Definition/ }).inputValue(),
  ) as Awaited<ReturnType<typeof definitionOf>>;
}
