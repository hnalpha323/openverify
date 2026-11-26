/**
 * The README's screenshots (docs/assets/screenshots/), taken on the e2e stack's synthetic data
 * only: seed:dev's environment, the generated SPECIMEN ID, invented names and the sandbox
 * providers. Opt-in: the spec is skipped unless `OPENVERIFY_DOCS_SCREENSHOTS=1`, so CI and the
 * shards never run it.
 *
 * Every photo of a person (the fake camera's public-domain clip, the ID portrait, the selfie
 * frames in the console) is blurred before a shot, and no shot shows a key or a token.
 *
 * Regenerate (from the repository root, one step per lock hold):
 *
 *   pnpm turbo run build --filter=@openverify/e2e^...
 *   flock /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e e2e:stack:up
 *   OPENVERIFY_DOCS_SCREENSHOTS=1 OPENVERIFY_E2E_REUSE_STACK=1 flock /tmp/openverify-e2e.lock \
 *     pnpm --filter @openverify/e2e exec playwright test --project=chromium tests/docs-screenshots.spec.ts
 *   flock /tmp/openverify-e2e.lock pnpm --filter @openverify/e2e e2e:stack:down
 *
 * then optimise the PNGs (the TDD note docs/tdd/release-docs-screenshots.tdd.md has the command).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { OpenVerifyClient } from '@openverify/node';
import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test';
import { FIXTURES, REPO_ROOT } from '../src/paths.js';
import { readStackInfo, type StackInfo } from '../src/stack-info.js';
import { publishedCaseTemplate } from './support/cases.js';
import { archiveBuilderDraft, builderDraft } from './support/ui-flow-builder.js';
import { fakeCameraArgs, giveConsent, selfieAnnouncement, takeSelfie } from './support/flow.js';
import {
  accountFieldTemplate,
  completedQuery,
  createAccounts,
  publishedTemplate,
} from './support/ui-graph.js';
import { signInAs } from './support/ui.js';
import { adminClient } from './support/workflows.js';
import { createServerApi } from './support/server-api.js';

const OUT = path.join(REPO_ROOT, 'docs', 'assets', 'screenshots');
const PHONE = { width: 390, height: 844 } as const;
const DESKTOP = { width: 1440, height: 900 } as const;

/** Photos of a person, blurred in every shot (the clip and the portrait are of a real person). */
const BLUR_PHOTOS = `
  video, canvas, img[alt^="Your photo"], img[alt*="selfie" i], img[alt*="portrait" i] {
    filter: blur(18px) !important;
  }`;
