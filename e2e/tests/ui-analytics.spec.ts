/**
 * C178.4 (Workflow 9C, dashboard-analytics): the console's Analytics section, saved views, exports
 * and bulk reports on the full stack, under the real header CSP (no `securitypolicyviolation` on any
 * page) and axe on every page. Budget: 90 s per test.
 *
 * - The overview, funnel and checks views over a synthetic population made in the spec (3 and 12
 *   inquiries today, read live): the small template's `created` reads "fewer than 11" in the table
 *   and in the chart's caption, the large one's 12; the views carry no person's reference id, for a
 *   viewer without pii:view either.
 * - A saved view refusing a reference-id filter in words, on the inquiries list.
 * - An inquiry export without personal data, downloaded by its creator: our inquiries are in it,
 *   their reference ids are not.
 * - A bulk report CSV whose second row fails with its code.
 * - The overview downloaded as CSV (K9-18): the live day's small count is its mark there too.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { expectAccessible } from './support/accessible.js';
import { recordingClient } from './support/platform.js';
import { todayUtc } from './support/platform-9b.js';
import { seededTemplateId } from './support/reports.js';
import { reloadUntil, seedAnalyticsPopulation } from './support/ui-analytics.js';
import { recordPolicyViolations } from './support/ui-settings.js';
import { signInAs } from './support/ui.js';

const stack = readStackInfo();

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${stack.dashboardUrl}${path}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

test('the overview, funnel and checks views show suppressed cells in the table and the chart (C164.9)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const violations = await recordPolicyViolations(page);
  const population = await seedAnalyticsPopulation(stack);
  const day = todayUtc();
  const window = `from=${day}&to=${day}`;
  await signInAs(page, stack, 'admin');

  await open(page, `/analytics?${window}&template=${population.smallTemplateId}`);
  const byDay = page.getByRole('table', { name: 'Inquiries by day' });
  const live = byDay.getByRole('row', { name: new RegExp(`^${day} \\(live\\)`) });
  await expect(live.getByRole('cell').first()).toHaveText('fewer than 11');
  const figure = page.getByRole('figure').first();
  await expect(
    figure.getByRole('img', { name: 'Inquiries created and started by day' }),
  ).toBeVisible();
  await expect(figure.locator('figcaption')).toContainText('fewer than 11 inquiries created');
  // The hidden cell is a hatched mark in the chart, never a value, and the figure says so.
  await expect(figure.locator('svg[role="img"] rect[fill$="-hatch)"]').first()).toBeAttached();
  await expect(figure).toContainText('Hatched: hidden or fewer than 11');
  await expect(page.getByRole('region', { name: 'About these figures' })).toContainText(
    'Time zone: UTC',
  );
  // K9-18: the view as CSV, made in the browser from the suppressed tables, under the real policy.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download this view as CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe(`analytics-overview-${day}-to-${day}.csv`);
  const csv = readFileSync(await download.path(), 'utf8');
  expect(csv).toContain('"Time zone: UTC. Days are local days in it."\r\n');
  expect(csv).toContain(`"${day} (live)","fewer than 11",`);
  await expectAccessible(page, { where: 'analytics overview, small population' });

  await open(page, `/analytics?${window}&template=${population.largeTemplateId}`);
  const totals = page.getByRole('table', { name: 'Inquiries over the window' });
  await expect(
    totals
      .getByRole('row', { name: /^Created / })
      .getByRole('cell')
      .first(),
  ).toHaveText('12');

  await open(page, `/analytics/funnel?${window}&template=${population.smallTemplateId}`);
  await expect(page.getByRole('heading', { level: 2, name: 'Funnel' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Inquiries started by day' })).toBeVisible();
  await expectAccessible(page, { where: 'analytics funnel' });

  await open(page, `/analytics/checks?${window}&template=${population.smallTemplateId}`);
  await expect(page.getByRole('table', { name: 'Checks and their results' })).toBeVisible();
  await expectAccessible(page, { where: 'analytics checks' });

  for (const view of ['verifications', 'cases', 'signals']) {
    await open(page, `/analytics/${view}?${window}`);
    await expectAccessible(page, { where: `analytics ${view}` });
  }

  // C31.6: a viewer without pii:view reads the same counts, and no page carries a reference id.
  await page.context().clearCookies();
  await signInAs(page, stack, 'viewer');
  await open(page, `/analytics?${window}&template=${population.largeTemplateId}`);
  const html = await page.content();
  for (const reference of population.references) {
    expect(html).not.toContain(reference);
  }
  expect(await violations()).toEqual([]);
});

test('a saved view refuses a personal-data filter, and an export without it is downloaded by its creator (C165.2, C166)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const violations = await recordPolicyViolations(page);
  const population = await seedAnalyticsPopulation(stack);
  const day = todayUtc();
  await signInAs(page, stack, 'admin');

  await open(page, `/inquiries?status=created&reference-id=${population.references[0] ?? ''}`);
  const views = page.getByRole('region', { name: 'Saved views' });
  await expect(views).toContainText('A saved view never holds personal data');
  await expect(views).toContainText('Remove the filters filter[reference-id] first');
  await expect(views.getByRole('form', { name: 'Save these filters as a view' })).toHaveCount(0);
  await expectAccessible(page, { where: 'inquiries with saved views' });

  await open(page, '/exports');
  await expectAccessible(page, { where: 'exports' });
  const form = page.getByRole('form', { name: 'New export' });
  await form.getByLabel('Export', { exact: true }).selectOption('inquiries');
  await form.getByLabel('Created from (UTC)').fill(day);
  await form.getByLabel('Created to (UTC)').fill(day);
  await form.getByRole('button', { name: 'Export' }).click();
  const status = form.getByRole('status');
  await expect(status).toContainText('Asked for export exp_');
  const id = /exp_[0-9A-Z]{26}/.exec((await status.textContent()) ?? '')?.[0] ?? '';
  const link = page.getByRole('link', { name: `Download ${id}` });
  await reloadUntil(page, () => link.isVisible(), 60_000, `export ${id} written`);
  const row = page.getByRole('row', { name: new RegExp(id) });
  await expect(row).toContainText('Personal data masked');
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const csv = readFileSync(await download.path(), 'utf8');
  for (const inquiryId of population.inquiryIds) {
    expect(csv).toContain(inquiryId);
  }
  for (const reference of population.references) {
    expect(csv).not.toContain(reference);
  }
  expect(await violations()).toEqual([]);
});

test('a bulk report CSV creates each row’s report or reports it failed with its code (C166.5)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const violations = await recordPolicyViolations(page);
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const templateId = await seededTemplateId(client, 'ip-address');
  await signInAs(page, stack, 'admin');

  await open(page, '/exports/bulk-reports');
  await expectAccessible(page, { where: 'bulk reports' });
  const form = page.getByRole('form', { name: 'Upload a bulk report file' });
  await form.getByLabel('Report template').selectOption(templateId);
  await form.getByLabel('CSV file').setInputFiles({
    name: 'synthetic-bulk.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('ip-address\n192.0.2.51\nnot-an-address\n'),
  });
  await form.getByRole('button', { name: 'Upload and create the reports' }).click();
  await expect(page).toHaveURL(/\/exports\/bulk-reports\?job=rbulk_/);
  const rows = page.getByRole('table', { name: 'Rows and their outcomes' });
  await reloadUntil(
    page,
    async () => (await page.getByText(/^Status: (completed|failed)\./).count()) > 0,
    60_000,
    'the bulk job ended',
  );
  await expect(page.getByText('Status: completed.', { exact: false })).toBeVisible();
  await expect(rows.getByRole('row', { name: /^1 Created rep_/ })).toBeVisible();
  const failed = rows.getByRole('row', { name: /^2 Failed/ });
  await expect(failed).toBeVisible();
  await expect(failed.getByRole('cell').last()).not.toHaveText('');
  // K9-21: the code in words, the code kept beside them.
  await expect(failed.getByRole('cell').last()).toHaveText(/\. \([a-z][a-z0-9_]*\)$/u);
  await expectAccessible(page, { where: 'bulk report job' });
  expect(await violations()).toEqual([]);
});
