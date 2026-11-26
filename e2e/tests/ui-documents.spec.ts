/**
 * C66 in the console, full stack (Workflow 5C, `dashboard-documents`): the evidence of a
 * proof-of-address document and of a government ID chip, and the read-only chip trust store. Each
 * test makes its own data through the flow API and the sandbox providers, and changes no setting.
 * The reviewer and the viewer sign in once for the file and keep their sessions: the API's login
 * limits (C4) count every attempt, and the whole suite shares them.
 * - A bill whose amount is covered by a white box: a reviewer reads what a pass means, the class
 *   with its uncalibrated beta confidence, the extracted fields, the fabrication cues as an
 *   advisory beta failure, the page-1 preview through the file route and the original PDF offered
 *   as a download only; a viewer without `pii:view` sees the fields and the preview hidden.
 * - A Utopia chip read with its holder's selfie: integrity apart from revocation, the sandbox-only
 *   anchor, the data-group table, Active Authentication, the device report as client-reported,
 *   the chip portrait beside the selfie centre photo it was compared with (on the verification
 *   page and on the inquiry's card), and earlier sightings as a count.
 * - The trust store page, for a role with `settings:read`: the seeded sandbox source and its
 *   anchor labelled sandbox-only, agreeing with the API; a role without it is refused.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dashboardTrustAnchorsSchema } from '@openverify/contracts';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { poaFixture } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import {
  chipInquiry,
  consolePage,
  documentInquiry,
  evidence,
  expectImageLoaded,
  sessionTokenOf,
  signedInStates,
  tableRow,
  term,
  type ConsoleRole,
} from './support/documents.js';
import { dashboardRequest } from './support/platform.js';

const COVERED = poaFixture('en/utility-bill/edited-covered-amount.pdf');
/** The selfie photo's alt text: it names the image, never the person (C66). */
const SELFIE_PHOTO = 'Selfie centre photo the portrait was compared with';

/** Each role signs in once for the whole file (the suite shares the API's login limits). */
let states: Awaited<ReturnType<typeof signedInStates>>;

test.beforeAll(async ({ browser }) => {
  states = await signedInStates(browser, readStackInfo(), ['reviewer', 'viewer']);
});

/** Runs `body` on a page signed in as `role`, closing its context afterwards. */
async function asRole(
  browser: Browser,
  role: ConsoleRole,
  body: (page: Page) => Promise<void>,
): Promise<void> {
  const { page, context } = await consolePage(browser, states[role]);
  try {
    await body(page);
  } finally {
    await context.close();
  }
}

test('a reviewer reads a proof-of-address document’s evidence, and a viewer sees its fields hidden (C60, C66)', async ({
  browser,
}) => {
  const stack = readStackInfo();
  const { inquiryId, status } = await documentInquiry(
    stack,
    `e2e-ui-documents-${randomUUID()}`,
    COVERED,
  );
  // The advisory fabrication check fails; the verification still passes.
  expect(status).toBe('passed');

  await asRole(browser, 'reviewer', async (page) => {
    await page.goto(`${stack.dashboardUrl}/inquiries/${inquiryId}`);
    const document = evidence(page, 'Document');
    await expect(document).toContainText('What a pass means');
    await expect(document).toContainText('does not mean the document is genuine');
    await expect(term(document, 'Class')).toHaveText('Utility bill');
    await expect(term(document, 'Type check')).toContainText('Passed');
    await expect(term(document, 'Confidence')).toContainText('Beta');
    await expect(term(document, 'Confidence')).toContainText('uncalibrated');
    await expect(term(document, 'Name')).toHaveText(/calderwood/i);
    await expect(term(document, 'Issuer')).not.toHaveText('Hidden');

    const fabrication = term(document, 'Fabrication');
    await expect(fabrication).toContainText('Failed');
    await expect(fabrication).toContainText('Advisory: it does not decide the verification');
    await expect(fabrication).toContainText('Beta');
    const cues = document.getByRole('table', { name: 'Document fabrication cues' });
    await expect(
      tableRow(cues, /^Hidden or covered text over a field/)
        .getByRole('cell')
        .first(),
    ).toHaveText('Strong');

    // C66: the preview inline through the file route; the PDF only as a download.
    await expectImageLoaded(document.getByRole('img', { name: 'Document preview, page 1' }));
    const download = document.getByRole('link', { name: 'Download the original PDF' });
    await expect(download).toHaveAttribute('download', '');
    await expect(download).toHaveAttribute('href', /^\/files\/file_[0-9A-Z]{26}\/content$/);
    // The route passes the API's attachment on, so the click saves the uploaded PDF itself.
    const [saved] = await Promise.all([page.waitForEvent('download'), download.click()]);
    expect(saved.suggestedFilename()).toMatch(/^[a-z-]+-file_[0-9A-Z]{26}\.pdf$/);
    const bytes = await readFile(await saved.path());
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await expect(page.locator('embed, object, iframe')).toHaveCount(0);
  });

  await asRole(browser, 'viewer', async (page) => {
    await page.goto(`${stack.dashboardUrl}/inquiries/${inquiryId}`);
    const hidden = evidence(page, 'Document');
    await expect(term(hidden, 'Name').getByText('Hidden', { exact: true })).toBeVisible();
    await expect(term(hidden, 'Preview').getByText('Hidden', { exact: true })).toBeVisible();
    await expect(hidden.getByRole('img')).toHaveCount(0);
    await expect(term(hidden, 'Class')).toHaveText('Utility bill');
  });
});

