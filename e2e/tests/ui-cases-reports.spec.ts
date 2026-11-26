/**
 * Workflow 9C (C172, C173, owner decision 20 after Workflow 7B): the case and report completions of the console, full stack. Budget: 90 s for the file.
 *
 * Everything is created inside the spec through the API in one `beforeAll`, in parallel: a case
 * template whose draft carries a checklist and a preset comment, a case action placed in the status
 * switcher, an inquiry with a watchlist report, and two accounts confirming one `.test` address
 * through OTP sends presented from the spec's own documentation address. Then, signed in once per
 * role through `signInAs`:
 * - an admin lays out the draft's case page by keyboard alone and publishes it; on a case of the
 *   template the switcher names what Approved needs, refuses it in words until the item is checked,
 *   shows the action placed in it (and nowhere else), and a preset comment is inserted, edited and
 *   posted;
 * - the inquiry's reports, the report's coverage words and latest run notes, the inquiry's print
 *   view with its audit entry written before the dialog, and the trust store's install flags;
 * - the documents of the case page and the inquiry, with the React Server Components payload they
 *   inline, carry none of the inquiry's personal values for a developer, who has no `pii:view`;
 * - a shared email node of a stored graph result is expanded by an explicit press;
 * - K19 (Workflow 9D): a business screening of the sandbox entity listed only on the Sectoral
 *   Sanctions Identifications List shows that list, with its programme, under "Other lists".
 * Axe runs on every page, and every page is opened under the console's real header with no CSP
 * violation.
 */
import { randomUUID } from 'node:crypto';
import type { OpenVerifyClient } from '@openverify/node';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { readStackInfo, type StackInfo } from '../src/stack-info.js';
import { expectAccessible } from './support/accessible.js';
import { emailCodeTemplate, waitForInquiryStatus } from './support/phase7b.js';
import { recordingClient } from './support/platform.js';
import {
  SANDBOX_LISTS,
  assertInFixture,
  seededTemplateId,
  waitForReport,
} from './support/reports.js';
import { sessionTokenAs, signInAs, type SeededRole } from './support/ui.js';
import {
  CHECKLIST,
  PRESET,
  completionsTemplate,
  confirmEmailFrom,
  endCompletions,
  documentPayloadOf,
  type CompletionsTemplate,
} from './support/ui-cases-reports.js';
import { recordPolicyViolations } from './support/ui-settings.js';
import { adminClient } from './support/workflows.js';

/** The spec's own documentation address for its two OTP sends. */
const OWN_ADDRESS = '203.0.113.93';
/** A name only the RSC payload check looks for (synthetic). */
const RSC_NAME = 'Quillbramble';

interface Made {
  readonly run: string;
  readonly template: CompletionsTemplate;
  readonly reportInquiryId: string;
  readonly reportId: string;
  readonly graphQueryId: string;
}

let made: Made | undefined;

function theRun(): Made {
  if (made === undefined) {
    throw new Error('beforeAll made nothing');
  }
  return made;
}

/** An inquiry with a watchlist report on the seeded template, finished. */
async function reportedInquiry(client: OpenVerifyClient, stack: StackInfo, run: string) {
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': stack.defaultTemplateId,
    'reference-id': `e2e-ui-cases-reports-${run}`,
    fields: { name_first: 'Synthetic', name_last: RSC_NAME },
  });
  const { data: report } = await client.reports.create(
    'report/watchlist',
    {
      'report-template-id': await seededTemplateId(client, 'watchlist'),
      query: SANDBOX_LISTS.listedPerson.query,
      'inquiry-id': inquiry.id,
    },
    { 'auto-create-account': false },
  );
  await waitForReport(client, report.id);
  return { inquiryId: inquiry.id, reportId: report.id };
}

