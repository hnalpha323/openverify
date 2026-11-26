/**
 * C142.1 the case console, full stack (Workflow 8C, `dashboard-cases`). Budget: 90 s.
 * - A developer creates a case template in the console, meets a file field refused in words at its
 *   place, saves a draft whose map leaves an end status unreachable, meets that publish refusal in
 *   words, opens the move, and publishes.
 * - A developer creates a queue and adds the seeded reviewer as a member; the reviewer sets the
 *   status of two of the queue's cases in bulk, reads each case's outcome, and pulls the third with
 *   "Next case from this queue".
 * - An admin exports a template's cases with personal data after the confirmation, and downloads
 *   the file the console names.
 * - A developer creates a business calendar and imports holidays from a CSV: one taken, the bad
 *   row refused by number and reason, never its value.
 * Each test makes its own template, queue, cases and calendar with random names and keys, and
 * archives its templates and queue in `finally`; a calendar has no delete or archive route, so the
 * spec's calendar stays, under its own random name. No setting is changed. Every value is synthetic.
 * Axe finds no WCAG 2.0 to 2.2 A or AA violation on /cases, a template version, a queue,
 * /case-settings and /cases/exports (Workflow 8D, C142.6).
 */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { publishedCaseTemplate } from './support/cases.js';
import { expectNoAxeViolations } from './support/ui-axe.js';
import {
  holidayCsv,
  newestExportSince,
  runSuffix,
  uiCaseTemplateKey,
  userIdOf,
} from './support/ui-cases.js';
import {
  clientAs,
  expectToast,
  reloadUntil,
  rowOf,
  signedInStates,
  withConsolePage,
  type StorageState,
} from './support/ui-lists.js';

const ROLES = ['developer', 'reviewer', 'admin'] as const;
let states: Record<(typeof ROLES)[number], StorageState>;

test.beforeAll(async ({ browser }) => {
  states = await signedInStates(browser, readStackInfo(), ROLES);
});

