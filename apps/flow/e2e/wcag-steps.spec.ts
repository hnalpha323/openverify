/**
 * C171.3 (Workflow 9D, `a11y-audit`): our own WCAG tests on every client step type, where
 * `wcag-own.spec.ts` checks the screen step only. Each of the 16 types at arrival, in English at 320
 * CSS px (the matrix's `<type>:arrival` state, reached by the mocked server):
 *
 * - 2.4.11: tabbing through the page, no focused control is covered by anything (`elementFromPoint`
 *   at its centre and corners);
 * - 2.5.8: every shown control is at least 24 by 24 CSS px;
 * - 3.2.6: the help slot (the language selector) follows the step, in one place on every screen;
 * - the step's accessibility tree, roles and names, as `toMatchAriaSnapshot` keeps it
 *   (`wcag-steps.spec.ts-snapshots/<type>.aria.yml`; a change to a screen's structure fails here
 *   until the snapshot is reviewed and updated).
 */
import { expect, test } from '@playwright/test';
import { CLIENT_STEP_TYPES } from './support/a11y-matrix';
import { closeEmbedding, openState } from './support/a11y-states';
import { coveredWhileTabbing, helpSlotAfterMain, smallTargets } from './support/wcag-checks';

/** More presses than any step screen has stops, so focus goes round the whole page. */
const PRESSES = 30;

test.afterAll(async () => {
  await closeEmbedding();
});

for (const type of CLIENT_STEP_TYPES) {
  test(`a ${type} step: 2.4.11, 2.5.8, 3.2.6 and its accessibility tree`, async ({ page }) => {
    await openState(page, `${type}:arrival`, {
      locale: 'en',
      scheme: 'light',
      mode: 'hosted',
      width: 320,
    });

    await expect(page.locator('main')).toMatchAriaSnapshot({ name: `${type}.aria.yml` });
    expect.soft(await smallTargets(page), '2.5.8: controls under 24 by 24 CSS px').toEqual([]);
    expect.soft(await helpSlotAfterMain(page), '3.2.6: the help slot after the step').toBe(true);
    expect(await coveredWhileTabbing(page, PRESSES), '2.4.11: covered focus').toEqual([]);
  });
}
