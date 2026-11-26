/**
 * C108 transactions in the console, full stack (Workflow 7C, `dashboard-lists-transactions`).
 * Budget: 90 s.
 * - A developer (`transaction-types:write`) creates a type in the console, opens its first draft
 *   from the type's page, by the `latest-version` relationship, meets a field error at its pointer
 *   in the editor, saves valid fields and statuses, publishes, and reads the version list.
 * - A transaction whose reference names an account: a developer (no `pii:view`) reads its fields
 *   as Hidden, keys and types kept, with no value in the page; a reviewer (`transactions:write`,
 *   `transactions:redact`, `pii:view`) finds it by reference, reads its values, changes its status,
 *   labels it, sees it on the account page, and redacts it after a confirmation.
 * - A reviewer sets a relation to an account, reads it in the list linked to the account, and
 *   removes it: the list empties, and stays empty on a fresh render (K7C-2).
 * Each test makes its own type, account and transaction with random names and references, and
 * archives its type in `finally`; no setting is changed. Every value is synthetic.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import {
  clientAs,
  expectToast,
  rowOf,
  signedInStates,
  withConsolePage,
  type StorageState,
} from './support/ui-lists.js';
import { UI_FIELD_SCHEMAS, UI_STATUSES, publishedType } from './support/ui-transactions.js';

const ROLES = ['developer', 'reviewer'] as const;
let states: Record<(typeof ROLES)[number], StorageState>;

test.beforeAll(async ({ browser }) => {
  states = await signedInStates(browser, readStackInfo(), ROLES);
});

test('a developer creates a type, opens its first draft, meets a field error at its pointer, publishes, and reads the version list (C104, C108)', async ({
  browser,
}) => {
  test.setTimeout(45_000);
  const stack = readStackInfo();
  const developer = await clientAs(stack, 'developer');
  const name = `e2e-ui-type-${randomUUID().slice(0, 8)}`;
  let typeId: string | undefined;
  try {
    await withConsolePage(browser, states.developer, async (page) => {
      await page.goto(`${stack.dashboardUrl}/transaction-types`);
      const create = page.getByRole('form', { name: 'Create a transaction type' });
      await create.getByRole('textbox', { name: /^Name/u }).fill(name);
      await create.getByRole('button', { name: 'Create type' }).click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      typeId = /\/transaction-types\/(txntp_[0-9A-Z]{26})$/u.exec(
        new URL(page.url()).pathname,
      )?.[1];
      await expect(page.getByRole('region', { name: 'Published version' })).toContainText(
        'No version is published yet',
      );

      await page.getByRole('link', { name: 'Open the latest draft' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Version 1' })).toBeVisible();
      const editor = page.getByRole('form', { name: 'Edit the draft' });
      const fields = editor.getByRole('textbox', { name: 'Fields' });
      await fields.fill(JSON.stringify([{ type: 'string', key: 'Bad Key', label: 'Note' }]));
      await editor.getByRole('button', { name: 'Save draft' }).click();
      await expect(editor.getByText('Problems in Fields')).toBeVisible();
      await expect(editor).toContainText('/0/key');

      await fields.fill(JSON.stringify(UI_FIELD_SCHEMAS));
      await editor.getByRole('textbox', { name: 'Statuses' }).fill(JSON.stringify(UI_STATUSES));
      await editor.getByRole('button', { name: 'Save draft' }).click();
      await expectToast(page, 'Saved the draft.');
      await page.getByRole('button', { name: 'Publish' }).click();
      await page
        .getByRole('dialog', { name: 'Publish version 1?' })
        .getByRole('button', { name: 'Publish version' })
        .click();
      await expectToast(page, 'Version 1 was published.');

      await page.goto(`${stack.dashboardUrl}/transaction-types/${typeId ?? ''}`);
      const versions = page.getByRole('table', { name: 'Versions' });
      await expect(rowOf(versions, 'Version 1')).toContainText('Published');
      await expect(page.getByRole('button', { name: 'New draft' })).toBeVisible();
      const published = page.getByRole('region', { name: 'Published version' });
      await expect(published.getByRole('table', { name: 'Fields' })).toContainText('note');
      await expect(published.getByRole('list', { name: 'Statuses' })).toContainText('approved');
    });
  } finally {
    if (typeId !== undefined) {
      await developer.transactionTypes.archive(typeId);
    }
  }
});

test('a transaction is masked for a developer, and a reviewer reads, moves, labels, finds it on its account and redacts it (C105, C108)', async ({
  browser,
}) => {
  test.setTimeout(45_000);
  const stack = readStackInfo();
  const developer = await clientAs(stack, 'developer');
  const reviewer = await clientAs(stack, 'reviewer');
  const run = randomUUID().slice(0, 8);
  const reference = `e2e-ui-txn-${run}`;
  const note = `synthetic-ui-note-${run}`;
  const typeId = await publishedType(developer, `e2e-ui-txn-type-${run}`);
  try {
    const { data: account } = await reviewer.accounts.create({ 'reference-id': reference });
    const { data: created } = await reviewer.transactions.create({
      'transaction-type-id': typeId,
      'reference-id': reference,
      fields: { note, amount: 12.5 },
    });

    await withConsolePage(browser, states.developer, async (page) => {
      await page.goto(`${stack.dashboardUrl}/transactions/${created.id}`);
      const fields = page.getByRole('table', { name: 'Fields' });
      await expect(rowOf(fields, 'note')).toContainText('Hidden');
      await expect(rowOf(fields, 'note')).toContainText('Text');
      await expect(rowOf(fields, 'amount')).toContainText('Hidden');
      expect(await page.content()).not.toContain(note);
    });

    await withConsolePage(browser, states.reviewer, async (page) => {
      await page.goto(`${stack.dashboardUrl}/transactions?reference=${reference}`);
      await page
        .getByRole('table', { name: 'Transactions' })
        .getByRole('link', { name: created.id })
        .click();
      await expect(
        page.getByRole('heading', { level: 1, name: `Transaction ${created.id}` }),
      ).toBeVisible();
      await expect(rowOf(page.getByRole('table', { name: 'Fields' }), 'note')).toContainText(note);

      const status = page.getByRole('form', { name: 'Change the status' });
      await status.getByRole('combobox', { name: 'Status' }).selectOption('approved');
      await status.getByRole('button', { name: 'Change status' }).click();
      await expectToast(page, 'Changed the status.');
      const label = page.getByRole('form', { name: 'Add a label' });
      await label.getByRole('textbox', { name: /^Label/u }).fill('synthetic-review');
      await label.getByRole('button', { name: 'Add label' }).click();
      await expectToast(page, 'Added the label.');
      const labels = page.getByRole('region', { name: 'Status and labels' });
      await expect(labels).toContainText('approved');
      await expect(labels).toContainText('synthetic-review');

      await page.goto(`${stack.dashboardUrl}/accounts/${account.id}`);
      await expect(
        rowOf(page.getByRole('table', { name: 'Transactions of this account' }), created.id),
      ).toContainText('approved');

      await page.goto(`${stack.dashboardUrl}/transactions/${created.id}`);
      await page.getByRole('button', { name: 'Redact', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Redact this transaction?' })
        .getByRole('button', { name: 'Redact transaction' })
        .click();
      await expectToast(page, 'Redacted the transaction.');
      // A fresh render: the first load's own payload stays in the document until a reload.
      await page.reload();
      await expect(page.getByText('The fields were redacted.')).toBeVisible();
      expect(await page.content()).not.toContain(note);
    });
  } finally {
    await developer.transactionTypes.archive(typeId);
  }
});

test('a relation that was set is shown linked to its target, and gone once removed (C105, C108, K7C-2)', async ({
  browser,
}) => {
  test.setTimeout(45_000);
  const stack = readStackInfo();
  const developer = await clientAs(stack, 'developer');
  const reviewer = await clientAs(stack, 'reviewer');
  const run = randomUUID().slice(0, 8);
  const { data: type } = await developer.transactionTypes.create({
    name: `e2e-ui-relation-type-${run}`,
  });
  try {
    const draftId = type.relationships?.['latest-version'].data.id ?? '';
    await developer.transactionTypes.versions.update(draftId, {
      'field-schemas': [...UI_FIELD_SCHEMAS],
      statuses: [...UI_STATUSES],
      'relation-schemas': [{ key: 'payer', target: 'account', cardinality: 'many' }],
    });
    await developer.transactionTypes.versions.publish(draftId);
    const { data: account } = await reviewer.accounts.create({
      'reference-id': `e2e-ui-relation-${run}`,
    });
    const { data: created } = await reviewer.transactions.create({
      'transaction-type-id': type.id,
      fields: { note: `synthetic-ui-note-${run}`, amount: 1 },
    });

    await withConsolePage(browser, states.reviewer, async (page) => {
      await page.goto(`${stack.dashboardUrl}/transactions/${created.id}`);
      const relations = page.getByRole('table', { name: 'Relations' });
      await expect(relations).toContainText('No relation is set.');
      const form = page.getByRole('form', { name: 'Relations' });
      await form.getByRole('combobox', { name: 'Relation' }).selectOption('payer');
      await form.getByRole('textbox', { name: /^Target ID/u }).fill(account.id);

      await form.getByRole('button', { name: 'Set relation' }).click();
      await expectToast(page, 'Saved the relation.');
      const row = rowOf(relations, account.id);
      await expect(row).toContainText('payer');
      await expect(row).toContainText('Account');
      await expect(row.getByRole('link', { name: account.id })).toHaveAttribute(
        'href',
        `/accounts/${account.id}`,
      );

      await form.getByRole('textbox', { name: /^Target ID/u }).fill(account.id);
      await form.getByRole('button', { name: 'Remove relation' }).click();
      await expect(relations).toContainText('No relation is set.');
      await expect(relations).not.toContainText(account.id);
      // A fresh render: what the API serves now, not what the form's action left on the page.
      await page.reload();
      await expect(relations).toContainText('No relation is set.');
    });
  } finally {
    await developer.transactionTypes.archive(type.id);
  }
});