test('a developer creates a template, meets a file field and a refused publish in words, and publishes (C130, C142.1)', async ({
  browser,
}) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  const developer = await clientAs(stack, 'developer');
  const name = `e2e-ui-case-template-${runSuffix()}`;
  let templateId: string | undefined;
  try {
    await withConsolePage(browser, states.developer, async (page) => {
      await page.goto(`${stack.dashboardUrl}/case-templates`);
      const create = page.getByRole('form', { name: 'Create a case template' });
      await create.getByRole('textbox', { name: /^Name/u }).fill(name);
      await create.getByRole('textbox', { name: /^Key/u }).fill(uiCaseTemplateKey());
      await create.getByRole('button', { name: 'Create template' }).click();
      await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
      templateId = /\/case-templates\/(ctmpl_[0-9A-Z]{26})$/u.exec(
        new URL(page.url()).pathname,
      )?.[1];

      await page.getByRole('link', { name: 'Open the latest draft' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Version 1' })).toBeVisible();
      await expectNoAxeViolations(page, '/case-templates/[id]/versions/[id]');
      const editor = page.getByRole('form', { name: 'Edit the draft' });
      const fields = editor.getByRole('textbox', { name: 'Fields' });
      await fields.fill(JSON.stringify([{ type: 'file', key: 'scan', label: 'Scan' }]));
      await editor.getByRole('button', { name: 'Save draft' }).click();
      await expect(editor).toContainText('A case field is never a file (attachments carry files)');

      await fields.fill(JSON.stringify([{ type: 'string', key: 'note', label: 'Note' }]));
      const moves = editor.getByRole('group', { name: 'Allowed moves' });
      for (const from of ['Open', 'Pending', 'Declined']) {
        await moves.getByRole('checkbox', { name: `From ${from} to Approved` }).uncheck();
      }
      await editor.getByRole('button', { name: 'Save draft' }).click();
      await expectToast(page, 'Saved the draft.');

      await page.getByRole('button', { name: 'Publish' }).click();
      const dialog = page.getByRole('dialog', { name: 'Publish version 1?' });
      await dialog.getByRole('button', { name: 'Publish version' }).click();
      await expect(dialog).toContainText('This version cannot be published');
      await expect(dialog).toContainText(
        'No path of moves reaches this end status from the initial status.',
      );
      await dialog.getByRole('button', { name: 'Cancel' }).click();

      await moves.getByRole('checkbox', { name: 'From Open to Approved' }).check();
      await editor.getByRole('button', { name: 'Save draft' }).click();
      await expectToast(page, 'Saved the draft.');
      await page.getByRole('button', { name: 'Publish' }).click();
      await page
        .getByRole('dialog', { name: 'Publish version 1?' })
        .getByRole('button', { name: 'Publish version' })
        .click();
      await expectToast(page, 'Version 1 was published.');
    });
  } finally {
    if (templateId !== undefined) {
      await developer.caseTemplates.archive(templateId);
    }
  }
});

test('a reviewer sets the status of a queue’s cases in bulk, reads each outcome, and pulls the next case of the queue (C132, C137, C142.1)', async ({
  browser,
}) => {
  test.setTimeout(40_000);
  const stack = readStackInfo();
  const developer = await clientAs(stack, 'developer');
  const reviewerId = await userIdOf(stack, 'reviewer');
  const suffix = runSuffix();
  const template = await publishedCaseTemplate(developer, `e2e-ui-cases-bulk-${suffix}`);
  let queueId: string | undefined;
  try {
    await withConsolePage(browser, states.developer, async (page) => {
      await page.goto(`${stack.dashboardUrl}/case-queues`);
      const create = page.getByRole('form', { name: 'Create a queue' });
      await create.getByRole('textbox', { name: /^Name/u }).fill(`e2e-ui-queue-${suffix}`);
      await create.getByRole('button', { name: 'Create queue' }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: `e2e-ui-queue-${suffix}` }),
      ).toBeVisible();
      queueId = /\/case-queues\/(cqueue_[0-9A-Z]{26})$/u.exec(new URL(page.url()).pathname)?.[1];
      await expectNoAxeViolations(page, '/case-queues/[id]');
      const members = page.getByRole('form', { name: 'Edit the members' });
      await members.getByRole('button', { name: 'Add a member' }).click();
      await members.getByRole('textbox', { name: /^Member 1/u }).fill(reviewerId);
      await members.getByRole('button', { name: 'Save members' }).click();
      await expectToast(page, 'Saved the members.');
    });
    const queue = queueId ?? '';
    const made = [];
    for (let index = 0; index < 3; index += 1) {
      const { data } = await developer.cases.create({
        'case-template-id': template.id,
        'case-queue-id': queue,
      });
      made.push(data);
    }
    const [first, second, third] = made;

    await withConsolePage(browser, states.reviewer, async (page) => {
      await page.goto(`${stack.dashboardUrl}/cases?queue=${queue}`);
      const table = page.getByRole('table', { name: 'Cases' });
      await expect(table).toContainText(first?.attributes.name ?? '-');
      await expectNoAxeViolations(page, '/cases');
      for (const each of [first, second]) {
        await rowOf(table, new RegExp(each?.attributes.name ?? '-', 'u'))
          .getByRole('checkbox', { name: `Select ${each?.attributes.name ?? ''}` })
          .check();
      }
      const bulk = page.getByRole('form', { name: 'Act on the selected cases' });
      await bulk.getByRole('combobox', { name: 'Action' }).selectOption('set-status');
      await bulk.getByRole('textbox', { name: /^Status key/u }).fill('approved');
      await bulk.getByRole('button', { name: 'Apply…' }).click();
      await page
        .getByRole('dialog', { name: 'Set the status of 2 cases?' })
        .getByRole('button', { name: 'Apply' })
        .click();
      await expect(page).toHaveURL(/\/cases\/bulk\/cblk_[0-9A-Z]{26}$/u);
      await reloadUntil(page, async () =>
        page.getByText('2 cases: 2 applied, 0 without change, 0 refused.').isVisible(),
      );
      await expect(
        rowOf(page.getByRole('table', { name: 'Outcome of each case' }), first?.id ?? ''),
      ).toContainText('Applied');

      await page.goto(`${stack.dashboardUrl}/cases?queue=${queue}`);
      await page.getByRole('button', { name: 'Next case from this queue' }).click();
      await expect(page).toHaveURL(new RegExp(`/cases/${third?.id ?? '-'}$`, 'u'));
    });
  } finally {
    if (queueId !== undefined) {
      await developer.caseQueues.update(queueId, { status: 'archived' });
    }
    await developer.caseTemplates.archive(template.id);
  }
});