/** Two accounts confirming one address, and a stored query linking them through its email node. */
async function sharedEmailQuery(client: OpenVerifyClient, stack: StackInfo, run: string) {
  const shared = `shared-${run}@cases-reports.test`;
  const templateId = await emailCodeTemplate(client, `e2e-ui-cases-reports-${run}`);
  const first = (await client.accounts.create({ 'reference-id': `e2e-cr-a-${run}` })).data.id;
  const second = (await client.accounts.create({ 'reference-id': `e2e-cr-b-${run}` })).data.id;
  const one = await confirmEmailFrom(stack, client, {
    templateId,
    referenceId: `e2e-cr-a-${run}`,
    address: shared,
    accountId: first,
    from: OWN_ADDRESS,
  });
  const two = await confirmEmailFrom(stack, client, {
    templateId,
    referenceId: `e2e-cr-b-${run}`,
    address: shared,
    accountId: second,
    from: OWN_ADDRESS,
    exceptMailIds: [one.mailId],
  });
  await waitForInquiryStatus(client, one.inquiryId, 'completed');
  await waitForInquiryStatus(client, two.inquiryId, 'completed');
  const { data: template } = await client.graphQueryTemplates.create({
    name: `e2e-ui-cases-reports-${run}`,
  });
  const { data: draft } = await client.graphQueryTemplates.versions.create({
    'graph-query-template-id': template.id,
    config: {
      parameters: [{ name: 'account_id', kind: 'account_id' }],
      start: [{ kind: 'account_id', value: '{{account_id}}' }],
      'connect-kinds': ['email_address'],
      'max-hops': 2,
    },
  });
  await client.graphQueryTemplates.versions.publish(draft.id);
  // The graph index sweep runs every 15 s: a query that finds only its start runs again.
  let queryId = '';
  await expect
    .poll(
      async () => {
        const { data } = await client.graphQueries.createSync({
          'graph-query-template-id': template.id,
          'parameter-map': { account_id: first },
        });
        queryId = data.id;
        return data.attributes.nodes.some((node) => node.type === 'email_address');
      },
      { timeout: 45_000, intervals: [2_000, 3_000] },
    )
    .toBe(true);
  return queryId;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(75_000);
  const stack = readStackInfo();
  const admin = await adminClient(stack);
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const run = randomUUID().slice(0, 8);
  const [template, reported, graphQueryId] = await Promise.all([
    completionsTemplate(admin, run),
    reportedInquiry(client, stack, run),
    sharedEmailQuery(client, stack, run),
  ]);
  made = {
    run,
    template,
    reportInquiryId: reported.inquiryId,
    reportId: reported.reportId,
    graphQueryId,
  };
});

test.afterAll(async () => {
  await endCompletions(await adminClient(readStackInfo()), made?.template);
});

