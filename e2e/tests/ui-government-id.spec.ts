/**
 * C37 (Workflow 3B): the console shows a Phase 3 government ID, full stack.
 *
 * A template requires `id_public_figure_detection`, an A-tier check whose provider the e2e stack
 * leaves unbound (`e2e/src/env.ts`), and asks for no selfie. The synthetic Utopia card then goes
 * to review, and so does its inquiry (C30.4, C30.5). In the console:
 * - the verification page says "Needs review" and names the required check that sent it there,
 *   "Not configured" (ADR 0002 §3e); the passed checks fold into a disclosure a keyboard opens,
 *   where a heuristic check shows its Beta badge, its confidence and its provenance;
 * - a reviewer (`pii:view`) reads the extraction, with its sources; a viewer sees "Hidden";
 * - the inquiry page shows the government ID as "Needs review", and a reviewer approves the
 *   inquiry (the Phase 2 review actions).
 *
 * Every inquiry, template and upload is made here, through the server and flow APIs, so the spec
 * depends on no other spec's data.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import {
  defaultTemplateAttributes,
  flowApi,
  giveFlowConsent,
  recordingClient,
  settledFlowVerification,
  submitGovernmentId,
} from './support/platform.js';
import { signInAs } from './support/ui.js';

/** A titled section of a console page. */
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/** The row of `name` among the rows of `scope` (any table in it). */
const row = (scope: Locator, name: string) =>
  scope
    .getByRole('row')
    .filter({ has: scope.page().getByRole('rowheader', { name, exact: true }) });

/** The value cell of an extraction field. */
const extracted = (page: Page, label: string) =>
  row(region(page, 'Extraction'), label).getByRole('cell').first();

