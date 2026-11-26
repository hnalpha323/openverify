/**
 * C86 in the console, full stack (Workflow 6B, `dashboard-reports`): the reports pages. Budget: 90 s.
 * - A reviewer creates a watchlist report in the console from the seeded sandbox template and the
 *   sandbox list's fictional listed person: the report page shows the match beside its complete
 *   coverage, what the result means, the imported list's provenance and the evidence side by
 *   side. The dismissal dialog requires its reason, shown on the field; once dismissed the report
 *   reads "No match" beside ready and the ignore list holds the reason. Run now runs it again
 *   (it stays dismissed); then the reviewer redacts it, and the history names the reviewer as who
 *   redacted it.
 * - A viewer (no `pii:view`) reads reports the spec creates through the API and links to an
 *   inquiry: the index filtered to that inquiry says "Match" for one and "Not screened" for one
 *   whose template selects a list never synced (naming it, never "no match"); the matched report's
 *   query and matches are hidden, nothing offered to act on; the inquiry page lists both.
 * - An admin sets the environment's report retention, a value out of range is refused on the
 *   field, and the original is restored in `finally`.
 * Each test makes its own data (a template it archives in `finally`, an inquiry, reports) or
 * reads what seed:dev made, and depends on no other spec.
 */
import { randomUUID } from 'node:crypto';
import { dashboardSettingsSchema } from '@openverify/contracts';
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { dashboardRequest } from './support/platform.js';
import {
  SANDBOX_LISTS,
  assertInFixture,
  seededTemplateId,
  waitForCompletedRuns,
  waitForReport,
} from './support/reports.js';
import { sessionTokenAs } from './support/ui.js';
import {
  asRole,
  region,
  reportIdOf,
  rowOf,
  serverClient,
  termValue,
} from './support/ui-reports.js';

const PERSON = SANDBOX_LISTS.listedPerson;

