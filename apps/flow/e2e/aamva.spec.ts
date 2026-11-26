/**
 * C52.3, C59.6, C64.1 in the browser, against the mocked API: the AAMVA step. With
 * `source: form`, the user types a US license as printed, its state chosen from the 56
 * jurisdictions; the browser checks each value with its contract schema and a 422 pointer comes
 * back to its field. With `source: government_id` the step has no form: the flow shows that the
 * license is being checked, polling the session on a paused clock, creates nothing, and moves on
 * once the server has made and decided (here, skipped) the attempt, a skipped one counting as
 * done (C50.5).
 */
import { expect, test } from '@playwright/test';
import { MockFlowApi, PHASE5_CONSENT_GIVEN, flowLink, phase5Flow } from './support/mock-flow-api';
import {
  AT_MS,
  collectUnexpectedErrors,
  expectRequiredMark,
  heading,
  inLiveRegion,
} from './support/phase5';

/** Synthetic: an invented license holder. */
const LICENSE = {
  'name-first': 'Alex',
  'name-last': 'Example',
  birthdate: '1990-04-01',
  'identification-number': 'E2E0000001',
} as const;

const GIVEN = { ...PHASE5_CONSENT_GIVEN, textKeys: [...PHASE5_CONSENT_GIVEN.textKeys] };

test('fills the AAMVA form: the license as printed, a ZIP code the browser refuses and a state the server refuses, each taking focus (C52.3, C64.1)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = new MockFlowApi();
  api.flow = phase5Flow('licence', { id: 'licence', type: 'aamva', source: 'form' });
  api.consent = GIVEN;
  api.refusedInputs.push(['/issuing-authority']);
  await api.install(page);
  await page.goto(flowLink());

  await expect(heading(page, 'Enter your driver’s license details')).toBeVisible();
  const first = page.getByRole('textbox', { name: 'First name', exact: true });
  const last = page.getByRole('textbox', { name: 'Last name', exact: true });
  const birthdate = page.getByLabel('Date of birth', { exact: true });
  const number = page.getByRole('textbox', {
    name: 'Driver’s license or ID card number',
    exact: true,
  });
  const state = page.getByRole('combobox', { name: 'Issuing state or territory', exact: true });
  const issued = page.getByLabel('Issue date', { exact: true });
  const expires = page.getByLabel('Expiration date', { exact: true });
  const zip = page.getByRole('textbox', { name: 'ZIP code', exact: true });

  for (const field of [first, last, birthdate, number, state]) {
    await expectRequiredMark(field);
  }
  for (const field of [issued, expires, zip]) {
    await expect(field).not.toHaveAttribute('required');
  }
  // The 50 states, DC and five territories, after the placeholder, named in English.
  await expect(state.getByRole('option')).toHaveCount(57);
  await expect(state.getByRole('option').first()).toHaveText('Choose a state or territory');
  await expect(state.getByRole('option', { name: 'U.S. Virgin Islands' })).toHaveCount(1);

  await first.fill(LICENSE['name-first']);
  await last.fill(LICENSE['name-last']);
  await birthdate.fill(LICENSE.birthdate);
  await number.fill(LICENSE['identification-number']);
  await state.selectOption('CA');
  await zip.fill('1234');
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await continueButton.click();

  // A ZIP code of the wrong shape, refused by the browser before any request: the summary is
  // announced, and the field takes focus with its error.
  await expect(page.getByRole('alert')).toHaveText('Check the details marked below.');
  await expect(zip).toBeFocused();
  await expect(zip).toHaveAttribute('aria-invalid', 'true');
  await expect(zip).toHaveAccessibleDescription(
    'Enter a 5-digit ZIP code, or a ZIP+4 like 12345-6789.',
  );
  expect(api.enteredValues).toEqual([]);
  await zip.fill('12345');
  await continueButton.click();

  // The server refused the state: its pointer marks the select, which takes focus.
  await expect(state).toBeFocused();
  await expect(state).toHaveAttribute('aria-invalid', 'true');
  await expect(state).toHaveAccessibleDescription('This was not accepted. Check it and try again.');
  await state.selectOption('NV');
  await continueButton.click();

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  // Sent without the empty dates, the state as its code.
  const sent = { ...LICENSE, 'issuing-authority': 'NV', 'address-postal-code': '12345' };
  expect(api.enteredValues.map(({ body }) => body)).toEqual([
    { ...sent, 'issuing-authority': 'CA' },
    sent,
  ]);
  expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
    ['verification/aamva', 'passed'],
  ]);
  expect(errors).toEqual([]);
});

test('waits on a silent AAMVA step until the server has made and skipped its attempt, then moves on, creating nothing (C59.6, C50.5, C64.1)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = new MockFlowApi();
  api.flow = phase5Flow(
    'silent',
    {
      id: 'government_id',
      type: 'government_id',
      sides: 'both',
      maxAttempts: 3,
      captureMethods: ['upload', 'camera'],
    },
    { id: 'aamva', type: 'aamva', source: 'government_id' },
    { id: 'email', type: 'email_otp' },
  );
  api.consent = GIVEN;
  api.verifications.push({
    type: 'verification/government-id',
    id: 'ver_01M5CK16P0D13FXHZSS4TCFB00',
    status: 'passed',
    hints: [],
  });
  // The first session read finds no attempt yet; the next, the server's submitted one; the
  // third, that the server skipped it (an ineligible ID or a non-participating jurisdiction).
  api.silentAamva.push(null, 'submitted', 'skipped');
  // The clock is paused before the flow loads, so each poll runs only when the spec says.
  await page.clock.install({ time: AT_MS });
  await page.clock.pauseAt(AT_MS + 1000);
  await api.install(page);
  await page.goto(flowLink());

  await expect(heading(page, 'Checking your license details')).toBeVisible();
  const status = page.getByRole('status');
  const waiting =
    'We are checking your driver’s license or ID card with the office that issued it. This usually takes a few seconds. Keep this page open.';
  await expect(status).toHaveText(waiting);
  expect(await inLiveRegion(status)).toBe(true);
  // The first poll found the server's submitted attempt: still checking, said once.
  await expect
    .poll(() => api.verifications.find(({ type }) => type === 'verification/aamva')?.status)
    .toBe('submitted');
  await expect(heading(page, 'Checking your license details')).toBeVisible();
  await expect(status).toHaveText(waiting);

  await page.clock.runFor(2000);

  // Skipped counts as done: the next step runs.
  await expect(heading(page, 'Confirm your email address')).toBeFocused();
  expect(
    api.requests.filter(({ method, path }) => method === 'POST' && path.includes('/verifications')),
  ).toEqual([]);
  expect(api.verifications.map(({ type, status: done }) => [type, done])).toEqual([
    ['verification/government-id', 'passed'],
    ['verification/aamva', 'skipped'],
  ]);
  expect(api.inquiryStatus).toBe('pending');
  expect(errors).toEqual([]);
});
