/**
 * Workflow 9C (`dashboard-preview`): the console's preview, simulate and test run overlay on the
 * full stack (C156.2, C156.4, C156.6, C156.7; C178.4's console specs). Budget: 90 s per test.
 *
 * 1. A developer previews a flow-spec 2 draft with a branch in the frame on the flow origin: the
 *    banner says what differs from a live flow, the width changes to 320 px, the pseudo-locales
 *    render the details screen's copy bracketed and right to left, and the ID step is a placeholder
 *    with the simulated outcome chosen.
 * 2. The same developer simulates the draft: a failed ID takes its `exhausted` fallback to the
 *    document and the inquiry to review, labelled simulated; the built-in passing ID preset takes the
 *    branch's route with its condition true.
 * 3. A developer starts a sandbox test run of a workflow whose step waits, and the overlay lists each
 *    step's state as an icon and a word over the read-only canvas.
 *
 * Every page is checked by axe at each state and records zero `securitypolicyviolation` events under
 * the console's real header (its `frame-src` is the flow origin). Every object is made inside the spec
 * and ended in `afterAll` or `finally`; the operator signs in through `signInAs`. No OTP is sent.
 */
import { expect, test } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { expectAccessible } from './support/accessible.js';
import { recordCspViolations } from './support/ui-graph.js';
import {
  DETAILS_TEXT,
  archivePreviewDraft,
  previewDraft,
  waitingWorkflow,
  type PreviewDraft,
} from './support/ui-preview.js';
import { endWorkflow } from './support/ui-workflow-ops.js';
import { signInAs } from './support/ui.js';
import { adminClient } from './support/workflows.js';

let draft: PreviewDraft | undefined;

test.beforeAll(async () => {
  test.setTimeout(60_000);
  draft = await previewDraft(readStackInfo());
});

test.afterAll(async () => {
  await archivePreviewDraft(readStackInfo(), draft);
});

/** The draft `beforeAll` made. */
function madeDraft(): PreviewDraft {
  if (draft === undefined) {
    throw new Error('beforeAll made no draft');
  }
  return draft;
}

const previewUrl = (dashboardUrl: string, made: PreviewDraft) =>
  `${dashboardUrl}/templates/${made.templateId}/preview?version=${made.versionId}`;

