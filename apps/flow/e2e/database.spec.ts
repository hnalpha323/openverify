/**
 * C52.3, C64.1 in the browser, against the mocked API: the database form. Each field has its
 * name as its label, its autofill token, and a required mark beside the label (hidden from
 * assistive technology; the control itself is required). Values the browser refuses are marked
 * with focus on the first; a 422's JSON Pointers come back to their fields, or, when none is on
 * the screen, to the summary, which takes focus. The values go without the empty ones, then the
 * verification is submitted; a resumed attempt whose values arrived is sent for checking.
 */
import { expect, test } from '@playwright/test';
import { MockFlowApi, PHASE5_CONSENT_GIVEN, flowLink, phase5Flow } from './support/mock-flow-api';
import {
  collectUnexpectedErrors,
  expectRequiredMark,
  expectTargetSize,
  heading,
} from './support/phase5';

/** Synthetic: an invented person at an invented address, with a number kept for drama. */
const PERSON = {
  'name-first': 'Alex',
  'name-last': 'Example',
  birthdate: '1990-04-01',
  'address-street-1': '1 Example Street',
  'address-city': 'Exampleton',
  'address-postal-code': 'EX1 1AA',
  'address-country-code': 'GB',
} as const;

function databaseApi(): MockFlowApi {
  const api = new MockFlowApi();
  api.flow = phase5Flow('records', {
    id: 'records',
    type: 'database',
    fields: [
      'name_first',
      'name_last',
      'birthdate',
      'address_street_1',
      'address_street_2',
      'address_city',
      'address_subdivision',
      'address_postal_code',
      'address_country_code',
      'phone_number',
    ],
    requiredFields: ['birthdate', 'address_street_1'],
  });
  api.consent = { ...PHASE5_CONSENT_GIVEN, textKeys: [...PHASE5_CONSENT_GIVEN.textKeys] };
  return api;
}

test('fills the database form: required marks, the browser’s checks, a 422 pointer at its field, then the values without the empty ones (C52.3, C64.1)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = databaseApi();
  api.refusedInputs.push(['/birthdate']);
  api.pendingPolls = 1;
  await api.install(page);
  await page.goto(flowLink());

  await expect(heading(page, 'Enter your details')).toBeVisible();
  await expect(page.getByText('Attempt 1 of 1')).toBeVisible();
  await expect(page.getByText('Fields marked * are required.')).toBeVisible();
  const first = page.getByRole('textbox', { name: 'First name', exact: true });
  const last = page.getByRole('textbox', { name: 'Last name', exact: true });
  const birthdate = page.getByLabel('Date of birth', { exact: true });
  const address = page.getByRole('group', { name: 'Address' });
  const line1 = address.getByRole('textbox', { name: 'Address line 1', exact: true });
  const line2 = address.getByRole('textbox', { name: 'Address line 2', exact: true });
  const city = address.getByRole('textbox', { name: 'Town or city', exact: true });
  const region = address.getByRole('textbox', { name: 'State, province or region', exact: true });
  const postalCode = address.getByRole('textbox', { name: 'Postal code', exact: true });
  const country = address.getByRole('combobox', { name: 'Country', exact: true });
  const phone = page.getByRole('textbox', { name: 'Phone number', exact: true });

  // C52.3: the step's required fields and the three every database step needs are marked.
  for (const field of [first, last, birthdate, line1, country]) {
    await expectRequiredMark(field);
  }
  for (const field of [line2, city, region, postalCode, phone]) {
    await expect(field).not.toHaveAttribute('required');
  }
  for (const [field, token] of [
    [first, 'given-name'],
    [last, 'family-name'],
    [birthdate, 'bday'],
    [line1, 'address-line1'],
    [line2, 'address-line2'],
    [city, 'address-level2'],
    [region, 'address-level1'],
    [postalCode, 'postal-code'],
    [country, 'country'],
    [phone, 'tel'],
  ] as const) {
    await expect(field).toHaveAttribute('autocomplete', token);
  }
  await expect(birthdate).toHaveAttribute('type', 'date');
  await expect(phone).toHaveAccessibleDescription('Include your country code.');
  // Countries are named by the browser's Intl, in the flow's language.
  await expect(country.getByRole('option', { name: 'United Kingdom' })).toHaveCount(1);
  await expect(country).toHaveValue('');
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expectTargetSize(continueButton);

  // Nothing entered: the summary says so and the first marked field takes focus.
  await continueButton.click();
  await expect(page.getByRole('alert')).toHaveText('Check the details marked below.');
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute('aria-invalid', 'true');
  await expect(first).toHaveAccessibleDescription('Enter your first name.');
  await expect(birthdate).toHaveAccessibleDescription('Enter your date of birth.');
  await expect(line1).toHaveAccessibleDescription('Enter the first line of your address.');
  await expect(country).toHaveAccessibleDescription('Choose your country.');
  await expect(line2).not.toHaveAttribute('aria-invalid');
  expect(api.verifications).toEqual([]);

  await first.fill(PERSON['name-first']);
  await last.fill(PERSON['name-last']);
  await birthdate.fill(PERSON.birthdate);
  await line1.fill(PERSON['address-street-1']);
  await city.fill(PERSON['address-city']);
  await postalCode.fill(PERSON['address-postal-code']);
  await country.selectOption(PERSON['address-country-code']);
  await phone.fill('+44 20 7946 0958');
  await continueButton.click();

  // C52.3: the server refused the birth date; its pointer marks the field, which takes focus.
  await expect(birthdate).toBeFocused();
  await expect(birthdate).toHaveAttribute('aria-invalid', 'true');
  await expect(birthdate).toHaveAccessibleDescription(
    'This was not accepted. Check it and try again.',
  );
  await expect(page.getByRole('alert')).toHaveText('Check the details marked below.');
  await expect(first).not.toHaveAttribute('aria-invalid');

  await birthdate.fill('1990-04-02');
  await continueButton.click();

  await expect(heading(page, 'Checking your verification')).toBeFocused();
  await expect(page.getByRole('status')).toHaveText(
    'This usually takes a few seconds. Keep this page open.',
  );
  await expect(heading(page, 'Verification submitted')).toBeFocused();
  const person = { ...PERSON, 'phone-number': '+442079460958' };
  expect(api.enteredValues.map(({ body }) => body)).toEqual([
    person,
    { ...person, birthdate: '1990-04-02' },
  ]);
  expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
    ['verification/database', 'passed'],
  ]);
  expect(api.submits).toEqual([{ verificationId: api.verifications[0]?.id, body: null }]);
  expect(errors).toEqual([]);
});