/** The console's images of a submission (ID sides, selfie poses), blurred on the inquiry page. */
const BLUR_CONSOLE_PHOTOS = `main img { filter: blur(18px) !important; }`;
/** No caret, no animation mid-way, no scroll bars. */
const STILL = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  ::-webkit-scrollbar { display: none; }`;

/** Invented people for the inquiries list; none is a real person. */
const PEOPLE = [
  ['Avery', 'Lindqvist', ['start_inquiry', 'complete_inquiry', 'approve_inquiry']],
  ['Marisol', 'Okafor', ['start_inquiry', 'complete_inquiry', 'approve_inquiry']],
  ['Theo', 'Brannigan', ['start_inquiry', 'complete_inquiry', 'mark_for_review_inquiry']],
  ['Priya', 'Venkataraman', ['start_inquiry', 'complete_inquiry']],
  ['Jonah', 'Castellanos', ['start_inquiry', 'fail_inquiry']],
  ['Ingrid', 'Halvorsen', ['start_inquiry', 'complete_inquiry', 'decline_inquiry']],
  ['Kenji', 'Morales', ['start_inquiry']],
  ['Lucia', 'Ferreira', ['start_inquiry', 'complete_inquiry', 'approve_inquiry']],
  ['Samuel', 'Achebe', ['start_inquiry', 'expire_inquiry']],
] as const;

test.use({ launchOptions: { args: fakeCameraArgs(FIXTURES.headTurnMatching) } });

async function shot(page: Page, name: string, css = ''): Promise<void> {
  await page.addStyleTag({ content: `${STILL}\n${css}` });
  // Fonts and images settle before the shot.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/** Scrolls so `target` starts near the top of the viewport (list pages open on their filters). */
async function scrollToTop(target: Locator): Promise<void> {
  await target.evaluate((element) => {
    window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 24);
  });
}

/**
 * Hides a list page's filter form and saved views for its shot, so the table sits under the
 * console's header (the page itself keeps both; the README says what the shot leaves out).
 */
async function hideListControls(page: Page, filterForm: string): Promise<void> {
  for (const panel of [
    page.getByRole('search', { name: filterForm }),
    page.getByRole('region', { name: 'Saved views' }),
  ]) {
    await panel.evaluate((element) => {
      (element as HTMLElement).style.display = 'none';
    });
  }
}

async function phoneContext(browser: Browser, dark = false): Promise<BrowserContext> {
  return browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: dark ? 'dark' : 'light',
    permissions: ['camera'],
    locale: 'en-US',
    // Only so the shot's own style (blur, no animation) applies; the stack's headers are unchanged.
    bypassCSP: true,
  });
}

async function desktopPage(browser: Browser, stack: StackInfo): Promise<Page> {
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    bypassCSP: true,
  });
  const page = await context.newPage();
  await signInAs(page, stack, 'admin');
  return page;
}

/** The inquiries the list shows, each moved to its status through the sandbox's simulate actions. */
async function seedInquiries(client: OpenVerifyClient, stack: StackInfo, run: string) {
  for (const [first, last, actions] of PEOPLE) {
    const { data } = await client.inquiries.create({
      'inquiry-template-id': stack.defaultTemplateId,
      'reference-id': `customer-${run}-${last.toLowerCase()}`,
      fields: { name_first: first, name_last: last },
    });
    await client.inquiries.performSimulateActions(data.id, {
      actions: actions.map((type) => ({ type })),
    });
  }
}

/** A small graph: six accounts linked by shared synthetic emails, phones and addresses. */
async function seedGraph(client: OpenVerifyClient, run: string): Promise<string> {
  const street = (n: number) => ({
    address_street_1: `${String(n)} Synthetic Way`,
    address_city: 'Exampleton',
    address_subdivision: 'CA',
    address_postal_code: '94000',
    address_country_code: 'US',
  });
  const email = (n: number) => ({ email_address: `shared-${run}-${String(n)}@example.test` });
  // The fictional 555-01xx range (+1 202 555 0101 to 0109).
  const phone = (n: number) => ({ phone_number: `+1202555010${String(n)}` });
  const ids = await createAccounts(client, `docs-${run}`, [
    { ...email(1), ...phone(1), ...street(1) },
    { ...email(1), ...phone(2) },
    { ...phone(1), ...street(2) },
    { ...street(1), ...email(2) },
    { ...email(2), ...phone(3) },
    { ...phone(2), ...street(2) },
    { ...phone(3), ...email(3) },
  ]);
  const templateId = await publishedTemplate(
    client,
    `Shared contact details ${run}`,
    accountFieldTemplate(4, 200),
  );
  const query = await completedQuery(client, templateId, ids[0] ?? '');
  return query.id;
}

test.describe('the README screenshots', () => {
  test.skip(
    process.env.OPENVERIFY_DOCS_SCREENSHOTS !== '1',
    'opt-in: set OPENVERIFY_DOCS_SCREENSHOTS=1 to regenerate docs/assets/screenshots/',
  );

  test('the hosted flow and the console, on synthetic data', async ({ browser }) => {
    test.setTimeout(15 * 60_000);
    mkdirSync(OUT, { recursive: true });
    const stack = readStackInfo();
    const api = createServerApi(stack.apiUrl, stack.apiKey);
    const admin = await adminClient(stack);
    const run = String(Date.now()).slice(-6);

    // The hosted flow on a phone: consent, the ID step, the selfie step, the completion.
    const flowInquiry = await api.createInquiry(stack.defaultTemplateId, `customer-${run}-flow`);
    const { flowUrl } = await api.resumeInquiry(flowInquiry.id);
    const phone = await phoneContext(browser);
    const flow = await phone.newPage();
    await flow.goto(flowUrl);
    await expect(
      flow.getByRole('heading', { level: 1, name: 'Consent to use your biometric data' }),
    ).toBeVisible();
    await shot(flow, 'flow-consent');
    await giveConsent(flow);
    await expect(flow.getByRole('heading', { level: 1, name: 'Photograph your ID' })).toBeVisible();
    await shot(flow, 'flow-government-id');
    await flow.getByLabel('Choose a photo of the front of your ID').setInputFiles(FIXTURES.idFront);
    await expect(
      flow.getByRole('img', { name: 'Your photo of the front of your ID' }),
    ).toBeVisible();
    await flow.getByRole('button', { name: 'Use this photo' }).click();
    await flow.getByLabel('Choose a photo of the back of your ID').setInputFiles(FIXTURES.idBack);
    await expect(
      flow.getByRole('img', { name: 'Your photo of the back of your ID' }),
    ).toBeVisible();
    await flow.getByRole('button', { name: 'Use this photo' }).click();
    // The selfie: shot while the guidance holds the first prompt, then the protocol runs to the end.
    await flow.addStyleTag({ content: BLUR_PHOTOS });
    const selfie = takeSelfie(flow);
    await expect(selfieAnnouncement(flow)).toHaveText(/Photo 1 of \d+: /, { timeout: 120_000 });
    await shot(flow, 'flow-selfie', BLUR_PHOTOS);
    await selfie;
    await expect(
      flow.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible({ timeout: 120_000 });
    await shot(flow, 'flow-complete');
    await phone.close();

    // The same flow's consent in the dark style variant.
    const darkInquiry = await api.createInquiry(stack.defaultTemplateId, `customer-${run}-dark`);
    const darkUrl = new URL((await api.resumeInquiry(darkInquiry.id)).flowUrl);
    darkUrl.searchParams.set('style-variant', 'dark');
    const darkContext = await phoneContext(browser, true);
    const dark = await darkContext.newPage();
    await dark.goto(darkUrl.toString());
    await expect(
      dark.getByRole('heading', { level: 1, name: 'Consent to use your biometric data' }),
    ).toBeVisible();
    await shot(dark, 'flow-consent-dark');
    await darkContext.close();

    // The console's data: inquiries in each status, cases, a workflow draft, a graph.
    await seedInquiries(admin, stack, run);
    const caseTemplate = await publishedCaseTemplate(admin, 'Document review');
    for (let index = 0; index < 4; index += 1) {
      await admin.cases.create({ 'case-template-id': caseTemplate.id });
    }
    const { data: workflow } = await admin.workflows.installRecipe('review-on-report-match');
    const graphQueryId = await seedGraph(admin, run);

    const operator = await desktopPage(browser, stack);
    await operator.goto(`${stack.dashboardUrl}/inquiries`);
    await expect(operator.getByRole('link', { name: flowInquiry.id })).toBeVisible();
    await hideListControls(operator, 'Filter inquiries');
    await shot(operator, 'dashboard-inquiries');

    await operator.goto(`${stack.dashboardUrl}/inquiries/${flowInquiry.id}`);
    const verifications = operator.getByRole('region', { name: 'Verifications' });
    await expect(
      verifications.getByRole('region', { name: 'Government ID', exact: true }),
    ).toBeVisible({
      timeout: 60_000,
    });
    await scrollToTop(verifications);
    await shot(operator, 'dashboard-inquiry', BLUR_CONSOLE_PHOTOS);

    await operator.goto(`${stack.dashboardUrl}/cases`);
    const cases = operator.getByRole('table', { name: 'Cases' });
    await expect(cases).toBeVisible();
    await hideListControls(operator, 'Filter cases');
    await shot(operator, 'dashboard-cases');

    await operator.goto(`${stack.dashboardUrl}/workflows/${workflow.id}/draft`);
    await expect(operator.getByRole('region', { name: 'Canvas' })).toBeVisible();
    await shot(operator, 'dashboard-workflow-editor');

    const builder = await builderDraft(stack);
    await operator.goto(`${stack.dashboardUrl}/templates/${builder.templateId}/flow`);
    await expect(operator.getByRole('tree', { name: 'Outline of the flow' })).toBeVisible();
    await operator.waitForLoadState('networkidle');
    await scrollToTop(operator.getByText(/^Draft version \d+\.$/));
    await shot(operator, 'dashboard-flow-builder');
    await archiveBuilderDraft(stack, builder);

    await operator.goto(`${stack.dashboardUrl}/graph/${graphQueryId}`);
    await operator.getByRole('button', { name: 'Canvas view' }).click();
    await operator.waitForLoadState('networkidle');
    await operator.waitForTimeout(1_500);
    await scrollToTop(operator.getByRole('heading', { name: 'Result', exact: true }));
    await shot(operator, 'dashboard-graph');

    await operator.context().close();
  });
});
