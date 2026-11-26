/**
 * C108 lists in the console, full stack (Workflow 7C, `dashboard-lists-transactions`). Budget: 90 s.
 * - An administrator (`lists:write`, `importers:write`, `pii:view`) creates an email list in the
 *   console, adds an item and sees its value, imports a CSV whose one bad row refuses the whole
 *   file (all or nothing), reads the import's error by its code in words, never its value, here and
 *   in the downloaded CSV, and archives the item.
 * - A viewer (`lists:read`, `importers:read`, no `pii:view`) reads a list's items as Hidden, the
 *   page carries no value, and nothing to change or import is offered; creating a list is refused.
 * Each test makes its own list with a random name and archives it in `finally`; no setting is
 * changed. Every address is synthetic, at `.test`.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import {
  clientAs,
  expectToast,
  reloadUntil,
  rowOf,
  signedInStates,
  withConsolePage,
  type StorageState,
} from './support/ui-lists.js';

const ROLES = ['admin', 'viewer'] as const;
let states: Record<(typeof ROLES)[number], StorageState>;

test.beforeAll(async ({ browser }) => {
  states = await signedInStates(browser, readStackInfo(), ROLES);
});

test('an administrator creates an email list, adds an item, imports a refused CSV, reads its error in words and as CSV, and archives the item (C97, C100, C108)', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const stack = readStackInfo();
  const admin = await clientAs(stack, 'admin');
  const run = randomUUID().slice(0, 8);
  const name = `e2e-ui-lists-${run}`;
  const value = `ui-item-${run}@lists.test`;
  const refused = `not-an-address-${run}`;
  let listId: string | undefined;
  try {
    await withConsolePage(browser, states.admin, async (page) => {
      await page.goto(`${stack.dashboardUrl}/lists/new`);
      await page.getByRole('combobox', { name: 'Type' }).selectOption('email-address');
      await page.getByRole('textbox', { name: /^Name/u }).fill(name);
      await page.getByRole('button', { name: 'Create list' }).click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      listId = /\/lists\/(lst_[0-9A-Z]{26})$/u.exec(new URL(page.url()).pathname)?.[1];
      expect(listId).toBeDefined();

      const add = page.getByRole('form', { name: 'Add an item' });
      await add.getByRole('textbox', { name: /^Email address/u }).fill(value);
      await add.getByRole('button', { name: 'Add item' }).click();
      await expectToast(page, 'Added the item.');
      const items = page.getByRole('table', { name: 'Items' });
      const item = items.getByRole('row').filter({ hasText: value });
      await expect(item).toContainText('Whole address');
      await expect(item).toContainText('Active');

      // C100: one bad row refuses the whole file; its error is a code, a row and a column.
      const upload = page.getByRole('form', { name: 'Import a CSV file' });
      await upload.getByLabel(/^CSV file/u).setInputFiles({
        name: 'synthetic.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(`value,match_type\r\nok-${run}@lists.test,\r\n${refused},\r\n`),
      });
      await upload.getByRole('button', { name: 'Import file' }).click();
      await expect(page).toHaveURL(/\/lists\/importers\/mprt_/u);
      const progress = page.getByRole('region', { name: 'Progress' });
      await reloadUntil(page, async () => !(await progress.textContent())?.includes('Importing'));
      await expect(progress).toContainText('Errored');
      await expect(progress).toContainText(
        'All or nothing: one refused row refuses the whole file, so no row of it was imported.',
      );
      const errors = page.getByRole('table', { name: 'Errors' });
      await expect(errors).toContainText('invalid_value');
      await expect(errors).toContainText('The value is not valid for this kind of list.');
      expect(await page.content()).not.toContain(refused);
      const csv = await page.request.get(`${new URL(page.url()).toString()}/errors.csv`);
      expect(csv.status()).toBe(200);
      const text = await csv.text();
      expect(text.startsWith('"row","column","code"\r\n')).toBe(true);
      expect(text).toContain('"invalid_value"');
      expect(text).not.toContain(refused);

      await page.goto(`${stack.dashboardUrl}/lists/${listId ?? ''}`);
      await page
        .getByRole('table', { name: 'Items' })
        .getByRole('row')
        .filter({ hasText: value })
        .getByRole('button', { name: /^Archive item/u })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Archive this item?' });
      await dialog.getByRole('button', { name: 'Archive item' }).click();
      await expectToast(page, 'Archived the item.');
      await expect(
        page.getByRole('table', { name: 'Items' }).getByRole('row').filter({ hasText: value }),
      ).toContainText('Archived');
    });
  } finally {
    if (listId !== undefined) {
      await admin.lists.archive(listId);
    }
  }
});

test('a viewer reads the items as Hidden, the page carries no value, and nothing to change is offered (C97.6, C108)', async ({
  browser,
}) => {
  test.setTimeout(45_000);
  const stack = readStackInfo();
  const admin = await clientAs(stack, 'admin');
  const run = randomUUID().slice(0, 8);
  const value = `ui-hidden-${run}@lists.test`;
  const { data: list } = await admin.lists.create('email-addresses', {
    name: `e2e-ui-lists-viewer-${run}`,
  });
  try {
    const { data: item } = await admin.listItems.create('email-addresses', {
      'list-id': list.id,
      value,
    });
    await withConsolePage(browser, states.viewer, async (page) => {
      await page.goto(`${stack.dashboardUrl}/lists/${list.id}`);
      await expect(
        page.getByRole('heading', { level: 1, name: list.attributes.name }),
      ).toBeVisible();
      await expect(rowOf(page.getByRole('table', { name: 'Items' }), item.id)).toContainText(
        'Hidden',
      );
      expect(await page.content()).not.toContain(value);
      await expect(page.getByRole('form', { name: 'Add an item' })).toHaveCount(0);
      await expect(page.getByRole('form', { name: 'Import a CSV file' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Archive list' })).toHaveCount(0);
      await expect(
        page.getByText('Importing a file needs importers:write and lists:write.'),
      ).toBeVisible();

      await page.goto(`${stack.dashboardUrl}/lists/new`);
      await expect(page.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    });
  } finally {
    await admin.lists.archive(list.id);
  }
});
