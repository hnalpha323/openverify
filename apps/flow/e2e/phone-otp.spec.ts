/**
 * C55, C64.1 in the browser, against the mocked API: a phone number confirmed with a one-time
 * code. The page's wall clock is frozen (Playwright's `page.clock`) and moved with the mock's, so
 * the resend countdown moves only when the spec says. Each screen is checked as assistive
 * technology meets it: the accessible names and descriptions, focus on each new screen's heading
 * or on the field a refusal names, and what the live regions say (the countdown itself is not
 * one: only the moment a new code may be asked for is announced).
 */
import { expect, test } from '@playwright/test';
import { giveConsent } from './support/flow-steps';
import { MockFlowApi, PHASE5_CONSENT_GIVEN, flowLink, phase5Flow } from './support/mock-flow-api';
import {
  AT_MS,
  advanceClock,
  collectUnexpectedErrors,
  expectTargetSize,
  freezeClock,
  heading,
  inLiveRegion,
} from './support/phase5';

const PHONE = { id: 'phone', type: 'phone_otp', allowedCountries: ['US', 'GB'] } as const;
/** Synthetic numbers from the ranges kept for drama (Ofcom 020 7946 0xxx, NANP 555-01xx). */
const LONDON = '020 7946 0958';
const NANP = '202 555 0143';
const WRONG_CODE = '135791';

function phoneApi(): MockFlowApi {
  const api = new MockFlowApi();
  api.flow = phase5Flow('phone', { ...PHONE, allowedCountries: [...PHONE.allowedCountries] });
  return api;
}

