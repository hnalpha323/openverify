/**
 * C52.3, C61, C64.1 in the browser, against the mocked API: the business registry and business
 * website forms. The business form's verification is made when the screen opens, so the inputs
 * every match group needs are marked before the user types; its registration number is checked
 * for the chosen country's register and its LEI's check digits; up to ten people are groups of
 * their own, each 422 pointer coming back to its person. The website form checks its URL as the
 * server does and makes its verification only when sending. Every value here is synthetic.
 */
import { expect, test, type Page } from '@playwright/test';
import { MockFlowApi, PHASE5_CONSENT_GIVEN, flowLink, phase5Flow } from './support/mock-flow-api';
import {
  collectUnexpectedErrors,
  expectRequiredMark,
  expectTargetSize,
  heading,
} from './support/phase5';

/** An invented business; nothing here names a real company. */
const COMPANY = 'Example Widgets Ltd';

/**
 * A synthetic LEI (ISO 17442): 18 invented characters and the ISO 7064 MOD 97-10 check digits
 * that make it valid; it names no registered entity.
 */
function syntheticLei(base = 'OPENVERIFYSYNTH001'): string {
  let remainder = 0;
  for (const character of `${base}00`) {
    for (const digit of String(Number.parseInt(character, 36))) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return `${base}${String(98 - remainder).padStart(2, '0')}`;
}

function businessApi(collectAssociatedPersons = false): MockFlowApi {
  const api = new MockFlowApi();
  api.flow = phase5Flow('kyb', {
    id: 'business',
    type: 'database_business',
    collectAssociatedPersons,
  });
  api.consent = { ...PHASE5_CONSENT_GIVEN, textKeys: [...PHASE5_CONSENT_GIVEN.textKeys] };
  return api;
}

function websiteApi(): MockFlowApi {
  const api = new MockFlowApi();
  api.flow = phase5Flow('website', { id: 'website', type: 'business_website' });
  api.consent = { ...PHASE5_CONSENT_GIVEN, textKeys: [...PHASE5_CONSENT_GIVEN.textKeys] };
  return api;
}

const field = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });

test('fills the business form: the guidance’s required inputs marked on opening, the register’s format per country, an LEI’s check digits (C52.3, C61, C64.1)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = businessApi();
  api.businessRequiredInputs = ['business-name', 'registration-number'];
  api.pendingPolls = 1;
  await api.install(page);
  await page.goto(flowLink());

  await expect(heading(page, 'Tell us about your business')).toBeFocused();
  const name = field(page, 'Business name');
  const country = page.getByRole('combobox', { name: 'Country of registration', exact: true });
  const number = field(page, 'Registration number');
  const lei = field(page, 'Legal Entity Identifier (LEI)');
  // C52.2: made on opening, the verification's guidance marks the registration number required.
  await expect(number).toHaveAttribute('required', '');
  for (const required of [name, country, number]) {
    await expectRequiredMark(required);
  }
  await expect(lei).not.toHaveAttribute('required');
  await expect(name).toHaveAttribute('autocomplete', 'organization');
  const address = page.getByRole('group', { name: 'Registered address' });
  await expect(address.getByRole('textbox')).toHaveCount(5);

  await name.fill(COMPANY);
  await country.selectOption('GB');
  await expect(number).toHaveAccessibleDescription(
    'For a UK company, the 8-character Companies House number, like 01234567 or SC123456.',
  );
  await number.fill('sc123456');
  const lastDigit = syntheticLei().slice(-1);
  await lei.fill(`${syntheticLei().slice(0, -1)}${lastDigit === '0' ? '1' : '0'}`);
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expectTargetSize(continueButton);
  await continueButton.click();

  await expect(page.getByRole('alert')).toHaveText('Check the details marked below.');
  await expect(number).toBeFocused();
  await expect(number).toHaveAccessibleDescription(
    'For a UK company, the 8-character Companies House number, like 01234567 or SC123456. Enter the 8-character company number, like 01234567 or SC123456.',
  );
  await expect(lei).toHaveAccessibleDescription(
    'The 20-character code from the global LEI register. Leave it out if the business has none. Enter the 20-character LEI exactly as it is registered.',
  );
  expect(api.enteredValues).toEqual([]);

  await number.fill('SC123456');
  await lei.fill(syntheticLei());
  await address.getByRole('textbox', { name: 'Town or city', exact: true }).fill('Exampleton');
  await continueButton.click();

  await expect(heading(page, 'Checking your verification')).toBeFocused();
  await expect(heading(page, 'Verification submitted')).toBeFocused();
  expect(api.enteredValues.map(({ body }) => body)).toEqual([
    {
      'business-name': COMPANY,
      'country-code': 'GB',
      'registration-number': 'SC123456',
      lei: syntheticLei(),
      'address-city': 'Exampleton',
    },
  ]);
  expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
    ['verification/database-business', 'passed'],
  ]);
  expect(errors).toEqual([]);
});

