/**
 * C47 in the console, full stack. An end user completes an inquiry of the default template in the
 * hosted flow (consent, the synthetic Utopia card, then the C40 selfie capture: the fake camera
 * plays person A's head-turn clip and the guidance takes the three photos itself). A reviewer then
 * reads the selfie in the dashboard: the pose photos in prompt order, the ID comparison beside the
 * centre photo with its threshold and basis, the liveness components and flags in words, the
 * capture in the inquiry's selfie captures, and the consent the session recorded; and on the
 * verification page, the government ID photo it was compared with, its prompt timings and its
 * captures. An admin then changes a face matching setting on the settings page and restores it.
 *
 * Every expected threshold, basis and status is read from the API, never from the console's own
 * copy: the face-match default and its basis may change with the C49 calibration. The matching
 * consent is left unticked, so this spec stores no face template that another spec's 1:N scan
 * could find; the console's rendering of a ticked optional key is covered by the dashboard's unit
 * tests.
 */
import { randomUUID } from 'node:crypto';
import {
  FACE_TEMPLATE_RETENTION_DAYS,
  dashboardSettingsSchema,
  selfieVerificationResourceSchema,
  type VerificationCheck,
} from '@openverify/contracts';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { FIXTURES } from '../src/paths.js';
import { readStackInfo } from '../src/stack-info.js';
import { fakeCameraArgs, giveConsent, takeSelfie, uploadId } from './support/flow.js';
import { dashboardRequest, recordingClient } from './support/platform.js';
import { createServerApi } from './support/server-api.js';
import { sessionTokenAs, signInAs } from './support/ui.js';

test.use({ launchOptions: { args: fakeCameraArgs(FIXTURES.headTurnMatching) } });

/** A liveness component's status as the console words it (C43, C47). */
const COMPONENT_WORDS: Readonly<Record<string, string>> = {
  passed: 'Passed',
  failed: 'Failed',
  not_requested: 'Not requested',
  not_executed: 'Not run',
};

/** A pose as the console labels it. */
const POSE_WORDS: Readonly<Record<string, string>> = {
  center: 'Center',
  left: 'Left',
  right: 'Right',
};

/** The value (`<dd>`) of a term (`<dt>`) of a `<dl>` inside `scope`. */
const term = (scope: Locator, name: string) => scope.locator(`dt:text-is("${name}") + dd`);

const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/** Waits until an image has decoded through the dashboard's authenticated file route. */
async function expectLoaded(image: Locator) {
  await image.scrollIntoViewIfNeeded();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
}

/** How the console says a threshold was set: a default's basis, or the template (C39.3). */
function basisWords(check: VerificationCheck, key: string): string {
  const basis = check.provenance?.['threshold-basis']?.[key];
  if (basis === undefined) {
    return 'Set by the template';
  }
  return basis === 'calibrated' ? 'Calibrated' : 'Provisional';
}