test('confirms a phone number: a wrong code with tries left, a new code on the frozen clock, a changed number, then the right code (C55, C64.1)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = phoneApi();
  // One poll still finds the submitted verification, so the processing screen can be read.
  api.pendingPolls = 1;
  await api.install(page);
  await freezeClock(page, api);
  await page.goto(flowLink());
  await giveConsent(page);

  // The number: a country from the step's allowed ones, then the number.
  await expect(heading(page, 'Confirm your phone number')).toBeFocused();
  await expect(page.getByText('Attempt 1 of 5')).toBeVisible();
  const country = page.getByRole('combobox', { name: 'Country' });
  await expect(country.getByRole('option')).toHaveText([
    'United Kingdom (+44)',
    'United States (+1)',
  ]);
  await expect(country).toHaveValue('US');
  const number = page.getByRole('textbox', { name: 'Phone number' });
  await expect(number).toHaveAttribute('type', 'tel');
  await expect(number).toHaveAttribute('autocomplete', 'tel-national');
  await expect(number).toHaveAccessibleDescription('You can leave out the country code.');
  const send = page.getByRole('button', { name: 'Send code' });
  await expectTargetSize(send);

  // A number the browser refuses takes focus, its error read with it; nothing is sent.
  await send.click();
  await expect(number).toBeFocused();
  await expect(number).toHaveAttribute('aria-invalid', 'true');
  await expect(number).toHaveAccessibleDescription(
    'You can leave out the country code. Enter your phone number.',
  );
  expect(api.otpSends).toEqual([]);

  await country.selectOption('GB');
  await number.fill(LONDON);
  await send.click();

  // The code: sent in E.164, the destination masked, the one-time-code autofill.
  await expect(heading(page, 'Enter the code')).toBeFocused();
  expect(api.otpSends.map(({ body }) => body)).toEqual([{ 'phone-number': '+442079460958' }]);
  await expect(page.getByRole('status').filter({ hasText: 'We sent a code to' })).toHaveText(
    'We sent a code to •••••••0958.',
  );
  const code = page.getByRole('textbox', { name: 'Code' });
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(code).toHaveAttribute('inputmode', 'numeric');
  await expect(code).toHaveAccessibleDescription('The code has 6 digits.');
  await expect(page.getByText('Tries left for this code: 5')).toBeVisible();

  // The resend waits 30 s: the countdown is a description, never a live region, and the status
  // region stays empty while it runs, so nothing is announced every second.
  const resend = page.getByRole('button', { name: 'Send a new code' });
  await expect(resend).toHaveAttribute('aria-disabled', 'true');
  await expect(resend).toHaveAccessibleDescription('You can ask for a new code in 0:30.');
  const countdown = page.getByText('You can ask for a new code in');
  expect(await inLiveRegion(countdown)).toBe(false);
  const ready = page.getByRole('status').filter({ hasNotText: 'We sent' }).last();
  await expect(ready).toHaveText('');

  // A wrong code: its tries left drop, and the field takes focus with its error.
  await code.fill(WRONG_CODE);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await expect(code).toHaveAccessibleDescription(
    'The code has 6 digits. That code is not correct. Check it and try again. Tries left for this code: 4',
  );
  await expect(page.getByText('Tries left for this code: 4')).toBeVisible();

  // The frozen clock moves 12 s, then to the end of the wait: announced once, when it ends.
  await advanceClock(page, api, 12_000);
  await expect(resend).toHaveAccessibleDescription('You can ask for a new code in 0:18.');
  await expect(ready).toHaveText('');
  await advanceClock(page, api, 18_000);
  await expect(ready).toHaveText('You can now ask for a new code.');
  await expect(resend).not.toHaveAttribute('aria-disabled');
  await expectTargetSize(resend);

  await resend.click();
  await expect(page.getByText('We sent a new code to •••••••0958.')).toBeVisible();
  // C55.6: the second code waits 60 s for the third, and has five tries of its own.
  await expect(resend).toHaveAccessibleDescription('You can ask for a new code in 1:00.');
  await expect(page.getByText('Tries left for this code: 5')).toBeVisible();

  // "Change phone number" goes back with what was typed; the wait belongs to the verification.
  await page.getByRole('button', { name: 'Change phone number' }).click();
  await expect(heading(page, 'Confirm your phone number')).toBeFocused();
  await expect(country).toHaveValue('GB');
  await expect(number).toHaveValue(LONDON);
  await country.selectOption('US');
  await number.fill(NANP);
  await send.click();
  await expect(number).toBeFocused();
  await expect(number).toHaveAccessibleDescription(
    'You can leave out the country code. Wait a little before you ask for a new code.',
  );
  await advanceClock(page, api, 60_000);
  await send.click();
  await expect(heading(page, 'Enter the code')).toBeFocused();
  await expect(page.getByText('We sent a new code to •••••••0143.')).toBeVisible();

  // The right code is confirmed and the verification submitted at once.
  await code.fill(api.otpCode);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(heading(page, 'Checking your verification')).toBeFocused();
  await expect(page.getByRole('status')).toHaveText(
    'This usually takes a few seconds. Keep this page open.',
  );
  await expect(heading(page, 'Verification submitted')).toBeFocused();

  expect(api.otpSends.map(({ body }) => body)).toEqual([
    { 'phone-number': '+442079460958' },
    { 'phone-number': '+442079460958' },
    { 'phone-number': '+12025550143' },
    { 'phone-number': '+12025550143' },
  ]);
  expect(api.otpConfirms.map(({ body }) => body)).toEqual([
    { code: WRONG_CODE },
    { code: api.otpCode },
  ]);
  // One verification for the attempt, submitted once with no body, whatever the number.
  expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
    ['verification/phone-number', 'passed'],
  ]);
  expect(api.submits).toEqual([{ verificationId: api.verifications[0]?.id, body: null }]);
  expect(api.inquiryStatus).toBe('completed');
  expect(errors).toEqual([]);
});

test('continues for review after a limit refused a code (C55.6, C55.7)', async ({ page }) => {
  const errors = collectUnexpectedErrors(page);
  const api = phoneApi();
  api.consent = { ...PHASE5_CONSENT_GIVEN, textKeys: [...PHASE5_CONSENT_GIVEN.textKeys] };
  api.refusals.otp = [{ code: 'otp_rate_limited' }];
  // C55.6: the check answers otp_delivery_unavailable, so the verification goes to review.
  api.decisions.push({ status: 'needs_review' });
  await api.install(page);
  await freezeClock(page, api);
  await page.goto(flowLink());

  await page.getByRole('textbox', { name: 'Phone number' }).fill(NANP);
  await page.getByRole('button', { name: 'Send code' }).click();

  await expect(heading(page, 'We cannot send you a code right now')).toBeFocused();
  await expect(
    page.getByText(
      'We could not send or check a code for you just now. You can continue, and the organization that asked you to verify will review your verification.',
    ),
  ).toBeVisible();
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expectTargetSize(continueButton);
  await continueButton.click();

  await expect(heading(page, 'Verification submitted')).toBeFocused();
  expect(api.submits).toEqual([{ verificationId: api.verifications[0]?.id, body: null }]);
  expect(api.verifications[0]?.status).toBe('needs_review');
  expect(api.inquiryStatus).toBe('needs_review');
  expect(errors).toEqual([]);
});

