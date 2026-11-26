/**
 * C142.6 (Workflow 8C): the reviewer's case page on the full stack. Budget: 90 s for the file.
 *
 * A reviewer opens a case of the spec's own, compares the held inquiry's ID front with its selfie by
 * keyboard alone (the viewer's keys act only while it has focus), comments with a mention, runs a
 * case action through its parameter form, uploads a 10 MiB file through the streaming route (past a
 * server action's 1 MB and the proxy's buffer), prints (the audit call first), resolves the case and
 * decides the held inquiry behind its confirmation. The case page then loads under the console's real
 * nonce CSP (C170.3, Workflow 9C) with no violation. Every object is created inside the spec through the API; the
 * reviewer signs in once through `signInAs`.
 *
 * Axe (C142.6, `expectNoAxeViolations` in support/ui-axe.ts) runs on the case page after it loads,
 * with the compare panel in use, and once the case is resolved and its inquiry decided (the
 * `dlitem` and `label-content-name-mismatch` violations platform-carry measured were fixed in
 * apps/dashboard in the Workflow 8D review, R001 and R002).
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { signInAs } from './support/ui.js';
import { expectNoAxeViolations } from './support/ui-axe.js';
import { recordCspViolations } from './support/ui-graph.js';
import {
  endReviewerCase,
  paddedJpeg,
  reviewerCase,
  type ReviewerCase,
} from './support/ui-reviewer.js';
import { adminClient } from './support/workflows.js';

const TEN_MIB = 10 * 1_048_576;

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
/** The value (`<dd>`) of a term (`<dt>`) inside `scope`. */
const term = (scope: Locator, name: string) => scope.locator(`dt:text-is("${name}") + dd`);

/**
 * K8-36: a compare viewer takes focus, and drops its `aria-busy`, only once its keys act (after
 * hydration and its panzoom), so a key typed before that would reach nothing; wait for that state.
 */
async function expectViewerReady(viewer: Locator): Promise<void> {
  await expect(viewer).toHaveAttribute('tabindex', '0');
  await expect(viewer).not.toHaveAttribute('aria-busy');
}

test.describe.configure({ mode: 'serial' });

let made: ReviewerCase | undefined;

/** The case `beforeAll` made; a test that runs has it. */
function theCase(): ReviewerCase {
  if (made === undefined) {
    throw new Error('beforeAll made no case');
  }
  return made;
}

test.beforeAll(async () => {
  test.setTimeout(45_000);
  const stack = readStackInfo();
  made = await reviewerCase(await adminClient(stack), stack, randomUUID().slice(0, 8));
});

test.afterAll(async () => {
  await endReviewerCase(await adminClient(readStackInfo()), made);
});