test('a reviewer creates a watchlist report in the console, reads its match beside its coverage, dismisses it with a required reason, runs it again and redacts it (C72.1, C75, C86)', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const stack = readStackInfo();
  const client = serverClient(stack);
  await assertInFixture('openverify-sandbox.json', PERSON.entryId);

  await asRole(browser, stack, 'reviewer', async (page) => {
    await page.goto(`${stack.dashboardUrl}/reports/new`);
    await page
      .getByRole('combobox', { name: 'Report template' })
      .selectOption({ label: 'Default watchlist (Watchlist)' });
    await page.getByRole('button', { name: 'Continue' }).click();
    const create = page.getByRole('form', { name: 'Create report' });
    await create
      .getByRole('textbox', { name: 'First name', exact: true })
      .fill(PERSON.query['name-first']);
    await create
      .getByRole('textbox', { name: 'Middle name', exact: true })
      .fill(PERSON.query['name-middle']);
    await create
      .getByRole('textbox', { name: 'Last name', exact: true })
      .fill(PERSON.query['name-last']);
    await create
      .getByRole('textbox', { name: 'Date of birth', exact: true })
      .fill(PERSON.query.birthdate);
    await create.getByRole('button', { name: 'Create report' }).click();
    await page.waitForURL(/\/reports\/rep_[0-9A-Z]{26}$/);
    const id = reportIdOf(page);

    await waitForReport(client, id);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Watchlist report ${id}`);
    const result = region(page, 'Result');
    await expect(termValue(result, 'Status')).toHaveText('Ready');
    await expect(termValue(result, 'Result')).toHaveText('Match');
    // Owner decision 6: complete coverage says what it does not promise.
    await expect(termValue(result, 'Coverage')).toHaveText(
      /^Complete\s*Complete coverage does not promise romanisations outside the variant groups and ICAO’s tables, unknown spellings, or typos beyond the budget\.$/,
    );
    await expect(result.getByRole('group', { name: 'What this result means' })).toContainText(
      'At least one entry of a screened list matched the person',
    );
    await expect(
      rowOf(page.getByRole('table', { name: 'Sources' }), 'openverify-sandbox'),
    ).toContainText('Imported from a file (not the publisher’s download)');
    await expect(termValue(region(page, 'Details'), 'Origin')).toHaveText('Console');
    const match = region(page, 'Matches').getByRole('article');
    await expect(match).toHaveCount(1);
    await expect(termValue(match, 'Subject name')).toContainText(PERSON.query['name-last']);
    await expect(termValue(match, 'Status')).toHaveText('Open');

    // The dismissal needs its reason: refused on the field, then dismissed (C75.2, C86).
    await match.getByRole('button', { name: /^Dismiss match rpm_/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Dismiss this match?' });
    const reason = dialog.getByRole('textbox', { name: 'Reason' });
    await expect(reason).toBeFocused();
    await dialog.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(reason).toHaveAttribute('aria-invalid', 'true');
    await reason.fill(`Synthetic e2e ${randomUUID()}: not the listed party`);
    await dialog.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Dismissed.' })).toBeVisible();
    await expect(termValue(result, 'Result')).toHaveText('No match');
    await expect(
      region(page, 'Ignore list').getByRole('table', { name: 'Dismissed matches' }),
    ).toContainText('not the listed party');

    // Run now: the same evidence stays dismissed (C75.8).
    await region(page, 'Monitoring').getByRole('button', { name: 'Run now' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'A run was requested.' }),
    ).toBeVisible();
    await waitForCompletedRuns(client, id, 2);
    await page.reload();
    await expect(
      region(page, 'History').getByRole('listitem', { name: 'Run now run: Ready' }),
    ).toBeVisible();
    await expect(termValue(region(page, 'Result'), 'Result')).toHaveText('No match');

    // Redaction, once the phrase is typed (C73.5).
    await page.getByRole('button', { name: 'Redact report' }).click();
    const redact = page.getByRole('dialog', { name: 'Redact this report?' });
    await redact.getByRole('textbox', { name: 'Type redact to confirm' }).fill('redact');
    await redact.getByRole('button', { name: 'Redact permanently' }).click();
    await expect(page.getByRole('status', { name: 'Redacted' })).toBeVisible();
    await expect(region(page, 'Query').getByText('Redacted')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Redact report' })).toHaveCount(0);
    // Owner decision 12: the history names who redacted it, this reviewer's user.
    await page.reload();
    await expect(
      termValue(region(page, 'History').getByRole('listitem', { name: 'Redacted' }), 'By'),
    ).toHaveText(/^User usr_[0-9A-Z]{26}$/);
  });
});

test('a viewer reads reports masked, an errored one as not screened naming its list, and an inquiry’s reports in its section (C69.4, C70.3, C86)', async ({
  browser,
}) => {
  test.setTimeout(45_000);
  const stack = readStackInfo();
  const client = serverClient(stack);
  const run = randomUUID();
  const { data: unsynced } = await client.reportTemplates.create({
    name: `e2e ui reports unsynced ${run}`,
    'report-type': 'watchlist',
    // A real list selected in the sandbox and never synced by the e2e: it is not screened.
    config: { 'search-lists': ['ofac-sdn'] },
  });
  try {
    const { data: inquiry } = await client.inquiries.create({
      'inquiry-template-id': stack.defaultTemplateId,
      'reference-id': `ui-reports-${run}`,
    });
    const create = async (templateId: string) =>
      (
        await client.reports.create(
          'report/watchlist',
          { 'report-template-id': templateId, query: PERSON.query, 'inquiry-id': inquiry.id },
          { 'auto-create-account': false },
        )
      ).data.id;
    const matched = await create(await seededTemplateId(client, 'watchlist'));
    const errored = await create(unsynced.id);
    await waitForReport(client, matched);
    expect((await waitForReport(client, errored)).attributes).toMatchObject({
      status: 'errored',
      errors: [{ code: 'list_unavailable', source: 'ofac-sdn' }],
    });

    await asRole(browser, stack, 'viewer', async (page) => {
      await page.goto(`${stack.dashboardUrl}/reports?inquiry-id=${inquiry.id}`);
      const table = page.getByRole('table', { name: 'Reports' });
      await expect(rowOf(table, matched)).toContainText('Match');
      await expect(rowOf(table, errored)).toContainText('Not screened');
      await expect(rowOf(table, errored)).not.toContainText(/no match/i);

      await rowOf(table, errored).getByRole('link', { name: errored }).click();
      const result = region(page, 'Result');
      await expect(termValue(result, 'Result')).toHaveText('Not screened');
      await expect(
        result.getByRole('list', { name: 'Why it was not fully screened' }),
      ).toContainText('ofac-sdn has never been synced or checked');
      await expect(page.locator('main')).not.toContainText(/no match/i);

      await page.goto(`${stack.dashboardUrl}/reports/${matched}`);
      await expect(termValue(region(page, 'Result'), 'Result')).toHaveText('Match');
      await expect(region(page, 'Query').getByText('Hidden')).toHaveCount(4);
      await expect(region(page, 'Matches').getByText('Hidden')).toBeVisible();
      await expect(page.getByRole('button', { name: /^(Dismiss|Review)/ })).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText(PERSON.query['name-last']);

      await page.goto(`${stack.dashboardUrl}/inquiries/${inquiry.id}`);
      const section = region(page, 'Reports').getByRole('table', {
        name: 'Reports of this inquiry',
      });
      await expect(rowOf(section, matched)).toContainText('Match');
      await expect(rowOf(section, errored)).toContainText('Not screened');
    });
  } finally {
    await client.reportTemplates.update(unsynced.id, { status: 'archived' });
  }
});

test('an admin sets the report retention, a value out of range is refused on its field, and the original is restored (C73.6, C86)', async ({
  browser,
}) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  const token = await sessionTokenAs(stack, 'admin');
  const read = async () =>
    dashboardSettingsSchema.parse(
      (await dashboardRequest(stack, 'GET', '/settings', { token })).body,
    );
  const original = (await read())['report-retention-days'];
  if (original === undefined) {
    throw new Error('The API does not serve report-retention-days');
  }
  const changed = original === 400 ? 401 : 400;
  try {
    await asRole(browser, stack, 'admin', async (page) => {
      await page.goto(`${stack.dashboardUrl}/settings`);
      const field = page.getByRole('spinbutton', { name: 'Reports (days)' });
      await expect(field).toHaveValue(original === null ? '' : String(original));

      await field.fill('3651');
      await page.getByRole('button', { name: 'Save settings' }).click();
      await expect(field).toHaveAccessibleDescription(
        /Enter a whole number of days from 1 to 3650/,
      );
      expect((await read())['report-retention-days']).toBe(original);

      await field.fill(String(changed));
      await page.getByRole('button', { name: 'Save settings' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();
      expect((await read())['report-retention-days']).toBe(changed);
    });
  } finally {
    await dashboardRequest(stack, 'PATCH', '/settings', {
      token,
      body: { 'report-retention-days': original },
    });
  }
  expect((await read())['report-retention-days']).toBe(original);
});
