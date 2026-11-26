/**
 * C148 (Workflow 9A, flow-renderer): the `screen` step in the browser, at the server's position, each
 * state checked by axe on C171.2's CI matrix: English at 320 CSS px light, Arabic at 320 CSS px dark,
 * and one run at 768 CSS px. Branches are the mocked server's answers: the flow evaluates nothing.
 */
import { expect, test, type Page } from '@playwright/test';
import { expectAccessible } from './support/accessible';
import { at, rendererScript, type ServedPosition } from './support/mock-flow-renderer';
import { DONE, ON_EVERY_KIND, openAt } from './support/screens';

const NARROW = { width: 320, height: 720 };

const SECOND: ServedPosition = {
  position: at('more', 'active', 'about'),
  step: {
    id: 'more',
    type: 'screen',
    components: [
      { id: 'title', kind: 'text', variant: 'title', copyKey: 'more.title' },
      { id: 'go', kind: 'button', labelKey: 'screen.continue', action: 'submit' },
    ],
  },
  copy: { messages: { en: { 'more.title': 'One more thing' }, ar: { 'more.title': 'أمر أخير' } } },
};

async function fillRequired(page: Page) {
  await page.getByRole('radio', { name: 'No' }).check();
  await page.getByRole('textbox', { name: 'Street address' }).fill('1 Example Road');
  await page.getByRole('textbox', { name: 'City' }).fill('Springfield');
  await page.getByRole('textbox', { name: 'Postal code' }).fill('12345');
  await page.getByRole('combobox', { name: 'Country', exact: true }).selectOption('US');
}

test.describe('in English at 320 CSS px, light (C171.2)', () => {
  test.use({ viewport: NARROW, colorScheme: 'light' });

  test('every state of a screen of every kind, then the branch the server takes', async ({
    page,
  }) => {
    const mock = await openAt(page, ON_EVERY_KIND);
    const script = rendererScript(mock);
    script.onSubmit = ({ body }) => (body.button === 'skip' ? DONE : SECOND);

    // Arrival: the server's values filled (3.3.7), a masked value shown as provided.
    await expect(page.getByRole('heading', { level: 1, name: 'About you' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'First name' })).toHaveValue('Sam');
    await expect(page.getByLabel('Tax number')).toHaveAccessibleDescription(/Already provided/u);
    await expectAccessible(page, { where: 'screen: arrival (en, 320, light)' });

    // A rule over the screen's own fields shows a component (C148.4).
    await page.getByRole('radio', { name: 'Yes' }).check();
    await expect(page.getByRole('textbox', { name: 'Pet name' })).toBeVisible();
    await expectAccessible(page, { where: 'screen: conditional field shown (en)' });

    // The error summary, linked to each field (C148.7).
    await page.getByRole('button', { name: 'Continue' }).click();
    const summary = page.getByRole('alert').filter({ hasText: 'Check these answers:' });
    await expect(summary).toBeVisible();
    await expect(summary.getByRole('link', { name: 'Pet name' })).toBeVisible();
    await expectAccessible(page, { where: 'screen: error summary (en)' });

    // The answers filled; the server's answer to "Continue" is a second screen.
    await fillRequired(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'One more thing' })).toBeVisible();
    await expectAccessible(page, { where: 'screen: second screen (en)' });
    expect(script.submissions.at(-1)?.body).toEqual({
      values: expect.objectContaining({ name_first: 'Sam', has_pet: 'no', city: 'Springfield' }),
    });
    expect(script.submissions.at(-1)?.body.values).not.toHaveProperty('pet_name');
    expect(script.declaredSpecs.every((header) => header === '1, 2')).toBe(true);
  });

  test('the other button takes the other branch the server chose', async ({ page }) => {
    const mock = await openAt(page, ON_EVERY_KIND);
    rendererScript(mock).onSubmit = ({ body }) => (body.button === 'skip' ? DONE : SECOND);

    await fillRequired(page);
    await page.getByRole('button', { name: 'Skip for now' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Verification submitted' }),
    ).toBeVisible();
    expect(rendererScript(mock).submissions.at(-1)?.body.button).toBe('skip');
    await expectAccessible(page, { where: 'completion (en, 320, light)' });
  });
});

test.describe('in Arabic at 320 CSS px, dark (C171.2)', () => {
  test.use({ viewport: NARROW, colorScheme: 'dark' });

  test('every state of the screen, right to left', async ({ page }) => {
    const mock = await openAt(page, ON_EVERY_KIND, { language: 'ar', styleVariant: 'dark' });
    rendererScript(mock).onSubmit = () => SECOND;

    await expect(page.getByRole('heading', { level: 1, name: 'عنك' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('data-openverify-variant', 'dark');
    await expectAccessible(page, { where: 'screen: arrival (ar, 320, dark)' });

    await page.getByRole('radio', { name: 'نعم' }).check();
    await page.getByRole('button', { name: 'متابعة' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'يُرجى مراجعة هذه الإجابات:' }),
    ).toBeVisible();
    await expectAccessible(page, { where: 'screen: error summary (ar, 320, dark)' });

    // An age typed on an Arabic keyboard reaches the server in ASCII digits (C161.4).
    await page.getByRole('textbox', { name: 'العمر' }).fill('٤٢');
    await expect(page.getByRole('textbox', { name: 'العمر' })).toHaveValue('42');
  });
});

test.describe('at 768 CSS px (C171.2: one run per step type)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('a screen', async ({ page }) => {
    await openAt(page, ON_EVERY_KIND);

    await expect(page.getByRole('heading', { level: 1, name: 'About you' })).toBeVisible();
    await expectAccessible(page, { where: 'screen (en, 768)' });
  });
});