/** A page signed in as `role`, recording CSP violations from its first document on. */
async function asRole(
  browser: Browser,
  stack: StackInfo,
  role: SeededRole,
  body: (page: Page, violations: () => Promise<string[]>) => Promise<void>,
) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const violations = await recordPolicyViolations(page);
    await page.addInitScript(() => {
      // Headless Chromium has no print dialog; the call is recorded instead.
      Object.defineProperty(window, 'print', {
        value: () => {
          document.documentElement.dataset.printed = 'true';
        },
      });
    });
    await signInAs(page, stack, role);
    await body(page, violations);
    expect(await violations()).toEqual([]);
  } finally {
    await context.close();
  }
}

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test('a case layout edited by keyboard, a checklist blocking a status until checked, an action in its placement and a preset comment edited and posted (C172)', async ({
  browser,
}) => {
  test.setTimeout(45_000);
  const stack = readStackInfo();
  const { template } = theRun();
  const admin = await adminClient(stack);
  await asRole(browser, stack, 'admin', async (page) => {
    await page.goto(
      `${stack.dashboardUrl}/case-templates/${template.templateId}/versions/${template.draftId}`,
    );
    const layout = region(page, 'Case page layout');
    await layout.getByRole('button', { name: 'Lay out the modules' }).focus();
    await page.keyboard.press('Enter');
    await layout.getByRole('combobox', { name: 'Columns' }).selectOption('2');
    await layout.getByRole('button', { name: 'Move Comments to column 2' }).focus();
    await page.keyboard.press('Enter');
    await expect(layout.getByRole('status', { name: 'Layout changes' })).toHaveText(
      'Comments moved to column 2, position 1.',
    );
    await layout.getByRole('button', { name: 'Move Timeline up' }).focus();
    await page.keyboard.press('Enter');
    await expectAccessible(page, { where: 'case template version, layout edited' });
    await layout.getByRole('button', { name: 'Save layout' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Saved the layout.')).toBeVisible();
  });

  await admin.caseTemplateVersions.publish(template.draftId);
  const { data: opened } = await admin.cases.create({ 'case-template-id': template.templateId });

  await asRole(browser, stack, 'admin', async (page) => {
    await page.goto(`${stack.dashboardUrl}/cases/${opened.id}`);
    const status = region(page, 'Status');
    // C172.5: the action placed in the switcher shows there, and only there.
    await expect(status.getByRole('group', { name: template.actionLabel })).toBeVisible();
    await expect(
      region(page, 'Case actions').getByRole('group', { name: template.actionLabel }),
    ).toHaveCount(0);
    // C172.1: the saved layout put the comments in the second column.
    await expect(region(page, 'Column 2').getByRole('region', { name: 'Comments' })).toBeVisible();
    await expectAccessible(page, { where: 'case page with checklist and layout' });

    await status.getByRole('combobox', { name: /New status/u }).selectOption('approved');
    await expect(
      status.getByRole('list', { name: 'Checklist items this status needs checked first' }),
    ).toHaveText(CHECKLIST.item.label);
    await status.getByRole('button', { name: 'Change status' }).click();
    await expect(
      status.getByText('Check every item that status requires before moving the case there.'),
    ).toBeVisible();

    const checklists = region(page, 'Checklists');
    await checklists.getByRole('button', { name: `Check ${CHECKLIST.item.label}` }).click();
    await expect(checklists.getByText(/Checked by/u)).toBeVisible();

    const comments = region(page, 'Comments');
    await comments.getByRole('combobox', { name: 'Preset comment' }).selectOption(PRESET.key);
    await comments.getByRole('button', { name: 'Insert preset comment' }).click();
    const box = comments.getByRole('textbox', { name: 'New comment' });
    await expect(box).toHaveValue(PRESET.text);
    await box.press('End');
    await box.pressSequentially(' Edited in the console.');
    await comments.getByRole('button', { name: 'Add comment' }).click();
    await expect(comments.getByText(`${PRESET.text} Edited in the console.`)).toBeVisible();

    await status.getByRole('combobox', { name: /New status/u }).selectOption('approved');
    await status.getByRole('button', { name: 'Change status' }).click();
    await expect(page.getByText('The status was changed.')).toBeVisible();
  });
});

test('the inquiry’s reports, the coverage words, the latest run notes, a print view with its audit and the trust-store flags (C173)', async ({
  browser,
}) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  const { reportInquiryId, reportId } = theRun();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const report = (await client.reports.retrieve(reportId)).data;
  const coverage = report.attributes.coverage;
  await asRole(browser, stack, 'admin', async (page) => {
    await page.goto(`${stack.dashboardUrl}/inquiries/${reportInquiryId}`);
    await expect(region(page, 'Reports').getByRole('rowheader', { name: reportId })).toBeVisible();
    await expectAccessible(page, { where: 'inquiry with its reports' });
    await page.getByRole('button', { name: 'Print' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-printed', 'true');
    // Beside the button on screen; the printed footer says it again, hidden until print.
    await expect(
      page
        .getByText('Printing from this button is recorded in the audit log.', { exact: false })
        .first(),
    ).toBeVisible();

    await page.goto(`${stack.dashboardUrl}/reports?inquiry-id=${reportInquiryId}`);
    const row = page.getByRole('row').filter({ has: page.getByText(reportId) });
    if (coverage?.complete === true && coverage.limits.length === 0) {
      // K20: a name screening's Complete always stands beside what it does not promise.
      await expect(row.getByText(/Complete coverage does not promise/u)).toBeVisible();
    }
    await expectAccessible(page, { where: 'reports index' });

    await page.goto(`${stack.dashboardUrl}/reports/${reportId}`);
    const notes = report.attributes['latest-run-notes'];
    const result = region(page, 'Result');
    await expect(
      notes === undefined
        ? result.getByText('No run has finished yet.')
        : notes.length === 0
          ? result.getByText('The latest run left no note.')
          : result.getByRole('list', { name: 'Notes of the latest run' }),
    ).toBeVisible();
    await expectAccessible(page, { where: 'report page' });

    await page.goto(`${stack.dashboardUrl}/trust-anchors`);
    const summary = region(page, 'Summary');
    await expect(summary.locator('dt:text-is("Store refresh") + dd')).toContainText(
      'OPENVERIFY_TRUST_ANCHOR_REFRESH',
    );
    await expect(summary.locator('dt:text-is("ICAO PKD CRLs") + dd')).toContainText(
      'OPENVERIFY_NFC_ALLOW_ICAO_CRLS',
    );
    await expectAccessible(page, { where: 'trust store' });
  });
  // C173.3: the print button wrote its audit entry before the dialog.
  const token = await sessionTokenAs(stack, 'admin');
  const audit = await fetch(
    `${stack.apiUrl}/api/v1/dashboard/audit-logs?filter[action]=inquiry.print-initiated&filter[resource-id]=${reportInquiryId}`,
    { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
  );
  expect(audit.status).toBe(200);
  expect(((await audit.json()) as { data: unknown[] }).data.length).toBeGreaterThan(0);
});

test('a listing on a list other than the SDN List reads as what it is, under "Other lists" (C173.1, K19)', async ({
  browser,
}) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  const entity = SANDBOX_LISTS.otherListsEntity;
  await assertInFixture('openverify-sandbox.json', entity.entryId);
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: created } = await client.reports.create('report/business-watchlist', {
    'report-template-id': await seededTemplateId(client, 'business-watchlist'),
    query: entity.query,
  });
  await waitForReport(client, created.id);
  await asRole(browser, stack, 'admin', async (page) => {
    await page.goto(`${stack.dashboardUrl}/reports/${created.id}`);
    const lists = region(page, 'Matched lists');
    await expect(lists.getByRole('columnheader', { name: 'Other lists' }).first()).toBeVisible();
    await expect(
      lists.getByText('Sectoral Sanctions Identifications List (programme SANDBOX-SSI-1)'),
    ).toBeVisible();
    await expectAccessible(page, { where: 'report with another list' });
  });
});

test('the case page and the inquiry carry no personal value in their payloads for a reader without pii:view (C172, C173)', async ({
  browser,
}) => {
  test.setTimeout(20_000);
  const stack = readStackInfo();
  const { reportInquiryId, template } = theRun();
  const admin = await adminClient(stack);
  const { data: held } = await admin.cases.create(
    { 'case-template-id': template.templateId },
    { 'object-ids': [reportInquiryId] },
  );
  await asRole(browser, stack, 'developer', async (page) => {
    for (const path of [`/cases/${held.id}`, `/inquiries/${reportInquiryId}`]) {
      const payload = await documentPayloadOf(page, stack, path);
      expect(payload.length).toBeGreaterThan(0);
      expect(payload).not.toContain(RSC_NAME);
    }
  });
});

test('a shared email node of a stored graph result expands by an explicit press (owner decision 20 after Workflow 7B)', async ({
  browser,
}) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  const { graphQueryId } = theRun();
  await asRole(browser, stack, 'admin', async (page) => {
    await page.goto(`${stack.dashboardUrl}/graph/${graphQueryId}`);
    const values = page.getByRole('table', { name: 'Shared values' });
    const expand = values.getByRole('button', { name: /^Expand gn_/u }).first();
    await expect(expand).toBeVisible();
    await expectAccessible(page, { where: 'graph explorer before an expansion' });
    await expand.click();
    await expect(page.getByRole('list', { name: 'Expansions' })).toContainText(/Expanded gn_/u);
    await expectAccessible(page, { where: 'graph explorer after an expansion' });
  });
});