test('a reviewer reads a selfie in the console: the photos in prompt order, the ID comparison with its threshold and basis, liveness in words, the capture and the consent (C47)', async ({
  page,
  browser,
}) => {
  const stack = readStackInfo();
  const api = createServerApi(stack.apiUrl, stack.apiKey);
  const inquiry = await api.createInquiry(stack.defaultTemplateId, `ui-selfie-${randomUUID()}`);
  const { flowUrl } = await api.resumeInquiry(inquiry.id);

  // The end user.
  await page.goto(flowUrl);
  await giveConsent(page);
  await uploadId(page, FIXTURES.idFront, FIXTURES.idBack);
  const shots = await takeSelfie(page);
  const prompts = shots.map((shot) => shot.pose);
  expect(prompts[0]).toBe('center');
  await expect(page.getByRole('heading', { level: 1, name: 'Verification submitted' })).toBeVisible(
    { timeout: 90_000 },
  );

  // What the API says, once the worker has decided the selfie.
  await expect
    .poll(
      async () =>
        (await api.getInquiry(inquiry.id)).included?.find(
          (resource) => resource.type === 'verification/selfie',
        )?.attributes.status,
      { timeout: 120_000, intervals: [1_000] },
    )
    .toMatch(/^(passed|failed|needs_review)$/);
  const document = await api.getInquiry(inquiry.id);
  const selfie = selfieVerificationResourceSchema.parse(
    document.included?.find((resource) => resource.type === 'verification/selfie'),
  );
  const checkNamed = (name: string) => {
    const check = selfie.attributes.checks.find((candidate) => candidate.name === name);
    if (check === undefined) {
      throw new Error(`The selfie has no ${name} result`);
    }
    return check;
  };
  const comparison = checkNamed('selfie_id_comparison');
  const liveness = checkNamed('selfie_liveness_detection');
  const similarity = selfie.attributes['document-similarity-score'];
  const threshold = comparison.provenance?.thresholds.threshold;
  expect(similarity).toEqual(expect.any(Number));
  expect(threshold).toEqual(expect.any(Number));
  // C51.3 widened a threshold to lists of match groups; this one is the face-match number.
  if (typeof threshold !== 'number') {
    throw new Error('selfie_id_comparison recorded no face-match threshold');
  }
  const components = liveness.metadata.components as Record<string, string>;
  const [captureId] = (selfie.relationships.selfies?.data ?? []).map((capture) => capture.id);
  expect(captureId).toMatch(/^self_/);
  const { client } = recordingClient(stack.apiUrl, stack.apiKey);
  const { data: sessions } = await client.inquirySessions.list({
    filter: { 'inquiry-id': inquiry.id },
  });
  const consented = sessions.find((session) => session.attributes.consent != null);
  const consent = consented?.attributes.consent;
  if (consented === undefined || consent == null) {
    throw new Error('No session recorded the consent');
  }

  // The reviewer, in a fresh browser context.
  const operator = await browser.newContext();
  try {
    const dashboard = await operator.newPage();
    await signInAs(dashboard, stack, 'reviewer');
    await dashboard.goto(`${stack.dashboardUrl}/inquiries/${inquiry.id}`);
    await expect(dashboard.getByRole('heading', { level: 1 })).toContainText(inquiry.id);
    const card = region(dashboard, 'Selfie');

    // The pose photos in the order the capture prompted them, each named by its pose.
    const photos = card
      .getByRole('list', { name: 'Selfie images' })
      .getByRole('img', { name: /^Selfie, / });
    await expect(photos).toHaveCount(3);
    expect(
      await photos.evaluateAll((images) => images.map((image) => image.getAttribute('alt'))),
    ).toEqual(prompts.map((pose) => `Selfie, ${pose}`));
    for (const photo of await photos.all()) {
      await expectLoaded(photo);
    }

    // Beside the centre photo: the similarity, the threshold and its basis, read from the result.
    const compared = card.getByRole('group', { name: 'Compared with the government ID' });
    await expect(term(compared, 'Similarity')).toHaveText((similarity ?? 0).toFixed(4));
    await expect(term(compared, 'Threshold')).toHaveText(String(threshold));
    await expect(term(compared, 'Threshold basis')).toHaveText(basisWords(comparison, 'threshold'));
    // The government ID card above shows the ID photo; the selfie card offers it on demand.
    await compared.getByText('Show the government ID photo').click();
    await expectLoaded(
      compared.getByRole('img', { name: 'Government ID front, whose portrait was compared' }),
    );

    // The liveness components and the flags the sandbox capture recorded, in words.
    const livenessGroup = card.getByRole('group', { name: 'Selfie liveness' });
    for (const [component, label] of [
      ['passive', 'Passive'],
      ['active', 'Active'],
      ['integrity', 'Integrity'],
    ] as const) {
      await expect(term(livenessGroup, label)).toHaveText(
        COMPONENT_WORDS[components[component] ?? ''] ?? '',
      );
    }
    const flags = livenessGroup.getByRole('list', { name: 'Selfie liveness flags' });
    for (const flag of liveness.metadata['integrity-flags'] as string[]) {
      await expect(flags).toContainText(flag);
    }
    await expect(flags).toContainText('The camera label is a file path');
    await expect(flags).toContainText('The browser was under automation (webdriver)');
    await expect(flags).toContainText('Sandbox test capture');

    // The capture's prompt timings, one per prompted pose.
    const timings = card.getByRole('table', { name: 'Selfie prompt timings' });
    expect((await timings.getByRole('rowheader').allTextContents()).sort()).toEqual(
      prompts.map((pose) => POSE_WORDS[pose]).sort(),
    );

    // The inquiry's selfie captures: this one, processed and used for the checks.
    const captures = region(dashboard, 'Selfie captures').getByRole('table', {
      name: 'Inquiry selfie captures',
    });
    const captureRow = captures
      .getByRole('row')
      .filter({ has: dashboard.getByRole('rowheader', { name: captureId ?? '' }) });
    await expect(captureRow).toContainText('Processed');
    await expect(captureRow).toContainText('Used for the checks');
    await expect(captureRow.getByRole('link', { name: selfie.id })).toHaveAttribute(
      'href',
      `/verifications/${selfie.id}`,
    );

    // The consent the session recorded: the required texts, and no optional one ticked.
    const sessionCard = region(dashboard, 'Sessions')
      .getByRole('list', { name: 'Inquiry sessions' })
      .getByRole('article', { name: `Session ${consented.id}`, exact: true });
    await expect(term(sessionCard, 'Required texts')).toHaveText(consent['text-keys'].join(', '));
    await expect(term(sessionCard, 'Optional texts')).toHaveText('None ticked');
    await expect(term(sessionCard, 'Locale')).toHaveText(consent.locale);

    // The selfie's own page: the ID photo shown beside the centre photo, timings and captures.
    await card.getByRole('link', { name: selfie.id }).first().click();
    await expect(dashboard).toHaveURL(new RegExp(`/verifications/${selfie.id}$`));
    const files = region(dashboard, 'Files');
    const pageComparison = files.getByRole('group', { name: 'Compared with the government ID' });
    await expectLoaded(
      pageComparison.getByRole('img', { name: 'Government ID front, whose portrait was compared' }),
    );
    await expect(term(pageComparison, 'Threshold basis')).toHaveText(
      basisWords(comparison, 'threshold'),
    );
    await expect(
      region(dashboard, 'Prompt timings')
        .getByRole('table', { name: 'Selfie prompt timings' })
        .getByRole('rowheader'),
    ).toHaveCount(prompts.length);
    await expect(
      region(dashboard, 'Captures')
        .getByRole('table', { name: 'Selfie captures' })
        .getByRole('rowheader', { name: captureId ?? '' }),
    ).toBeVisible();
  } finally {
    await operator.close();
  }
});

