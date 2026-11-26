/**
 * C55, C64.1 in the browser, against the mocked API: an email address confirmed with a one-time
 * code, on a frozen wall clock moved with the mock's. A delivery failure goes back to the address
 * with focus on it; an address the browser cannot use is refused before any request; a code
 * that expires on the clock asks for a new one; and the step speaks Spanish.
 */
import { expect, test } from '@playwright/test';
import { MockFlowApi, PHASE5_CONSENT_GIVEN, flowLink, phase5Flow } from './support/mock-flow-api';
import {
  advanceClock,
  collectUnexpectedErrors,
  expectTargetSize,
  freezeClock,
  heading,
} from './support/phase5';

/** Synthetic: `.test` is reserved (RFC 2606), so no one receives mail there. */
const EMAIL = 'casey@example.test';

function emailApi(): MockFlowApi {
  const api = new MockFlowApi();
  api.flow = phase5Flow('email', { id: 'email', type: 'email_otp' });
  api.consent = { ...PHASE5_CONSENT_GIVEN, textKeys: [...PHASE5_CONSENT_GIVEN.textKeys] };
  return api;
}

test('confirms an email address after a delivery failure sent the user back to it (C55, C64.1)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = emailApi();
  api.refusals.otp = [{ code: 'otp_delivery_failed' }];
  await api.install(page);
  await freezeClock(page, api);
  await page.goto(flowLink());

  await expect(heading(page, 'Confirm your email address')).toBeVisible();
  await expect(page.getByText('Attempt 1 of 5')).toBeVisible();
  const address = page.getByRole('textbox', { name: 'Email address' });
  await expect(address).toHaveAttribute('type', 'email');
  await expect(address).toHaveAttribute('autocomplete', 'email');
  await address.fill(` ${EMAIL} `);
  const send = page.getByRole('button', { name: 'Send code' });
  await send.click();

  // C64.1: the delivery failure is said at the address, which takes focus.
  await expect(address).toBeFocused();
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await expect(address).toHaveAccessibleDescription(
    'We could not send a code to this email address. Check it and try again, or use another email address.',
  );
  await send.click();

  await expect(heading(page, 'Enter the code')).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'We sent a code to' })).toHaveText(
    'We sent a code to c•••@example.test.',
  );
  await expect(page.getByRole('button', { name: 'Change email address' })).toBeVisible();
  // A code pasted with a space is taken without it.
  await page.getByRole('textbox', { name: 'Code' }).fill('246 810');
  const confirm = page.getByRole('button', { name: 'Confirm' });
  await expectTargetSize(confirm);
  await confirm.click();

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  expect(api.otpSends.map(({ body }) => body)).toEqual([
    { 'email-address': EMAIL },
    { 'email-address': EMAIL },
  ]);
  expect(api.otpConfirms.map(({ body }) => body)).toEqual([{ code: '246810' }]);
  expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
    ['verification/email-address', 'passed'],
  ]);
  expect(errors).toEqual([]);
});

test('refuses an address the browser cannot use, with focus on it, before any request (C55.8)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = emailApi();
  await api.install(page);
  await page.goto(flowLink());

  const address = page.getByRole('textbox', { name: 'Email address' });
  await address.fill('casey@');
  await page.getByRole('button', { name: 'Send code' }).click();

  await expect(address).toBeFocused();
  await expect(address).toHaveAttribute('aria-invalid', 'true');
  await expect(address).toHaveAccessibleDescription(
    'Enter an email address in the correct format, like name@example.com.',
  );
  expect(api.verifications).toEqual([]);
  expect(api.otpSends).toEqual([]);
  expect(errors).toEqual([]);
});

test('asks for a new code once the code expired on the frozen clock (C55.4, C55.6)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = emailApi();
  await api.install(page);
  await freezeClock(page, api);
  await page.goto(flowLink());
  await page.getByRole('textbox', { name: 'Email address' }).fill(EMAIL);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(heading(page, 'Enter the code')).toBeFocused();

  // Ten minutes on: the code has expired, and a new one may be asked for.
  await advanceClock(page, api, 600_000);
  await expect(page.getByRole('alert')).toHaveText('This code has expired. Ask for a new code.');
  await expect(page.getByRole('status').last()).toHaveText('You can now ask for a new code.');
  await page.getByRole('button', { name: 'Send a new code' }).click();
  await expect(page.getByText('We sent a new code to c•••@example.test.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Code' }).fill(api.otpCode);
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  expect(api.otpSends).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('speaks Spanish (C64.1)', async ({ page }) => {
  const errors = collectUnexpectedErrors(page);
  const api = emailApi();
  await api.install(page);
  await freezeClock(page, api);
  await page.goto(`/?lang=es${flowLink()}`.replace('/#', '#'));

  await expect(heading(page, 'Confirma tu correo electrónico')).toBeVisible();
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(EMAIL);
  await page.getByRole('button', { name: 'Enviar código' }).click();

  await expect(heading(page, 'Escribe el código')).toBeFocused();
  await expect(page.getByText('Enviamos un código a c•••@example.test.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Código', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar' })).toBeVisible();
  expect(errors).toEqual([]);
});