test('a reviewer compares, comments, runs a case action, uploads 10 MiB, prints, resolves and decides (C142.2 to C142.6)', async ({
  page,
}) => {
  test.setTimeout(75_000);
  const stack = readStackInfo();
  const made = theCase();
  await page.addInitScript(() => {
    // Headless Chromium has no print dialog; the call is recorded instead.
    Object.defineProperty(window, 'print', {
      value: () => {
        document.documentElement.dataset.printed = 'true';
      },
    });
  });
  await signInAs(page, stack, 'reviewer');
  await page.goto(`${stack.dashboardUrl}/cases/${made.caseId}`);
  const details = page.getByRole('group', { name: 'Case details' });
  await expect(term(details, 'Status')).toHaveText('Open');
  await expect(term(details, 'Category')).toHaveText('Initial');

  // The compare panel by keyboard alone: the page chord, then the viewer's own keys, once the
  // viewer takes focus (it does once its keys act, K8-36).
  const front = page.getByRole('group', { name: 'Government ID front viewer' });
  await expectViewerReady(front);
  await expectNoAxeViolations(page, '/cases/[id] after load');
  await page.keyboard.press('Alt+Shift+V');
  // R014 (WCAG 2.4.7): the chord's target shows where focus went.
  const compareTarget = page.locator('[data-shortcut-target="compare"]');
  await expect(compareTarget).toBeFocused();
  expect(await compareTarget.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe(
    'none',
  );
  await page.keyboard.press('Tab');
  await expect(front).toBeFocused();
  // The viewer's own state; the image may hold a second status while its rendition is prepared.
  const frontState = front.getByRole('status').filter({ hasText: /^Zoom / });
  await page.keyboard.type('+');
  await expect(frontState).toContainText(/Zoom 1[2-9]\d%/);
  await page.keyboard.type('r');
  await expect(frontState).toContainText('rotated 90°');
  await expectNoAxeViolations(page, '/cases/[id] with the compare panel in use');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('0');
  await expect(frontState).toHaveText('Zoom 100%, offset 0, 0, rotated 0°');
  // Focus on a button: the character keys no longer act.
  await front.getByRole('button', { name: 'Zoom in' }).focus();
  await page.keyboard.type('r');
  await expect(frontState).toContainText('rotated 0°');
  await expect(region(page, 'Compare')).toContainText('Beta');

  // A comment with a mention of oneself, as plain text.
  const comments = region(page, 'Comments');
  await comments.getByRole('textbox', { name: 'New comment' }).fill('Synthetic review note for ');
  await comments.getByRole('combobox', { name: 'Mention' }).selectOption({ index: 1 });
  await comments.getByRole('button', { name: 'Insert mention' }).click();
  await comments.getByRole('button', { name: 'Add comment' }).click();
  await expect(comments.getByRole('article').first()).toContainText('@you');

  // A case action through its parameter form; the run it started is linked.
  const action = region(page, 'Case actions').getByRole('group', { name: made.actionLabel });
  await action.getByRole('textbox', { name: 'reference' }).fill('synthetic-reference');
  await action.getByRole('button', { name: `Run ${made.actionLabel}` }).click();
  await expect(action.getByRole('link', { name: /^wfr_/ })).toHaveAttribute(
    'href',
    /^\/workflows\/runs\/wfr_[0-9A-Z]{26}$/,
  );

  // 10 MiB through the streaming route: a server action would stop at 1 MB.
  const attachments = region(page, 'Attachments');
  await attachments.getByLabel('File').setInputFiles({
    name: 'synthetic-ten-mib.jpg',
    mimeType: 'image/jpeg',
    buffer: await paddedJpeg(TEN_MIB),
  });
  await attachments.getByRole('button', { name: 'Upload' }).click();
  await expect(attachments.getByRole('status')).toContainText('The file was uploaded', {
    timeout: 30_000,
  });
  await expect(attachments.getByRole('row', { name: /synthetic-ten-mib\.jpg/ })).toContainText(
    '10.0 MiB',
  );

  // Print: the audit call first, then the browser's print.
  await page.getByRole('button', { name: 'Print' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-printed', 'true');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('[data-case-print-footer]')).toBeVisible();
  await expect(page.getByRole('navigation', { name: /./ }).first()).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  const admin = await adminClient(stack);
  const history = await admin.cases.history(made.caseId);
  expect(history.data.map((entry) => entry.attributes.kind)).toContain('print-initiated');

  // Resolve the case, then decide the held inquiry behind its confirmation.
  const status = region(page, 'Status');
  await status.getByRole('combobox', { name: 'New status' }).selectOption({ label: 'Approved' });
  await status.getByRole('button', { name: 'Change status' }).click();
  await expect(term(details, 'Status')).toHaveText('Approved');
  await expect(term(details, 'Category')).toHaveText('End');

  const held = region(page, 'Held objects');
  await held.getByRole('button', { name: `Approve ${made.decisionInquiryId}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve this inquiry?' });
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(dialog).toBeHidden();
  await expect(held.getByRole('row', { name: new RegExp(made.decisionInquiryId) })).toContainText(
    'approved',
  );
  await expectNoAxeViolations(page, '/cases/[id] once resolved');
});

test('the case page loads under the console real nonce script CSP with no violation (C142.6, F33, C170.3)', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  const made = theCase();
  await signInAs(page, stack, 'reviewer');
  const violations = await recordCspViolations(page);
  const url = `${stack.dashboardUrl}/cases/${made.caseId}`;
  const document = page.waitForResponse(url);
  await page.goto(url);
  expect((await document).headers()['content-security-policy']).toContain("'strict-dynamic'");
  const viewer = page.getByRole('group', { name: 'Government ID front viewer' });
  await expectViewerReady(viewer);
  await viewer.focus();
  await expect(viewer).toBeFocused();
  await page.keyboard.type('+');
  await expect(viewer.getByRole('status').filter({ hasText: /^Zoom / })).toContainText(
    /Zoom 1[2-9]\d%/,
  );
  expect(await violations()).toEqual([]);
});

test('the case page and its compare panel load under the console real nonce style CSP as well, with no violation (C142.6, R015, C170.3)', async ({
  page,
}) => {
  test.setTimeout(30_000);
  const stack = readStackInfo();
  const made = theCase();
  await signInAs(page, stack, 'reviewer');
  const violations = await recordCspViolations(page);
  const url = `${stack.dashboardUrl}/cases/${made.caseId}`;
  const document = page.waitForResponse(url);
  await page.goto(url);
  expect((await document).headers()['content-security-policy']).toContain('style-src');
  const viewer = page.getByRole('group', { name: 'Government ID front viewer' });
  await expectViewerReady(viewer);
  await viewer.focus();
  await expect(viewer).toBeFocused();
  await page.keyboard.type('+');
  await expect(viewer.getByRole('status').filter({ hasText: /^Zoom / })).toContainText(
    /Zoom 1[2-9]\d%/,
  );
  expect(await violations()).toEqual([]);
});
