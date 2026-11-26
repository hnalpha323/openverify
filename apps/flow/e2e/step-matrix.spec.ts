/**
 * C171.2 (Workflow 9A, flow-renderer; Workflow 9D, a11y-audit): every state of the web flow through
 * axe, in the configurations of `support/a11y-matrix.ts`:
 *
 * - by default, C171.2's CI matrix: every state of the catalog in `en` at 320 CSS px light, `ar` at
 *   320 CSS px dark, `en-XA` at 320 CSS px light and `ar-XB` at 320 CSS px dark, hosted; and per
 *   client step type, its arrival at 768 CSS px and embedded by `@openverify/js` (at 375 CSS px);
 * - with `OPENVERIFY_FLOW_A11Y_CROSS_PRODUCT=1`, which CI never sets, the full cross product (84
 *   configurations a state), run once by the audit in shards:
 *   `OPENVERIFY_FLOW_A11Y_CROSS_PRODUCT=1 pnpm --filter @openverify/flow exec playwright test
 *   --config e2e/playwright.config.ts --project=chromium e2e/step-matrix.spec.ts --shard=<i>/<N>`.
 *
 * Each state is reached by the mocked server's answers (`support/a11y-states.ts`); the screen step's
 * interactions, the waiting state's polling and the redirect are `screens.spec.ts`' and
 * `server-position.spec.ts`'.
 */
import { test } from '@playwright/test';
import { expectAccessible } from './support/accessible';
import { matrixRuns, runTitle, type A11yStateId } from './support/a11y-matrix';
import { STATE_RECIPES, closeEmbedding, openState } from './support/a11y-states';

const isStateId = (id: string): id is A11yStateId => Object.hasOwn(STATE_RECIPES, id);

test.afterAll(async () => {
  await closeEmbedding();
});

for (const run of matrixRuns(process.env)) {
  const { id } = run.state;
  if (!isStateId(id)) {
    throw new Error(`No recipe reaches the state ${id}`);
  }
  test(runTitle(run), async ({ page }) => {
    await openState(page, id, run.configuration);
    await expectAccessible(page, { where: runTitle(run) });
  });
}
