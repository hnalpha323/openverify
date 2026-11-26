/**
 * Workflow 9C (`dashboard-template-forms`): the template forms on the full stack (C153.1, C153.3,
 * C153.4; C178.4's console specs). Budget: 90 s per test.
 *
 * 1. A developer opens a flow-spec 2 draft's settings tab: a session window typed below 20 hours is
 *    warned (C171.4), saved with the draft's ETag and kept after a reload.
 * 2. The same developer edits the draft's verification config through the generated check panels:
 *    the panel of the check the draft's branch reads shows its tier, stage and that branch; making it
 *    required is saved and kept after a reload.
 * 3. A developer creates a report template through the form (POST /report-templates) and lands on
 *    its page.
 *
 * Every page is checked by axe at each state and records zero `securitypolicyviolation` events under
 * the console's real header. Every object is made inside the spec and archived in `afterAll` or
 * `finally`; the operator signs in through `signInAs`. No OTP is sent.
 */
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { expectAccessible } from './support/accessible.js';
import { recordCspViolations } from './support/ui-graph.js';
import {
  BRANCH_NAME,
  READ_CHECK,
  ROUTE_LABEL,
  archiveFormsDraft,
  archiveReportTemplatesNamed,
  formsDraft,
  formsSuffix,
  type FormsDraft,
} from './support/ui-template-forms.js';
import { signInAs } from './support/ui.js';

let draft: FormsDraft | undefined;

test.beforeAll(async () => {
  test.setTimeout(60_000);
  draft = await formsDraft(readStackInfo());
});

test.afterAll(async () => {
  await archiveFormsDraft(readStackInfo(), draft);
});

/** The draft `beforeAll` made. */
function madeDraft(): FormsDraft {
  if (draft === undefined) {
    throw new Error('beforeAll made no draft');
  }
  return draft;
}

const settingsUrl = (dashboardUrl: string, made: FormsDraft) =>
  `${dashboardUrl}/templates/${made.templateId}/settings?version=${made.versionId}`;

test('a settings window below 20 hours is warned, saved with the ETag and kept (C153.3, C171.4)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const made = madeDraft();
  const violations = await recordCspViolations(page);
  await signInAs(page, stack, 'developer');
  await page.goto(settingsUrl(stack.dashboardUrl, made));

  await expect(page.getByRole('heading', { level: 1, name: 'Template settings' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Template sections' })).toMatchAriaSnapshot(`
    - navigation "Template sections":
      - list:
        - listitem:
          - link "Overview"
        - listitem:
          - link "Flow"
        - listitem:
          - link "Settings"
        - listitem:
          - link "Translations"
        - listitem:
          - link "Theme"
        - listitem:
          - link "Preview"
  `);
  await expectAccessible(page, { where: '/templates/[id]/settings' });

  const settings = page.getByRole('form', { name: 'Settings' });
  const session = settings.getByRole('textbox', {
    name: 'session-expiration-seconds',
    exact: true,
  });
  await session.fill('3600');
  await expect(settings.getByText(/Warning: below 20 hours \(1 hours here\)/)).toBeVisible();
  await expectAccessible(page, { where: '/templates/[id]/settings (a window below 20 hours)' });
  await settings.getByRole('button', { name: 'Save Settings' }).click();
  await expect(page.getByText('Saved Settings to the draft.')).toBeVisible();

  await page.reload();
  const reloaded = page.getByRole('form', { name: 'Settings' });
  await expect(reloaded.getByRole('textbox', { name: 'session-expiration-seconds' })).toHaveValue(
    '3600',
  );
  await expect(reloaded.getByText(/Warning: below 20 hours/)).toBeVisible();
  expect(await violations()).toEqual([]);
});

test('a verification config edited through the generated check panels, the branch that reads a check shown (C153.1)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const made = madeDraft();
  const violations = await recordCspViolations(page);
  await signInAs(page, stack, 'developer');
  await page.goto(settingsUrl(stack.dashboardUrl, made));

  const checks = page.getByRole('form', { name: 'Verification checks' });
  const panel = checks.getByRole('region', { name: READ_CHECK });
  await expect(panel.getByText(/^Tier R/)).toBeVisible();
  await expect(panel.getByText(/^Stage: (GA|beta)$/)).toBeVisible();
  await expect(panel.getByText(`${BRANCH_NAME}: route "${ROUTE_LABEL}"`)).toBeVisible();
  await expect(panel).toMatchAriaSnapshot(`
    - region "${READ_CHECK}":
      - heading "${READ_CHECK}" [level=4]
  `);
  await expectAccessible(page, { where: '/templates/[id]/settings (the check panels)' });

  const run = panel.getByRole('checkbox', { name: `Run ${READ_CHECK}` });
  if (!(await run.isChecked())) {
    await run.check();
  }
  const require = panel.getByRole('checkbox', { name: `Require ${READ_CHECK} to pass` });
  const wasRequired = await require.isChecked();
  await require.setChecked(!wasRequired);
  await expect(checks.getByRole('status')).toContainText(READ_CHECK);
  await checks.getByRole('button', { name: 'Save verification checks' }).click();
  await expect(page.getByText('Saved Verification checks to the draft.')).toBeVisible();

  await page.reload();
  const saved = page
    .getByRole('form', { name: 'Verification checks' })
    .getByRole('region', { name: READ_CHECK })
    .getByRole('checkbox', { name: `Require ${READ_CHECK} to pass` });
  await expect(saved).toBeChecked({ checked: !wasRequired });
  await expectAccessible(page, { where: '/templates/[id]/settings (saved checks)' });
  expect(await violations()).toEqual([]);
});

test('a report template created through the generated form (C153.4, K14)', async ({ page }) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const name = `e2e ui report form ${formsSuffix()}`;
  const violations = await recordCspViolations(page);
  try {
    await signInAs(page, stack, 'developer');
    await page.goto(`${stack.dashboardUrl}/report-templates`);
    await page.getByRole('link', { name: 'New report template' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'New report template' }),
    ).toBeVisible();
    await expectAccessible(page, { where: '/report-templates/new' });
    const form = page.getByRole('form', { name: 'New report template' });
    await form.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await form
      .getByRole('combobox', { name: 'Report type', exact: true })
      .selectOption('email-address');
    await form.getByRole('textbox', { name: 'min-domain-age-days', exact: true }).fill('30');
    await expectAccessible(page, { where: '/report-templates/new (email address)' });
    await form.getByRole('button', { name: 'Create the template' }).click();

    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page).toHaveURL(/\/report-templates\/rptp_/);
    await expectAccessible(page, { where: '/report-templates/[id] (created through the form)' });
    expect(await violations()).toEqual([]);
  } finally {
    await archiveReportTemplatesNamed(stack, name);
  }
});
