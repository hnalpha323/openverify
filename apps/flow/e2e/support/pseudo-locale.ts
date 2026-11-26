/**
 * C161.7 (decision 35; review F11): the mocked suite's pseudo-locale pass. `flow-renderer` writes
 * the spec that renders every step in both pseudo-locales; this file gives it the viewport, the
 * catalogs and the check, so each spec does:
 *
 *     await page.setViewportSize(PSEUDO_VIEWPORT);
 *     // serve the session with `copy: pseudoCopy('ar-XB')` and the locale `ar`, open the step, then
 *     await expectPseudoLocalized(page, 'consent, ar-XB');
 *
 * The check fails on sideways scrolling at 320 CSS px (WCAG 1.4.10), on text its box cuts, and on
 * visible text outside a bracketed message (text that is not in a catalog).
 */
import { expect, type Page } from '@playwright/test';
import { PSEUDO_LOCALES } from '../../../../packages/flow-spec/src/pseudo-locale';
import {
  findPseudoLocaleProblems,
  type PseudoLocaleCheckOptions,
  type PseudoLocaleProblems,
} from './pseudo-locale-checks';

export { PSEUDO_BASE_LANGUAGE, pseudoCopy, pseudoMessages } from './pseudo-locale-catalog';
export { findPseudoLocaleProblems, type PseudoLocaleCheckOptions } from './pseudo-locale-checks';

/** Both pseudo-locales, for `for (const locale of PSEUDO_LOCALES)` in a spec. */
export { PSEUDO_LOCALES };

/** The narrowest width the flow supports (C171.2), at which every step must reflow. */
export const PSEUDO_VIEWPORT = Object.freeze({ width: 320, height: 720 });

const NO_PROBLEMS: PseudoLocaleProblems = { horizontalScroll: false, clipped: [], unbracketed: [] };

/** Fails, naming `where`, when the page shows any pseudo-locale problem. */
export async function expectPseudoLocalized(
  page: Page,
  where: string,
  options: PseudoLocaleCheckOptions = {},
): Promise<void> {
  const problems = await page.evaluate(findPseudoLocaleProblems, options);

  expect(problems, `pseudo-locale problems on ${where}`).toEqual(NO_PROBLEMS);
}
