/**
 * C171.3 (Workflow 9A, flow-renderer): our own tests of the WCAG 2.2 criteria axe cannot check, on
 * the web flow: 2.4.11 (focus not obscured), 3.2.6 (consistent help: the language selector's fixed
 * slot after every step), 3.3.7 (redundant entry: screen -> phone_otp and database -> phone_otp
 * through `prefillFrom`), 3.3.8 (a code may be pasted into one `one-time-code` field) and 2.5.8
 * (targets of at least 24 CSS px). 1.4.10 and 1.4.12 are the pseudo-locale spec's. 3.1.2 (Workflow
 * 9D): a screen's text the fallback took from the default locale names its language.
 */
import { expect, test } from '@playwright/test';
import { phase5Flow } from './support/mock-flow-api';
import { at, rendererScript, type ServedPosition } from './support/mock-flow-renderer';
import { DONE, ON_EVERY_KIND, openAt } from './support/screens';
import { coveredWhileTabbing, helpSlotAfterMain, smallTargets } from './support/wcag-checks';

const PHONE = { id: 'phone', type: 'phone_otp', allowedCountries: ['US', 'GB'] } as const;
const RECORDS = {
  id: 'records',
  type: 'database',
  fields: ['name_first', 'name_last', 'address_country_code', 'phone_number'],
  maxAttempts: 1,
} as const;
const MOBILE = '+12025550143';

const phoneFlow = () =>
  phase5Flow('prefill', { ...PHONE, allowedCountries: [...PHONE.allowedCountries] });

test('2.4.11: no focused control of a screen is covered by anything', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openAt(page, ON_EVERY_KIND);
  await expect(page.getByRole('heading', { level: 1, name: 'About you' })).toBeVisible();

  expect(await coveredWhileTabbing(page, 40)).toEqual([]);
});

test('3.2.6: the help slot sits after the step, in the same place on every screen', async ({
  page,
}) => {
  const mock = await openAt(page, ON_EVERY_KIND);
  rendererScript(mock).onSubmit = () => DONE;
  const slotAfterMain = () => helpSlotAfterMain(page);

  await expect(page.getByRole('heading', { level: 1, name: 'About you' })).toBeVisible();
  expect(await slotAfterMain()).toBe(true);
  await page.getByRole('radio', { name: 'No' }).check();
  await page.getByRole('textbox', { name: 'Street address' }).fill('1 Example Road');
  await page.getByRole('textbox', { name: 'City' }).fill('Springfield');
  await page.getByRole('textbox', { name: 'Postal code' }).fill('12345');
  await page.getByRole('combobox', { name: 'Country', exact: true }).selectOption('US');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
  ).toBeVisible();
  expect(await slotAfterMain()).toBe(true);
});

test.describe('3.3.7: a value entered once is shown again, filled and editable', () => {
  test('screen -> phone_otp through prefillFrom', async ({ page }) => {
    const screen: ServedPosition = {
      position: at('contact'),
      step: {
        id: 'contact',
        type: 'screen',
        components: [
          { id: 'title', kind: 'text', variant: 'title', copyKey: 'contact.title' },
          { id: 'tel', kind: 'phone', field: 'mobile', labelKey: 'contact.tel', required: true },
          { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
        ],
      },
      copy: { messages: { en: { 'contact.title': 'How to reach you', 'contact.tel': 'Mobile' } } },
    };
    const mock = await openAt(page, screen, { flow: phoneFlow() });
    rendererScript(mock).onSubmit = ({ body }) => ({
      position: at('phone', 'active', 'contact'),
      step: PHONE,
      values: { mobile: body.values.mobile ?? null },
    });

    await page.getByRole('textbox', { name: 'Mobile' }).fill(MOBILE);
    await page.getByRole('button', { name: 'Continue' }).click();

    const number = page.getByRole('textbox', { name: 'Phone number' });
    await expect(number).toHaveValue(MOBILE);
    await expect(number).toBeEditable();
  });

  test('database -> phone_otp through prefillFrom', async ({ page }) => {
    await openAt(
      page,
      { position: at('records'), step: RECORDS, values: { phone_number: MOBILE } },
      { flow: phase5Flow('prefill', { ...RECORDS, fields: [...RECORDS.fields] }) },
    );

    await expect(page.getByRole('textbox', { name: 'Phone number' })).toHaveValue(MOBILE);

    // The database step's phone number feeds the phone step's prefill: the server serves it there.
    await openAt(
      page,
      { position: at('phone', 'active', 'records'), step: PHONE, values: { phone_number: MOBILE } },
      { flow: phoneFlow() },
    );
    await expect(page.getByRole('textbox', { name: 'Phone number' })).toHaveValue(MOBILE);
  });
});

test('3.3.8: the code is one one-time-code field that takes a paste', async ({ page }) => {
  await openAt(page, { position: at('phone'), step: PHONE }, { flow: phoneFlow() });

  await page.getByRole('textbox', { name: 'Phone number' }).fill('202 555 0143');
  await page.getByRole('button', { name: 'Send code' }).click();
  const code = page.getByRole('textbox', { name: 'Code' });
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(page.getByRole('textbox')).toHaveCount(1);

  const prevented = await code.evaluate((input) => {
    const data = new DataTransfer();
    data.setData('text/plain', '123456');
    const paste = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(paste);
    return paste.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await code.focus();
  await page.keyboard.insertText('123456');
  await expect(code).toHaveValue('123456');
});

test('2.5.8: every control of a screen is at least 24 by 24 CSS px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await openAt(page, ON_EVERY_KIND);
  await expect(page.getByRole('heading', { level: 1, name: 'About you' })).toBeVisible();

  expect(await smallTargets(page)).toEqual([]);
});

test('3.1.2: a screen’s text the fallback took from English names its language on a Spanish page', async ({
  page,
}) => {
  await openAt(
    page,
    { ...ON_EVERY_KIND, locales: { enabled: ['en', 'es'], default: 'en' } },
    { language: 'es' },
  );

  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  const title = page.getByRole('heading', { level: 1, name: 'About you' });
  await expect(title.locator('[lang="en"]')).toHaveText('About you');
  await expect(page.locator('label', { hasText: 'First name' }).locator('[lang="en"]')).toHaveCount(
    1,
  );
  // The flow's own words are Spanish, in the page's language.
  await expect(page.locator('footer[data-slot="help"] label')).not.toHaveAttribute('lang', /./u);
  await expect(page.locator('footer[data-slot="help"] label [lang]')).toHaveCount(0);
});