test('an admin changes the face template retention on the settings page, a value out of range is refused on its field, and the original is restored (C42.6, C47)', async ({
  page,
}) => {
  const stack = readStackInfo();
  const token = await sessionTokenAs(stack, 'admin');
  const read = async () =>
    dashboardSettingsSchema.parse(
      (await dashboardRequest(stack, 'GET', '/settings', { token })).body,
    )['face-template-retention-days'];
  const original = await read();
  expect(original).toEqual(expect.any(Number));
  const changed = original === 30 ? 31 : 30;
  try {
    await signInAs(page, stack, 'admin');
    await page.goto(`${stack.dashboardUrl}/settings`);
    const face = page.getByRole('group', { name: 'Face matching in Sandbox' });
    const field = face.getByLabel('Face template retention (days)');
    await expect(field).toHaveValue(String(original));

    // Out of the contract's range: refused on the field itself, nothing saved.
    await field.fill(String(FACE_TEMPLATE_RETENTION_DAYS.max + 1));
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(field).toHaveAccessibleDescription(
      new RegExp(
        `Enter a whole number of days from ${FACE_TEMPLATE_RETENTION_DAYS.min.toLocaleString('en-US')} to ${FACE_TEMPLATE_RETENTION_DAYS.max.toLocaleString('en-US')}\\.$`,
      ),
    );
    expect(await read()).toBe(original);

    await field.fill(String(changed));
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();
    expect(await read()).toBe(changed);
    await page.reload();
    await expect(
      page
        .getByRole('group', { name: 'Face matching in Sandbox' })
        .getByLabel('Face template retention (days)'),
    ).toHaveValue(String(changed));
  } finally {
    // No other spec sees the change.
    await dashboardRequest(stack, 'PATCH', '/settings', {
      token,
      body: { 'face-template-retention-days': original },
    });
  }
  expect(await read()).toBe(original);
});