test('a reviewer reads a chip verification’s evidence: integrity, revocation, the sandbox anchor, the data groups, Active Authentication and the portrait (C62, C66)', async ({
  browser,
}) => {
  const stack = readStackInfo();
  const { inquiryId, verificationId } = await chipInquiry(
    stack,
    `e2e-ui-documents-chip-${randomUUID()}`,
  );

  await asRole(browser, 'reviewer', async (page) => {
    await page.goto(`${stack.dashboardUrl}/verifications/${verificationId}`);
    const chip = evidence(page, 'Government ID chip');
    await expect(chip).toContainText('bound to the person in the live selfie');
    await expect(term(chip, 'Passive authentication')).toContainText('Passed');
    await expect(term(chip, 'Integrity')).toContainText('Established');
    await expect(term(chip, 'Revocation')).toContainText('Not revoked');
    const anchor = term(chip, 'Trust anchor source');
    await expect(anchor).toContainText('openverify-sandbox');
    await expect(anchor).toContainText('Sandbox-only');
    await expect(term(chip, 'Signer certificate')).toHaveText('Valid at verification time');

    const groups = chip.getByRole('table', { name: 'Government ID chip data groups' });
    for (const group of ['DG1 (MRZ)', 'DG2 (portrait)']) {
      await expect(tableRow(groups, group)).toContainText('Identical');
    }

    await expect(term(chip, 'Chip authentication')).toContainText('Passed');
    await expect(term(chip, 'Active Authentication')).toContainText('Verified');
    const report = term(chip, 'Device report');
    await expect(report).toContainText('PACE, Active Authentication');
    await expect(report).toContainText('As reported by the client');
    await expect(term(chip, 'Selfie comparison')).toContainText('Passed');
    await expect(term(chip, 'MRZ comparison')).toContainText('Passed');
    await expect(term(chip, 'Earlier sightings on other accounts')).toHaveText('0');
    await expect(term(chip, 'Last name')).toHaveText('CALDERWOOD');

    // C66: the chip portrait beside the selfie centre photo, both through the file route.
    await expectImageLoaded(
      term(chip, 'Chip portrait').getByRole('img', { name: 'Chip portrait' }),
    );
    await expectImageLoaded(term(chip, 'Selfie photo').getByRole('img', { name: SELFIE_PHOTO }));
    // The console serves no raw chip file: the files list shows them by kind, not as images.
    const files = page.getByRole('list', { name: 'Government ID chip files' });
    await expect(files.getByRole('img')).toHaveCount(1);

    // The inquiry's card shows them side by side too, from the inquiry's own files.
    await page.goto(`${stack.dashboardUrl}/inquiries/${inquiryId}`);
    const card = evidence(page, 'Government ID chip');
    await expectImageLoaded(
      term(card, 'Chip portrait').getByRole('img', { name: 'Chip portrait' }),
    );
    await expectImageLoaded(term(card, 'Selfie photo').getByRole('img', { name: SELFIE_PHOTO }));
  });
});

test('the chip trust store shows the sandbox source and anchor as the API reports them, to a role with settings:read only (C62.10, C66)', async ({
  browser,
}) => {
  const stack = readStackInfo();
  const answer = await dashboardRequest(stack, 'GET', '/trust-anchors', {
    token: sessionTokenOf(states.viewer),
  });
  expect(answer.status).toBe(200);
  const store = dashboardTrustAnchorsSchema.parse(answer.body);
  const [seeded] = store['sandbox-anchors'];
  if (seeded === undefined) {
    throw new Error('seed:dev inserted no sandbox anchor');
  }

  await asRole(browser, 'viewer', async (page) => {
    await page.goto(`${stack.dashboardUrl}/inquiries`);
    await page.getByRole('link', { name: 'Chip trust store' }).click();
    await expect(page).toHaveURL(/\/trust-anchors$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Chip trust store' })).toBeVisible();
    await expect(
      term(page.getByRole('region', { name: 'Summary' }), 'Production anchor'),
    ).toContainText(store['has-production-anchor'] ? 'Yes' : 'No');
    const sources = page.getByRole('table', { name: 'Trust anchor sources' });
    await expect(tableRow(sources, /openverify-sandbox/)).toContainText('Enabled');
    const sandbox = page.getByRole('region', { name: 'Sandbox anchors' });
    await expect(sandbox).toContainText('Sandbox-only anchor');
    await expect(
      tableRow(
        sandbox.getByRole('table', { name: 'Sandbox-only anchors' }),
        /Utopia \(test issuer\)/,
      ),
    ).toContainText(seeded.id);
  });

  await asRole(browser, 'reviewer', async (page) => {
    await page.goto(`${stack.dashboardUrl}/inquiries`);
    await expect(page.getByRole('link', { name: 'Chip trust store' })).toHaveCount(0);
    await page.goto(`${stack.dashboardUrl}/trust-anchors`);
    await expect(page.getByRole('heading', { name: 'You do not have access' })).toBeVisible();
    await expect(page.getByTestId('forbidden-panel')).toContainText('settings:read');
  });
});