test('moves focus to the summary when the server refuses a member no field shows (C52.3, WCAG 2.2 AA)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = databaseApi();
  api.refusedInputs.push(['/identification-number']);
  await api.install(page);
  await page.goto(flowLink());

  await page.getByRole('textbox', { name: 'First name', exact: true }).fill(PERSON['name-first']);
  await page.getByRole('textbox', { name: 'Last name', exact: true }).fill(PERSON['name-last']);
  await page.getByLabel('Date of birth', { exact: true }).fill(PERSON.birthdate);
  await page
    .getByRole('textbox', { name: 'Address line 1', exact: true })
    .fill(PERSON['address-street-1']);
  await page.getByRole('combobox', { name: 'Country' }).selectOption('GB');
  await page.getByRole('button', { name: 'Continue' }).click();

  const summary = page.getByRole('alert');
  await expect(summary).toHaveText('Some details were not accepted. Check them and try again.');
  await expect(summary).toBeFocused();
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  expect(api.submits).toEqual([]);
  expect(errors).toEqual([]);
});

test('sends values the server already holds for checking when the flow resumes (C52.2, C64.1)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = databaseApi();
  api.verifications.push({
    type: 'verification/database',
    id: 'ver_01M5CK16P0D13FXHZSS4TCFB00',
    status: 'initiated',
    hints: [],
    values: { ...PERSON },
    inputsReceived: true,
  });
  await api.install(page);
  await page.goto(flowLink());

  await expect(heading(page, 'Enter your details')).toBeVisible();
  await expect(
    page.getByText('We received your details. Send them for checking, or change them below.'),
  ).toBeVisible();
  const sendReceived = page.getByRole('button', { name: 'Send for checking' });
  await expectTargetSize(sendReceived);
  await sendReceived.click();

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  expect(api.enteredValues).toEqual([]);
  expect(api.submits).toEqual([{ verificationId: 'ver_01M5CK16P0D13FXHZSS4TCFB00', body: null }]);
  expect(errors).toEqual([]);
});

test('speaks Spanish (C64.1)', async ({ page }) => {
  const errors = collectUnexpectedErrors(page);
  const api = databaseApi();
  await api.install(page);
  await page.goto(`/?lang=es${flowLink()}`.replace('/#', '#'));

  await expect(heading(page, 'Introduce tus datos')).toBeVisible();
  await expect(page.getByText('Los campos marcados con * son obligatorios.')).toBeVisible();
  const address = page.getByRole('group', { name: 'Dirección' });
  await expect(address.getByRole('textbox', { name: 'Línea 1 de la dirección' })).toBeVisible();
  const country = address.getByRole('combobox', { name: 'País' });
  await expect(country.getByRole('option', { name: 'Elige un país' })).toHaveCount(1);
  await expect(country.getByRole('option', { name: 'Reino Unido' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Revisa los datos marcados abajo.');
  await expect(page.getByRole('textbox', { name: 'Nombre', exact: true })).toBeFocused();
  expect(errors).toEqual([]);
});
