/**
 * C161.7, C171.2, C171.3 (Workflow 9A, flow-renderer): every state of the screen step and the
 * server-position screens in both pseudo-locales at 320 CSS px (WCAG 1.4.10), under the text-spacing
 * override of WCAG 1.4.12, with flow-i18n's checks (no sideways scrolling, no cut text, no text
 * outside a catalog message) and axe. The copy is served as the session's operator copy, so the flow
 * applies it over its built-in messages as it does any operator's (C162.5).
 */
import { expect, test, type Page } from '@playwright/test';
import { pseudoLocalize, type PseudoLocale } from '../../../packages/flow-spec/src/pseudo-locale';
import { expectAccessible } from './support/accessible';
import { at, rendererScript, type ServedPosition } from './support/mock-flow-renderer';
import {
  PSEUDO_BASE_LANGUAGE,
  PSEUDO_LOCALES,
  PSEUDO_VIEWPORT,
  expectPseudoLocalized,
  pseudoCopy,
} from './support/pseudo-locale';
import { ON_EVERY_KIND, openAt } from './support/screens';

// The override of WCAG 1.4.12's text spacing, which the flow must take without losing content.
const TEXT_SPACING = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-block-end: 2em !important; }
`;

test.use({ viewport: PSEUDO_VIEWPORT, bypassCSP: true });

/** The screen's own copy in `locale`, beside every built-in message. */
function copyIn(locale: PseudoLocale): NonNullable<ServedPosition['copy']> {
  const base = PSEUDO_BASE_LANGUAGE[locale];
  const english = ON_EVERY_KIND.copy?.messages.en ?? {};
  const screen = Object.fromEntries(
    Object.entries(english).map(([key, text]) => [key, pseudoLocalize(locale, text)]),
  );
  return { messages: { [base]: { ...(pseudoCopy(locale).messages[base] ?? {}), ...screen } } };
}

/** Values the person typed, and the language names the selector shows in themselves. */
const ALLOWED = ['Sam', 'English', 'العربية'];

async function check(page: Page, where: string) {
  await page.addStyleTag({ content: TEXT_SPACING });
  await expectPseudoLocalized(page, where, {
    allowedTexts: ALLOWED,
    ignoreSelectors: ['footer[data-slot="help"] option', 'select option'],
  });
  await expectAccessible(page, { where });
}

for (const locale of PSEUDO_LOCALES) {
  test(`the screen step and the server-position screens in ${locale}`, async ({ page }) => {
    const base = PSEUDO_BASE_LANGUAGE[locale];
    const copy = copyIn(locale);
    const mock = await openAt(
      page,
      {
        ...ON_EVERY_KIND,
        copy,
        locales: { enabled: [base], default: base },
      },
      { language: base },
    );
    rendererScript(mock).onSubmit = () => ({
      position: at('age_route', 'waiting', 'about'),
      copy,
      locales: { enabled: [base], default: base },
    });

    await expect(page.getByRole('heading', { level: 1 })).toContainText('[');
    await check(page, `screen arrival, ${locale}`);

    // "Yes" shows the pet's name, which is required: the submit then names it in the summary.
    for (const radio of await page.getByRole('radio').all()) {
      if ((await radio.getAttribute('value')) === 'yes') await radio.check();
    }
    await page
      .getByRole('button')
      .filter({ hasText: pseudoLocalize(locale, 'Continue') })
      .first()
      .click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await check(page, `screen errors, ${locale}`);

    for (const radio of await page.getByRole('radio').all()) {
      if ((await radio.getAttribute('value')) === 'no') await radio.check();
    }
    await page.locator('input[name="street"]').fill('1');
    await page.locator('input[name="city"]').fill('2');
    await page.locator('input[name="postcode"]').fill('3');
    await page.locator('select[name="addr_country"]').selectOption('US');
    await page
      .getByRole('button')
      .filter({ hasText: pseudoLocalize(locale, 'Continue') })
      .first()
      .click();
    await expect(page.getByRole('status').first()).toBeVisible();
    await check(page, `waiting, ${locale}`);
  });
}