test('starts again once the last code expired with no code left: the attempt fails otp_not_confirmed (C55.6, C64.1)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = phoneApi();
  api.consent = { ...PHASE5_CONSENT_GIVEN, textKeys: [...PHASE5_CONSENT_GIVEN.textKeys] };
  // Resumed: the fifth code was sent eleven minutes ago, so it has expired and none is left.
  api.verifications.push({
    type: 'verification/phone-number',
    id: 'ver_01M5CK16P0D13FXHZSS4TCFB00',
    status: 'initiated',
    hints: [],
    sends: 5,
    otp: { destination: '+12025550143', sentAtMs: AT_MS - 660_000, attemptsRemaining: 5 },
  });
  api.decisions.push({
    status: 'failed',
    hints: [{ name: 'phone_number_otp_comparison', reasons: ['otp_not_confirmed'] }],
  });
  await api.install(page);
  await freezeClock(page, api);
  await page.goto(flowLink());

  await expect(heading(page, 'Enter the code')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(
    'This code has expired, and no more codes can be sent. Start again to get a new code.',
  );
  await expect(page.getByText('No more codes can be sent.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send a new code' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start again' }).click();
  await expect(heading(page, 'Confirm your phone number')).toBeFocused();
  await page.getByRole('textbox', { name: 'Phone number' }).fill(NANP);
  await page.getByRole('button', { name: 'Send code' }).click();

  // C55.6: the server submits the attempt; it fails, and the next attempt says why.
  await expect(heading(page, 'Confirm your phone number')).toBeFocused();
  await expect(page.getByText('Attempt 2 of 5')).toBeVisible();
  const hints = page.getByRole('alert');
  await expect(hints).toContainText('Your last attempt did not go through');
  await expect(hints).toContainText(
    'The code was not confirmed in time. Start again to get a new code.',
  );
  await expect(page.getByRole('main')).not.toContainText(/photo/u);
  expect(api.verifications.map(({ status }) => status)).toEqual(['failed']);
  expect(api.submits).toEqual([]);
  expect(errors).toEqual([]);
});

test('submits a confirmed code at once when the flow resumes on it (C64.1 resume)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = phoneApi();
  api.consent = { ...PHASE5_CONSENT_GIVEN, textKeys: [...PHASE5_CONSENT_GIVEN.textKeys] };
  api.verifications.push({
    type: 'verification/phone-number',
    id: 'ver_01M5CK16P0D13FXHZSS4TCFB00',
    status: 'confirmed',
    hints: [],
    sends: 1,
  });
  await api.install(page);
  await freezeClock(page, api);
  await page.goto(flowLink());

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  expect(api.submits).toEqual([{ verificationId: 'ver_01M5CK16P0D13FXHZSS4TCFB00', body: null }]);
  expect(api.otpSends).toEqual([]);
  expect(api.otpConfirms).toEqual([]);
  expect(errors).toEqual([]);
});

// Workflow 5C review P020: the served JavaScript holds libphonenumber's metadata, so the flow
// serves its licences beside it, as it serves ONNX Runtime's (C48).
test('serves libphonenumber-js’s licence and its metadata’s Apache-2.0 licence with the flow', async ({
  request,
}) => {
  const licence = await request.get('/licenses/libphonenumber-js/LICENSE');
  const apache = await request.get('/licenses/libphonenumber-js/LICENSE.Apache');

  expect(licence.status()).toBe(200);
  expect(await licence.text()).toContain('MIT License');
  expect(apache.status()).toBe(200);
  expect(await apache.text()).toContain('Apache License');
});