test('an admin exports a template’s cases with personal data after the confirmation, and downloads the file (C138, C142.1)', async ({
  browser,
}) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  const admin = await clientAs(stack, 'admin');
  const name = `e2e-ui-cases-export-${runSuffix()}`;
  const template = await publishedCaseTemplate(admin, name);
  try {
    const { data: made } = await admin.cases.create({ 'case-template-id': template.id });
    const since = new Date(Date.now() - 1_000);
    await withConsolePage(browser, states.admin, async (page) => {
      await page.goto(`${stack.dashboardUrl}/cases/exports`);
      const form = page.getByRole('form', { name: 'Export cases' });
      await expect(form).toBeVisible();
      await expectNoAxeViolations(page, '/cases/exports');
      await form.getByRole('combobox', { name: 'Template' }).selectOption(template.id);
      await form.getByRole('checkbox', { name: /^Include personal data/u }).check();
      await form.getByRole('button', { name: 'Export' }).click();
      await page
        .getByRole('dialog', { name: 'Include personal data in the export?' })
        .getByRole('button', { name: 'Export with personal data' })
        .click();
      await expect(form.getByText('Asked for the export.', { exact: false })).toBeVisible();

      await expect.poll(async () => (await newestExportSince(admin, since))?.id).toBeDefined();
      const exportId = (await newestExportSince(admin, since))?.id ?? '';
      const table = page.getByRole('table', { name: 'Your exports' });
      await reloadUntil(
        page,
        async () =>
          (await rowOf(table, exportId).textContent())?.includes('Ready to download') === true,
      );
      await expect(rowOf(table, exportId)).toContainText('Includes personal data');
      const download = page.waitForEvent('download');
      await rowOf(table, exportId)
        .getByRole('link', { name: `Download ${exportId}` })
        .click();
      const file = await download;
      expect(file.suggestedFilename()).toBe(`case-export-${exportId}.csv`);
      const csv = await readFile(await file.path(), 'utf8');
      expect(csv).toContain(made.id);
      expect(csv).toContain(made.attributes.name);
    });
  } finally {
    await admin.caseTemplates.archive(template.id);
  }
});

test('a developer creates a calendar and imports holidays from a CSV, a bad row refused by number and reason (C133, C142.1)', async ({
  browser,
}) => {
  test.setTimeout(20_000);
  const stack = readStackInfo();
  const suffix = runSuffix();
  await withConsolePage(browser, states.developer, async (page) => {
    await page.goto(`${stack.dashboardUrl}/case-settings`);
    const create = page.getByRole('form', { name: 'Create a calendar' });
    await expect(create).toBeVisible();
    await expectNoAxeViolations(page, '/case-settings');
    await create.getByRole('textbox', { name: /^Name/u }).fill(`e2e-ui-calendar-${suffix}`);
    await create.getByRole('textbox', { name: /^Time zone/u }).fill('Europe/London');
    await create.getByRole('button', { name: 'Create calendar' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: `e2e-ui-calendar-${suffix}` }),
    ).toBeVisible();

    const importForm = page.getByRole('form', { name: 'Import holidays' });
    await importForm.getByLabel(/^CSV file/u).setInputFiles({
      name: 'holidays.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(holidayCsv(suffix)),
    });
    await importForm.getByRole('button', { name: 'Import' }).click();
    const result = importForm.getByRole('status', { name: 'Import result' });
    await expect(result).toContainText('Imported 1 holiday. 1 row was refused.');
    await expect(result).toContainText(/Row \d+: the date or the label is not valid/u);
    await expect(result).not.toContainText('Synthetic bad row');
    await expect(page.getByRole('table', { name: 'Holidays' })).toContainText('2031-01-01');
  });
});
