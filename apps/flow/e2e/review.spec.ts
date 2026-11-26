/**
 * C30.6 in the browser, against the mocked API: a government ID or a selfie an operator reviews
 * (`needs_review`) is done for the user. The flow moves on without retry hints and ends on the
 * normal "submitted" completion screen, never on a retry and never on a "verified" message, and
 * a reload shows the same screen once the inquiry is marked for review (C30.5).
 */
import { expect, test } from '@playwright/test';
import { heading, uploadId, uploadSelfie } from './support/flow-steps';
import { MockFlowApi, flowLink, type Decision } from './support/mock-flow-api';

const COMPLETION = 'Thank you. Your verification has been submitted, and you can close this page.';

const cases: readonly (readonly [string, readonly Decision[]])[] = [
  ['a government ID in review', [{ status: 'needs_review' }, { status: 'passed' }]],
  ['a selfie in review', [{ status: 'passed' }, { status: 'needs_review' }]],
];

for (const [label, decisions] of cases) {
  test(`${label} ends on the normal completion screen, without a retry (C30.6)`, async ({
    page,
  }) => {
    const api = new MockFlowApi();
    api.consent = { textKeys: ['consent.biometric', 'consent.processing'], locale: 'en' };
    // A sandbox session, so the selfie can be uploaded as well as taken (C19).
    api.environmentKind = 'sandbox';
    api.decisions.push(...decisions);
    await api.install(page);
    await page.goto(flowLink());

    await uploadId(page);
    await expect(heading(page, 'Take a selfie')).toBeVisible();
    await expect(page.getByText('Attempt 1 of 3')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await uploadSelfie(page);

    await expect(heading(page, 'Verification submitted')).toBeFocused();
    await expect(page.getByText(COMPLETION)).toBeVisible();
    await expect(page.getByText(/\bverified\b/i)).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button')).toHaveCount(0);
    expect(api.inquiryStatus).toBe('needs_review');
    expect(api.verifications.map(({ type }) => type)).toEqual([
      'verification/government-id',
      'verification/selfie',
    ]);

    await page.reload();

    await expect(heading(page, 'Verification submitted')).toBeVisible();
    await expect(page.getByText(COMPLETION)).toBeVisible();
  });
}