test('a draft with a branch previewed in the frame at 320 px, in both pseudo-locales and on its capture step (C156.2, C156.7)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const made = madeDraft();
  const violations = await recordCspViolations(page);
  await signInAs(page, stack, 'developer');
  await page.goto(previewUrl(stack.dashboardUrl, made));

  await expect(page.getByRole('heading', { level: 1, name: 'Preview' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'What differs from a live flow' })).toContainText(
    'consent digests',
  );
  const frameElement = page.locator('iframe[title="Flow preview"]');
  await expect(frameElement).toHaveAttribute('src', `${stack.flowUrl}/preview`);
  const frame = page.frameLocator('iframe[title="Flow preview"]');
  await expect(page.getByText('The preview is showing step consent.')).toBeVisible();
  await expect(frame.getByText(/no camera, no uploads, no checks/)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Template sections' })).toMatchAriaSnapshot(`
    - navigation "Template sections":
      - list:
        - listitem:
          - link "Overview"
        - listitem:
          - link /.+/
        - listitem:
          - link /.+/
        - listitem:
          - link /.+/
        - listitem:
          - link /.+/
        - listitem:
          - link "Preview"
  `);
  await expectAccessible(page, { where: '/templates/[id]/preview' });

  await page.getByRole('radio', { name: '320 px' }).check();
  await expect(frameElement).toHaveClass(/w-\[320px\]/);

  await page.getByLabel('Step').selectOption('details');
  await expect(frame.getByText(DETAILS_TEXT, { exact: true })).toBeVisible();
  await page.getByLabel('Language').selectOption('en-XA');
  // C161.7: the pseudo-locale brackets and lengthens every text, so the English one is gone.
  await expect(frame.getByText(/^\[.+\]$/).first()).toBeVisible();
  await expect(frame.getByText(DETAILS_TEXT, { exact: true })).toHaveCount(0);
  await expectAccessible(page, { where: '/templates/[id]/preview (en-XA, 320 px)' });
  await page.getByLabel('Language').selectOption('ar-XB');
  await expect(frame.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.getByLabel('Step').selectOption('id_card');
  await expect(frame.getByText(/drawn as a still placeholder/)).toBeVisible();
  await page.getByLabel('Simulated outcome of this step').selectOption('failed');
  await expect(frame.getByText('Simulated outcome: failed')).toBeVisible();
  await expectAccessible(page, { where: '/templates/[id]/preview (a capture step)' });

  expect(await violations()).toEqual([]);
});

test('a simulated path through the ID’s fallback, and the built-in passing preset through the branch (C156.4)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const made = madeDraft();
  const violations = await recordCspViolations(page);
  await signInAs(page, stack, 'developer');
  await page.goto(previewUrl(stack.dashboardUrl, made));

  const simulate = page.getByRole('region', { name: 'Simulate a path' });
  await expect(simulate).toContainText('Use synthetic values only');
  await simulate.getByLabel('id_card: Status').selectOption('failed');
  await simulate.getByLabel('poa: Status').selectOption('passed');
  await simulate.getByRole('button', { name: 'Simulate', exact: true }).click();

  const path = simulate.getByRole('region', { name: 'Simulated path' });
  await expect(path.getByText('Simulated', { exact: true })).toBeVisible();
  await expect(
    path
      .getByRole('list', { name: 'How a live inquiry can differ from this simulated path' })
      .getByRole('listitem'),
  ).toHaveCount(2);
  const steps = path.getByRole('list', { name: 'Simulated path, step by step' });
  await expect(steps.getByRole('heading')).toHaveText([
    'consent (consent)',
    'id_card (government id)',
    'poa (document)',
    'done (completion)',
  ]);
  await expect(path.getByText('Left by exhausted')).toBeVisible();
  const outcome = path.getByRole('region', { name: 'Outcome' });
  await expect(outcome).toContainText('Inquiry status: needs review');
  await expect(outcome.getByRole('listitem').filter({ hasText: /^id_card$/ })).toBeVisible();
  await expectAccessible(page, { where: '/templates/[id]/preview (a simulated fallback)' });

  await simulate.getByLabel('Preset', { exact: true }).selectOption('builtin:government-id-passed');
  await simulate.getByRole('button', { name: 'Simulate', exact: true }).click();
  await expect(steps.getByRole('heading')).toContainText([
    'age_route (branch)',
    'details (screen)',
  ]);
  await expect(path.getByText('Route: under_60')).toBeVisible();
  await expect(path.getByText('condition true')).toBeVisible();
  await expect(path.getByText('verifications.id_card.age-years', { exact: false })).toBeVisible();
  await expectAccessible(page, { where: '/templates/[id]/preview (a preset)' });

  expect(await violations()).toEqual([]);
});

test('a sandbox test run’s path over the workflow’s read-only canvas and outline (C156.6, K4)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const admin = await adminClient(stack);
  let workflowId: string | undefined;
  try {
    workflowId = await waitingWorkflow(admin);
    const violations = await recordCspViolations(page);
    await signInAs(page, stack, 'developer');
    await page.goto(`${stack.dashboardUrl}/workflows/${workflowId}/test-runs`);
    const form = page.getByRole('form', { name: 'Start a test run' });
    await form.getByRole('radio', { name: 'A synthetic payload' }).check();
    await form.getByRole('textbox', { name: 'Payload (JSON)' }).fill('{}');
    await form.getByRole('button', { name: 'Start the test run' }).click();
    await page.waitForURL(/[?&]run=wfr_[0-9A-Z]{26}/);

    const overlay = page.getByRole('region', { name: 'Test run over the draft' });
    await expect
      .poll(
        async () => {
          await page.reload();
          return overlay.getByRole('list', { name: 'Test run path, step by step' }).textContent();
        },
        { timeout: 30_000 },
      )
      .toContain('Waiting');
    const list = overlay.getByRole('list', { name: 'Test run path, step by step' });
    await expect(list.getByRole('listitem').first()).toContainText('Started');
    await expect(list.getByRole('listitem').filter({ hasText: 'Hold for an hour' })).toContainText(
      '⏸ Waiting',
    );
    await expect(overlay.locator('.react-flow')).toBeVisible();
    await expectAccessible(page, { where: '/workflows/[id]/test-runs (the overlay)' });
    expect(await violations()).toEqual([]);
  } finally {
    await endWorkflow(admin, workflowId);
  }
});