test('collects the business’s people in groups of their own, with focus on each new one and a 422 pointer back at its person (C52.3, WCAG 2.2 AA)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = businessApi(true);
  api.refusedInputs.push(['/associated-persons/1/name-last']);
  await api.install(page);
  await page.goto(flowLink());

  await field(page, 'Business name').fill(COMPANY);
  await page
    .getByRole('combobox', { name: 'Country of registration', exact: true })
    .selectOption('FR');
  const people = page.getByRole('group', { name: 'People who own or run the business' });
  const add = people.getByRole('button', { name: 'Add a person' });
  await expectTargetSize(add);
  await add.click();
  const first = page.getByRole('group', { name: 'Person 1', exact: true });
  await expect(first.getByRole('textbox', { name: 'First name', exact: true })).toBeFocused();
  await expectRequiredMark(first.getByRole('textbox', { name: 'First name', exact: true }));
  await expect(first.getByRole('textbox', { name: 'First name', exact: true })).toHaveAttribute(
    'autocomplete',
    'off',
  );
  await first.getByRole('textbox', { name: 'First name', exact: true }).fill('Robin');
  await first.getByRole('textbox', { name: 'Last name', exact: true }).fill('Sample');
  await first.getByRole('textbox', { name: 'Month or date of birth', exact: true }).fill('1980-04');
  await add.click();
  const second = page.getByRole('group', { name: 'Person 2', exact: true });
  await second.getByRole('textbox', { name: 'First name', exact: true }).fill('Casey');
  await second.getByRole('textbox', { name: 'Last name', exact: true }).fill('Placeholder');
  await page.getByRole('button', { name: 'Continue' }).click();

  const refusedLast = second.getByRole('textbox', { name: 'Last name', exact: true });
  await expect(refusedLast).toBeFocused();
  await expect(refusedLast).toHaveAccessibleDescription(
    'This was not accepted. Check it and try again.',
  );
  await expect(first.getByRole('textbox', { name: 'Last name', exact: true })).not.toHaveAttribute(
    'aria-invalid',
  );
  expect(api.enteredValues.map(({ body }) => body)).toEqual([
    {
      'business-name': COMPANY,
      'country-code': 'FR',
      'associated-persons': [
        { 'name-first': 'Robin', 'name-last': 'Sample', birthdate: '1980-04' },
        { 'name-first': 'Casey', 'name-last': 'Placeholder' },
      ],
    },
  ]);

  // Removing the first person keeps the second's values; focus returns to the add button.
  await first.getByRole('button', { name: 'Remove person 1' }).click();
  await expect(add).toBeFocused();
  await expect(
    page.getByRole('group', { name: 'Person 1', exact: true }).getByRole('textbox', {
      name: 'First name',
      exact: true,
    }),
  ).toHaveValue('Casey');
  await expect(page.getByRole('group', { name: 'Person 2', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('fills the website form: the URL checked as the server does, the verification made only when sending (C52.3, C61.3)', async ({
  page,
}) => {
  const errors = collectUnexpectedErrors(page);
  const api = websiteApi();
  await api.install(page);
  await page.goto(flowLink());

  await expect(heading(page, 'Enter your business website')).toBeFocused();
  await expect(
    page.getByText('We check that the website’s address exists. We never open the website itself.'),
  ).toBeVisible();
  const url = field(page, 'Website address');
  await expectRequiredMark(url);
  await expect(url).toHaveAttribute('type', 'url');
  await expect(url).toHaveAttribute('inputmode', 'url');
  await expect(url).toHaveAttribute('autocomplete', 'url');
  await expect(field(page, 'Business name')).not.toHaveAttribute('required');
  expect(api.verifications).toEqual([]);

  for (const refused of [
    'www.example.com',
    'https://user:secret@example.com',
    'https://192.0.2.1',
  ]) {
    await url.fill(refused);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(url).toBeFocused();
    await expect(url).toHaveAttribute('aria-invalid', 'true');
    await expect(url).toHaveAccessibleDescription(
      'Include https:// or http://, like https://www.example.com. Enter the full web address, starting with https:// or http://, like https://www.example.com.',
    );
  }
  expect(api.verifications).toEqual([]);

  await url.fill('https://shop.example.com/about');
  await field(page, 'Business name').fill(COMPANY);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(heading(page, 'Verification submitted')).toBeVisible();
  expect(api.enteredValues.map(({ body }) => body)).toEqual([
    { 'website-url': 'https://shop.example.com/about', 'business-name': COMPANY },
  ]);
  expect(api.verifications.map(({ type, status }) => [type, status])).toEqual([
    ['verification/business-website', 'passed'],
  ]);
  expect(errors).toEqual([]);
});

test('speaks Spanish (C64.1)', async ({ page }) => {
  const errors = collectUnexpectedErrors(page);
  const api = businessApi(true);
  await api.install(page);
  await page.goto(`/?lang=es${flowLink()}`.replace('/#', '#'));

  await expect(heading(page, 'Háblanos de tu empresa')).toBeVisible();
  await expect(field(page, 'Nombre de la empresa')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Domicilio registrado' })).toBeVisible();
  await page.getByRole('button', { name: 'Añadir una persona' }).click();
  await expect(page.getByRole('group', { name: 'Persona 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Revisa los datos marcados abajo.');
  await expect(field(page, 'Nombre de la empresa')).toBeFocused();
  expect(errors).toEqual([]);
});