test('a government ID sent to review shows why, its Beta results and its extraction, and the inquiry is approved (C37)', async ({
  page,
  browser,
}) => {
  const stack = readStackInfo();
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);

  // The default template without the selfie, requiring the unbound A-tier check.
  const defaults = await defaultTemplateAttributes(`ui-government-id-${randomUUID()}`);
  const governmentId = defaults['verification-config']['government-id'];
  if (governmentId === undefined) {
    throw new Error('The default template has no government ID verification config');
  }
  const { data: template } = await client.inquiryTemplates.create({
    ...defaults,
    flow: {
      ...defaults.flow,
      steps: defaults.flow.steps.filter((step) => step.type !== 'selfie'),
      transitions: defaults.flow.transitions.filter(
        (transition) => transition.from !== 'selfie' && transition.to !== 'selfie',
      ),
    },
    'verification-config': {
      'government-id': {
        ...governmentId,
        checks: {
          ...governmentId.checks,
          id_public_figure_detection: { enabled: true, required: true },
        },
      },
    },
  });
  const { data: inquiry } = await client.inquiries.create({
    'inquiry-template-id': template.id,
    'reference-id': `ui-government-id-${randomUUID()}`,
  });
  const flow = flowApi(
    stack.apiUrl,
    (await client.inquiries.resume(inquiry.id)).meta['session-token'],
  );
  await giveFlowConsent(flow);
  const verificationId = await submitGovernmentId(flow, {
    front: FIXTURES.idFront,
    back: FIXTURES.idBack,
  });
  expect((await settledFlowVerification(flow, verificationId)).attributes.status).toBe(
    'needs_review',
  );
  await expect
    .poll(async () => (await client.inquiries.retrieve(inquiry.id)).data.attributes.status, {
      timeout: 60_000,
    })
    .toBe('needs_review');
  const verificationUrl = `${stack.dashboardUrl}/verifications/${verificationId}`;

  // A reviewer, who holds pii:view.
  await signInAs(page, stack, 'reviewer');
  await page.goto(verificationUrl);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    `Government ID verification ${verificationId}`,
  );
  await expect(region(page, 'Details').locator('[data-status="needs_review"]')).toHaveText(
    'Needs review',
  );

  const checks = region(page, 'Checks');
  const why = checks.getByRole('note', { name: 'Why it needs review' });
  await expect(why).toContainText('Sent to review by 1 required check without evidence');
  await expect(why).toContainText('id_public_figure_detection (Not configured)');
  const attention = checks.getByRole('table', { name: 'Government ID checks needing attention' });
  const publicFigure = row(attention, 'id_public_figure_detection');
  await expect(publicFigure).toContainText('Not applicable');
  await expect(publicFigure).toContainText('Beta');
  await expect(publicFigure).toContainText('Not configured');
  await expect(publicFigure).toContainText(
    'No provider is bound to this check in this environment.',
  );

  // The rest are folded away; the keyboard opens them.
  const others = checks.getByRole('table', { name: 'Other Government ID checks' });
  await expect(others).toBeHidden();
  const summary = checks.locator('summary').filter({ hasText: /^Other checks: \d+ passed/ });
  await summary.focus();
  await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(others).toBeVisible();

  // A heuristic (H-tier) result: beta, with a confidence and its provenance.
  const color = row(others, 'id_color_inconsistency_detection');
  await expect(color).toContainText('Passed');
  await expect(color.locator('[data-stage="beta"]')).toHaveText('Beta');
  await expect(color).toContainText(/Confidence\s*(0\.\d\d|1\.00)/);
  const provenance = color.locator('summary', { hasText: 'Show' });
  await provenance.focus();
  await page.keyboard.press('Enter');
  await expect(color.getByText('Implementation version')).toBeVisible();
  await expect(color).toContainText('max-color-inconsistency-score: 0.622');
  // A ga result carries no badge.
  await expect(row(others, 'id_expired_detection').locator('[data-stage]')).toHaveCount(0);

  // The extraction, as the API shows it to the reviewer, with its sources (C31.5).
  await expect(extracted(page, 'Last name')).toHaveText('CALDERWOOD');
  await expect(extracted(page, 'First name')).toHaveText('NORA');
  await expect(extracted(page, 'Date of birth')).toHaveText('1988-03-21');
  await expect(extracted(page, 'Document number')).toHaveText('UT4829163');
  await expect(row(region(page, 'Extraction'), 'Last name')).toContainText(
    'Machine-readable zone, Visual zone',
  );

  // A viewer, in another browser: the API masks the extraction, so every value is "Hidden".
  const viewerContext = await browser.newContext();
  try {
    const viewer = await viewerContext.newPage();
    await signInAs(viewer, stack, 'viewer');
    await viewer.goto(verificationUrl);
    await expect(viewer.getByRole('heading', { level: 1 })).toContainText(verificationId);
    for (const label of ['Last name', 'First name', 'Date of birth', 'Document number']) {
      await expect(extracted(viewer, label).getByText('Hidden', { exact: true })).toBeVisible();
    }
    await expect(region(viewer, 'Extraction')).not.toContainText('CALDERWOOD');
    await expect(viewer.getByRole('main')).not.toContainText('UT4829163');
  } finally {
    await viewerContext.close();
  }

  // The inquiry page: the government ID needs review, and the reviewer approves the inquiry.
  await page.goto(`${stack.dashboardUrl}/inquiries/${inquiry.id}`);
  const card = page.getByRole('region', { name: 'Government ID', exact: true });
  await expect(card.locator('[data-status="needs_review"]')).toHaveText('Needs review');
  await expect(card.getByRole('note', { name: 'Why it needs review' })).toContainText(
    'id_public_figure_detection',
  );
  const actions = page.getByRole('group', { name: 'Inquiry actions' });
  await expect(actions.getByRole('button')).toHaveText(['Approve', 'Decline', 'Redact']);
  await actions.getByRole('button', { name: 'Approve' }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve this inquiry?' });
  await dialog.getByRole('button', { name: 'Approve inquiry' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('main').locator('[data-status="approved"]').first()).toHaveText(
    'Approved',
  );
  expect((await client.inquiries.retrieve(inquiry.id)).data.attributes.status).toBe('approved');
});
